/** Client for the Smashup analysis service (`backend/smashup`). */

import type { StemName, Word } from '@/model/types'

const BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/$/, '')

export function apiUrl(path: string): string {
  return `${BASE}${path}`
}

export interface ServiceHealth {
  ok: boolean
  demucs: boolean
  whisper: boolean
  align: boolean
  whisper_model?: string
}

export async function checkService(): Promise<ServiceHealth | null> {
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 5000)
    const r = await fetch(apiUrl('/api/smashup/health'), { signal: ctl.signal })
    clearTimeout(timer)
    if (!r.ok) return null
    const j = (await r.json()) as ServiceHealth
    return j.ok ? j : null
  } catch {
    return null
  }
}

export interface ServiceHit {
  w: string
  start: number
  end: number
  p: number
  source: 'asr' | 'aligned'
}

export interface AnalyzeResult {
  hash: string
  language: string | null
  words: Word[]
  hits: ServiceHit[]
  stems: Record<StemName, string> | null
  stems_error?: string | null
}

interface Job {
  status: 'queued' | 'running' | 'done' | 'error'
  stage?: string
  progress?: number
  error?: string
  result?: AnalyzeResult
}

export async function analyzeRemote(
  file: Blob,
  fileName: string,
  keywords: string[],
  onProgress: (stage: string, pct: number) => void,
): Promise<AnalyzeResult> {
  const fd = new FormData()
  fd.append('file', file, fileName)
  fd.append('keywords', keywords.join(','))
  const r = await fetch(apiUrl('/api/smashup/analyze'), { method: 'POST', body: fd })
  if (!r.ok) throw new Error(`analysis service: ${r.status} ${await r.text().catch(() => '')}`)
  const { job_id } = (await r.json()) as { job_id: string }
  for (;;) {
    const j = (await (await fetch(apiUrl(`/api/smashup/jobs/${job_id}`))).json()) as Job
    if (j.status === 'done' && j.result) return j.result
    if (j.status === 'error') throw new Error(j.error || 'analysis failed')
    onProgress(j.stage ?? j.status, j.progress ?? 0)
    await new Promise((res) => setTimeout(res, 2000))
  }
}

export async function fetchStem(url: string): Promise<Blob> {
  const r = await fetch(apiUrl(url))
  if (!r.ok) throw new Error(`stem download failed: ${r.status}`)
  return r.blob()
}

/* ── LRCLib fallback (line-synced lyrics → interpolated word times) ──── */

interface LrcResult {
  trackName?: string
  artistName?: string
  syncedLyrics?: string | null
  plainLyrics?: string | null
  duration?: number
}

export interface LyricsLookup {
  words: Word[] | null
  /** Why nothing usable came back — shown on the Word Wall. */
  note: string
}

const LRC_TOLERANCE = 30

async function lrcFetch(path: string): Promise<unknown> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 8000)
  try {
    const r = await fetch(`https://lrclib.net${path}`, { signal: ctl.signal })
    return r.ok ? await r.json() : null
  } finally {
    clearTimeout(timer)
  }
}

/** Query variants, most specific first: template query, title, cleaned filename. */
export function lyricQueries(...raw: (string | null | undefined)[]): string[] {
  const clean = (q: string) =>
    q
      .replace(/\.[a-z0-9]{2,4}$/i, '')
      .replace(/[_]+/g, ' ')
      .replace(/\s*[([](official|lyrics?|audio|video|hd|4k|full song)[^)\]]*[)\]]/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
  const out: string[] = []
  for (const q of raw) {
    if (!q) continue
    const c = clean(q)
    if (c && !out.some((o) => o.toLowerCase() === c.toLowerCase())) out.push(c)
  }
  return out
}

export async function lyricsWords(queries: string[], duration: number): Promise<LyricsLookup> {
  let sawAny = false
  let sawSynced = false
  try {
    for (const q of queries) {
      const list = ((await lrcFetch(`/api/search?q=${encodeURIComponent(q)}`)) as LrcResult[] | null) ?? []
      if (list.length) sawAny = true
      const synced = list.filter((x) => x.syncedLyrics)
      if (synced.length) sawSynced = true
      const best = synced
        .filter((x) => Math.abs((x.duration ?? duration) - duration) <= LRC_TOLERANCE)
        .sort((a, b) => Math.abs((a.duration ?? 0) - duration) - Math.abs((b.duration ?? 0) - duration))[0]
      if (best?.syncedLyrics) {
        return { words: lrcToWords(best.syncedLyrics, duration), note: `lyrics: ${best.trackName ?? q}${best.artistName ? ` — ${best.artistName}` : ''}` }
      }
    }
  } catch {
    return { words: null, note: 'lyrics service unreachable' }
  }
  if (!sawAny) return { words: null, note: `no lyrics found for "${queries[0] ?? ''}"` }
  if (!sawSynced) return { words: null, note: 'only unsynced lyrics exist for this song' }
  return { words: null, note: 'synced lyrics found, but for a different length/version' }
}

export function lrcToWords(lrc: string, duration: number): Word[] {
  const lines: { t: number; text: string }[] = []
  for (const raw of lrc.split('\n')) {
    const m = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/)
    if (m) lines.push({ t: parseInt(m[1], 10) * 60 + parseFloat(m[2]), text: m[3].trim() })
  }
  const words: Word[] = []
  lines.forEach((ln, i) => {
    const toks = ln.text.split(/\s+/).filter(Boolean)
    if (!toks.length) return
    const end = Math.min(lines[i + 1]?.t ?? duration, ln.t + 6)
    const chars = toks.reduce((s, w) => s + w.length + 1, 0)
    let t = ln.t
    for (const w of toks) {
      const d = ((end - ln.t) * 0.9 * (w.length + 1)) / chars
      words.push({ w, start: +t.toFixed(3), end: +(t + d * 0.9).toFixed(3), p: 0.45 })
      t += d
    }
  })
  return words
}
