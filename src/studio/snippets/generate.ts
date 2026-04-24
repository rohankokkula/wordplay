import type { TrackAnalysis } from '../../audio/types'
import type { Snippet, SnippetDeck } from './types'

interface Args {
  deck: SnippetDeck
  title: string
  analysis: TrackAnalysis
}

/** Target snippet length in seconds — ~1 bar at 90bpm ≈ 2.7s, we aim ~8-12s. */
const MIN_LEN = 4
const MAX_LEN = 14

/**
 * Minimum vocal snippets we want per deck. Real-world tracks (especially
 * bass-heavy or bollywood/indian mixes) often slip past the client-side
 * spectral vocal detector, leaving `vocalSegments` empty. That's a crap
 * UX — the deck is useless if you can't drag any vocals. So we guarantee
 * at least this many vocal slices by deriving them from high-energy
 * regions if detection fails.
 */
const MIN_VOCAL_SNIPPETS = 3

function uid(deck: SnippetDeck, stem: string, idx: number): string {
  return `${deck}-${stem}-${idx}-${Math.random().toString(36).slice(2, 8)}`
}

/** 0..1 peak energy for a time window from the analysis energy profile. */
function windowEnergy(analysis: TrackAnalysis, startSec: number, endSec: number): number {
  const len = analysis.energyProfile.length
  if (!len || analysis.duration <= 0) return 0.5
  const s = Math.max(0, Math.floor((startSec / analysis.duration) * len))
  const e = Math.min(len, Math.ceil((endSec / analysis.duration) * len))
  let peak = 0
  for (let i = s; i < e; i++) {
    const v = analysis.energyProfile[i]
    if (v > peak) peak = v
  }
  return Math.max(0, Math.min(1, peak))
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Build vertical "drop slices" — natural-sounding clip boundaries driven by
 * the analysis: start, drop, cue points, vocal segments + hooks, and
 * uniform fill so even a flat song gets segmented.
 */
function boundaries(analysis: TrackAnalysis): number[] {
  const out = new Set<number>()
  out.add(0)
  out.add(analysis.duration)

  if (analysis.dropTime > 1 && analysis.dropTime < analysis.duration - 1) {
    out.add(analysis.dropTime)
  }

  for (const c of analysis.cuePoints ?? []) {
    if (c.time > 0 && c.time < analysis.duration) out.add(c.time)
  }

  for (const h of analysis.vocalHooks ?? []) {
    if (h.time > 0 && h.time < analysis.duration) out.add(h.time)
  }

  for (const v of analysis.vocalSegments ?? []) {
    if (v.start > 0 && v.start < analysis.duration) out.add(v.start)
    if (v.end > 0 && v.end < analysis.duration) out.add(v.end)
  }

  // Uniform fill
  const stride = Math.max(MIN_LEN * 2, Math.min(MAX_LEN * 1.6, analysis.duration / 6))
  for (let t = stride; t < analysis.duration; t += stride) out.add(t)

  const sorted = Array.from(out).sort((a, b) => a - b)
  const merged: number[] = []
  for (const t of sorted) {
    if (merged.length === 0 || t - merged[merged.length - 1] >= MIN_LEN) {
      merged.push(t)
    }
  }
  return merged
}

/** Overlap of [startSec..endSec] with detected vocal segments, as a 0..1 ratio. */
function vocalOverlapRatio(startSec: number, endSec: number, analysis: TrackAnalysis): number {
  const span = Math.max(0.001, endSec - startSec)
  let inside = 0
  for (const v of analysis.vocalSegments ?? []) {
    const overlap = Math.max(0, Math.min(endSec, v.end) - Math.max(startSec, v.start))
    inside += overlap
  }
  return inside / span
}

/**
 * Heuristic label for a window based on its position in the song and any
 * cue/hook it hits. Positional fallbacks (Intro / Verse / Drop / Outro) keep
 * the label useful even when there are no detected cues.
 */
function labelForWindow(
  startSec: number,
  endSec: number,
  analysis: TrackAnalysis,
  isVocal: boolean,
): string {
  const dur = analysis.duration
  const mid = (startSec + endSec) / 2

  for (const c of analysis.cuePoints ?? []) {
    if (Math.abs(c.time - startSec) < 1.5) return c.label
  }
  if (Math.abs(startSec - analysis.dropTime) < 2) return 'Drop'
  if (startSec < 4) return 'Intro'
  if (dur - endSec < 4) return 'Outro'

  if (isVocal) {
    const hook = (analysis.vocalHooks ?? []).find(
      (h) => h.time >= startSec - 0.5 && h.time <= endSec,
    )
    if (hook) return 'Hook'
    const pos = mid / Math.max(dur, 1)
    if (pos < 0.33) return 'Verse 1'
    if (pos < 0.66) return 'Chorus'
    return 'Verse 2'
  }

  const pos = mid / Math.max(dur, 1)
  if (pos < 0.33) return 'Bed'
  if (pos < 0.66) return 'Break'
  return 'Bridge'
}

/**
 * Turn a `TrackAnalysis` into snippet rows for both stem lanes of a deck.
 *
 * A snippet references a deck + stem + [start..end]. Playback routes through
 * the corresponding stem bus once Demucs finishes — and falls back to the
 * full-mix buffer in `masterScheduler` when stems aren't available yet or
 * failed to separate. That means the vocals lane is always useful even if
 * stem separation never returns.
 */
export function generateSnippets({ deck, title, analysis }: Args): Snippet[] {
  if (!analysis || analysis.duration <= 0) return []
  const bnds = boundaries(analysis)
  const snippets: Snippet[] = []

  /**
   * Track window (start, end) + energy + vocal-overlap score for every
   * region. We keep the full list so we can decide later whether the
   * native vocal detector yielded enough content or we need to synthesize
   * vocal snippets from energy + position.
   */
  type Region = { start: number; end: number; energy: number; vRatio: number; label: string }
  const regions: Region[] = []

  for (let i = 0; i < bnds.length - 1; i++) {
    const rawStart = bnds[i]
    const rawEnd = Math.min(bnds[i + 1], rawStart + MAX_LEN)
    if (rawEnd - rawStart < MIN_LEN) continue
    const energy = windowEnergy(analysis, rawStart, rawEnd)
    const vRatio = vocalOverlapRatio(rawStart, rawEnd, analysis)
    const isVocal = vRatio >= 0.2
    regions.push({
      start: rawStart,
      end: rawEnd,
      energy,
      vRatio,
      label: labelForWindow(rawStart, rawEnd, analysis, isVocal),
    })

    if (regions.length > 24) break
    if (rawEnd < bnds[i + 1]) bnds.splice(i + 1, 0, rawEnd)
  }

  // First pass — detected vocals (loose 20% overlap threshold).
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i]
    if (r.vRatio >= 0.2) {
      snippets.push({
        id: uid(deck, 'v', i),
        deck,
        stem: 'vocals',
        startSec: r.start,
        endSec: r.end,
        label: r.label,
        hint: `${fmtTime(r.start)} – ${fmtTime(r.end)} · vocals`,
        energy: r.energy,
        sourceTitle: title,
        bpm: analysis.bpm,
      })
    }
  }

  /*
   * Fallback — if the spectral detector missed (e.g. bass-heavy or
   * unconventional mixes), synthesize vocal snippets from the highest-energy
   * regions away from the first/last 10% of the track. This keeps the
   * vocals lane populated so users can always drag *something* onto the
   * master deck. Playback falls back to the full-mix buffer in
   * masterScheduler when Demucs hasn't produced a vocal stem yet.
   */
  const vocalCount = snippets.filter((s) => s.stem === 'vocals').length
  if (vocalCount < MIN_VOCAL_SNIPPETS && regions.length > 0) {
    const dur = analysis.duration
    const mid = regions
      .filter((r) => r.start > dur * 0.08 && r.end < dur * 0.92)
      .sort((a, b) => b.energy - a.energy)

    const existingStarts = new Set(
      snippets.filter((s) => s.stem === 'vocals').map((s) => Math.round(s.startSec * 10) / 10),
    )

    for (const r of mid) {
      const key = Math.round(r.start * 10) / 10
      if (existingStarts.has(key)) continue
      existingStarts.add(key)

      const isVocal = true
      const label = labelForWindow(r.start, r.end, analysis, isVocal)
      snippets.push({
        id: uid(deck, 'vf', snippets.length),
        deck,
        stem: 'vocals',
        startSec: r.start,
        endSec: r.end,
        label,
        hint: `${fmtTime(r.start)} – ${fmtTime(r.end)} · vocals`,
        energy: r.energy,
        sourceTitle: title,
        bpm: analysis.bpm,
      })
      const cnt = snippets.filter((s) => s.stem === 'vocals').length
      if (cnt >= MIN_VOCAL_SNIPPETS) break
    }
  }

  // Second pass — every region gets an instrument snippet so users can
  // always grab a bed to sit underneath.
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i]
    snippets.push({
      id: uid(deck, 'i', i),
      deck,
      stem: 'instruments',
      startSec: r.start,
      endSec: r.end,
      label: r.label === 'Hook' ? 'Bed' : r.label,
      hint: `${fmtTime(r.start)} – ${fmtTime(r.end)} · instrumental`,
      energy: r.energy,
      sourceTitle: title,
      bpm: analysis.bpm,
    })
  }

  return snippets.sort((a, b) => {
    if (a.stem !== b.stem) return a.stem === 'vocals' ? -1 : 1
    return a.startSec - b.startSec
  })
}

