/**
 * Per-song analysis pipeline. Stages report progress so the UI can fill the
 * Word Wall and pads live:
 *   decode → on-device music analysis (Worker) → stems → words
 *   (sidecar | service | in-browser Whisper | LRCLib) → keyword hits
 *   (+ onset refine, lyric cross-check) → moments → pads
 * `rescanWords` re-runs just the word stage for an analysed song.
 */

import type { Hit, Song, SongAnalysis, StemName, Word } from '@/model/types'
import { STEM_NAMES } from '@/model/types'
import { analyzeRemote, fetchStem, lyricQueries, lyricsWords, type ServiceHealth } from '@/api/service'
import { getBlob, putBlob } from '@/store/persist'
import { labelRoles, refineOnset, stemDensity } from './music'
import { assignPads, buildMoments } from './cues'
import { findHits, hitId } from './keywordMatch'
import { toAsrInput, transcribeInBrowser, type AsrLanguage } from './asr'
import type { Candidate, Seed } from './spotter'

export interface SongSource {
  blob: Blob
  fileName: string
  hash: string
  sidecarWords?: Word[] | null
  /** Pre-separated stems (demo crate). */
  stems?: Partial<Record<StemName, Blob>> | null
}

export interface PipelineDeps {
  aliases: string[]
  service: ServiceHealth | null
  language: AsrLanguage
  /** In-browser Whisper on/off (on by default). */
  browserAsr: boolean
  update: (patch: Partial<Song>) => void
}

let worker: Worker | null = null
let reqId = 0
const pending = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>()

function callWorker<T>(msg: Record<string, unknown>, transfer: Transferable[]): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.ok) p.resolve(e.data.result)
      else p.reject(new Error(e.data.error || 'worker failed'))
    }
  }
  const id = ++reqId
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (r: unknown) => void, reject })
    worker!.postMessage({ id, ...msg }, transfer)
  })
}

const analyzeInWorker = (pcm: Float32Array, sr: number) => callWorker<SongAnalysis>({ kind: 'analyze', pcm, sr }, [pcm.buffer])

export function spotInWorker(songs: { pcm: Float32Array; sr: number }[], seeds: Seed[]): Promise<Candidate[][]> {
  return callWorker<Candidate[][]>({ kind: 'spot', songs, seeds }, songs.map((s) => s.pcm.buffer))
}

async function decodeBuffer(blob: Blob): Promise<AudioBuffer> {
  return new OfflineAudioContext(1, 1, 44100).decodeAudioData(await blob.arrayBuffer())
}

function toMono(buf: AudioBuffer): Float32Array {
  const mono = new Float32Array(buf.length)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels
  }
  return mono
}

async function decodeMono(blob: Blob): Promise<{ mono: Float32Array; sr: number }> {
  const buf = await decodeBuffer(blob)
  return { mono: toMono(buf), sr: buf.sampleRate }
}

/** The best audio to listen for words in: vocal stem when present, else the full mix. */
export async function listeningSource(hash: string, hasStems: boolean): Promise<{ buf: AudioBuffer; isVocal: boolean } | null> {
  const blob = (hasStems && (await getBlob(`${hash}:vocals`))) || (await getBlob(`${hash}:full`))
  if (!blob) return null
  return { buf: await decodeBuffer(blob), isVocal: hasStems }
}

interface WordsResult {
  words: Word[] | null
  source: Song['wordsSource']
  note: string
  /** Lyric-only hits that ASR didn't hear — offered as suggestions. */
  softHits: Hit[]
  lyricHitTimes: number[]
}

