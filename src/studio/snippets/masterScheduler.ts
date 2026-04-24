import { getAudioContext, getStemBus } from '../../audio/mixer'
import type { MasterSnippet } from './types'
import type { MasterTransition } from './masterTransitions'
import { DEFAULT_MASTER_TRANSITION, boundaryOverlapSec } from './masterTransitions'

export interface StemBuffers {
  vocals: AudioBuffer
  instruments: AudioBuffer
}

/**
 * What a single deck can offer the scheduler. `stems` is the ideal path
 * (post-Demucs); `full` is the decoded original file used as a fallback
 * when stems aren't ready or separation failed. The scheduler gracefully
 * degrades — a "vocals" clip will play the full-mix segment if no vocal
 * stem exists, so the snippet UI stays useful without a backend.
 */
export interface DeckSource {
  stems?: StemBuffers | null
  full?: AudioBuffer | null
}

export type MasterPlaybackStatus = 'playing' | 'stopped' | 'done'

/**
 * Schedules the Master deck with per-boundary crossfades / gaps.
 * Routing: stem buses (same as stem preview).
 */
export class MasterScheduler {
  private nodes: { src: AudioBufferSourceNode; gain: GainNode }[] = []
  private startAt = 0
  private totalDur = 0
  private status: MasterPlaybackStatus = 'stopped'
  private onTick?: (progress: number) => void
  private raf: number | null = null
  private onEnd?: () => void
  private sequence: MasterSnippet[]
  private sources: { A?: DeckSource | null; B?: DeckSource | null }
  private transitions: MasterTransition[]

  constructor(
    sequence: MasterSnippet[],
    sources: { A?: DeckSource | null; B?: DeckSource | null },
    options?: {
      onEnd?: () => void
      onTick?: (progressSec: number) => void
      transitions?: MasterTransition[]
    },
  ) {
    this.sequence = sequence
    this.sources = sources
    this.onEnd = options?.onEnd
    this.onTick = options?.onTick
    this.transitions = options?.transitions ?? []
  }

  start(): void {
    const n = this.sequence.length
    const ac = getAudioContext()
    if (ac.state === 'suspended') void ac.resume()
    const now = ac.currentTime + 0.05
    this.startAt = now
    let t = now

    for (let i = 0; i < n; i++) {
      const clip = this.sequence[i]!
      const src = this.sources[clip.deck]
      if (!src) continue
      const stemBuf = clip.stem === 'vocals' ? src.stems?.vocals : src.stems?.instruments
      const buffer = stemBuf ?? src.full
      if (!buffer) continue

      const playLen = Math.max(0.1, clip.endSec - clip.startSec)
      const dNext =
        i < n - 1 ? Math.max(0.1, this.sequence[i + 1]!.endSec - this.sequence[i + 1]!.startSec) : 0
      const tr = (i < n - 1 ? this.transitions[i] : undefined) ?? DEFAULT_MASTER_TRANSITION
      const oOut =
        i < n - 1 && tr.kind !== 'gap' ? boundaryOverlapSec(tr, playLen, dNext) : 0
      const trPrev = i > 0 ? (this.transitions[i - 1] ?? DEFAULT_MASTER_TRANSITION) : null
      const oIn =
        i > 0 && trPrev && trPrev.kind !== 'gap'
          ? boundaryOverlapSec(
              trPrev,
              Math.max(0.1, this.sequence[i - 1]!.endSec - this.sequence[i - 1]!.startSec),
              playLen,
            )
          : 0

      const offset = Math.max(0, Math.min(clip.startSec, buffer.duration - 0.05))
      const srcNode = ac.createBufferSource()
      srcNode.buffer = buffer
      const gain = ac.createGain()
      gain.gain.setValueAtTime(0, t)

      if (i === 0) {
        gain.gain.linearRampToValueAtTime(1, t + 0.02)
      } else if (oIn > 0 && trPrev) {
        if (trPrev.kind === 'equal_power') {
          const m = 48
          const c = new Float32Array(m)
          for (let k = 0; k < m; k++) c[k] = Math.sin((k / (m - 1)) * (Math.PI / 2))
          gain.gain.setValueCurveAtTime(c, t, oIn)
        } else {
          gain.gain.linearRampToValueAtTime(1, t + oIn)
        }
      } else {
        gain.gain.setValueAtTime(1, t + 0.005)
      }

      if (i < n - 1) {
        if (tr.kind === 'gap') {
          gain.gain.setValueAtTime(1, t + playLen - 0.001)
          gain.gain.setValueAtTime(0, t + playLen)
          gain.gain.setValueAtTime(0, t + playLen + tr.crossfadeSec)
        } else if (oOut > 0) {
          gain.gain.setValueAtTime(1, t + playLen - oOut)
          if (tr.kind === 'equal_power') {
            const m = 48
            const c = new Float32Array(m)
            for (let k = 0; k < m; k++) c[k] = Math.cos((k / (m - 1)) * (Math.PI / 2))
            gain.gain.setValueCurveAtTime(c, t + playLen - oOut, oOut)
          } else {
            gain.gain.linearRampToValueAtTime(0, t + playLen)
          }
        } else {
          gain.gain.setValueAtTime(1, t + playLen - 0.02)
          gain.gain.linearRampToValueAtTime(0, t + playLen)
        }
      } else {
        gain.gain.setValueAtTime(1, t + playLen - 0.04)
        gain.gain.setValueAtTime(0, t + playLen)
      }

      const busKey: 'vocalsA' | 'instrumentsA' | 'vocalsB' | 'instrumentsB' =
        `${clip.stem}${clip.deck}` as 'vocalsA' | 'instrumentsA' | 'vocalsB' | 'instrumentsB'
      const bus = getStemBus(busKey)

      srcNode.connect(gain).connect(bus)
      try {
        srcNode.start(t, offset, playLen)
      } catch {
        /* noop */
      }
      this.nodes.push({ src: srcNode, gain })

      if (i < n - 1) {
        if (tr.kind === 'gap') t += playLen + tr.crossfadeSec
        else t += playLen - oOut
      }
    }

    this.totalDur = t - now
    this.status = 'playing'

    const tick = () => {
      if (this.status !== 'playing') return
      const ac2 = getAudioContext()
      const elapsed = ac2.currentTime - this.startAt
      this.onTick?.(Math.max(0, Math.min(this.totalDur, elapsed)))
      if (elapsed >= this.totalDur) {
        this.status = 'done'
        this.onEnd?.()
        return
      }
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  stop(): void {
    const ac = getAudioContext()
    for (const { src, gain } of this.nodes) {
      try {
        gain.gain.cancelScheduledValues(ac.currentTime)
        gain.gain.setValueAtTime(gain.gain.value, ac.currentTime)
        gain.gain.linearRampToValueAtTime(0, ac.currentTime + 0.05)
        src.stop(ac.currentTime + 0.06)
      } catch {
        /* already stopped */
      }
    }
    this.nodes = []
    if (this.raf != null) cancelAnimationFrame(this.raf)
    this.raf = null
    this.status = 'stopped'
  }

  getStatus(): MasterPlaybackStatus {
    return this.status
  }
}
