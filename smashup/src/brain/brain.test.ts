import { describe, expect, it } from 'vitest'
import type { Hit, Moment, Plan, SongAnalysis } from '@/model/types'
import { camelotDistance, effectiveBpm, harmonicallyCompatible, solveMaster } from './compat'
import { compose, type BrainSong } from './composer'
import { MOVES } from './moves'
import { buildTimeline } from '@/engine/timeline'
import { buildMoments, assignPads, roleFromLabel } from '@/analysis/cues'
import { camelotOf, analyzeMono } from '@/analysis/music'
import { matchesKeyword, fold, findHits } from '@/analysis/keywordMatch'

/* ── fixtures ───────────────────────────────────────────────────────── */

const FORM = ['intro', 'verse', 'build', 'chorus', 'drop', 'outro'] as const
const ENERGY: Record<(typeof FORM)[number], number> = { intro: 0.3, verse: 0.5, build: 0.6, chorus: 0.85, drop: 1, outro: 0.35 }
const VOCAL: Record<(typeof FORM)[number], number> = { intro: 0.05, verse: 0.7, build: 0.4, chorus: 0.9, drop: 0.1, outro: 0.5 }

function fakeSong(id: string, bpm: number, tonic: number, mode: 'major' | 'minor', hitBars: number[]): BrainSong & { hits: Hit[] } {
  const barLen = 240 / bpm
  const nBars = 48
  const bars = Array.from({ length: nBars }, (_, i) => i * barLen)
  const sectionOf = (b: number) => FORM[Math.min(5, Math.floor(b / 8))]
  const analysis: SongAnalysis = {
    bpm,
    beatInterval: 60 / bpm,
    downbeat: 0,
    bars,
    key: { tonic, mode, camelot: camelotOf(tonic, mode), confidence: 0.8 },
    energy: bars.map((_, i) => ENERGY[sectionOf(i)]),
    vocal: bars.map((_, i) => VOCAL[sectionOf(i)]),
    sections: FORM.map((role, i) => ({ startBar: i * 8, bars: 8, role, energy: ENERGY[role] })),
    peaks: [],
    peaksPerSec: 100,
    duration: nBars * barLen,
  }
  const hits: Hit[] = hitBars.map((b, i) => ({
    id: `${id}-h${i}`, songId: id, text: 'paisa', start: b * barLen + 0.01, end: b * barLen + 0.5,
    confidence: 0.9, source: 'sidecar', accepted: true, cluster: 0, iconic: 0,
  }))
  const moments: Moment[] = buildMoments(id, analysis, hits)
  return { id, title: id.toUpperCase(), analysis, moments, hasStems: true, hits }
}

const CRATE = [
  fakeSong('a', 96, 9, 'minor', [10, 25, 26, 27, 28, 42]),
  fakeSong('b', 92, 4, 'minor', [9, 24, 25, 26, 41]),
  fakeSong('c', 100, 0, 'major', [12, 24, 26, 28]),
  fakeSong('d', 128, 2, 'minor', [10, 26, 27]),
  fakeSong('e', 49, 6, 'minor', [8, 24, 25]),
]

const masterOf = (songs: BrainSong[], keyLock = true) =>
  solveMaster(songs.map((s) => ({ id: s.id, title: s.title, bpm: s.analysis.bpm, key: s.analysis.key })), { keyLock })

/* ── keyword matching ───────────────────────────────────────────────── */

describe('keyword matcher', () => {
  it.each(['paisa', 'Paisaa', 'pesa', 'पैसा', 'PAISA!', 'paysa', 'paisa-paisa', 'پیسہ', 'پیسے', 'ਪੈਸਾ', 'paise'])('matches %s', (w) => {
    expect(matchesKeyword(w, ['paisa'])).toBe(true)
  })
  it.each(['pass', 'pa', 'paani', 'masala', 'pyaar'])('rejects %s', (w) => {
    expect(matchesKeyword(w, ['paisa'])).toBe(false)
  })
  it('folds scripts to one form', () => {
    expect(fold('पैसा')).toBe(fold('paisa'))
  })
  it('merges split tokens of one sung word', () => {
    const hits = findHits([{ w: 'paisa', start: 1, end: 1.3, p: 1 }, { w: 'paisa', start: 1.32, end: 1.5, p: 1 }, { w: 'paisa', start: 3, end: 3.4, p: 1 }], ['paisa'], 's', 'asr')
    expect(hits.map((h) => h.start)).toEqual([1, 3])
  })
})

/* ── harmony + tempo ────────────────────────────────────────────────── */

