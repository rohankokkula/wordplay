/**
 * Bridges graph FX kinds → concrete calls against `src/audio/effects.ts`.
 * Each handler is a short async function so the scheduler can `await` it
 * and sequence them between splits.
 */
import {
  openFilter,
  openHighpass,
  setReverbSend,
  sweepFilter,
  sweepHighpass,
} from '../audio/effects'
import { getAudioContext, setMasterVolume } from '../audio/mixer'
import type { FXEdge, FXKind } from './types'

export interface FXHandlerCtx {
  /** Seconds per beat at the graph's master BPM. */
  secPerBeat: number
}

export type FXHandler = (edge: FXEdge, ctx: FXHandlerCtx) => Promise<void> | void

/** No-op hard cut. */
const cut: FXHandler = () => {
  setReverbSend(0, 0.02)
  openFilter(0.02)
  openHighpass(0.02)
}

const reverb: FXHandler = (edge, ctx) => {
  const dur = ctx.secPerBeat * edge.blendBeats
  setReverbSend(Math.max(0, Math.min(1, edge.wet)), 0.1)
  setTimeout(() => setReverbSend(0, 0.3), dur * 1000)
}

const echo: FXHandler = (edge, ctx) => {
  const dur = ctx.secPerBeat * edge.blendBeats
  setReverbSend(Math.max(0, Math.min(1, edge.wet * 0.7)), 0.05)
  setTimeout(() => setReverbSend(0, 0.2), dur * 1000)
}

const lowpass: FXHandler = (edge, ctx) => {
  const dur = ctx.secPerBeat * edge.blendBeats
  const target = 400 + (1 - edge.wet) * 8000
  sweepFilter(target, dur * 0.5)
  setTimeout(() => openFilter(dur * 0.5), dur * 500)
}

const filterSweep: FXHandler = (edge, ctx) => {
  const dur = ctx.secPerBeat * edge.blendBeats
  sweepFilter(200, dur * 0.4)
  sweepHighpass(900, dur * 0.4)
  setTimeout(() => {
    openFilter(dur * 0.5)
    openHighpass(dur * 0.5)
  }, dur * 400)
}

const stutter: FXHandler = (edge, ctx) => {
  const dur = ctx.secPerBeat * edge.blendBeats
  const steps = 8
  const ac = getAudioContext()
  const originalVol = 1
  const stepSec = (dur / steps) * 1000
  for (let i = 0; i < steps; i++) {
    const t = i * stepSec
    setTimeout(() => setMasterVolume(i % 2 === 0 ? 0.1 : originalVol), t)
  }
  setTimeout(() => setMasterVolume(originalVol), dur * 1000 + 10)
  // Silence warning
  void ac
}

export const FX_HANDLERS: Record<FXKind, FXHandler> = {
  none: cut,
  reverb,
  echo,
  lowpass,
  'filter-sweep': filterSweep,
  stutter,
}

export function runFX(edge: FXEdge, bpm: number) {
  const handler = FX_HANDLERS[edge.fx] ?? cut
  return handler(edge, { secPerBeat: 60 / Math.max(1, bpm) })
}
