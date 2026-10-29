/**
 * SourceBank: decoded + warped audio, loaded lazily per (song, stem, range).
 *
 * Only the ranges a timeline actually uses get warped, which keeps memory to
 * the arrangement's length instead of N songs × 5 stems × full duration.
 */

import type { Master, StemName, Timeline } from '@/model/types'
import { requiredRanges } from './timeline'
import { needsWarp, sliceBuffer, warpBuffer, type WarpMode } from './warp'

export type BlobLoader = (songId: string, stem: StemName | 'full') => Promise<Blob | null>

interface Slice {
  /** Warped-time range covered. */
  w0: number
  w1: number
  buffer: AudioBuffer
}

const MARGIN = 0.75

export class SourceBank {
  readonly sampleRate: number
  private load: BlobLoader
  private decoded = new Map<string, Promise<AudioBuffer | null>>()
  private decodedOrder: string[] = []
  private slices = new Map<string, Slice[]>()
  private raw = new Map<string, AudioBuffer>()
  private inflight = new Map<string, Promise<void>>()
  warpMode: WarpMode = 'none'

  constructor(sampleRate: number, load: BlobLoader) {
    this.sampleRate = sampleRate
    this.load = load
  }

  decode(songId: string, stem: StemName | 'full'): Promise<AudioBuffer | null> {
    const key = `${songId}|${stem}`
    const hit = this.decoded.get(key)
    if (hit) {
      this.decodedOrder = [...this.decodedOrder.filter((k) => k !== key), key]
      return hit
    }
    const p: Promise<AudioBuffer | null> = (async () => {
      const blob = await this.load(songId, stem)
      if (!blob) return null
      const ctx = new OfflineAudioContext(2, 1, this.sampleRate)
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
      if (this.decoded.has(key)) this.raw.set(key, buf)
      return buf
    })()
    this.decoded.set(key, p)
    this.decodedOrder.push(key)
    // Keep a handful of full decodes around (audition + warping); slices persist separately.
    while (this.decodedOrder.length > 8) {
      const old = this.decodedOrder.shift()!
      this.decoded.delete(old)
      this.raw.delete(old)
    }
    return p
  }

  private sliceKey(songId: string, stem: string, rate: number, semis: number) {
    return `${songId}|${stem}|${rate.toFixed(4)}|${semis}`
  }

  /** Make sure every range the timeline needs is decoded + warped. */
  async prepare(tl: Timeline, master: Master, onProgress?: (done: number, total: number) => void): Promise<void> {
    const ranges = requiredRanges(tl)
    const jobs: Promise<void>[] = []
    const queue: { key: string; run: () => Promise<void> }[] = []
    for (const [key, list] of ranges) {
      const [songId, stem] = key.split('|') as [string, StemName | 'full']
      const ms = master.songs[songId]
      const rate = ms?.rate ?? 1
      const semis = ms?.semitones ?? 0
      const sk = this.sliceKey(songId, stem, rate, semis)
      for (const [w0, w1] of list) {
        const have = this.slices.get(sk) ?? []
        if (have.some((s) => s.w0 <= w0 && s.w1 >= w1)) continue
        const jobKey = needsWarp(rate, semis) ? `${sk}|${w0.toFixed(2)}|${w1.toFixed(2)}` : sk
        const running = this.inflight.get(jobKey)
        if (running) {
          jobs.push(running)
          continue
        }
        queue.push({
          key: jobKey,
          run: async () => {
            const full = await this.decode(songId, stem)
            if (!full) return
            if (!needsWarp(rate, semis)) {
              this.slices.set(sk, [{ w0: 0, w1: full.duration, buffer: full }])
              return
            }
            const s0 = Math.max(0, w0 * rate - MARGIN)
            const s1 = Math.min(full.duration, w1 * rate + MARGIN)
            const { buffer, mode } = await warpBuffer(sliceBuffer(full, s0, s1), rate, semis)
            if (mode !== 'none') this.warpMode = mode
            const list2 = this.slices.get(sk) ?? []
            list2.push({ w0: s0 / rate, w1: s0 / rate + buffer.duration, buffer })
            this.slices.set(sk, list2)
          },
        })
      }
    }
    let done = 0
    const total = queue.length + jobs.length
    onProgress?.(0, total)
    // Offline renders run on their own threads — a small pool is ~3× faster than serial.
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const p = item.run().finally(() => this.inflight.delete(item!.key))
        this.inflight.set(item.key, p)
        await p
        onProgress?.(++done, total)
      }
    })
    await Promise.all([...workers, ...jobs])
  }

  /** Decode originals for vinyl-mode playback (live pads): no pre-render, rate applied at play time. */
  async prepareRaw(songIds: string[], stem: StemName | 'full' = 'full'): Promise<void> {
    await Promise.all(songIds.map((id) => this.decode(id, stem)))
  }

  /** Vinyl lookup: original buffer, offset in song seconds, playback rate. */
  getRaw(songId: string, stem: StemName | 'full', w: number, master: Master): { buffer: AudioBuffer; offset: number; rate: number } | null {
    const buffer = this.raw.get(`${songId}|${stem}`)
    const rate = master.songs[songId]?.rate ?? 1
    return buffer ? { buffer, offset: w * rate, rate } : null
  }

  get(songId: string, stem: StemName | 'full', w: number, dur: number, master: Master): { buffer: AudioBuffer; offset: number } | null {
    const ms = master.songs[songId]
    const sk = this.sliceKey(songId, stem, ms?.rate ?? 1, ms?.semitones ?? 0)
    const list = this.slices.get(sk)
    if (!list) return null
    const s =
      list.find((x) => x.w0 <= w + 1e-3 && x.w1 >= w + dur - 0.01) ?? list.find((x) => x.w0 <= w + 1e-3 && x.w1 > w)
    return s ? { buffer: s.buffer, offset: w - s.w0 } : null
  }

  /** Drop warped slices (after master tempo/key changes). */
  clearSlices(songId?: string): void {
    if (!songId) this.slices.clear()
    else for (const k of [...this.slices.keys()]) if (k.startsWith(`${songId}|`)) this.slices.delete(k)
  }

  forget(songId: string): void {
    this.clearSlices(songId)
    for (const k of [...this.decoded.keys()]) if (k.startsWith(`${songId}|`)) this.decoded.delete(k)
    for (const k of [...this.raw.keys()]) if (k.startsWith(`${songId}|`)) this.raw.delete(k)
    this.decodedOrder = this.decodedOrder.filter((k) => !k.startsWith(`${songId}|`))
  }
}
