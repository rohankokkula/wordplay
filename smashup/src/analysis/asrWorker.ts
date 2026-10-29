/// <reference lib="webworker" />
/**
 * In-browser Whisper (transformers.js) with word timestamps. Runs on WebGPU
 * when available, WASM otherwise. The model is fetched once from the Hugging
 * Face CDN and cached by the browser.
 */
import { pipeline, env } from '@huggingface/transformers'

env.allowLocalModels = false

// Repos exported with cross-attentions so word-level timestamps work; tried in order.
const MODELS = ['onnx-community/whisper-base_timestamped', 'Xenova/whisper-base']

type Transcriber = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ chunks?: { text: string; timestamp: [number, number | null] }[] }>

let ready: Promise<{ run: Transcriber; model: string }> | null = null
const post = (m: unknown) => (self as unknown as Worker).postMessage(m)

async function load(id: number): Promise<{ run: Transcriber; model: string }> {
  const device = (navigator as Navigator & { gpu?: unknown }).gpu ? 'webgpu' : 'wasm'
  let lastErr: unknown = null
  for (const model of MODELS) {
    try {
      const run = (await pipeline('automatic-speech-recognition', model, {
        device,
        dtype: device === 'webgpu' ? 'fp32' : 'q8',
        progress_callback: (p: { status?: string; progress?: number; file?: string }) => {
          if (p.status === 'progress' && typeof p.progress === 'number') post({ id, type: 'progress', stage: 'download', pct: p.progress })
        },
      })) as unknown as Transcriber
      return { run, model }
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr ?? new Error('no ASR model could be loaded')
}

self.onmessage = async (e: MessageEvent<{ id: number; pcm16k: Float32Array; language: string | null; keywords: string[] }>) => {
  const { id, pcm16k, language } = e.data
  try {
    if (!ready) ready = load(id)
    const { run, model } = await ready
    // Chunk manually so we can report progress; Whisper's window is 30 s.
    const sr = 16000
    const win = 30 * sr
    const hop = 25 * sr
    const words: { w: string; start: number; end: number; p: number }[] = []
    for (let s = 0; s < pcm16k.length; s += hop) {
      const chunk = pcm16k.subarray(s, Math.min(pcm16k.length, s + win))
      if (chunk.length < sr) break
      const out = await run(chunk, { return_timestamps: 'word', ...(language ? { language, task: 'transcribe' } : {}) })
      const off = s / sr
      const keepFrom = s === 0 ? 0 : 2.5 // drop the overlap already covered by the previous window
      for (const c of out.chunks ?? []) {
        const t0 = c.timestamp[0]
        if (t0 < keepFrom && s !== 0) continue
        if (s + hop < pcm16k.length && t0 >= 27.5) continue
        const t1 = c.timestamp[1] ?? t0 + 0.4
        const w = c.text.trim()
        if (w) words.push({ w, start: +(off + t0).toFixed(3), end: +(off + t1).toFixed(3), p: 0.7 })
      }
      post({ id, type: 'progress', stage: 'listen', pct: Math.min(100, ((s + win) / pcm16k.length) * 100) })
    }
    post({ id, type: 'done', words, model })
  } catch (err) {
    ready = null
    post({ id, type: 'error', error: err instanceof Error ? err.message : String(err) })
  }
}
