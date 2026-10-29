/**
 * Main-thread wrapper for the in-browser Whisper worker. Prepares 16 kHz mono
 * audio (vocal band, or the vocal stem when present), caches transcripts in
 * IndexedDB by hash + language, and exposes a test hook so e2e can stub ASR.
 */

import type { Word } from '@/model/types'
import { getBlob, putBlob } from '@/store/persist'

export type AsrLanguage = 'auto' | 'hindi' | 'urdu' | 'punjabi' | 'english'

export interface AsrProgress {
  stage: 'download' | 'listen'
  pct: number
}

type Stub = (pcm16k: Float32Array, language: AsrLanguage) => Promise<Word[]>
const hook = globalThis as unknown as { __smashupAsrStub?: Stub }

let worker: Worker | null = null
let seq = 0
// One transcription at a time: Whisper saturates the device.
let queue: Promise<unknown> = Promise.resolve()

const CACHE_VERSION = 'asr1'

/** Resample to 16 kHz and band-limit to the vocal range so the beat interferes less. */
export async function toAsrInput(buf: AudioBuffer, isVocalStem: boolean, bandLimit = true): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.ceil(buf.duration * 16000), 16000)
  const src = ctx.createBufferSource()
  src.buffer = buf
  let node: AudioNode = src
  if (!isVocalStem && bandLimit) {
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 180
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 4200
    node = node.connect(hp).connect(lp)
  }
  node.connect(ctx.destination)
  src.start()
  const out = await ctx.startRendering()
  const d = out.getChannelData(0)
  let peak = 0
  for (const v of d) peak = Math.max(peak, Math.abs(v))
  if (peak > 0) for (let i = 0; i < d.length; i++) d[i] *= 0.9 / peak
  return d
}

export function transcribeInBrowser(
  hash: string,
  pcm16k: Float32Array,
  language: AsrLanguage,
  keywords: string[],
  onProgress: (p: AsrProgress) => void,
): Promise<Word[]> {
  const run = async (): Promise<Word[]> => {
    const key = `${hash}:${CACHE_VERSION}:${language}`
    const cached = await getBlob(key)
    if (cached) return JSON.parse(await cached.text()) as Word[]
    let words: Word[]
    if (hook.__smashupAsrStub) words = await hook.__smashupAsrStub(pcm16k, language)
    else words = await viaWorker(pcm16k, language, keywords, onProgress)
    await putBlob(key, new Blob([JSON.stringify(words)], { type: 'application/json' }))
    return words
  }
  const p = queue.then(run, run)
  queue = p.catch(() => undefined)
  return p
}

function viaWorker(pcm16k: Float32Array, language: AsrLanguage, keywords: string[], onProgress: (p: AsrProgress) => void): Promise<Word[]> {
  if (!worker) worker = new Worker(new URL('./asrWorker.ts', import.meta.url), { type: 'module' })
  const id = ++seq
  const w = worker
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent<{ id: number; type: string; stage?: AsrProgress['stage']; pct?: number; words?: Word[]; error?: string }>) => {
      if (e.data.id !== id) return
      if (e.data.type === 'progress') onProgress({ stage: e.data.stage ?? 'listen', pct: e.data.pct ?? 0 })
      else {
        w.removeEventListener('message', onMsg)
        if (e.data.type === 'done') resolve(e.data.words ?? [])
        else reject(new Error(e.data.error || 'transcription failed'))
      }
    }
    w.addEventListener('message', onMsg)
    const copy = pcm16k.slice()
    w.postMessage({ id, pcm16k: copy, language: language === 'auto' ? null : language, keywords }, [copy.buffer])
  })
}