/** Local word detection: in-browser Whisper, then LRCLib (also used to cross-check). */
async function localWords(song: Song, hash: string, hasStems: boolean, duration: number, deps: PipelineDeps): Promise<WordsResult> {
  const { update, aliases } = deps
  const notes: string[] = []
  let asrWords: Word[] | null = null
  if (deps.browserAsr) {
    try {
      const src = await listeningSource(hash, hasStems)
      if (src) {
        update({ stage: 'Preparing audio for listening', progress: 40 })
        const pcm = await toAsrInput(src.buf, src.isVocal)
        asrWords = await transcribeInBrowser(hash, pcm, deps.language, aliases, (p) =>
          update({
            stage: p.stage === 'download' ? `Downloading speech model (once) ${Math.round(p.pct)}%` : `Listening for “${aliases[0]}” ${Math.round(p.pct)}%`,
            progress: p.stage === 'download' ? 40 + p.pct * 0.1 : 50 + p.pct * 0.35,
          }),
        )
        const n = findHits(asrWords, aliases, song.id, 'asr-local').length
        notes.push(n ? `heard “${aliases[0]}” ${n}× (in-browser Whisper)` : `transcribed ${asrWords.length} words in-browser; “${aliases[0]}” not heard clearly`)
      }
    } catch (e) {
      notes.push(`in-browser transcription failed (${e instanceof Error ? e.message : e})`)
    }
  }

  update({ stage: 'Checking lyrics', progress: 88 })
  const lyr = await lyricsWords(lyricQueries(song.query, song.title, song.fileName), duration)
  const lyricHits = lyr.words ? findHits(lyr.words, aliases, song.id, 'lyrics') : []
  notes.push(lyr.words ? (lyricHits.length ? `${lyr.note} (${lyricHits.length} lines with the word)` : `${lyr.note} — keyword not in them`) : lyr.note)

  const asrHits = asrWords ? findHits(asrWords, aliases, song.id, 'asr-local') : []
  if (asrHits.length) {
    const soft = lyricHits
      .filter((l) => !asrHits.some((a) => Math.abs(a.start - l.start) < 1.5))
      .map((h) => ({ ...h, accepted: false, suggested: true, confidence: 0.35 }))
    return { words: asrWords, source: 'browser', note: notes.join(' · '), softHits: soft, lyricHitTimes: lyricHits.map((h) => h.start) }
  }
  if (lyricHits.length) return { words: lyr.words, source: 'lyrics', note: notes.join(' · '), softHits: [], lyricHitTimes: [] }
  return {
    words: asrWords ?? lyr.words,
    source: asrWords ? 'browser' : lyr.words ? 'lyrics' : 'none',
    note: `${notes.join(' · ')} — mark one “${aliases[0]}” and use Find all`,
    softHits: [],
    lyricHitTimes: [],
  }
}

/** Words → hits: onset-snap, lyric cross-check boost, keep the user's manual/match hits. */
async function finishHits(
  song: Song,
  analysis: SongAnalysis,
  words: Word[] | null,
  source: Song['wordsSource'],
  aliases: string[],
  onset: { x: Float32Array; sr: number } | null,
  extra: { serviceHits?: Hit[] | null; softHits?: Hit[]; lyricHitTimes?: number[]; keep?: Hit[] },
): Promise<Hit[]> {
  const hitSource: Hit['source'] = source === 'sidecar' ? 'sidecar' : source === 'lyrics' ? 'lyrics' : source === 'browser' ? 'asr-local' : 'asr'
  const base = extra.serviceHits ?? findHits(words ?? [], aliases, song.id, hitSource)
  const snapped = [...base, ...(extra.softHits ?? [])].map((h) => {
    let out = h
    if (onset && h.source !== 'aligned' && h.source !== 'sidecar') out = { ...h, start: refineOnset(onset.x, onset.sr, h.start, h.source === 'lyrics' ? 0.25 : 0.08) }
    if (extra.lyricHitTimes?.some((t) => Math.abs(t - out.start) < 1.5)) out = { ...out, confidence: Math.min(1, out.confidence + 0.2) }
    return out
  })
  const keep = (extra.keep ?? []).filter((k) => !snapped.some((h) => Math.abs(h.start - k.start) < 0.15))
  return [...snapped, ...keep].sort((a, b) => a.start - b.start)
}

