/**
 * On-device music analysis: tempo + beat grid + downbeats, key (Camelot),
 * per-bar energy / vocal estimate, and phrase sections with roles.
 *
 * Pure functions over mono PCM so it runs in a Worker and in tests. The
 * approach (spectral-flux onsets → autocorrelation tempo → comb phase →
 * least-squares grid fit) is a cleaned-up descendant of Wordplay's
 * `analyzeCore.ts`, extended with downbeats, chroma key and sectioning.
 */

import type { Camelot, MusicalKey, SectionRole, SongAnalysis, SongSection } from '@/model/types'
import { FFT } from './fft'

const TARGET_SR = 22050
const FRAME = 2048
const HOP = 512

export interface Features {
  sr: number
  hopSec: number
  onset: Float32Array
  low: Float32Array
  rms: Float32Array
  vocalish: Float32Array
  chroma: Float32Array[]
}

export function downsample(x: Float32Array, sr: number): { y: Float32Array; sr: number } {
  const factor = Math.max(1, Math.round(sr / TARGET_SR))
  if (factor === 1) return { y: x, sr }
  const y = new Float32Array(Math.floor(x.length / factor))
  for (let i = 0; i < y.length; i++) {
    let s = 0
    for (let k = 0; k < factor; k++) s += x[i * factor + k]
    y[i] = s / factor
  }
  return { y, sr: sr / factor }
}

export function extractFeatures(x: Float32Array, sr: number): Features {
  const fft = new FFT(FRAME)
  const nFrames = Math.max(1, Math.floor((x.length - FRAME) / HOP) + 1)
  const bins = FRAME / 2
  const hz = sr / FRAME
  const mag = new Float32Array(bins)
  const prevLog = new Float32Array(bins)
  const onset = new Float32Array(nFrames)
  const low = new Float32Array(nFrames)
  const rms = new Float32Array(nFrames)
  const vocalish = new Float32Array(nFrames)
  const chroma: Float32Array[] = []
  const lowBin = Math.ceil(150 / hz)
  const vLo = Math.floor(300 / hz)
  const vHi = Math.ceil(3400 / hz)
  const cLo = Math.floor(100 / hz)
  const cHi = Math.ceil(5000 / hz)
  const pitchClass = new Int8Array(bins).fill(-1)
  for (let b = cLo; b <= cHi && b < bins; b++) {
    const f = b * hz
    pitchClass[b] = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12 + 9) % 12
  }

  for (let f = 0; f < nFrames; f++) {
    const off = f * HOP
    let e = 0
    for (let i = 0; i < FRAME; i++) {
      const v = x[off + i] ?? 0
      e += v * v
    }
    rms[f] = Math.sqrt(e / FRAME)
    fft.magnitudes(x, off, mag)
    let flux = 0
    let lowE = 0
    let vE = 0
    let tot = 0
    const c = new Float32Array(12)
    for (let b = 1; b < bins; b++) {
      const m = mag[b]
      const lg = Math.log1p(100 * m)
      const d = lg - prevLog[b]
      if (d > 0) flux += d
      prevLog[b] = lg
      const p = m * m
      tot += p
      if (b <= lowBin) lowE += p
      if (b >= vLo && b <= vHi) vE += p
      const pc = pitchClass[b]
      if (pc >= 0) c[pc] += Math.sqrt(m)
    }
    onset[f] = flux
    low[f] = lowE
    vocalish[f] = tot > 0 ? vE / tot : 0
    chroma.push(c)
  }
  normalizeMax(onset)
  normalizeMax(low)
  // A frame describes its window centre, not its start: shift so index i ↔ time i·hop.
  const lag = Math.round(FRAME / 2 / HOP)
  const shift = (a: Float32Array) => {
    const o = new Float32Array(a.length)
    o.set(a.subarray(0, a.length - lag), lag)
    return o
  }
  const chromaShifted = [...Array.from({ length: lag }, () => new Float32Array(12)), ...chroma.slice(0, chroma.length - lag)]
  return { sr, hopSec: HOP / sr, onset: shift(onset), low: shift(low), rms: shift(rms), vocalish: shift(vocalish), chroma: chromaShifted }
}

function normalizeMax(a: Float32Array): void {
  let m = 0
  for (const v of a) if (v > m) m = v
  if (m > 0) for (let i = 0; i < a.length; i++) a[i] /= m
}

export interface Grid {
  bpm: number
  period: number
  /** Time of the first beat at or after 0. */
  phase: number
  downbeat: number
}

