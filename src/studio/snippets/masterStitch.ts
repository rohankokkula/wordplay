import type { MasterSnippet } from './types'
import type { DeckSource } from './masterScheduler'
import type { MasterTransition } from './masterTransitions'
import { DEFAULT_MASTER_TRANSITION, boundaryOverlapSec, masterNetDurationSec } from './masterTransitions'
import { getAudioContext, getStitchedMasterInput } from '../../audio/mixer'

type Sources = { A?: DeckSource | null; B?: DeckSource | null }

function getClipBuffer(clip: MasterSnippet, src: DeckSource | undefined): AudioBuffer | null {
  if (!src) return null
  const stemBuf = clip.stem === 'vocals' ? src.stems?.vocals : src.stems?.instruments
  return stemBuf ?? src.full ?? null
}

/**
 * Bounces the master chain to a single stereo `AudioBuffer` (timing aligned with `MasterScheduler`).
 */
export function stitchMasterMix(
  sequence: MasterSnippet[],
  transitions: MasterTransition[],
  sources: Sources,
  opts: { sampleRate?: number } = {},
): Promise<AudioBuffer> {
  const n = sequence.length
  if (n === 0) {
    const sr = opts.sampleRate ?? 48000
    return new OfflineAudioContext(2, 1, sr).startRendering()
  }
  const c0 = sequence[0]!
  const b0 = getClipBuffer(c0, sources[c0.deck] ?? undefined)
  const sampleRate = opts.sampleRate ?? b0?.sampleRate ?? 48000
  const totalDur = masterNetDurationSec(sequence, transitions) + 0.1
  const frames = Math.max(1, Math.floor(totalDur * sampleRate))
  const oac = new OfflineAudioContext(2, frames, sampleRate)
  const bus = oac.createGain()
  bus.gain.value = 0.9
  bus.connect(oac.destination)

  let t = 0.02
  for (let i = 0; i < n; i++) {
    const clip = sequence[i]!
    const dDeck = sources[clip.deck]
    const buffer = getClipBuffer(clip, dDeck ?? undefined)
    if (!buffer) continue

    const d = Math.max(0.1, clip.endSec - clip.startSec)
    const dNext =
      i < n - 1 ? Math.max(0.1, sequence[i + 1]!.endSec - sequence[i + 1]!.startSec) : 0
    const tr = (i < n - 1 ? transitions[i] : undefined) ?? DEFAULT_MASTER_TRANSITION
    const oOut =
      i < n - 1 && tr.kind !== 'gap' ? boundaryOverlapSec(tr, d, dNext) : 0
    const trPrev = i > 0 ? (transitions[i - 1] ?? DEFAULT_MASTER_TRANSITION) : null
    const oIn =
      i > 0 && trPrev && trPrev.kind !== 'gap'
        ? boundaryOverlapSec(
            trPrev,
            Math.max(0.1, sequence[i - 1]!.endSec - sequence[i - 1]!.startSec),
            d,
          )
        : 0

    const g = oac.createGain()
    g.gain.setValueAtTime(0, t)

    if (i === 0) {
      g.gain.linearRampToValueAtTime(1, t + 0.02)
    } else if (oIn > 0 && trPrev) {
      if (trPrev.kind === 'equal_power') {
        const m = 48
        const c = new Float32Array(m)
        for (let k = 0; k < m; k++) c[k] = Math.sin((k / (m - 1)) * (Math.PI / 2))
        g.gain.setValueCurveAtTime(c, t, oIn)
      } else {
        g.gain.linearRampToValueAtTime(1, t + oIn)
      }
    } else {
      g.gain.setValueAtTime(1, t + 0.005)
    }

    if (i < n - 1) {
      if (tr.kind === 'gap') {
        g.gain.setValueAtTime(1, t + d - 0.001)
        g.gain.setValueAtTime(0, t + d)
        g.gain.setValueAtTime(0, t + d + tr.crossfadeSec)
      } else if (oOut > 0) {
        g.gain.setValueAtTime(1, t + d - oOut)
        if (tr.kind === 'equal_power') {
          const m = 48
          const c = new Float32Array(m)
          for (let k = 0; k < m; k++) c[k] = Math.cos((k / (m - 1)) * (Math.PI / 2))
          g.gain.setValueCurveAtTime(c, t + d - oOut, oOut)
        } else {
          g.gain.linearRampToValueAtTime(0, t + d)
        }
      } else {
        g.gain.setValueAtTime(1, t + d - 0.02)
        g.gain.linearRampToValueAtTime(0, t + d)
      }
    } else {
      g.gain.setValueAtTime(1, t + d - 0.04)
      g.gain.setValueAtTime(0, t + d)
    }

    const b = oac.createBufferSource()
    b.buffer = buffer
    b.connect(g)
    g.connect(bus)
    const offset = Math.max(0, Math.min(clip.startSec, buffer.duration - 0.05))
    try {
      b.start(t, offset, d)
    } catch {
      /* noop */
    }
    if (i < n - 1) {
      if (tr.kind === 'gap') t += d + tr.crossfadeSec
      else t += d - oOut
    }
  }

  return oac.startRendering()
}

export class StitchedMasterPlayer {
  private source: AudioBufferSourceNode | null = null
  private raf: number | null = null
  private startAt = 0
  private total = 0
  private onEnd?: () => void
  private onTick?: (p: number) => void
  private status: 'idle' | 'going' = 'idle'

  start(
    buffer: AudioBuffer,
    onTick: (p: number) => void,
    onEnd: () => void,
  ) {
    this.stop()
    const ac = getAudioContext()
    if (ac.state === 'suspended') void ac.resume()
    this.total = buffer.duration
    this.onEnd = onEnd
    this.onTick = onTick
    this.status = 'going'
    const s = ac.createBufferSource()
    s.buffer = buffer
    s.connect(getStitchedMasterInput())
    const now = ac.currentTime + 0.02
    s.start(now)
    this.startAt = now
    this.source = s
    s.onended = () => {
      this.status = 'idle'
      this.cleanupRaf()
      onEnd()
    }
    const tick = () => {
      if (this.status !== 'going' || !this.source) return
      const p = ac.currentTime - this.startAt
      onTick(Math.max(0, Math.min(this.total, p)))
      if (p < this.total - 0.02) {
        this.raf = requestAnimationFrame(tick)
      }
    }
    this.raf = requestAnimationFrame(tick)
  }

  stop() {
    this.status = 'idle'
    if (this.source) {
      try {
        this.source.stop()
      } catch {
        /* */
      }
      this.source = null
    }
    this.cleanupRaf()
  }

  private cleanupRaf() {
    if (this.raf != null) cancelAnimationFrame(this.raf)
    this.raf = null
  }
}
