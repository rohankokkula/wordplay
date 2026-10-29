/**
 * Time-stretch + pitch-shift a slice to the master tempo/key.
 *
 * Primary path: Signalsmith Stretch (WASM AudioWorklet) rendered in an
 * OfflineAudioContext — pitch-preserving warp, independent semitone shift.
 * Fallback ("vinyl" mode): resample with playbackRate — tempo and pitch move
 * together, like a turntable's pitch fader. Used when AudioWorklet isn't
 * available in offline contexts.
 */

import SignalsmithStretch from 'signalsmith-stretch'

export type WarpMode = 'stretch' | 'vinyl' | 'none'

let stretchBroken = false

export function needsWarp(rate: number, semitones: number): boolean {
  return Math.abs(rate - 1) > 0.002 || semitones !== 0
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])
}

export async function warpBuffer(buf: AudioBuffer, rate: number, semitones: number): Promise<{ buffer: AudioBuffer; mode: WarpMode }> {
  if (!needsWarp(rate, semitones)) return { buffer: buf, mode: 'none' }
  if (!stretchBroken) {
    try {
      return { buffer: await stretchRender(buf, rate, semitones), mode: 'stretch' }
    } catch (e) {
      console.warn('[smashup] Signalsmith stretch unavailable, falling back to vinyl warp', e)
      stretchBroken = true
    }
  }
  return { buffer: await vinylRender(buf, rate), mode: 'vinyl' }
}

async function stretchRender(buf: AudioBuffer, rate: number, semitones: number): Promise<AudioBuffer> {
  const channels = Math.min(2, buf.numberOfChannels)
  const outLen = Math.ceil(buf.length / rate)
  const ctx = new OfflineAudioContext(channels, outLen, buf.sampleRate)
  const node = await withTimeout(
    SignalsmithStretch(ctx, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [channels] }),
    8000,
  )
  const data = Array.from({ length: channels }, (_, c) => buf.getChannelData(c).slice())
  await withTimeout(node.addBuffers(data), 8000)
  await withTimeout(node.schedule({ output: 0, active: true, input: 0, rate, semitones, formantCompensation: true }), 8000)
  node.connect(ctx.destination)
  return ctx.startRendering()
}

async function vinylRender(buf: AudioBuffer, rate: number): Promise<AudioBuffer> {
  const outLen = Math.ceil(buf.length / rate)
  const ctx = new OfflineAudioContext(buf.numberOfChannels, outLen, buf.sampleRate)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = rate
  src.connect(ctx.destination)
  src.start()
  return ctx.startRendering()
}

/** Copy [startSec, endSec) of a buffer into a new one. */
export function sliceBuffer(buf: AudioBuffer, startSec: number, endSec: number): AudioBuffer {
  const s = Math.max(0, Math.floor(startSec * buf.sampleRate))
  const e = Math.min(buf.length, Math.ceil(endSec * buf.sampleRate))
  const out = new AudioBuffer({ length: Math.max(1, e - s), numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate })
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(s, e), c)
  return out
}
