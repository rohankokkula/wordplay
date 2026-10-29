/**
 * Schedules a Timeline onto any BaseAudioContext.
 *
 * The same function drives live playback (AudioContext) and export
 * (OfflineAudioContext), so what you hear is exactly what you bounce.
 *
 * Per clip: source → env → gain → low-shelf → HPF → LPF → lane → master,
 * with post-filter sends to a tempo-synced delay and a plate-ish reverb.
 */

import type { Clip, Lane, Master, Timeline } from '@/model/types'
import type { SourceBank } from './bank'
import { reverbIR, scheduleSfx } from './sfx'

type Pts = [number, number][]

function valueAt(pts: Pts, t: number): number {
  if (t <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const [t0, v0] = pts[i - 1]
      const [t1, v1] = pts[i]
      return t1 === t0 ? v1 : v0 + ((t - t0) / (t1 - t0)) * (v1 - v0)
    }
  }
  return pts[pts.length - 1][1]
}

/** Apply clip-relative automation, starting mid-clip if `offsetIn` > 0. */
function automate(param: AudioParam, pts: Pts | undefined, clipStartCtx: number, offsetIn: number, exp = false): void {
  if (!pts?.length) return
  const startCtx = clipStartCtx + offsetIn
  param.setValueAtTime(valueAt(pts, offsetIn), startCtx)
  for (const [t, v] of pts) {
    if (t <= offsetIn) continue
    const at = clipStartCtx + t
    if (exp && v > 0) param.exponentialRampToValueAtTime(v, at)
    else param.linearRampToValueAtTime(v, at)
  }
}

export interface ScheduleHandle {
  stop: () => void
  /** Stop at a future context time (quantized pad changes). */
  stopAt: (when: number) => void
  analyser: AnalyserNode
}

export interface ScheduleOptions {
  from: number
  when: number
  laneGain?: Partial<Record<Lane, number>>
  masterGain?: number
  /** Live pads: play originals at `rate` (tempo + pitch move together, like a turntable). */
  vinyl?: boolean
}

