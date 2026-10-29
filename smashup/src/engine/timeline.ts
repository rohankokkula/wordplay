/**
 * Plan → Timeline: turn the editable plan into concrete, sample-accurate clips.
 *
 * All times are master-clock seconds; clip sources are seconds in the *warped*
 * song (song time ÷ rate). Every move's DJ behaviour is expressed here as
 * clips + automation + SFX, so live playback and offline export share it.
 */

import type { Automation, Clip, Lane, Master, MoveId, Plan, Sfx, StemName, Timeline, TimelineSeam, TimelineSection } from '@/model/types'
import { LANE_STEM } from '@/model/types'
import { barAt } from '@/analysis/cues'
import { type BrainSong, momentSpan, sectionBars, tensionOf } from '@/brain/composer'

const STEM_LANES: Lane[] = ['vox', 'drums', 'bass', 'music']

let clipSeq = 0
const cid = () => `c${++clipSeq}`

function lanesOf(song: BrainSong): Lane[] {
  return song.hasStems ? STEM_LANES : ['full']
}

function stemOf(lane: Lane): StemName | 'full' {
  return lane === 'full' ? 'full' : LANE_STEM[lane]
}

interface Source {
  songId: string
  lane: Lane
  /** Warped position where this source stopped. */
  w: number
}

