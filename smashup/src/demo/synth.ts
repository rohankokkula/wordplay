/**
 * Synthetic demo crate: five royalty-free "songs" generated in the browser,
 * each with real 4-stem separation (rendered separately) and a sidecar word
 * list. Lets anyone hear the whole pipeline on the hosted preview without
 * uploading copyrighted music or needing the analysis service.
 *
 * The "vocal" is formant synthesis that sings "pai-sa" (p-burst, ai glide,
 * s-hiss, a) plus filler syllables, on a melody in the song's key.
 */

import type { StemName, Word } from '@/model/types'

export interface DemoSpec {
  slug: string
  title: string
  bpm: number
  tonic: number
  minor: boolean
  /** Section plan in bars. */
  form: { kind: 'intro' | 'verse' | 'build' | 'chorus' | 'drop' | 'outro'; bars: number }[]
  swing?: number
}

const FORM_A: DemoSpec['form'] = [
  { kind: 'intro', bars: 4 },
  { kind: 'verse', bars: 8 },
  { kind: 'build', bars: 4 },
  { kind: 'chorus', bars: 8 },
  { kind: 'drop', bars: 8 },
  { kind: 'outro', bars: 4 },
]
const FORM_B: DemoSpec['form'] = [
  { kind: 'intro', bars: 4 },
  { kind: 'chorus', bars: 8 },
  { kind: 'verse', bars: 8 },
  { kind: 'build', bars: 4 },
  { kind: 'drop', bars: 8 },
  { kind: 'chorus', bars: 4 },
]
const FORM_SHORT: DemoSpec['form'] = [
  { kind: 'intro', bars: 2 },
  { kind: 'verse', bars: 4 },
  { kind: 'chorus', bars: 6 },
  { kind: 'drop', bars: 4 },
  { kind: 'outro', bars: 2 },
]

export const DEMO_SONGS: DemoSpec[] = [
  { slug: 'paisa-anthem', title: 'Paisa Anthem (demo)', bpm: 96, tonic: 9, minor: true, form: FORM_A },
  { slug: 'mera-paisa', title: 'Mera Paisa (demo)', bpm: 92, tonic: 4, minor: true, form: FORM_B, swing: 0.12 },
  { slug: 'paisa-hi-paisa', title: 'Paisa Hi Paisa (demo)', bpm: 100, tonic: 0, minor: false, form: FORM_A },
  { slug: 'paisa-rave', title: 'Paisa Rave (demo)', bpm: 128, tonic: 2, minor: true, form: FORM_B },
  { slug: 'halftime-paisa', title: 'Halftime Paisa (demo)', bpm: 49, tonic: 6, minor: true, form: FORM_SHORT },
]

export const DEMO_SR = 24000

type Stems = Record<StemName, Float32Array>

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12)

/* ── Direct DSP primitives (no Web Audio graph: thousands of nodes were ~20 s/song) ── */

interface Ctx {
  buf: Float32Array
  sr: number
  noise: Float32Array
}

class Biquad {
  private b0 = 1
  private b1 = 0
  private b2 = 0
  private a1 = 0
  private a2 = 0
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0
  set(type: 'lp' | 'hp' | 'bp', f: number, q: number, sr: number): this {
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr
    const cos = Math.cos(w)
    const alpha = Math.sin(w) / (2 * q)
    const a0 = 1 + alpha
    let b0: number, b1: number, b2: number
    if (type === 'lp') {
      b0 = (1 - cos) / 2
      b1 = 1 - cos
      b2 = b0
    } else if (type === 'hp') {
      b0 = (1 + cos) / 2
      b1 = -(1 + cos)
      b2 = b0
    } else {
      b0 = alpha
      b1 = 0
      b2 = -alpha
    }
    this.b0 = b0 / a0
    this.b1 = b1 / a0
    this.b2 = b2 / a0
    this.a1 = (-2 * cos) / a0
    this.a2 = (1 - alpha) / a0
    return this
  }
  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1
    this.x1 = x
    this.y2 = this.y1
    this.y1 = y
    return y
  }
}

