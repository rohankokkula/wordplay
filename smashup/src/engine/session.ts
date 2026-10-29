/**
 * Audio session singleton: one AudioContext, one SourceBank, live transport,
 * auditions, pad performance and export.
 */

import type { Lane, Master, StemName, Timeline } from '@/model/types'
import { getBlob } from '@/store/persist'
import { ensureDemoBlobs } from '@/demo'
import { SourceBank } from './bank'
import { renderOffline, scheduleTimeline, type ScheduleHandle } from './graph'
import { audioBufferToWav } from './wav'

type HashResolver = (songId: string) => string | null

class AudioSession {
  private ctx: AudioContext | null = null
  private resolver: HashResolver = () => null
  readonly bank: SourceBank
  private live: ScheduleHandle | null = null
  private startCtx = 0
  private startPos = 0
  private audition: AudioBufferSourceNode | null = null
  playing = false
  laneGain: Partial<Record<Lane, number>> = {}

  constructor() {
    this.bank = new SourceBank(44100, async (songId, stem) => {
      const hash = this.resolver(songId)
      if (!hash) return null
      const key = `${hash}:${stem}`
      const b = await getBlob(key)
      if (b) return b
      if (hash.startsWith('demo-') && (await ensureDemoBlobs(hash))) return getBlob(key)
      return null
    })
  }

  setResolver(r: HashResolver) {
    this.resolver = r
  }

  context(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext({ latencyHint: 'interactive' })
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  get analyser(): AnalyserNode | null {
    return this.live?.analyser ?? null
  }

  async prepare(tl: Timeline, master: Master, onProgress?: (d: number, t: number) => void) {
    await this.bank.prepare(tl, master, onProgress)
  }

  async play(tl: Timeline, master: Master, from: number) {
    this.stop()
    this.stopAudition()
    const ctx = this.context()
    await this.prepare(tl, master)
    const when = ctx.currentTime + 0.08
    this.live = scheduleTimeline(ctx, ctx.destination, tl, this.bank, master, { from, when, laneGain: this.laneGain })
    this.startCtx = when
    this.startPos = from
    this.playing = true
  }

  stop(): number {
    const pos = this.position()
    this.live?.stop()
    this.live = null
    this.playing = false
    return pos
  }

  position(): number {
    if (!this.playing || !this.ctx) return this.startPos
    return this.startPos + Math.max(0, this.ctx.currentTime - this.startCtx)
  }

  /** Raw (unwarped) audition of a song region — Word Wall + pad preview. */
  async auditionRaw(songId: string, stem: StemName | 'full', start: number, dur: number) {
    this.stopAudition()
    const ctx = this.context()
    const buf = await this.bank.decode(songId, stem)
    if (!buf) return
    const s = ctx.createBufferSource()
    s.buffer = buf
    const g = ctx.createGain()
    const t = ctx.currentTime + 0.02
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.9, t + 0.01)
    g.gain.setValueAtTime(0.9, t + dur - 0.03)
    g.gain.linearRampToValueAtTime(0, t + dur)
    s.connect(g).connect(ctx.destination)
    s.start(t, Math.max(0, start), dur)
    this.audition = s
  }

  stopAudition() {
    try {
      this.audition?.stop()
    } catch {
      /* already stopped */
    }
    this.audition = null
  }

  /** Perform mode: schedule a one-section timeline at an exact context time, vinyl-style. */
  schedulePad(tl: Timeline, master: Master, when: number): ScheduleHandle {
    const ctx = this.context()
    return scheduleTimeline(ctx, ctx.destination, tl, this.bank, master, { from: 0, when: Math.max(when, ctx.currentTime + 0.01), vinyl: true })
  }

  async exportWav(tl: Timeline, master: Master, onProgress?: (d: number, t: number) => void): Promise<Blob> {
    await this.prepare(tl, master, onProgress)
    const buf = await renderOffline(tl, this.bank, master)
    return audioBufferToWav(buf)
  }
}

export const session = new AudioSession()
