/**
 * Hits → Moments → Pads.
 *
 * A Moment is phrase-aligned: it starts on a downbeat (or the bar holding the
 * keyword's pickup) and runs a whole number of bars, so any two Moments can be
 * butted together on the master grid. Roles follow how DJs label hot cues:
 * Call (first strong hit), Build (pre-hook), Chant (densest hit cluster),
 * Drop (high energy, low vocal), plus Intro / Outro / Breath for structure.
 */

import type { Hit, Moment, MomentRole, Pad, SongAnalysis } from '@/model/types'
import { PAD_ROLE_NAMES } from '@/model/types'

export function barAt(a: SongAnalysis, t: number): number {
  const { bars } = a
  let lo = 0
  let hi = bars.length - 1
  if (hi < 0 || t < bars[0]) return 0
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (bars[mid] <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

export function barLen(a: SongAnalysis): number {
  return a.beatInterval * 4
}

/** Score clusters + iconic-ness in place. Returns accepted hits sorted by time. */
export function scoreHits(hits: Hit[], a: SongAnalysis): Hit[] {
  const acc = hits.filter((h) => h.accepted).sort((x, y) => x.start - y.start)
  const span = barLen(a) * 2
  for (const h of hits) {
    const near = acc.filter((o) => Math.abs(o.start - h.start) <= span).length
    h.cluster = near
    const e = a.energy[barAt(a, h.start)] ?? 0.5
    h.iconic = Math.min(1, 0.45 * Math.min(1, near / 4) + 0.35 * e + 0.2 * h.confidence)
  }
  return acc
}

interface MomentDraft {
  role: MomentRole
  startBar: number
  bars: number
  label: string
}

/**
 * Start bar for a hit: the bar it falls in, unless the word sits in the last
 * beat of the bar (a pickup) — then the *next* bar's downbeat is where the
 * hook "lands", and we start one bar earlier so the pickup is heard.
 */
function anchorBar(a: SongAnalysis, t: number): number {
  // A word sung a hair before the detected downbeat belongs to that downbeat's bar.
  return Math.max(0, barAt(a, t + a.beatInterval * 0.25))
}

export function buildMoments(songId: string, a: SongAnalysis, hits: Hit[]): Moment[] {
  const nBars = a.bars.length
  if (nBars < 4) return []
  const acc = scoreHits(hits, a)
  const drafts: MomentDraft[] = []
  const clamp = (start: number, bars: number) => {
    const s = Math.max(0, Math.min(start, nBars - bars))
    return { startBar: s, bars: Math.min(bars, nBars - s) }
  }

  // 1. Cluster hits that are ≤ 2 bars apart.
  const clusters: Hit[][] = []
  for (const h of acc) {
    const last = clusters[clusters.length - 1]
    if (last && anchorBar(a, h.start) - anchorBar(a, last[last.length - 1].start) <= 2) last.push(h)
    else clusters.push([h])
  }
  for (const c of clusters) {
    const first = anchorBar(a, c[0].start)
    const lastBar = anchorBar(a, c[c.length - 1].start)
    const len = lastBar - first + 1 > 3 ? 8 : 4
    const role: MomentRole = c.length >= 3 ? 'chant' : 'call'
    drafts.push({
      role,
      ...clamp(first, len),
      label: role === 'chant' ? `${c[0].text} ×${c.length}` : `"${c[0].text}"`,
    })
  }

  // 2. Structural moments from sections.
  const sections = a.sections
  const vocalAt = (s: number, n: number) => avg(a.vocal, s, n)
  const energyAt = (s: number, n: number) => avg(a.energy, s, n)
  const intro = sections[0]
  if (intro && vocalAt(0, Math.min(8, intro.bars)) < 0.4) {
    drafts.push({ role: 'intro', ...clamp(0, Math.min(8, Math.max(4, intro.bars))), label: 'Clean intro' })
  }
  for (const s of sections) {
    if (s.role === 'drop' || (s.role === 'chorus' && vocalAt(s.startBar, s.bars) < 0.5)) {
      drafts.push({ role: 'drop', ...clamp(s.startBar, Math.min(8, s.bars)), label: 'Drop' })
    }
    if (s.role === 'build') {
      const len = Math.min(8, s.bars)
      drafts.push({ role: 'build', ...clamp(s.startBar + s.bars - len, len), label: 'Build' })
    }
    if (s.role === 'breath' && s.startBar > 0) {
      drafts.push({ role: 'breath', ...clamp(s.startBar, Math.min(8, s.bars)), label: 'Breath' })
    }
  }
  const outro = sections[sections.length - 1]
  if (outro && sections.length > 1) {
    const len = Math.min(8, Math.max(4, outro.bars))
    drafts.push({ role: 'outro', ...clamp(nBars - len, len), label: 'Outro' })
  }

  // Fallbacks so every song has a usable Drop and Build even when sectioning is flat.
  if (!drafts.some((d) => d.role === 'drop')) {
    let best = 0
    let bestE = -1
    for (let s = 0; s + 8 <= nBars; s += 4) {
      const score = energyAt(s, 8) - 0.5 * vocalAt(s, 8)
      if (score > bestE) {
        bestE = score
        best = s
      }
    }
    drafts.push({ role: 'drop', ...clamp(best, 8), label: 'Drop' })
  }
  if (!drafts.some((d) => d.role === 'build')) {
    const chant = drafts.find((d) => d.role === 'chant') ?? drafts.find((d) => d.role === 'drop')
    if (chant && chant.startBar >= 4) drafts.push({ role: 'build', ...clamp(chant.startBar - 4, 4), label: 'Pre-hook' })
  }

  // 3. Dedupe near-identical drafts (prefer keyword roles).
  const priority: Record<MomentRole, number> = { chant: 0, call: 1, drop: 2, build: 3, intro: 4, outro: 5, breath: 6 }
  drafts.sort((x, y) => priority[x.role] - priority[y.role])
  const kept: MomentDraft[] = []
  for (const d of drafts) {
    if (kept.some((k) => k.startBar === d.startBar && k.bars === d.bars)) continue
    kept.push(d)
  }
  kept.sort((x, y) => x.startBar - y.startBar)

  return kept.map((d, i) => {
    const t0 = a.bars[d.startBar]
    const t1 = a.bars[d.startBar + d.bars] ?? a.duration
    const inside = acc.filter((h) => h.start >= t0 - 0.05 && h.start < t1)
    if (d.role === 'chant' && inside.length) d.label = `${inside[0].text} ×${inside.length}`
    return {
      id: `${songId}-m${i}-${d.role}-${d.startBar}`,
      songId,
      role: d.role,
      startBar: d.startBar,
      bars: d.bars,
      hitTimes: acc.filter((h) => h.start >= t0 - 0.05 && h.start < t1).map((h) => h.start),
      energy: energyAt(d.startBar, d.bars),
      vocal: vocalAt(d.startBar, d.bars),
      label: d.label,
    }
  })
}

function avg(arr: number[], start: number, n: number): number {
  let s = 0
  let c = 0
  for (let i = start; i < start + n && i < arr.length; i++) {
    s += arr[i]
    c++
  }
  return c ? s / c : 0
}

export type PadRole = 'call' | 'build' | 'chant' | 'drop' | 'outro'
const ROLE_PRIORITY: Record<PadRole, number> = { chant: 0, drop: 1, build: 2, outro: 3, call: 4 }
const ROLE_TITLE: Record<MomentRole, string> = {
  call: 'Call', build: 'Build', chant: 'Chant', drop: 'Drop', intro: 'Intro', outro: 'Outro', breath: 'Breath',
}
export const DEFAULT_PAD_ROLES: PadRole[] = ['call', 'build', 'chant', 'drop']

/** Infer what a human pad label asks for ("Instrumental" → drop, "Full hook" → chant …). */
export function roleFromLabel(label: string, fallback: PadRole): PadRole {
  const l = label.toLowerCase()
  if (/instrumental|drop|drums|beat|dan dana/.test(l)) return 'drop'
  if (/ending|outro/.test(l)) return 'outro'
  if (/pre-?hook|build|intro/.test(l)) return 'build'
  if (/hook|chant|full/.test(l)) return 'chant'
  return fallback
}

/** Four hot-cue pads per song: Call · Build · Chant · Drop by default; template labels steer roles. */
export function assignPads(moments: Moment[], labels?: string[]): Pad[] {
  const used = new Set<string>()
  const roles = DEFAULT_PAD_ROLES.map((r, i) => (labels?.[i] ? roleFromLabel(labels[i], r) : r))
  const free = () => moments.filter((m) => !used.has(m.id))
  const best = (list: Moment[], score: (m: Moment) => number) =>
    list.reduce<Moment | null>((b, m) => (b === null || score(m) > score(b) ? m : b), null)
  const pickFor = (role: PadRole): Moment | null => {
    const f = free()
    const withHits = f.filter((m) => m.hitTimes.length > 0)
    switch (role) {
      case 'call':
        return best(withHits.filter((m) => m.role === 'call'), (m) => -m.startBar) ?? best(withHits, (m) => -m.startBar) ?? null
      case 'chant':
        return best(withHits, (m) => m.hitTimes.length * 2 + m.energy) ?? null
      case 'build':
        return best(f.filter((m) => m.role === 'build' || m.role === 'intro'), (m) => m.energy) ?? null
      case 'drop':
        return best(f.filter((m) => m.role === 'drop' || m.role === 'breath'), (m) => m.energy - m.vocal) ?? null
      case 'outro':
        return best(f.filter((m) => m.role === 'outro' || m.hitTimes.length > 0), (m) => m.startBar) ?? null
    }
  }
  // Fill the most specific roles first (chant takes the densest cluster before
  // call grabs the earliest hit), then emit in pad order.
  const order = [...roles.keys()].sort((a, b) => ROLE_PRIORITY[roles[a]] - ROLE_PRIORITY[roles[b]])
  const chosen: (Moment | null)[] = new Array(roles.length).fill(null)
  for (const i of order) {
    const m = pickFor(roles[i]) ?? best(free(), (x) => x.hitTimes.length + x.energy)
    if (m) used.add(m.id)
    chosen[i] = m
  }
  return chosen.map((m, i) => ({
    momentId: m?.id ?? null,
    label: labels?.[i] || (m ? `${ROLE_TITLE[m.role]} · ${m.label}` : PAD_ROLE_NAMES[i]),
  }))
}