function makeNoise(sr: number, seed: number): Float32Array {
  const r = rng(seed)
  const d = new Float32Array(sr * 2)
  for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1
  return d
}

/** Attack/exponential-decay envelope. */
function adEnv(t: number, a: number, peak: number, d: number): number {
  return t < a ? (peak * t) / a : peak * Math.exp((-(t - a) * 6.9) / d)
}

function kick(c: Ctx, at: number, v = 1) {
  const s0 = Math.floor(at * c.sr)
  const n = Math.floor(0.35 * c.sr)
  let ph = 0
  for (let i = 0; i < n && s0 + i < c.buf.length; i++) {
    const t = i / c.sr
    const f = 42 + 98 * Math.exp(-t / 0.035)
    ph += (2 * Math.PI * f) / c.sr
    c.buf[s0 + i] += Math.sin(ph) * adEnv(t, 0.002, 0.9 * v, 0.3)
  }
}

function noiseHit(c: Ctx, at: number, dur: number, gain: number, type: 'bp' | 'hp', f: number, q: number) {
  const s0 = Math.floor(at * c.sr)
  const n = Math.floor(dur * c.sr * 1.2)
  const bq = new Biquad().set(type, f, q, c.sr)
  const off = s0 % c.noise.length
  for (let i = 0; i < n && s0 + i < c.buf.length; i++) {
    const x = c.noise[(off + i) % c.noise.length]
    c.buf[s0 + i] += bq.run(x) * adEnv(i / c.sr, 0.001, gain, dur)
  }
}

function snare(c: Ctx, at: number, v = 1) {
  noiseHit(c, at, 0.16, 0.9 * v, 'bp', 2200, 0.8)
  const s0 = Math.floor(at * c.sr)
  for (let i = 0; i < 0.1 * c.sr && s0 + i < c.buf.length; i++) {
    const t = i / c.sr
    c.buf[s0 + i] += Math.sin(2 * Math.PI * 190 * t) * adEnv(t, 0.001, 0.25 * v, 0.08)
  }
}

function hat(c: Ctx, at: number, v = 1, open = false) {
  noiseHit(c, at, open ? 0.18 : 0.04, 0.35 * v, 'hp', 7000, 0.7)
}

function osc(type: OscillatorType, ph: number): number {
  const x = ph - Math.floor(ph)
  if (type === 'sine') return Math.sin(2 * Math.PI * x)
  if (type === 'square') return x < 0.5 ? 1 : -1
  return 2 * x - 1
}

function tone(c: Ctx, at: number, dur: number, hz: number, type: OscillatorType, gain: number, cutoff: number) {
  const s0 = Math.floor(at * c.sr)
  const n = Math.floor((dur + 0.02) * c.sr)
  const lp = new Biquad().set('lp', cutoff, 0.7, c.sr)
  let ph = 0
  for (let i = 0; i < n && s0 + i < c.buf.length; i++) {
    const t = i / c.sr
    ph += hz / c.sr
    const env = t < 0.01 ? t / 0.01 : t > dur - 0.05 ? Math.max(0, (dur - t) / 0.05) : 1
    c.buf[s0 + i] += lp.run(osc(type, ph)) * gain * env
  }
}