/** Tempo by autocorrelation of the onset envelope with a log-Gaussian prior around 115 BPM. */
export function estimateTempo(onset: Float32Array, hopSec: number): number {
  const n = onset.length
  let mean = 0
  for (const v of onset) mean += v
  mean /= Math.max(1, n)
  const o = Float32Array.from(onset, (v) => v - mean)
  const minLag = Math.floor(60 / 200 / hopSec)
  const maxLag = Math.ceil(60 / 60 / hopSec)
  const ac = new Float32Array(maxLag + 2)
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0
    for (let i = 0; i + lag < n; i++) s += o[i] * o[i + lag]
    ac[lag] = s / (n - lag)
  }
  let best = minLag
  let bestScore = -Infinity
  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    const bpm = 60 / (lag * hopSec)
    // Club music lives around 90–130 BPM; a tight prior stops octave errors (92 read as 184).
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 112) / 0.5) ** 2)
    // Reward lags whose double also correlates (true beat periods are periodic).
    const harmonic = lag * 2 <= maxLag ? 0.25 * Math.max(0, ac[lag * 2]) : 0
    const score = (Math.max(0, ac[lag]) + harmonic) * prior
    if (ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1] && score > bestScore) {
      bestScore = score
      best = lag
    }
  }
  // Parabolic interpolation for sub-frame precision.
  const a = ac[best - 1]
  const b = ac[best]
  const c = ac[best + 1]
  const denom = a - 2 * b + c
  const shift = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0
  return 60 / ((best + shift) * hopSec)
}

/** Beat phase by comb filtering, then least-squares refinement of period + phase on local peaks. */
export function fitGrid(f: Features, bpm: number, duration: number): Grid {
  const { onset, low, hopSec, chroma } = f
  let period = 60 / bpm
  const periodFrames = period / hopSec
  let bestPhase = 0
  let bestSum = -1
  for (let p = 0; p < periodFrames; p += 0.5) {
    let s = 0
    for (let t = p; t < onset.length; t += periodFrames) s += onset[Math.round(t)] ?? 0
    if (s > bestSum) {
      bestSum = s
      bestPhase = p
    }
  }
  let phase = bestPhase * hopSec
  // Least-squares on snapped local maxima.
  const xs: number[] = []
  const ys: number[] = []
  for (let k = 0; phase + k * period < duration; k++) {
    const center = Math.round((phase + k * period) / hopSec)
    let bi = center
    let bv = -1
    for (let d = -3; d <= 3; d++) {
      const v = onset[center + d] ?? -1
      if (v > bv) {
        bv = v
        bi = center + d
      }
    }
    if (bv > 0.15) {
      xs.push(k)
      ys.push(bi * hopSec)
    }
  }
  if (xs.length > 16) {
    const n = xs.length
    const mx = xs.reduce((s, v) => s + v, 0) / n
    const my = ys.reduce((s, v) => s + v, 0) / n
    let num = 0
    let den = 0
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my)
      den += (xs[i] - mx) ** 2
    }
    const p2 = num / den
    if (Math.abs(p2 - period) / period < 0.03) {
      period = p2
      phase = my - p2 * mx
    }
  }
  while (phase - period >= 0) phase -= period
  while (phase < 0) phase += period

  // Downbeat: which of 4 beat offsets carries the most kick + harmonic change.
  const scores = [0, 0, 0, 0]
  let prevC: Float32Array | null = null
  for (let k = 0; phase + k * period < duration; k++) {
    const fi = Math.round((phase + k * period) / hopSec)
    const c = chroma[fi]
    let change = 0
    if (c && prevC) {
      let dot = 0
      let na = 0
      let nb = 0
      for (let i = 0; i < 12; i++) {
        dot += c[i] * prevC[i]
        na += c[i] * c[i]
        nb += prevC[i] * prevC[i]
      }
      change = 1 - dot / Math.sqrt(na * nb + 1e-9)
    }
    if (c) prevC = c
    scores[k % 4] += (low[fi] ?? 0) + 0.6 * (onset[fi] ?? 0) + 1.5 * change
  }
  const o = scores.indexOf(Math.max(...scores))
  const downbeat = phase + o * period
  return { bpm: 60 / period, period, phase, downbeat }
}

/* ── Key ─────────────────────────────────────────────────────────────── */

const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

export function camelotOf(tonic: number, mode: 'major' | 'minor'): Camelot {
  const relMajor = mode === 'major' ? tonic : (tonic + 3) % 12
  const n = (((relMajor * 7) % 12) + 7) % 12 + 1
  return `${n}${mode === 'major' ? 'B' : 'A'}` as Camelot
}

export function keyName(k: Pick<MusicalKey, 'tonic' | 'mode'>): string {
  return `${NOTE_NAMES[k.tonic]}${k.mode === 'minor' ? 'm' : ''}`
}

function corr(a: number[], b: number[]): number {
  const n = a.length
  const ma = a.reduce((s, v) => s + v, 0) / n
  const mb = b.reduce((s, v) => s + v, 0) / n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return num / Math.sqrt(da * db + 1e-12)
}

