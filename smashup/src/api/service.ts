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
  syncedLyrics?: string | null
  duration?: number
}

export async function lyricsWords(query: string, duration: number): Promise<Word[] | null> {
  try {
    const r = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`)
    if (!r.ok) return null
    const list = (await r.json()) as LrcResult[]
    const best = list
      .filter((x) => x.syncedLyrics)
      .sort((a, b) => Math.abs((a.duration ?? 0) - duration) - Math.abs((b.duration ?? 0) - duration))[0]
    if (!best?.syncedLyrics || Math.abs((best.duration ?? duration) - duration) > 20) return null
    return lrcToWords(best.syncedLyrics, duration)
  } catch {
    return null
  }
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
