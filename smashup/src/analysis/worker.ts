/// <reference lib="webworker" />
import { analyzeMono } from './music'

self.onmessage = (e: MessageEvent<{ id: number; pcm: Float32Array; sr: number }>) => {
  const { id, pcm, sr } = e.data
  try {
    ;(self as unknown as Worker).postMessage({ id, ok: true, analysis: analyzeMono(pcm, sr) })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, ok: false, error: String(err) })
  }
}