describe('camelot', () => {
  it('maps keys to the wheel', () => {
    expect(camelotOf(9, 'minor')).toBe('8A')
    expect(camelotOf(0, 'major')).toBe('8B')
    expect(camelotOf(7, 'major')).toBe('9B')
    expect(camelotOf(11, 'major')).toBe('1B')
    expect(camelotOf(6, 'minor')).toBe('11A')
  })
  it('measures distance', () => {
    expect(camelotDistance('8A', '8A')).toBe(0)
    expect(camelotDistance('8A', '8B')).toBe(1)
    expect(camelotDistance('12A', '1A')).toBe(1)
    expect(camelotDistance('8A', '10A')).toBe(2)
    expect(harmonicallyCompatible('3B', '9A')).toBe(false)
  })
})

describe('master solver', () => {
  it('treats half-time as compatible', () => {
    expect(effectiveBpm(49, 98).barScale).toBe(2)
    expect(effectiveBpm(190, 95).barScale).toBe(0.5)
  })
  it('picks a tempo that keeps most songs within ±8% and flags the outlier', () => {
    const m = masterOf(CRATE)
    expect(m.bpm).toBeGreaterThan(90)
    expect(m.bpm).toBeLessThan(101)
    expect(m.songs.d.tempoBreak).toBe(true)
    for (const id of ['a', 'b', 'c', 'e']) {
      expect(m.songs[id].tempoBreak).toBe(false)
      expect(Math.abs(m.songs[id].rate - 1)).toBeLessThanOrEqual(0.085)
      expect(Math.abs(m.songs[id].semitones)).toBeLessThanOrEqual(2)
    }
  })
  it('respects key lock off', () => {
    const m = masterOf(CRATE, false)
    for (const s of Object.values(m.songs)) expect(s.semitones).toBe(0)
  })
})

/* ── moments + pads ─────────────────────────────────────────────────── */

describe('moments', () => {
  it('starts every moment on a bar and finds chants', () => {
    const s = CRATE[0]
    expect(s.moments.length).toBeGreaterThan(3)
    for (const m of s.moments) expect(Number.isInteger(m.startBar)).toBe(true)
    expect(s.moments.some((m) => m.role === 'chant' && m.hitTimes.length >= 3)).toBe(true)
    expect(s.moments.some((m) => m.role === 'drop')).toBe(true)
  })
  it('assigns 4 distinct pads and honours template labels', () => {
    const pads = assignPads(CRATE[0].moments, ['Paisa vocal', 'Main hook', 'Instrumental', 'Vocal ending'])
    expect(pads).toHaveLength(4)
    const ids = pads.map((p) => p.momentId).filter(Boolean)
    expect(new Set(ids).size).toBe(ids.length)
    expect(roleFromLabel('Instrumental', 'call')).toBe('drop')
    expect(roleFromLabel('Full hook', 'call')).toBe('chant')
    const instrumental = CRATE[0].moments.find((m) => m.id === pads[2].momentId)
    expect(instrumental?.role).toBe('drop')
  })
})

/* ── composer grammar ───────────────────────────────────────────────── */

describe('composer', () => {
  const master = masterOf(CRATE)
  const plans = compose(CRATE, master, { targetSec: 150, curve: 'wave', seed: 0 })
  const byMoment = new Map(CRATE.flatMap((s) => s.moments.map((m) => [m.id, m] as const)))
  const songOf = (p: Plan, i: number) => byMoment.get(p.sections[i].momentId)!.songId

  it('returns diverse plans', () => {
    expect(plans.length).toBeGreaterThanOrEqual(2)
    const seqs = plans.map((p) => p.sections.map((_, i) => songOf(p, i)).join('>'))
    expect(new Set(seqs).size).toBe(seqs.length)
  })

  it('uses every song and never repeats a song back to back (solo)', () => {
    for (const p of plans) {
      const songs = p.sections.map((_, i) => songOf(p, i))
      expect(new Set(songs).size).toBe(CRATE.length)
      for (let i = 1; i < songs.length; i++) {
        if (p.sections[i].layer !== 'acapellaOver') expect(songs[i]).not.toBe(songs[i - 1])
      }
    }
  })

  it('never puts two drops back to back and never repeats a move consecutively', () => {
    for (const p of plans) {
      for (let i = 1; i < p.sections.length; i++) {
        const a = byMoment.get(p.sections[i - 1].momentId)!
        const b = byMoment.get(p.sections[i].momentId)!
        expect(a.role === 'drop' && b.role === 'drop').toBe(false)
      }
      for (let i = 1; i < p.seams.length; i++) expect(p.seams[i].move).not.toBe(p.seams[i - 1].move)
    }
  })

  it('only uses beatmatched moves across a tempo break', () => {
    const blendMoves = ['bassSwap', 'filterHandover', 'acapellaIn', 'callResponse']
    for (const p of plans) {
      p.seams.forEach((seam, i) => {
        const touchesD = songOf(p, i) === 'd' || songOf(p, i + 1) === 'd'
        if (touchesD) expect(blendMoves).not.toContain(seam.move)
      })
    }
  })

  it('does not always open with the first song, and explains itself', () => {
    const openers = new Set<string>()
    for (let seed = 0; seed < 6; seed++) {
      for (const p of compose([...CRATE].reverse(), master, { targetSec: 150, curve: 'wave', seed })) openers.add(songOf(p, 0))
    }
    expect(openers.size).toBeGreaterThan(1)
    expect(plans[0].sections[0].reason).toMatch(/opens here because/)
    expect(plans[0].summary.length).toBeGreaterThan(1)
  })

  it('keeps locked sections in place when recomposing', () => {
    const lockMoment = CRATE[2].moments.find((m) => m.hitTimes.length > 0)!
    const locks = [null, { momentId: lockMoment.id, layer: 'solo' as const, locked: true, reason: 'locked' }]
    const [p] = compose(CRATE, master, { targetSec: 150, curve: 'climb', seed: 3, locks })
    expect(p.sections[1].momentId).toBe(lockMoment.id)
  })
})