export function buildTimeline(plan: Plan, songs: BrainSong[], master: Master): Timeline {
  const byId = new Map(songs.map((s) => [s.id, s]))
  const momentById = new Map(songs.flatMap((s) => s.moments.map((m) => [m.id, { m, s }] as const)))
  const clips: Clip[] = []
  const sfx: Sfx[] = []
  const sections: TimelineSection[] = []
  const seams: TimelineSeam[] = []
  const keywordTimes: Timeline['keywordTimes'] = []
  const cursorW: Record<string, number> = {}
  const rateOf = (id: string) => master.songs[id]?.rate ?? 1
  const bpmOf = (id: string) => (master.songs[id]?.tempoBreak ? byId.get(id)!.analysis.bpm : master.bpm)

  const add = (c: Omit<Clip, 'id' | 'gain'> & { gain?: number }) => {
    if (c.dur <= 0.005) return null
    const clip: Clip = { id: cid(), gain: 1, ...c }
    clips.push(clip)
    return clip
  }

  let t = 0
  let skip = 0
  let prevSources: Source[] = []

  const placed = plan.sections
    .map((spec) => ({ spec, ...(momentById.get(spec.momentId) ?? { m: null, s: null }) }))
    .filter((p): p is { spec: typeof p.spec; m: NonNullable<typeof p.m>; s: NonNullable<typeof p.s> } => !!p.m && !!p.s)

  for (let i = 0; i < placed.length; i++) {
    const { spec, m, s: song } = placed[i]
    const r = rateOf(song.id)
    const { t0, t1 } = momentSpan(song.analysis, m, spec.layer)
    const w0 = t0 / r
    const full = (t1 - t0) / r
    const dur = full - skip
    const bpm = bpmOf(song.id)
    const beat = 60 / bpm
    const sources: Source[] = []

    const mainLanes = spec.layer === 'tease' ? (song.hasStems ? (['vox'] as Lane[]) : (['full'] as Lane[])) : lanesOf(song)
    if (spec.layer === 'acapellaOver' && spec.bedSongId && byId.get(spec.bedSongId)?.hasStems) {
      const bed = byId.get(spec.bedSongId)!
      const bedDurW = bed.analysis.duration / rateOf(bed.id)
      let bedSrc = cursorW[bed.id] ?? 0
      if (bedSrc + dur > bedDurW) bedSrc = Math.max(0, bedDurW - dur)
      add({ lane: 'vox', songId: song.id, stem: 'vocals', srcStart: w0 + skip, at: t, dur, auto: {}, sectionIndex: i })
      sources.push({ songId: song.id, lane: 'vox', w: w0 + full })
      for (const lane of ['drums', 'bass', 'music'] as Lane[]) {
        add({ lane, songId: bed.id, stem: stemOf(lane), srcStart: bedSrc, at: t, dur, auto: {}, sectionIndex: i })
        sources.push({ songId: bed.id, lane, w: bedSrc + dur })
      }
      cursorW[bed.id] = bedSrc + dur
    } else {
      for (const lane of mainLanes) {
        const auto: Automation = {}
        if (spec.layer === 'tease') auto.reverbSend = [[0, 0.35]]
        if (skip > 0 && lane === 'bass') auto.lowShelfDb = [[0, -24], [beat, 0]]
        if (spec.layer === 'tease' && lane === 'full') auto.hpf = [[0, 350]]
        add({ lane, songId: song.id, stem: stemOf(lane), srcStart: w0 + skip, at: t, dur, auto, sectionIndex: i })
        sources.push({ songId: song.id, lane, w: w0 + full })
      }
    }
    cursorW[song.id] = w0 + full

    for (const h of m.hitTimes) {
      if (h >= t1) continue
      const at = t + (h - t0) / r - skip
      if (at >= t - 0.01) keywordTimes.push({ at, songId: song.id })
    }
    sections.push({
      index: i, at: t, dur, bpm, bars: sectionBars(m, spec.layer), songId: song.id, layer: spec.layer, momentId: m.id, role: m.role,
      tension: tensionOf(m, spec.layer),
    })
    t += dur
    skip = 0
    prevSources = sources

    // ── Seam into the next section ─────────────────────────────────────
    const nextP = placed[i + 1]
    const seam = plan.seams[i]
    if (!nextP || !seam) continue
    const B = nextP.s
    const rb = rateOf(B.id)
    const bSpan = momentSpan(B.analysis, nextP.m, nextP.spec.layer)
    const b0w = bSpan.t0 / rb
    const barSec = 240 / bpm
    let R = seam.bars * barSec
    let move: MoveId = seam.move
    const aTail = Math.min(...prevSources.map((src) => byId.get(src.songId)!.analysis.duration / rateOf(src.songId) - src.w))
    const overlap = move === 'bassSwap' || move === 'filterHandover'
    if (overlap) R = Math.min(R, Math.floor(Math.min(aTail, b0w) / barSec) * barSec)
    if ((move === 'dropSwap' || move === 'acapellaIn') && aTail < R) R = Math.floor(aTail / barSec) * barSec
    if (move === 'acapellaIn' && !(song.hasStems && B.hasStems)) move = 'wordCut'
    if (R <= 0.01 && ['bassSwap', 'filterHandover', 'dropSwap', 'acapellaIn', 'callResponse', 'loopRoll'].includes(move)) move = 'wordCut'
    if (move === 'wordCut' || move === 'spinback') R = 0
    if (move === 'dropOut') R = 0.5 * barSec

    const lastClipsOfA = clips.filter((c) => c.sectionIndex === i && c.at + c.dur >= t - 0.01)
    const continueA = (auto: (lane: Lane) => Automation) => {
      for (const src of prevSources) {
        add({ lane: src.lane, songId: src.songId, stem: stemOf(src.lane), srcStart: src.w, at: t, dur: R, auto: auto(src.lane), sectionIndex: i })
      }
    }
    const bPreroll = (auto: (lane: Lane) => Automation, muteVox: boolean) => {
      for (const lane of lanesOf(B)) {
        if (muteVox && lane === 'vox') continue
        add({ lane, songId: B.id, stem: stemOf(lane), srcStart: b0w - R, at: t, dur: R, auto: auto(lane), sectionIndex: i + 1 })
      }
    }

    switch (move) {
      case 'callResponse': {
        const aHit = m.hitTimes[m.hitTimes.length - 1] ?? t0
        const bHit = nextP.m.hitTimes[0] ?? bSpan.t0
        const aBar = song.analysis.bars[barAt(song.analysis, aHit)] / r
        const bBar = B.analysis.bars[barAt(B.analysis, bHit)] / rb
        const one = R / 4
        for (let k = 0; k < 4; k++) {
          const S = k % 2 === 0 ? song : B
          for (const lane of lanesOf(S)) {
            add({ lane, songId: S.id, stem: stemOf(lane), srcStart: k % 2 === 0 ? aBar : bBar, at: t + k * one, dur: one, auto: {}, sectionIndex: i })
          }
        }
        break
      }
      case 'loopRoll': {
        const hit = m.hitTimes[m.hitTimes.length - 1] ?? t1 - 1
        const w = Math.max(0, hit / r - 0.01)
        const stages: [number, number, number][] = [
          [0, 0.5, beat / 2],
          [0.5, 0.75, beat / 4],
          [0.75, 1, beat / 8],
        ]
        for (const [s0, s1, every] of stages) {
          for (const lane of lanesOf(song)) {
            const at = t + s0 * R
            const d = (s1 - s0) * R
            add({
              lane, songId: song.id, stem: stemOf(lane), srcStart: w, at, dur: d, sectionIndex: i,
              loop: { len: every, every },
              auto: { hpf: [[0, 120 + s0 * 1800], [d, 120 + s1 * 1800]], gain: [[0, 0.85 + s0 * 0.15]] },
            })
          }
        }
        break
      }
      case 'echoThrow': {
        for (const c of lastClipsOfA) {
          const off = c.dur - beat
          c.auto = { ...c.auto, delaySend: [[Math.max(0, off - 0.01), 0], [Math.max(0, off), 0.85]], reverbSend: [[Math.max(0, off), 0.25]] }
        }
        break
      }
      case 'bassSwap': {
        continueA((lane) => ({
          gain: lane === 'vox' ? [[0, 1], [R * 0.5, 0]] : [[0, 1], [R * 0.6, 1], [R, 0]],
          lowShelfDb: [[0, 0], [R * 0.45, 0], [R * 0.55, -30]],
        }))
        bPreroll(() => ({ gain: [[0, 0.15], [R * 0.4, 1]], lowShelfDb: [[0, -30], [R * 0.45, -30], [R * 0.55, 0]] }), true)
        break
      }
      case 'filterHandover': {
        continueA(() => ({ gain: [[0, 1], [R * 0.7, 0.85], [R, 0]], lpf: [[0, 18000], [R, 320]] }))
        bPreroll(() => ({ gain: [[0, 0.4], [R * 0.5, 1]], hpf: [[0, 1600], [R, 20]] }), true)
        break
      }
      case 'acapellaIn': {
        continueA((lane) => (lane === 'vox' || lane === 'full' ? { gain: [[0, 1], [beat, 0]] } : { gain: [[0, 1], [R - 0.03, 1], [R, 0]] }))
        add({ lane: 'vox', songId: B.id, stem: 'vocals', srcStart: b0w, at: t, dur: R, auto: { gain: [[0, 0.2], [beat, 1]] }, sectionIndex: i + 1 })
        skip = R
        break
      }
      case 'dropSwap': {
        continueA(() => ({ hpf: [[0, 20], [R, 2600]], gain: [[0, 1], [R, 0.75]] }))
        sfx.push({ kind: 'riser', at: t, dur: R }, { kind: 'crash', at: t + R, dur: 1.8 }, { kind: 'kick', at: t + R, dur: 0.4 })
        break
      }
      case 'spinback': {
        const brake = Math.min(2 * beat, 1.2)
        for (const c of lastClipsOfA) {
          const off = Math.max(0, c.dur - brake)
          c.auto = { ...c.auto, rate: [[off, 1], [c.dur, 0.06]], gain: [[0, 1], [off, 1], [c.dur, 0]] }
        }
        sfx.push({ kind: 'brake', at: t - brake, dur: brake })
        break
      }
      default:
        break
    }
    // For acapellaIn the region is B's first R seconds (vocal only); `skip` trims B's section to match.
    seams.push({ index: i, at: t, dur: R, move })
    t += R
  }

  return { duration: t, clips, sfx, sections, seams, keywordTimes, bpm: master.bpm }
}

/** Which (song, stem) ranges in *warped* seconds a timeline needs, merged. */
export function requiredRanges(tl: Timeline): Map<string, [number, number][]> {
  const raw = new Map<string, [number, number][]>()
  for (const c of tl.clips) {
    const key = `${c.songId}|${c.stem}`
    const end = c.loop ? c.srcStart + c.loop.len + 0.05 : c.srcStart + c.dur + 0.05
    const list = raw.get(key) ?? []
    list.push([Math.max(0, c.srcStart - 0.05), end])
    raw.set(key, list)
  }
  const merged = new Map<string, [number, number][]>()
  for (const [key, list] of raw) {
    list.sort((a, b) => a[0] - b[0])
    const out: [number, number][] = []
    for (const r of list) {
      const last = out[out.length - 1]
      if (last && r[0] <= last[1] + 2) last[1] = Math.max(last[1], r[1])
      else out.push([...r])
    }
    merged.set(key, out)
  }
  return merged
}
