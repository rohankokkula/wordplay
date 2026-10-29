/// <reference lib="webworker" />
import { analyzeMono } from './music'
import { spot, type Seed } from './spotter'

type Msg =
  | { id: number; kind: 'analyze'; pcm: Float32Array; sr: number }
  | { id: number; kind: 'spot'; songs: { pcm: Float32Array; sr: number }[]; seeds: Seed[] }

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data
  const post = (r: unknown) => (self as unknown as Worker).postMessage(r)
  try {
    if (m.kind === 'spot') post({ id: m.id, ok: true, result: spot(m.songs, m.seeds) })
    else post({ id: m.id, ok: true, result: analyzeMono(m.pcm, m.sr) })
  } catch (err) {
    post({ id: m.id, ok: false, error: String(err) })
  }
}