export function scheduleTimeline(
  ctx: BaseAudioContext,
  dest: AudioNode,
  tl: Timeline,
  bank: SourceBank,
  master: Master,
  opts: ScheduleOptions,
): ScheduleHandle {
  const { from, when } = opts
  const sources: AudioScheduledSourceNode[] = []
  const nodes: AudioNode[] = []
  const keep = <T extends AudioNode>(n: T) => {
    nodes.push(n)
    return n
  }

  const masterGain = keep(ctx.createGain())
  masterGain.gain.value = opts.masterGain ?? 0.9
  const comp = keep(ctx.createDynamicsCompressor())
  comp.threshold.value = -10
  comp.knee.value = 6
  comp.ratio.value = 4
  comp.attack.value = 0.003
  comp.release.value = 0.15
  const analyser = keep(ctx.createAnalyser())
  analyser.fftSize = 512
  masterGain.connect(comp).connect(analyser).connect(dest)

  // Tempo-synced dotted-eighth delay with filtered feedback.
  const beat = 60 / tl.bpm
  const delay = keep(ctx.createDelay(4))
  delay.delayTime.value = beat * 0.75
  const fb = keep(ctx.createGain())
  fb.gain.value = 0.5
  const fbLp = keep(ctx.createBiquadFilter())
  fbLp.type = 'lowpass'
  fbLp.frequency.value = 3500
  delay.connect(fbLp).connect(fb).connect(delay)
  const delayOut = keep(ctx.createGain())
  delayOut.gain.value = 0.7
  delay.connect(delayOut).connect(masterGain)

  const reverb = keep(ctx.createConvolver())
  reverb.buffer = reverbIR(ctx)
  const reverbOut = keep(ctx.createGain())
  reverbOut.gain.value = 0.6
  reverb.connect(reverbOut).connect(masterGain)

  const lanes = new Map<Lane, GainNode>()
  const laneNode = (lane: Lane) => {
    let g = lanes.get(lane)
    if (!g) {
      g = keep(ctx.createGain())
      g.gain.value = opts.laneGain?.[lane] ?? 1
      g.connect(masterGain)
      lanes.set(lane, g)
    }
    return g
  }

  const scheduleClip = (clip: Clip) => {
    const end = clip.at + clip.dur
    if (end <= from) return
    const raw = opts.vinyl ? bank.getRaw(clip.songId, clip.stem, clip.srcStart, master) : null
    const src = raw ?? bank.get(clip.songId, clip.stem, clip.srcStart, clip.loop ? clip.loop.len : clip.dur, master)
    if (!src) return
    const rate = raw?.rate ?? 1
    const offsetIn = Math.max(0, from - clip.at)
    const clipStartCtx = when + (clip.at - from)
    const startCtx = clipStartCtx + offsetIn
    const endCtx = clipStartCtx + clip.dur

    const g = keep(ctx.createGain())
    g.gain.value = clip.gain
    automate(g.gain, clip.auto.gain, clipStartCtx, offsetIn)
    const ls = keep(ctx.createBiquadFilter())
    ls.type = 'lowshelf'
    ls.frequency.value = 160
    ls.gain.value = 0
    automate(ls.gain, clip.auto.lowShelfDb, clipStartCtx, offsetIn)
    const hp = keep(ctx.createBiquadFilter())
    hp.type = 'highpass'
    hp.frequency.value = 10
    hp.Q.value = 0.8
    automate(hp.frequency, clip.auto.hpf, clipStartCtx, offsetIn, true)
    const lp = keep(ctx.createBiquadFilter())
    lp.type = 'lowpass'
    lp.frequency.value = 20000
    lp.Q.value = 0.8
    automate(lp.frequency, clip.auto.lpf, clipStartCtx, offsetIn, true)
    g.connect(ls).connect(hp).connect(lp).connect(laneNode(clip.lane))
    if (clip.auto.delaySend) {
      const ds = keep(ctx.createGain())
      ds.gain.value = 0
      automate(ds.gain, clip.auto.delaySend, clipStartCtx, offsetIn)
      lp.connect(ds).connect(delay)
    }
    if (clip.auto.reverbSend) {
      const rs = keep(ctx.createGain())
      rs.gain.value = 0
      automate(rs.gain, clip.auto.reverbSend, clipStartCtx, offsetIn)
      lp.connect(rs).connect(reverb)
    }

    const fade = 0.004
    const play = (at: number, offset: number, len: number, rateAuto?: Pts, autoBase = clipStartCtx) => {
      const s = ctx.createBufferSource()
      s.buffer = src.buffer
      s.playbackRate.value = rate
      const env = keep(ctx.createGain())
      env.gain.setValueAtTime(0, at)
      env.gain.linearRampToValueAtTime(1, at + Math.min(fade, len / 3))
      env.gain.setValueAtTime(1, Math.max(at + fade, at + len - fade))
      env.gain.linearRampToValueAtTime(0, at + len)
      if (rateAuto) automate(s.playbackRate, rateAuto.map(([t, v]) => [t, v * rate] as [number, number]), autoBase, Math.max(0, at - autoBase))
      s.connect(env).connect(g)
      s.start(at, Math.max(0, offset), (len + 0.01) * rate)
      s.stop(at + len + 0.01)
      sources.push(s)
    }

    if (clip.loop) {
      const { len, every } = clip.loop
      for (let k = 0; clip.at + k * every < end - 1e-4; k++) {
        const at = clip.at + k * every
        const sliceLen = Math.min(len, end - at)
        if (at + sliceLen <= from) continue
        play(when + (at - from), src.offset, sliceLen)
      }
    } else {
      play(startCtx, src.offset + offsetIn * rate, endCtx - startCtx, clip.auto.rate)
    }
  }

  for (const clip of tl.clips) scheduleClip(clip)
  for (const s of tl.sfx) {
    if (s.at + s.dur <= from || s.at < from) continue
    sources.push(...scheduleSfx(ctx, masterGain, s, when + (s.at - from)))
  }

  return {
    analyser,
    stopAt: (t: number) => {
      for (const s of sources) {
        try {
          s.stop(t)
        } catch {
          /* already stopped */
        }
      }
      const ms = Math.max(0, (t - ctx.currentTime) * 1000) + 3000
      setTimeout(() => nodes.forEach((n) => n.disconnect()), ms)
    },
    stop: () => {
      for (const s of sources) {
        try {
          s.stop()
        } catch {
          /* already stopped */
        }
      }
      for (const n of nodes) n.disconnect()
    },
  }
}

export async function renderOffline(tl: Timeline, bank: SourceBank, master: Master, sampleRate = 44100): Promise<AudioBuffer> {
  const tail = 2.5
  const ctx = new OfflineAudioContext(2, Math.ceil((tl.duration + tail) * sampleRate), sampleRate)
  scheduleTimeline(ctx, ctx.destination, tl, bank, master, { from: 0, when: 0 })
  return ctx.startRendering()
}