export async function analyzeSong(song: Song, src: SongSource, deps: PipelineDeps): Promise<void> {
  const { update } = deps
  try {
    update({ status: 'decoding', stage: 'Decoding', progress: 5, error: null, hash: src.hash, fileName: src.fileName })
    const { mono, sr } = await decodeMono(src.blob)
    const keep: Float32Array = mono.slice() // worker takes ownership of the transferred copy
    update({ status: 'analyzing', stage: 'Beat grid · key · phrases', progress: 15 })
    const analysis = await analyzeInWorker(mono, sr)
    update({ analysis, stage: 'Listening for the word', progress: 30 })

    // Words + stems.
    let words: Word[] | null = null
    let wordsSource: Song['wordsSource'] = 'none'
    let serviceHits: Hit[] | null = null
    let hasStems = false
    if (src.stems && STEM_NAMES.every((s) => src.stems?.[s])) {
      for (const s of STEM_NAMES) await putBlob(`${src.hash}:${s}`, src.stems[s]!)
      hasStems = true
    }
    if (src.sidecarWords?.length) {
      words = src.sidecarWords
      wordsSource = 'sidecar'
    } else if (deps.service?.whisper) {
      update({ status: 'remote', stage: 'Stems + word alignment (service)', progress: 36 })
      try {
        const res = await analyzeRemote(src.blob, src.fileName, deps.aliases, (stage, pct) =>
          update({ stage: `Service: ${stage}`, progress: 36 + pct * 0.5 }),
        )
        words = res.words
        wordsSource = 'service'
        serviceHits = res.hits.map((h) => ({
          id: hitId(song.id),
          songId: song.id,
          text: h.w.replace(/[,.!?]+$/, ''),
          start: h.start,
          end: Math.max(h.end, h.start + 0.12),
          confidence: h.p,
          source: h.source,
          accepted: true,
          cluster: 0,
          iconic: 0,
        }))
        if (res.stems) {
          update({ stage: 'Downloading stems', progress: 86 })
          for (const s of STEM_NAMES) await putBlob(`${src.hash}:${s}`, await fetchStem(res.stems[s]))
          hasStems = true
        }
      } catch (e) {
        console.warn('[smashup] service analysis failed, falling back', e)
        update({ stage: 'Service unavailable — listening in the browser' })
      }
    }
    // Real vocal density from the stem beats the spectral guess.
    let onset = { x: keep, sr }
    if (hasStems) {
      update({ stage: 'Vocal density from stem', progress: 38 })
      const vb = await getBlob(`${src.hash}:vocals`)
      if (vb) {
        const v = await decodeMono(vb)
        analysis.vocal = stemDensity(v.mono, v.sr, analysis.bars, analysis.duration)
        labelRoles(analysis.sections, analysis.vocal)
        onset = { x: v.mono, sr: v.sr }
      }
    }

    let note = wordsSource === 'sidecar' ? 'words from sidecar file' : wordsSource === 'service' ? 'words from analysis service' : ''
    let softHits: Hit[] = []
    let lyricHitTimes: number[] = []
    if (!words) {
      const local = await localWords({ ...song, fileName: src.fileName }, src.hash, hasStems, analysis.duration, deps)
      words = local.words
      wordsSource = local.source
      note = local.note
      softHits = local.softHits
      lyricHitTimes = local.lyricHitTimes
    }
    const hits = await finishHits(song, analysis, words, wordsSource, deps.aliases, onset, { serviceHits, softHits, lyricHitTimes })
    const moments = buildMoments(song.id, analysis, hits)
    const pads = assignPads(moments, song.padLabels)
    update({
      analysis,
      words,
      wordsSource,
      wordsNote: note,
      hits,
      moments,
      pads,
      hasStems,
      status: 'ready',
      stage: hits.length ? `${hits.filter((h) => h.accepted).length} hits` : 'No hits — mark one on the Word Wall',
      progress: 100,
    })
  } catch (e) {
    update({ status: 'error', error: e instanceof Error ? e.message : String(e), stage: 'Failed' })
  }
}

/** Re-run only the word stage (no re-decode / beat analysis). Keeps manual + matched hits. */
export async function rescanWords(song: Song, deps: PipelineDeps): Promise<void> {
  const { update } = deps
  if (!song.analysis || !song.hash) return
  try {
    update({ status: 'analyzing', stage: 'Listening for the word', progress: 35, error: null })
    const src = await listeningSource(song.hash, song.hasStems)
    const onset = src ? { x: toMono(src.buf), sr: src.buf.sampleRate } : null
    const local = await localWords(song, song.hash, song.hasStems, song.analysis.duration, deps)
    const keep = song.hits.filter((h) => h.source === 'manual' || h.source === 'match' || h.source === 'sidecar')
    const hits = await finishHits(song, song.analysis, local.words, local.source, deps.aliases, onset, { softHits: local.softHits, lyricHitTimes: local.lyricHitTimes, keep })
    const moments = buildMoments(song.id, song.analysis, hits)
    update({
      words: local.words,
      wordsSource: local.source,
      wordsNote: local.note,
      hits,
      moments,
      pads: assignPads(moments, song.padLabels),
      status: 'ready',
      progress: 100,
      stage: hits.some((h) => h.accepted) ? `${hits.filter((h) => h.accepted).length} hits` : 'No hits — mark one on the Word Wall',
    })
  } catch (e) {
    update({ status: 'ready', progress: 100, stage: 'Word scan failed', wordsNote: e instanceof Error ? e.message : String(e) })
  }
}

/** Rebuild moments + pads after hit edits (accept/reject/nudge/manual). */
export function rebuildMoments(song: Song): Pick<Song, 'moments' | 'pads'> {
  if (!song.analysis) return { moments: [], pads: [] }
  const moments = buildMoments(song.id, song.analysis, song.hits)
  return { moments, pads: assignPads(moments, song.padLabels) }
}
