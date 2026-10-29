/**
 * Master tempo + key solver and the compatibility maths behind it.
 *
 * A mashup is *produced*: everything is warped to one master tempo and pulled
 * into one harmonic neighbourhood. Limits mirror what working producers accept:
 * ±8% time-stretch before artefacts and groove loss, ±2 semitones before
 * vocals start sounding chipmunked or sluggish.
 */

import type { Camelot, Master, MusicalKey } from '@/model/types'
import { camelotOf, keyName } from '@/analysis/music'

export const MAX_WARP = 0.08
export const MAX_SHIFT = 2

export function parseCamelot(c: Camelot): { n: number; l: 'A' | 'B' } {
  return { n: parseInt(c, 10), l: c.endsWith('A') ? 'A' : 'B' }
}

/** 0 = same, 1 = relative maj/min or ±1 on the wheel, 2 = ±2 ("energy boost"), higher = clash. */
export function camelotDistance(a: Camelot, b: Camelot): number {
  const x = parseCamelot(a)
  const y = parseCamelot(b)
  const d = Math.min((x.n - y.n + 12) % 12, (y.n - x.n + 12) % 12)
  if (x.l === y.l) return d
  return d === 0 ? 1 : d + 1
}

export function harmonicallyCompatible(a: Camelot, b: Camelot): boolean {
  return camelotDistance(a, b) <= 1
}

export function shiftKey(k: MusicalKey, semitones: number): MusicalKey {
  const tonic = (((k.tonic + semitones) % 12) + 12) % 12
  return { ...k, tonic, camelot: camelotOf(tonic, k.mode) }
}

/** Effective tempo of a song against a master: the song may be half- or double-time. */
export function effectiveBpm(bpm: number, master: number): { bpm: number; barScale: number } {
  const options = [
    { bpm, barScale: 1 },
    { bpm: bpm * 2, barScale: 2 },
    { bpm: bpm / 2, barScale: 0.5 },
  ]
  return options.reduce((best, o) =>
    Math.abs(Math.log(o.bpm / master)) < Math.abs(Math.log(best.bpm / master)) ? o : best,
  )
}

export interface SongTempoKey {
  id: string
  title: string
  bpm: number
  key: MusicalKey
}

export interface SolveOptions {
  keyLock: boolean
}

export function solveMaster(songs: SongTempoKey[], opts: SolveOptions = { keyLock: true }): Master {
  if (songs.length === 0) {
    return { bpm: 120, key: { tonic: 0, mode: 'major', camelot: '8B', confidence: 0 }, songs: {}, summary: [] }
  }
  // Tempo: scan 70–180 BPM; cost = sum of log-warp, songs past MAX_WARP count as a tempo break.
  let bestBpm = songs[0].bpm
  let bestCost = Infinity
  for (let cand = 70; cand <= 180; cand += 0.25) {
    let cost = 0
    for (const s of songs) {
      const w = Math.abs(Math.log(effectiveBpm(s.bpm, cand).bpm / cand))
      cost += w <= MAX_WARP ? w : 0.25
    }
    // Gentle preference for the 85–135 club range when costs tie.
    cost += cand < 85 || cand > 135 ? 0.002 : 0
    if (cost < bestCost - 1e-9) {
      bestCost = cost
      bestBpm = cand
    }
  }
  // Snap to an exact song tempo when within 0.5 BPM — keeps that song unwarped.
  for (const s of songs) {
    const e = effectiveBpm(s.bpm, bestBpm).bpm
    if (Math.abs(e - bestBpm) < 0.5) {
      bestBpm = e
      break
    }
  }
  bestBpm = Math.round(bestBpm * 100) / 100

  // Key: try all 24 master keys; each song may shift ±MAX_SHIFT to land compatible.
  type KeyPlan = { key: MusicalKey; cost: number; shifts: Record<string, { s: number; clash: boolean }> }
  let bestKey: KeyPlan | null = null
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor'] as const) {
      const mk: MusicalKey = { tonic, mode, camelot: camelotOf(tonic, mode), confidence: 1 }
      let cost = 0
      const shifts: KeyPlan['shifts'] = {}
      for (const s of songs) {
        const weight = 0.4 + 0.6 * s.key.confidence
        let best = { s: 0, c: Infinity, clash: true }
        const range = opts.keyLock ? MAX_SHIFT : 0
        for (let sh = range ? -range : 0; sh <= range; sh++) {
          const d = camelotDistance(shiftKey(s.key, sh).camelot, mk.camelot)
          if (d > 1) continue
          const c = Math.abs(sh) * 0.6 + d * 0.4
          if (c < best.c) best = { s: sh, c, clash: false }
        }
        if (best.clash) best = { s: 0, c: 3, clash: true }
        cost += best.c * weight
        shifts[s.id] = { s: best.s, clash: best.clash }
      }
      if (!bestKey || cost < bestKey.cost) bestKey = { key: mk, cost, shifts }
    }
  }
  const plan = bestKey!

  const out: Master['songs'] = {}
  const summary: string[] = [`Master ${bestBpm} BPM · ${keyName(plan.key)} (${plan.key.camelot})`]
  for (const s of songs) {
    const eff = effectiveBpm(s.bpm, bestBpm)
    const warp = bestBpm / eff.bpm
    const tempoBreak = Math.abs(Math.log(warp)) > MAX_WARP
    const rate = tempoBreak ? 1 : warp
    const { s: semis, clash } = plan.shifts[s.id]
    const pct = ((rate - 1) * 100).toFixed(1)
    const parts = [`${Math.round(s.bpm)} BPM ${s.key.camelot}`]
    if (tempoBreak) parts.push(`too far from ${bestBpm} — plays native, joins via tempo-break moves`)
    else if (Math.abs(rate - 1) > 0.002) parts.push(`warp ${rate > 1 ? '+' : ''}${pct}%${eff.barScale !== 1 ? (eff.barScale > 1 ? ' (half-time feel)' : ' (double-time feel)') : ''}`)
    else parts.push('native tempo')
    if (semis) parts.push(`${semis > 0 ? '+' : ''}${semis} st → ${shiftKey(s.key, semis).camelot}`)
    if (clash) parts.push('key clash — kept to hard cuts')
    const note = parts.join(' · ')
    out[s.id] = { rate, semitones: semis, tempoBreak, keyClash: clash, note }
    summary.push(`${s.title}: ${note}`)
  }
  return { bpm: bestBpm, key: plan.key, songs: out, summary }
}