const MIN_CLIP_SEC = 0.45

/**
 * Build vocal + instrument snippets for a user-defined time range (waveform clipper).
 * Returns null if the range is invalid or shorter than `MIN_CLIP_SEC`.
 */
export function buildClipSnippetsForRegion(
  deck: SnippetDeck,
  title: string,
  analysis: TrackAnalysis,
  startSec: number,
  endSec: number,
): { vocals: Snippet; instruments: Snippet } | null {
  const d = analysis.duration
  if (d <= 0) return null
  const s0 = Math.max(0, Math.min(startSec, d - MIN_CLIP_SEC))
  const s1 = Math.max(s0 + MIN_CLIP_SEC, Math.min(endSec, d))
  if (s1 - s0 < MIN_CLIP_SEC) return null

  const energy = windowEnergy(analysis, s0, s1)
  const vRatio = vocalOverlapRatio(s0, s1, analysis)
  const isVocal = vRatio >= 0.2
  const vLabel = labelForWindow(s0, s1, analysis, isVocal)
  const iLabel = vLabel === 'Hook' ? 'Bed' : vLabel
  const idB = `clip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

  return {
    vocals: {
      id: `${idB}-v`,
      deck,
      stem: 'vocals',
      startSec: s0,
      endSec: s1,
      label: vLabel,
      hint: `Clip ${fmtTime(s0)} – ${fmtTime(s1)} · vocals`,
      energy,
      sourceTitle: title,
      bpm: analysis.bpm,
    },
    instruments: {
      id: `${idB}-i`,
      deck,
      stem: 'instruments',
      startSec: s0,
      endSec: s1,
      label: iLabel,
      hint: `Clip ${fmtTime(s0)} – ${fmtTime(s1)} · instrumental`,
      energy,
      sourceTitle: title,
      bpm: analysis.bpm,
    },
  }
}
