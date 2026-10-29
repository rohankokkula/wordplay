/** Synthesised DJ one-shots (riser, crash, brake, kick) — context-agnostic so they render offline too. */

import type { Sfx } from '@/model/types'

function noise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds))
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  return buf
}

export function scheduleSfx(ctx: BaseAudioContext, dest: AudioNode, s: Sfx, when: number): AudioScheduledSourceNode[] {
  const out: AudioScheduledSourceNode[] = []
  const g = ctx.createGain()
  g.connect(dest)
  switch (s.kind) {
    case 'riser': {
      const src = ctx.createBufferSource()
      src.buffer = noise(ctx, s.dur)
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.Q.value = 2
      bp.frequency.setValueAtTime(300, when)
      bp.frequency.exponentialRampToValueAtTime(7000, when + s.dur)
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(110, when)
      osc.frequency.exponentialRampToValueAtTime(1800, when + s.dur)
      const og = ctx.createGain()
      og.gain.value = 0.05
      g.gain.setValueAtTime(0.0001, when)
      g.gain.exponentialRampToValueAtTime(0.3, when + s.dur * 0.95)
      g.gain.linearRampToValueAtTime(0, when + s.dur)
      src.connect(bp).connect(g)
      osc.connect(og).connect(g)
      src.start(when)
      src.stop(when + s.dur)
      osc.start(when)
      osc.stop(when + s.dur)
      out.push(src, osc)
      break
    }
    case 'crash': {
      const src = ctx.createBufferSource()
      src.buffer = noise(ctx, s.dur)
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 5000
      g.gain.setValueAtTime(0.32, when)
      g.gain.exponentialRampToValueAtTime(0.001, when + s.dur)
      src.connect(hp).connect(g)
      src.start(when)
      src.stop(when + s.dur)
      out.push(src)
      break
    }
    case 'brake': {
      const src = ctx.createBufferSource()
      src.buffer = noise(ctx, s.dur)
      src.playbackRate.setValueAtTime(1, when)
      src.playbackRate.exponentialRampToValueAtTime(0.05, when + s.dur)
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(6000, when)
      lp.frequency.exponentialRampToValueAtTime(150, when + s.dur)
      g.gain.setValueAtTime(0.06, when)
      g.gain.linearRampToValueAtTime(0, when + s.dur)
      src.connect(lp).connect(g)
      src.start(when)
      src.stop(when + s.dur)
      out.push(src)
      break
    }
    case 'kick': {
      const osc = ctx.createOscillator()
      osc.frequency.setValueAtTime(150, when)
      osc.frequency.exponentialRampToValueAtTime(40, when + 0.18)
      g.gain.setValueAtTime(0.9, when)
      g.gain.exponentialRampToValueAtTime(0.001, when + s.dur)
      osc.connect(g)
      osc.start(when)
      osc.stop(when + s.dur)
      out.push(osc)
      break
    }
  }
  return out
}

export function reverbIR(ctx: BaseAudioContext, seconds = 2.2, decay = 3): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp((-i / len) * decay * 2)
  }
  return buf
}