export function estimateKey(profile: number[]): MusicalKey {
  let best = { tonic: 0, mode: 'major' as 'major' | 'minor', r: -2 }
  let second = -2
  for (let t = 0; t < 12; t++) {
    const rotated = profile.map((_, i) => profile[(i + t) % 12])
    for (const [mode, prof] of [['major', KK_MAJOR], ['minor', KK_MINOR]] as const) {
      const r = corr(rotated, prof)
      if (r > best.r) {
        second = best.r
        best = { tonic: t, mode, r }
      } else if (r > second) second = r
    }
  }
  return {
    tonic: best.tonic,
    mode: best.mode,
    camelot: camelotOf(best.tonic, best.mode),
    confidence: Math.max(0, Math.min(1, (best.r - second) * 5 + best.r * 0.5)),
  }
}

/* ── Bars, energy, sections ──────────────────────────────────────────── */

function perBar(values: Float32Array, hopSec: number, bars: number[], duration: number): number[] {
  const out: number[] = []
  for (let i = 0; i < bars.length; i++) {
    const s = Math.floor(bars[i] / hopSec)
    const e = Math.max(s + 1, Math.floor((bars[i + 1] ?? duration) / hopSec))
    let sum = 0
    let n = 0
    for (let j = s; j < e && j < values.length; j++) {
      sum += values[j]
      n++
    }
    out.push(n ? sum / n : 0)
  }
  return out
}

export function normalizeRobust(a: number[]): number[] {
  if (!a.length) return a
  const sorted = [...a].sort((x, y) => x - y)
  const hi = sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1] || 1
  const lo = sorted[Math.floor(sorted.length * 0.05)] || 0
  const span = Math.max(1e-6, hi - lo)
  return a.map((v) => Math.max(0, Math.min(1, (v - lo) / span)))
}

export function segmentSections(energy: number[], vocal: number[], barChroma: number[][]): SongSection[] {
  const nBars = energy.length
  if (nBars === 0) return []
  const block = 4
  const nBlocks = Math.ceil(nBars / block)
  const feat = (b: number) => {
    const s = b * block
    const e = Math.min(nBars, s + block)
    let en = 0
    let vo = 0
    const ch = new Array(12).fill(0)
    for (let i = s; i < e; i++) {
      en += energy[i]
      vo += vocal[i]
      for (let k = 0; k < 12; k++) ch[k] += barChroma[i]?.[k] ?? 0
    }
    const n = e - s
    const norm = Math.hypot(...ch) || 1
    return { en: en / n, vo: vo / n, ch: ch.map((v) => v / norm) }
  }
  const feats = Array.from({ length: nBlocks }, (_, b) => feat(b))
  const novelty = feats.map((f, b) => {
    if (b === 0) return 0
    const p = feats[b - 1]
    let cos = 0
    for (let k = 0; k < 12; k++) cos += f.ch[k] * p.ch[k]
    return Math.abs(f.en - p.en) * 2 + Math.abs(f.vo - p.vo) * 1.5 + (1 - cos)
  })
  const mean = novelty.reduce((s, v) => s + v, 0) / Math.max(1, novelty.length)
  const cuts = [0]
  for (let b = 1; b < nBlocks; b++) {
    const isPeak = novelty[b] >= (novelty[b - 1] ?? 0) && novelty[b] >= (novelty[b + 1] ?? 0)
    // Phrases of at least 8 bars, and prefer 8/16-bar boundaries.
    const gap = b - cuts[cuts.length - 1]
    // 8-bar phrases by default; a 4-bar section only when the change is stark.
    if (isPeak && ((gap >= 2 && novelty[b] > mean * 0.9) || (gap >= 1 && novelty[b] > mean * 1.6))) cuts.push(b)
    else if (gap >= 4) cuts.push(b)
  }
  const sections: SongSection[] = cuts.map((b, i) => {
    const startBar = b * block
    const end = Math.min(nBars, (cuts[i + 1] ?? nBlocks) * block)
    let en = 0
    for (let k = startBar; k < end; k++) en += energy[k]
    return { startBar, bars: end - startBar, role: 'verse' as SectionRole, energy: en / Math.max(1, end - startBar) }
  })
  labelRoles(sections, vocal)
  return sections
}