/* ── timeline ───────────────────────────────────────────────────────── */

describe('timeline', () => {
  const master = masterOf(CRATE)
  const [plan] = compose(CRATE, master, { targetSec: 150, curve: 'wave', seed: 0 })
  const tl = buildTimeline(plan, CRATE, master)

  it('butts sections and seams together without gaps or overlaps', () => {
    let t = 0
    for (let i = 0; i < tl.sections.length; i++) {
      expect(tl.sections[i].at).toBeCloseTo(t, 6)
      t += tl.sections[i].dur
      const seam = tl.seams.find((s) => s.index === i)
      if (seam) {
        expect(seam.at).toBeCloseTo(t, 6)
        t += seam.dur
      }
    }
    expect(tl.duration).toBeCloseTo(t, 6)
  })

  it('lands sections on the master bar grid', () => {
    const bar = 240 / master.bpm
    for (const s of tl.sections) {
      if (master.songs[s.songId].tempoBreak) continue
      const bars = s.dur / bar
      expect(Math.abs(bars - Math.round(bars * 2) / 2)).toBeLessThan(0.02)
    }
  })

  it('plays keyword hits on the master clock inside their sections', () => {
    expect(tl.keywordTimes.length).toBeGreaterThan(5)
    for (const k of tl.keywordTimes) expect(k.at).toBeLessThanOrEqual(tl.duration)
  })

  it('implements every move without breaking the grid', () => {
    for (const id of Object.keys(MOVES) as (keyof typeof MOVES)[]) {
      const forced = { ...plan, seams: plan.seams.map((s) => ({ ...s, move: id, bars: MOVES[id].bars })) }
      const t2 = buildTimeline(forced, CRATE, master)
      expect(t2.duration).toBeGreaterThan(30)
      for (const c of t2.clips) {
        expect(c.dur).toBeGreaterThan(0)
        expect(c.srcStart).toBeGreaterThanOrEqual(-1e-6)
      }
    }
  })
})

/* ── on-device analysis ─────────────────────────────────────────────── */

describe('analyzeMono', () => {
  it('recovers tempo, downbeat-aligned bars and key from a synthetic track', () => {
    const sr = 22050
    const bpm = 100
    const beat = 60 / bpm
    const dur = 40
    const x = new Float32Array(sr * dur)
    const chord = [220, 261.63, 329.63] // A minor triad
    for (let i = 0; i < x.length; i++) {
      const t = i / sr
      let v = 0
      for (const f of chord) v += 0.05 * Math.sin(2 * Math.PI * f * t)
      x[i] = v
    }
    for (let k = 0; k * beat < dur; k++) {
      const s = Math.floor((0.25 + k * beat) * sr)
      const accent = k % 4 === 0 ? 1 : 0.45
      for (let j = 0; j < 2000 && s + j < x.length; j++) x[s + j] += accent * Math.sin((2 * Math.PI * 60 * j) / sr) * Math.exp(-j / 400)
    }
    const a = analyzeMono(x, sr)
    expect(a.bpm).toBeGreaterThan(98.5)
    expect(a.bpm).toBeLessThan(101.5)
    expect(['8A', '8B']).toContain(a.key.camelot)
    const offset = (((a.downbeat - 0.25) % (beat * 4)) + beat * 4) % (beat * 4)
    expect(Math.min(offset, beat * 4 - offset)).toBeLessThan(0.05)
  })
})
