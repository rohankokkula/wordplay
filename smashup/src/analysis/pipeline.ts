/**
 * Per-song analysis pipeline. Stages report progress so the UI can fill the
 * Word Wall and pads live:
 *   decode → on-device music analysis (Worker) → words (service | sidecar | LRCLib)
 *   → stems → vocal density → keyword hits (+ onset refine) → moments → pads
 */

import type { Hit, Song, SongAnalysis, StemName, Word } from '@/model/types'
import { STEM_NAMES } from '@/model/types'
import { analyzeRemote, fetchStem, lyricsWords, type ServiceHealth } from '@/api/service'
import { getBlob, putBlob } from '@/store/persist'
import { analyzeMono, labelRoles, refineOnset, stemDensity } from './music'
import { assignPads, buildMoments } from './cues'
import { findHits, hitId } from './keywordMatch'

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
  query?: string
  update: (patch: Partial<Song>) => void
}

let worker: Worker | null = null
let reqId = 0
const pending = new Map<number, { resolve: (a: SongAnalysis) => void; reject: (e: Error) => void }>()

function analyzeInWorker(pcm: Float32Array, sr: number): Promise<SongAnalysis> {
  try {
    if (!worker) {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; analysis?: SongAnalysis; error?: string }>) => {
        const p = pending.get(e.data.id)
        if (!p) return
        pending.delete(e.data.id)
        if (e.data.ok && e.data.analysis) p.resolve(e.data.analysis)
        else p.reject(new Error(e.data.error || 'analysis failed'))
      }
    }
    const id = ++reqId
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      worker!.postMessage({ id, pcm, sr }, [pcm.buffer])
    })
  } catch {
    return Promise.resolve(analyzeMono(pcm, sr))
  }
}

async function decodeMono(blob: Blob): Promise<{ mono: Float32Array; sr: number }> {
  const ctx = new OfflineAudioContext(1, 1, 44100)
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
  const mono = new Float32Array(buf.length)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels
  }
  return { mono, sr: buf.sampleRate }
}

export async function analyzeSong(song: Song, src: SongSource, deps: PipelineDeps): Promise<void> {
  const { update } = deps
  try {
    update({ status: 'decoding', stage: 'Decoding', progress: 5, error: null, hash: src.hash, fileName: src.fileName })
    const { mono, sr } = await decodeMono(src.blob)
    const keep = mono.slice() // worker takes ownership of the transferred copy
    update({ status: 'analyzing', stage: 'Beat grid · key · phrases', progress: 15 })
    const analysis = await analyzeInWorker(mono, sr)
    update({ analysis, stage: 'Listening for the word', progress: 35 })

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
      update({ status: 'remote', stage: 'Stems + word alignment (service)', progress: 40 })
      try {
        const res = await analyzeRemote(src.blob, src.fileName, deps.aliases, (stage, pct) =>
          update({ stage: `Service: ${stage}`, progress: 40 + pct * 0.45 }),
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
        update({ stage: 'Service unavailable — using lyrics fallback' })
      }
    }
    if (!words) {
      words = await lyricsWords(deps.query || song.title, analysis.duration)
      wordsSource = words ? 'lyrics' : 'none'
    }

    // Real vocal density from the stem beats the spectral guess.
    let onsetSrc: Float32Array = keep
    let onsetSr = sr
    if (hasStems) {
      update({ stage: 'Vocal density from stem', progress: 90 })
      const vb = await getBlob(`${src.hash}:vocals`)
      if (vb) {
        const v = await decodeMono(vb)
        analysis.vocal = stemDensity(v.mono, v.sr, analysis.bars, analysis.duration)
        labelRoles(analysis.sections, analysis.vocal)
        onsetSrc = v.mono
        onsetSr = v.sr
      }
    }

    const source: Hit['source'] = wordsSource === 'sidecar' ? 'sidecar' : wordsSource === 'lyrics' ? 'lyrics' : 'asr'
    const hits = (serviceHits ?? findHits(words ?? [], deps.aliases, song.id, source)).map((h) =>
      h.source === 'aligned' || h.source === 'sidecar' ? h : { ...h, start: refineOnset(onsetSrc, onsetSr, h.start, h.source === 'lyrics' ? 0.25 : 0.08) },
    )
    const moments = buildMoments(song.id, analysis, hits)
    const pads = assignPads(moments, song.padLabels)
    update({
      analysis,
      words,
      wordsSource,
      hits,
      moments,
      pads,
      hasStems,
      status: 'ready',
      stage: hits.length ? `${hits.length} hits` : 'No hits — mark them on the Word Wall',
      progress: 100,
    })
  } catch (e) {
    update({ status: 'error', error: e instanceof Error ? e.message : String(e), stage: 'Failed' })
  }
}

/** Rebuild moments + pads after hit edits (accept/reject/nudge/manual). */
export function rebuildMoments(song: Song): Pick<Song, 'moments' | 'pads'> {
  if (!song.analysis) return { moments: [], pads: [] }
  const moments = buildMoments(song.id, song.analysis, song.hits)
  return { moments, pads: assignPads(moments, song.padLabels) }
}