export function labelRoles(sections: SongSection[], vocal: number[]): void {
  const energies = sections.map((s) => s.energy).sort((a, b) => a - b)
  const q = (p: number) => energies[Math.min(energies.length - 1, Math.floor(p * energies.length))] ?? 0
  const hi = q(0.7)
  const lo = q(0.3)
  sections.forEach((s, i) => {
    let vo = 0
    for (let k = s.startBar; k < s.startBar + s.bars; k++) vo += vocal[k] ?? 0
    vo /= Math.max(1, s.bars)
    const next = sections[i + 1]
    if (i === 0 && s.energy <= hi) s.role = 'intro'
    else if (i === sections.length - 1 && s.energy <= hi) s.role = 'outro'
    else if (s.energy >= hi) s.role = vo < 0.35 ? 'drop' : 'chorus'
    else if (next && next.energy >= hi && s.energy > lo) s.role = 'build'
    else if (s.energy <= lo) s.role = 'breath'
    else s.role = 'verse'
  })
}

/* ── Entry point ─────────────────────────────────────────────────────── */

export function analyzeMono(raw: Float32Array, rawSr: number): SongAnalysis {
  const duration = raw.length / rawSr
  const { y, sr } = downsample(raw, rawSr)
  const f = extractFeatures(y, sr)
  const bpm0 = estimateTempo(f.onset, f.hopSec)
  const grid = fitGrid(f, bpm0, duration)
  const barLen = grid.period * 4
  let first = grid.downbeat
  while (first - barLen >= -0.05) first -= barLen
  if (first < 0) first += barLen
  const bars: number[] = []
  for (let t = first; t + barLen * 0.5 < duration; t += barLen) bars.push(t)

  const energy = normalizeRobust(perBar(f.rms, f.hopSec, bars, duration))
  const vocalRaw = perBar(f.vocalish, f.hopSec, bars, duration)
  // Spectral estimate is weak; scale it by energy so silent bars never read as vocal.
  const vocal = normalizeRobust(vocalRaw).map((v, i) => v * (0.4 + 0.6 * energy[i]))
  const barChroma = bars.map((t, i) => {
    const s = Math.floor(t / f.hopSec)
    const e = Math.floor((bars[i + 1] ?? duration) / f.hopSec)
    const c = new Array(12).fill(0)
    for (let j = s; j < e && j < f.chroma.length; j++) for (let k = 0; k < 12; k++) c[k] += f.chroma[j][k]
    return c
  })
  const keyProfile = new Array(12).fill(0)
  for (const c of barChroma) {
    const n = c.reduce((s: number, v: number) => s + v, 0) || 1
    for (let k = 0; k < 12; k++) keyProfile[k] += c[k] / n
  }
  const peaksPerSec = 100
  const peaks = computePeaks(raw, rawSr, peaksPerSec)
  return {
    bpm: Math.round(grid.bpm * 100) / 100,
    beatInterval: grid.period,
    downbeat: first,
    bars,
    key: estimateKey(keyProfile),
    energy,
    vocal,
    sections: segmentSections(energy, vocal, barChroma),
    peaks,
    peaksPerSec,
    duration,
  }
}

export function computePeaks(x: Float32Array, sr: number, perSec: number): number[] {
  const block = Math.max(1, Math.floor(sr / perSec))
  const out: number[] = []
  for (let i = 0; i < x.length; i += block) {
    let m = 0
    const end = Math.min(x.length, i + block)
    for (let j = i; j < end; j++) {
      const v = Math.abs(x[j])
      if (v > m) m = v
    }
    out.push(Math.round(m * 1000) / 1000)
  }
  return out
}

/** Per-bar RMS of a stem, normalised against the song's loud bars — used for real vocal density. */
export function stemDensity(x: Float32Array, sr: number, bars: number[], duration: number): number[] {
  const out: number[] = []
  for (let i = 0; i < bars.length; i++) {
    const s = Math.floor(bars[i] * sr)
    const e = Math.min(x.length, Math.floor((bars[i + 1] ?? duration) * sr))
    let sum = 0
    for (let j = s; j < e; j += 4) sum += x[j] * x[j]
    out.push(Math.sqrt(sum / Math.max(1, (e - s) / 4)))
  }
  const sorted = [...out].sort((a, b) => a - b)
  const ref = sorted[Math.floor(sorted.length * 0.9)] || 1
  return out.map((v) => Math.min(1, v / ref))
}

/**
 * Snap a word start to the actual syllable transient: the largest rise in
 * 5 ms high-passed energy within ±window. ASR timings drift; cuts must not.
 */
export function refineOnset(x: Float32Array, sr: number, t: number, window = 0.08): number {
  const hop = Math.max(1, Math.floor(sr * 0.005))
  const s = Math.max(1, Math.floor((t - window) * sr))
  const e = Math.min(x.length - hop, Math.floor((t + window) * sr))
  let prev = 0
  let best = t
  let bestRise = 0
  for (let i = s; i < e; i += hop) {
    let en = 0
    for (let j = i; j < i + hop; j++) {
      const d = x[j] - x[j - 1]
      en += d * d
    }
    const rise = en - prev
    if (rise > bestRise) {
      bestRise = rise
      best = i / sr
    }
    prev = en
  }
  return best
}