/** Sing one syllable: optional consonant noise, then a saw through a gliding formant pair. */
function syllable(
  c: Ctx,
  at: number,
  dur: number,
  hz: number,
  f1: readonly [number, number],
  f2: readonly [number, number],
  cons: 'p' | 's' | 'n' | 'm' | 'h' | null,
  gain = 0.5,
) {
  let vowelAt = at
  if (cons === 'p') {
    noiseHit(c, at, 0.025, 0.9 * gain, 'bp', 1200, 1)
    vowelAt = at + 0.02
  } else if (cons === 's') {
    noiseHit(c, at, 0.1, 0.6 * gain, 'hp', 4500, 0.7)
    vowelAt = at + 0.09
  } else if (cons) {
    vowelAt = at + 0.04
  }
  const vd = Math.max(0.06, at + dur - vowelAt)
  const s0 = Math.floor(vowelAt * c.sr)
  const n = Math.floor(vd * c.sr)
  const bp1 = new Biquad()
  const bp2 = new Biquad()
  let ph = 0
  for (let i = 0; i < n && s0 + i < c.buf.length; i++) {
    const t = i / c.sr
    if (i % 64 === 0) {
      const g = Math.min(1, t / (vd * 0.8))
      bp1.set('bp', f1[0] + (f1[1] - f1[0]) * g, 6, c.sr)
      bp2.set('bp', f2[0] + (f2[1] - f2[0]) * g, 9, c.sr)
    }
    ph += (hz * (1 + 0.012 * Math.sin(2 * Math.PI * 5.5 * t))) / c.sr
    const x = osc('sawtooth', ph)
    const env = t < 0.025 ? t / 0.025 : t > vd * 0.75 ? Math.max(0, (vd - t) / (vd * 0.25)) : 1
    c.buf[s0 + i] += (bp1.run(x) * 2.2 + bp2.run(x) * 1.3) * gain * env
  }
}

const A: [number, number] = [800, 800]
const AI_F1: [number, number] = [780, 320]
const AI_F2: [number, number] = [1150, 2300]
const A2: [number, number] = [1200, 1200]

function singPaisa(c: Ctx, at: number, beat: number, hz: number, gain = 0.55) {
  syllable(c, at, beat * 0.5, hz, AI_F1, AI_F2, 'p', gain)
  syllable(c, at + beat * 0.5, beat * 0.5, hz * 0.89, A, A2, 's', gain)
}

const FILLERS = [
  { w: 'mera', s: [['m', [500, 500], [1000, 1800]], [null, A, A2]] },
  { w: 'hai', s: [['h', AI_F1, AI_F2]] },
  { w: 'yaar', s: [[null, [300, 800], [2200, 1200]]] },
  { w: 'sona', s: [['s', [450, 450], [800, 800]], ['n', A, A2]] },
] as const

