/**
 * The composer: beam search over Moments to write a Smashup.
 *
 * It doesn't play songs in order. It builds an arc: tease, build, peak,
 * breath, bigger peak, callback. Every step is scored on:
 *   • tension fit to the target curve,
 *   • mashup grammar: rule of three, no back-to-back drops, builds must pay off,
 *     intro only first, outro only last, bookend callback,
 *   • variety: no song twice in a row, every song used, each song returns at
 *     most twice, no repeated move back to back,
 *   • move quality at each seam.
 * Every choice records a plain-English reason for the Brain panel.
 */

import type { CurvePreset, Layer, Master, Moment, MomentRole, MoveId, Plan, SectionSpec, SeamSpec, SongAnalysis } from '@/model/types'
import { harmonicallyCompatible, shiftKey } from './compat'
import { MOVES, type MoveDef, type SeamContext, legalMoves } from './moves'

export interface BrainSong {
  id: string
  title: string
  analysis: SongAnalysis
  moments: Moment[]
  hasStems: boolean
}

export interface ComposeOptions {
  targetSec: number
  curve: CurvePreset
  seed: number
  /** Per section index: a locked spec that must appear there. */
  locks?: (SectionSpec | null)[]
  beam?: number
  plans?: number
}

const CURVES: Record<CurvePreset, [number, number][]> = {
  wave: [[0, 0.3], [0.15, 0.5], [0.3, 0.78], [0.42, 0.5], [0.6, 0.8], [0.78, 1], [0.9, 0.72], [1, 0.45]],
  climb: [[0, 0.3], [0.35, 0.55], [0.5, 0.45], [0.8, 0.85], [1, 1]],
  peak: [[0, 0.55], [0.12, 0.85], [0.45, 0.9], [0.55, 0.7], [0.8, 1], [1, 0.8]],
}

export const CURVE_LABEL: Record<CurvePreset, string> = {
  wave: 'Wave: tease → peak → breath → bigger peak → callback',
  climb: 'Climb: steady build to the finale',
  peak: 'Peak-time: start hot, stay hot',
}

export function curveAt(preset: CurvePreset, x: number): number {
  const pts = CURVES[preset]
  const t = Math.max(0, Math.min(1, x))
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x0, y0] = pts[i - 1]
    if (t <= x1) return y0 + ((t - x0) / (x1 - x0)) * (y1 - y0)
  }
  return pts[pts.length - 1][1]
}

const ROLE_TENSION: Record<MomentRole, number> = {
  drop: 0.3, chant: 0.2, build: 0.08, call: 0.05, breath: -0.15, intro: -0.12, outro: -0.1,
}