function renderStem(spec: DemoSpec, stem: StemName, seed: number, words: Word[] | null): Float32Array {
  const beat = 60 / spec.bpm
  const bar = beat * 4
  const totalBars = spec.form.reduce((s, f) => s + f.bars, 0)
  const dur = totalBars * bar + 0.5
  const c: Ctx = { buf: new Float32Array(Math.ceil(dur * DEMO_SR)), sr: DEMO_SR, noise: makeNoise(DEMO_SR, seed) }
  const r = rng(seed * 31 + stem.length)
  const root = 36 + spec.tonic // C2 + tonic
  const scale = spec.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]
  const prog = spec.minor ? [0, 5, 2, 6] : [0, 4, 5, 3] // i–VI–III–VII / I–V–vi–IV (scale degrees)
  const chordAt = (barIdx: number) => prog[barIdx % 4]
  const degHz = (deg: number, oct: number) => midiHz(root + 12 * oct + scale[deg % 7] + 12 * Math.floor(deg / 7))
  const swing = spec.swing ?? 0

  let b0 = 0
  for (const sec of spec.form) {
    for (let bi = 0; bi < sec.bars; bi++) {
      const barIdx = b0 + bi
      const t = barIdx * bar
      const deg = chordAt(barIdx)
      const k = sec.kind
      if (stem === 'drums') {
        const full = k === 'chorus' || k === 'drop'
        const light = k === 'intro' || k === 'outro'
        for (let s = 0; s < 16; s++) {
          const at = t + s * (beat / 4) + (s % 2 ? swing * beat * 0.25 : 0)
          if (s % 4 === 0 && (!light || s % 8 === 0)) kick(c, at, k === 'drop' ? 1.1 : 0.9)
          if (full && s === 10 && r() > 0.5) kick(c, at, 0.6)
          if ((s === 4 || s === 12) && k !== 'intro') snare(c, at, full ? 1 : 0.7)
          if (s % 2 === 0 || full) hat(c, at, s % 4 === 2 ? 1 : 0.6, k === 'drop' && s % 4 === 2)
          if (k === 'build') {
            const prog01 = bi / sec.bars
            const div = prog01 < 0.5 ? 4 : prog01 < 0.75 ? 2 : 1
            if (s % div === 0) snare(c, at, 0.3 + prog01 * 0.7)
          }
        }
      } else if (stem === 'bass') {
        if (k === 'intro') continue
        const hz = degHz(deg, -1)
        const pattern = k === 'drop' ? [0, 0.75, 1.5, 2, 2.75, 3.5] : [0, 1.5, 2, 3]
        for (const p of pattern) tone(c, t + p * beat, beat * 0.45, hz, k === 'drop' ? 'sawtooth' : 'sine', k === 'drop' ? 0.35 : 0.5, k === 'drop' ? 900 : 400)
      } else if (stem === 'other') {
        const chord = [deg, deg + 2, deg + 4]
        const pad = k === 'drop' ? 0.05 : 0.08
        for (const d of chord) tone(c, t, bar * 0.98, degHz(d, 1), 'sawtooth', pad, k === 'build' ? 800 + bi * 600 : 1800)
        if (k === 'drop' || k === 'chorus') {
          for (let s = 0; s < 8; s++) tone(c, t + s * (beat / 2), beat * 0.35, degHz(chord[s % 3] + 7, 1), 'square', 0.04, 3000)
        }
      } else if (stem === 'vocals' && words) {
        const sing = (at: number, w: string) => {
          words.push({ w, start: +at.toFixed(3), end: +(at + beat).toFixed(3), p: 0.95 })
        }
        const mel = (i: number) => degHz(deg + [4, 2, 4, 0][i % 4], 1)
        if (k === 'chorus') {
          // "paisa" chant: on beats 1 and 3, answer on 4& every other bar.
          for (const bt of [0, 2]) {
            singPaisa(c, t + bt * beat, beat, mel(bt), 0.6)
            sing(t + bt * beat, 'paisa')
          }
        } else if (k === 'verse') {
          for (let i = 0; i < 4; i++) {
            const at = t + i * beat
            if (bi % 4 === 3 && i === 2) {
              singPaisa(c, at, beat, mel(i), 0.5)
              sing(at, 'paisa')
              break
            }
            const f = FILLERS[Math.floor(r() * FILLERS.length)]
            const per = beat / f.s.length
            f.s.forEach((sy, j) => syllable(c, at + j * per, per * 0.9, mel(i + j), sy[1], sy[2], sy[0], 0.4))
            words.push({ w: f.w, start: +at.toFixed(3), end: +(at + beat * 0.9).toFixed(3), p: 0.9 })
          }
        } else if (k === 'build' && bi === sec.bars - 1) {
          singPaisa(c, t + 2 * beat, beat, mel(2), 0.6)
          sing(t + 2 * beat, 'paisa')
        } else if (k === 'outro' && bi === 0) {
          singPaisa(c, t, beat * 2, mel(0), 0.5)
          sing(t, 'paisa')
        }
      }
    }
    b0 += sec.bars
  }
  return c.buf
}

export interface DemoSong {
  spec: DemoSpec
  stems: Stems
  full: Float32Array
  words: Word[]
  sampleRate: number
}

export async function renderDemoSong(spec: DemoSpec, seed: number): Promise<DemoSong> {
  const words: Word[] = []
  const yieldUi = () => new Promise((res) => setTimeout(res, 0))
  const stems = {} as Stems
  for (const stem of ['vocals', 'drums', 'bass', 'other'] as StemName[]) {
    stems[stem] = renderStem(spec, stem, seed, stem === 'vocals' ? words : null)
    await yieldUi()
  }
  const full = new Float32Array(stems.drums.length)
  for (const s of Object.values(stems)) for (let i = 0; i < full.length; i++) full[i] += s[i] ?? 0
  let peak = 0
  for (const v of full) peak = Math.max(peak, Math.abs(v))
  const norm = peak > 0.95 ? 0.95 / peak : 1
  if (norm !== 1) {
    for (const s of [...Object.values(stems), full]) for (let i = 0; i < s.length; i++) s[i] *= norm
  }
  words.sort((a, b) => a.start - b.start)
  return { spec, stems, full, words, sampleRate: DEMO_SR }
}