export function tensionOf(m: Moment, layer: Layer): number {
  const base = 0.15 + m.energy * 0.6 + ROLE_TENSION[m.role] + Math.min(0.1, m.hitTimes.length * 0.03)
  const l = layer === 'tease' ? -0.25 : layer === 'acapellaOver' ? 0.05 : 0
  return Math.max(0, Math.min(1, base + l))
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ── Durations ───────────────────────────────────────────────────────── */

/** A tease is a 4-bar cold open; every other layer plays the whole moment. */
export function sectionBars(m: Moment, layer?: Layer): number {
  return layer === 'tease' ? Math.min(4, m.bars) : m.bars
}

export function momentSpan(a: SongAnalysis, m: Moment, layer?: Layer): { t0: number; t1: number } {
  const t0 = a.bars[m.startBar] ?? 0
  const t1 = a.bars[m.startBar + sectionBars(m, layer)] ?? a.duration
  return { t0, t1 }
}

/** Seconds on the master clock. */
export function momentDur(song: BrainSong, m: Moment, master: Master, layer?: Layer): number {
  const { t0, t1 } = momentSpan(song.analysis, m, layer)
  return (t1 - t0) / (master.songs[song.id]?.rate ?? 1)
}

export function masterBarSec(master: Master): number {
  return 240 / master.bpm
}

/* ── Seam context + move choice ──────────────────────────────────────── */

interface Placed {
  spec: SectionSpec
  song: BrainSong
  moment: Moment
}

export function seamContextFor(a: Placed, b: Placed, master: Master): SeamContext {
  const ma = master.songs[a.song.id]
  const mb = master.songs[b.song.id]
  const ka = shiftKey(a.song.analysis.key, ma?.semitones ?? 0).camelot
  const kb = shiftKey(b.song.analysis.key, mb?.semitones ?? 0).camelot
  const bVocal = b.song.analysis.vocal[b.moment.startBar] ?? b.moment.vocal
  return {
    aRole: a.moment.role,
    bRole: b.moment.role,
    aEnergy: tensionOf(a.moment, a.spec.layer),
    bEnergy: tensionOf(b.moment, b.spec.layer),
    aHits: a.moment.hitTimes.length,
    bHits: b.moment.hitTimes.length,
    tempoBreak: Boolean(ma?.tempoBreak || mb?.tempoBreak),
    keyCompat: harmonicallyCompatible(ka, kb) && !ma?.keyClash && !mb?.keyClash,
    stems: a.song.hasStems && b.song.hasStems,
    bVocal,
  }
}

/** Audio available after A's section (tail) and before B's moment (pre-roll), master seconds. */
function seamRoom(a: Placed, b: Placed, master: Master): { aTail: number; bPre: number } {
  const ra = master.songs[a.song.id]?.rate ?? 1
  const rb = master.songs[b.song.id]?.rate ?? 1
  const { t1 } = momentSpan(a.song.analysis, a.moment, a.spec.layer)
  const { t0 } = momentSpan(b.song.analysis, b.moment, b.spec.layer)
  return { aTail: (a.song.analysis.duration - t1) / ra, bPre: t0 / rb }
}

export function moveFits(move: MoveDef, a: Placed, b: Placed, master: Master): boolean {
  const region = move.bars * masterBarSec(master)
  const { aTail, bPre } = seamRoom(a, b, master)
  // A vocal-only tease has no groove to blend or carry — it hands over with a hit.
  if (a.spec.layer === 'tease' && ['bassSwap', 'filterHandover', 'acapellaIn', 'callResponse'].includes(move.id)) return false
  switch (move.id) {
    case 'bassSwap':
    case 'filterHandover':
      return aTail >= region && bPre >= region
    case 'acapellaIn':
      return aTail >= region && momentDur(b.song, b.moment, master) > region * 1.5
    case 'dropSwap':
      return aTail >= region
    default:
      return true
  }
}

export function chooseMove(
  a: Placed,
  b: Placed,
  master: Master,
  lastMove: MoveId | null,
  counts: Partial<Record<MoveId, number>>,
  rand: () => number,
  jitter: number,
): { move: MoveDef; score: number; reason: string } {
  const ctx = seamContextFor(a, b, master)
  let best: { move: MoveDef; score: number } | null = null
  for (const m of legalMoves(ctx)) {
    if (!moveFits(m, a, b, master)) continue
    let s = m.score(ctx) + (rand() - 0.5) * jitter
    if (m.id === lastMove) s -= 0.8
    s -= Math.max(0, (counts[m.id] ?? 0) - 1) * 0.3
    if (!best || s > best.score) best = { move: m, score: s }
  }
  const move = best?.move ?? MOVES.wordCut
  return { move, score: best?.score ?? 0.5, reason: move.reason(ctx) }
}

/* ── Beam search ─────────────────────────────────────────────────────── */

interface State {
  placed: Placed[]
  seams: SeamSpec[]
  elapsed: number
  score: number
  uses: Record<string, number>
  usedMoments: Set<string>
  moveCounts: Partial<Record<MoveId, number>>
  lastMove: MoveId | null
  /** Song-time cursor where each song's beat last stopped (for acapella beds). */
  cursor: Record<string, number>
  done: boolean
}

function openerBonus(song: BrainSong, m: Moment, layer: Layer): { bonus: number; why: string } {
  const a = song.analysis
  const cleanIntro = a.vocal.slice(0, 4).every((v) => v < 0.35)
  const iconic = m.hitTimes.length
  if (layer === 'tease') return { bonus: 1.3 + iconic * 0.1, why: `cold acapella tease of its most iconic hook (${iconic} hits)` }
  if (m.role === 'intro') return { bonus: cleanIntro ? 1.0 : 0.4, why: cleanIntro ? 'it has the cleanest instrumental intro' : 'its intro sets the mood' }
  if (m.role === 'call') return { bonus: 0.6, why: 'the keyword arrives early and clearly' }
  if (m.role === 'drop') return { bonus: -1.2, why: 'a drop as an opener has nowhere to go' }
  return { bonus: 0.1, why: 'it sets up the arc' }
}

function layerOptions(song: BrainSong, m: Moment, prev: Placed | undefined, isFirst: boolean, master: Master): Layer[] {
  const out: Layer[] = ['solo']
  const hasHits = m.hitTimes.length > 0
  if (isFirst && song.hasStems && hasHits && m.vocal > 0.25) out.push('tease')
  if (prev && song.hasStems && hasHits && prev.song.hasStems) {
    const ms = master.songs[song.id]
    const mp = master.songs[prev.song.id]
    const bedId = prev.spec.layer === 'acapellaOver' ? prev.spec.bedSongId : prev.song.id
    if (bedId && bedId !== song.id && !ms?.tempoBreak && !mp?.tempoBreak && !ms?.keyClash && !mp?.keyClash) out.push('acapellaOver')
  }
  return out
}

export function compose(songs: BrainSong[], master: Master, opts: ComposeOptions): Plan[] {
  const usable = songs.filter((s) => s.moments.length > 0)
  if (usable.length === 0) return []
  const byId = new Map(usable.map((s) => [s.id, s]))
  const beamWidth = opts.beam ?? 48
  const rand = mulberry32(opts.seed)
  const jitter = opts.seed === 0 ? 0.05 : 0.45
  const target = Math.max(30, opts.targetSec)
  const maxUses = usable.length <= 2 ? 6 : 3

  let beam: State[] = [
    { placed: [], seams: [], elapsed: 0, score: 0, uses: {}, usedMoments: new Set(), moveCounts: {}, lastMove: null, cursor: {}, done: false },
  ]
  const finished: State[] = []

  for (let step = 0; step < 40 && beam.length; step++) {
    const next: State[] = []
    for (const st of beam) {
      const idx = st.placed.length
      const prev = st.placed[idx - 1]
      const lock = opts.locks?.[idx] ?? null
      const x0 = st.elapsed / target
      const nearEnd = x0 >= 0.78

      for (const song of usable) {
        for (const m of song.moments) {
          if (lock && lock.momentId !== m.id) continue
          const first = st.placed[0]
          const isCallback = nearEnd && first && first.moment.id === m.id
          if (!lock && st.usedMoments.has(m.id) && !isCallback) continue
          if (!lock && (st.uses[song.id] ?? 0) >= maxUses) continue
          if (!lock && m.role === 'intro' && idx > 0) continue
          if (!lock && m.role === 'outro' && !nearEnd) continue

          const layers = lock ? [lock.layer] : layerOptions(song, m, prev, idx === 0, master)
          for (const layer of layers) {
            const spec: SectionSpec = { momentId: m.id, layer, locked: lock?.locked, reason: '' }
            if (layer === 'acapellaOver' && prev) {
              spec.bedSongId = lock?.bedSongId ?? (prev.spec.layer === 'acapellaOver' ? prev.spec.bedSongId : prev.song.id)
              const bed = spec.bedSongId ? byId.get(spec.bedSongId) : undefined
              if (!bed) continue
              const need = momentDur(song, m, master) * (master.songs[bed.id]?.rate ?? 1)
              if ((st.cursor[bed.id] ?? 0) + need > bed.analysis.duration) continue
            }
            const placed: Placed = { spec, song, moment: m }
            const dur = momentDur(song, m, master, layer)
            let score = st.score
            const reasons: string[] = []

            // Seam into this section.
            let seam: SeamSpec | null = null
            let seamDur = 0
            let lastMove = st.lastMove
            const moveCounts = { ...st.moveCounts }
            if (prev) {
              const ch = chooseMove(prev, placed, master, st.lastMove, st.moveCounts, rand, jitter)
              seam = { move: ch.move.id, bars: ch.move.bars, reason: ch.reason }
              seamDur = ch.move.bars * masterBarSec(master)
              score += ch.score * 0.6
              lastMove = ch.move.id
              moveCounts[ch.move.id] = (moveCounts[ch.move.id] ?? 0) + 1
              if (layer === 'acapellaOver' && ch.move.id === 'acapellaIn') score -= 0.6
            }

            // Tension fit.
            const tension = tensionOf(m, layer)
            const want = curveAt(opts.curve, (st.elapsed + seamDur + dur / 2) / target)
            score -= 3 * (tension - want) ** 2
            reasons.push(`tension ${tension.toFixed(2)} vs target ${want.toFixed(2)}`)

            // Rule of three: the keyword should land 2–3 times before handing over.
            const hits = m.hitTimes.length
            score += 0.25 * Math.min(hits, 3) + (hits >= 2 && hits <= 3 ? 0.2 : 0)
            if (hits === 0 && layer !== 'tease') score -= 0.15

            // Grammar.
            if (prev) {
              const prevT = tensionOf(prev.moment, prev.spec.layer)
              if (prev.moment.role === 'drop' && m.role === 'drop') score -= 2
              if (prev.moment.role === 'build' && tension < prevT) score -= 0.5
              const peak = tension > 0.75
              const primed = ['build', 'breath', 'intro'].includes(prev.moment.role) || ['loopRoll', 'dropSwap', 'dropOut'].includes(seam!.move) || prevT < tension - 0.15
              if (peak && !primed) score -= 0.4
              if (prev.song.id === song.id && layer !== 'acapellaOver') score -= 1.5
              const recent = st.placed.slice(-3).some((p) => p.song.id === song.id)
              if (recent && prev.song.id !== song.id) score -= 0.25
              if (layer === 'acapellaOver') reasons.push(`vocal rides ${byId.get(spec.bedSongId!)?.title}'s beat`)
            } else {
              const ob = openerBonus(song, m, layer)
              score += ob.bonus
              reasons.unshift(`opens here because ${ob.why}`)
            }
            score -= Math.max(0, (st.uses[song.id] ?? 0)) * 0.3
            if (master.songs[song.id]?.tempoBreak) score -= 0.3
            if (isCallback) {
              score += 1.2
              reasons.unshift('bookend callback to the opening hook')
            }

            spec.reason = reasons.join('; ')
            const elapsed = st.elapsed + seamDur + dur
            const cursor = { ...st.cursor }
            const { t1 } = momentSpan(song.analysis, m, layer)
            cursor[song.id] = t1
            if (layer === 'acapellaOver' && spec.bedSongId) {
              cursor[spec.bedSongId] = (st.cursor[spec.bedSongId] ?? 0) + dur * (master.songs[spec.bedSongId]?.rate ?? 1)
            }
            const ns: State = {
              placed: [...st.placed, placed],
              seams: seam ? [...st.seams, seam] : st.seams,
              elapsed,
              score,
              uses: { ...st.uses, [song.id]: (st.uses[song.id] ?? 0) + 1 },
              usedMoments: new Set(st.usedMoments).add(m.id),
              moveCounts,
              lastMove,
              cursor,
              done: elapsed >= target * 0.92,
            }
            if (ns.done) finished.push(finalize(ns, usable))
            else next.push(ns)
          }
        }
      }
    }
    next.sort((a, b) => b.score - a.score)
    beam = diversify(next, beamWidth)
    if (finished.length > 600) {
      finished.sort((a, b) => b.score - a.score)
      finished.length = 200
    }
  }
  if (finished.length === 0) return []
  finished.sort((a, b) => b.score - a.score)
  return pickDiverse(finished, opts.plans ?? 3).map((s, i) => toPlan(s, opts, master, i))
}

function finalize(st: State, songs: BrainSong[]): State {
  let score = st.score
  const used = new Set(st.placed.map((p) => p.song.id))
  score += used.size * 1.2
  score -= (songs.length - used.size) * 2.5
  const first = st.placed[0]
  const last = st.placed[st.placed.length - 1]
  if (first && last && st.placed.length > 2 && first.song.id === last.song.id && last.moment.hitTimes.length) score += 1.0
  if (last && ['outro', 'chant', 'call'].includes(last.moment.role)) score += 0.4
  if (last && last.moment.role === 'build') score -= 1
  return { ...st, score }
}

/** Keep the beam from collapsing onto one opener / one song order. */
function diversify(states: State[], width: number): State[] {
  const out: State[] = []
  const perKey = new Map<string, number>()
  for (const s of states) {
    const key = s.placed.map((p) => p.song.id).join('>')
    const n = perKey.get(key) ?? 0
    if (n >= 3) continue
    perKey.set(key, n + 1)
    out.push(s)
    if (out.length >= width) break
  }
  return out
}

function pickDiverse(states: State[], k: number): State[] {
  const out: State[] = []
  for (const s of states) {
    const seq = s.placed.map((p) => p.song.id)
    const similar = out.some((o) => {
      const oseq = o.placed.map((p) => p.song.id)
      if (oseq[0] !== seq[0]) return false
      const n = Math.max(seq.length, oseq.length)
      let same = 0
      for (let i = 0; i < n; i++) if (seq[i] === oseq[i]) same++
      return same / n > 0.7
    })
    if (!similar) out.push(s)
    if (out.length >= k) break
  }
  return out
}

function toPlan(st: State, opts: ComposeOptions, master: Master, rank: number): Plan {
  const first = st.placed[0]
  const titles = [...new Set(st.placed.map((p) => p.song.title))]
  const minutes = Math.floor(st.elapsed / 60)
  const secs = Math.round(st.elapsed % 60).toString().padStart(2, '0')
  return {
    id: `plan-${opts.seed}-${rank}`,
    seed: opts.seed,
    curve: opts.curve,
    sections: st.placed.map((p) => p.spec),
    seams: st.seams,
    score: Math.round(st.score * 100) / 100,
    summary: [
      `${st.placed.length} sections · ${titles.length} songs · ${minutes}:${secs}`,
      first ? `Opens on ${first.song.title}: ${first.spec.reason.split(';')[0].replace('opens here because ', '')}` : '',
      ...master.summary.slice(0, 1),
    ].filter(Boolean),
  }
}

export { MOVES }
