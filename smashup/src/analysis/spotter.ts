/**
 * Query-by-example keyword spotting: "mark one 'paisa', find all".
 *
 * MFCC + delta features (100 frames/s) with per-song cepstral mean/variance
 * normalisation. Each seed hit becomes a template; we slide it over every song
 * at three time-stretches and score mean frame-wise cosine similarity. Peaks
 * above an adaptive threshold, after non-maximum suppression, are candidates.
 * Pure functions — runs in the analysis Worker and in tests.
 */

import { FFT } from './fft'

export const FPS = 100

export interface FeatureConfig {
  nMel: number
  nCep: number
  fmin: number
  fmax: number
  /** Weight of the log-energy contour (pitch-independent word rhythm). */
  energyW: number
}

// Tuned on the synthetic crate: a coarse spectral envelope (5 cepstra from 250 Hz,
// up to 7.6 kHz so the "s" hiss counts) plus a heavily weighted energy contour is
// far less pitch-sensitive — the same word sung on different notes still matches.
export const DEFAULT_FEATURES: FeatureConfig = { nMel: 16, nCep: 5, fmin: 250, fmax: 7600, energyW: 3 }
/** Matches at or above this similarity are auto-accepted; the rest are suggestions. */
export const AUTO_ACCEPT = 0.65
let CFG = DEFAULT_FEATURES
export function setFeatureConfig(c: Partial<FeatureConfig>) {
  CFG = { ...DEFAULT_FEATURES, ...c }
}

export interface Features {
  /** frames × dims, row-major */
  data: Float32Array
  dims: number
  frames: number
}

function melFilterbank(nfft: number, sr: number, N_MEL: number, FMIN: number, FMAX: number): { lo: number; hi: number; w: Float32Array }[] {
  const mel = (f: number) => 2595 * Math.log10(1 + f / 700)
  const inv = (m: number) => 700 * (10 ** (m / 2595) - 1)
  const pts = Array.from({ length: N_MEL + 2 }, (_, i) => inv(mel(FMIN) + ((mel(FMAX) - mel(FMIN)) * i) / (N_MEL + 1)))
  const bin = (f: number) => Math.floor(((nfft + 1) * f) / sr)
  return Array.from({ length: N_MEL }, (_, m) => {
    const a = bin(pts[m])
    const b = bin(pts[m + 1])
    const c = Math.max(b + 1, bin(pts[m + 2]))
    const w = new Float32Array(c - a + 1)
    for (let k = a; k <= c; k++) w[k - a] = k <= b ? (k - a) / Math.max(1, b - a) : (c - k) / Math.max(1, c - b)
    return { lo: a, hi: c, w }
  })
}

export function mfcc(x: Float32Array, sr: number): Features {
  const { nMel: N_MEL, nCep: N_CEP, energyW } = CFG
  const FMAX = Math.min(CFG.fmax, sr * 0.48)
  const hop = Math.round(sr / FPS)
  let nfft = 256
  while (nfft < sr * 0.032) nfft *= 2
  const fft = new FFT(nfft)
  const mag = new Float32Array(nfft / 2)
  const bank = melFilterbank(nfft, sr, N_MEL, CFG.fmin, FMAX)
  const frames = Math.max(1, Math.floor((x.length - nfft) / hop) + 1)
  const cepDims = N_CEP + 1 // c1..c12 + log energy
  const dims = cepDims * 2
  const base = new Float32Array(frames * cepDims)
  const logMel = new Float32Array(N_MEL)
  for (let f = 0; f < frames; f++) {
    fft.magnitudes(x, f * hop, mag)
    let energy = 0
    for (let m = 0; m < N_MEL; m++) {
      const { lo, w } = bank[m]
      let s = 0
      for (let k = 0; k < w.length; k++) {
        const v = mag[lo + k] ?? 0
        s += v * v * w[k]
      }
      energy += s
      logMel[m] = Math.log(s + 1e-8)
    }
    for (let c = 1; c <= N_CEP; c++) {
      let s = 0
      for (let m = 0; m < N_MEL; m++) s += logMel[m] * Math.cos((Math.PI * c * (m + 0.5)) / N_MEL)
      base[f * cepDims + c - 1] = s
    }
    base[f * cepDims + N_CEP] = Math.log(energy + 1e-8)
  }
  // Cepstral mean/variance normalisation per song.
  for (let d = 0; d < cepDims; d++) {
    let mean = 0
    for (let f = 0; f < frames; f++) mean += base[f * cepDims + d]
    mean /= frames
    let v = 0
    for (let f = 0; f < frames; f++) v += (base[f * cepDims + d] - mean) ** 2
    const sd = (Math.sqrt(v / frames) || 1) / (d === N_CEP ? energyW : 1)
    for (let f = 0; f < frames; f++) base[f * cepDims + d] = (base[f * cepDims + d] - mean) / sd
  }
  const data = new Float32Array(frames * dims)
  for (let f = 0; f < frames; f++) {
    for (let d = 0; d < cepDims; d++) {
      data[f * dims + d] = base[f * cepDims + d]
      const prev = base[Math.max(0, f - 2) * cepDims + d]
      const next = base[Math.min(frames - 1, f + 2) * cepDims + d]
      data[f * dims + cepDims + d] = (next - prev) * 0.5
    }
  }
  return { data, dims, frames }
}

/** Unit-normalise every frame so a dot product is a cosine. */
function unitFrames(F: Features): Float32Array {
  const out = new Float32Array(F.data.length)
  for (let f = 0; f < F.frames; f++) {
    let n = 0
    for (let d = 0; d < F.dims; d++) n += F.data[f * F.dims + d] ** 2
    n = Math.sqrt(n) || 1
    for (let d = 0; d < F.dims; d++) out[f * F.dims + d] = F.data[f * F.dims + d] / n
  }
  return out
}

function stretch(t: Float32Array, frames: number, dims: number, factor: number): { data: Float32Array; frames: number } {
  const n = Math.max(3, Math.round(frames * factor))
  const out = new Float32Array(n * dims)
  for (let i = 0; i < n; i++) {
    const src = (i * (frames - 1)) / Math.max(1, n - 1)
    const a = Math.floor(src)
    const b = Math.min(frames - 1, a + 1)
    const fr = src - a
    for (let d = 0; d < dims; d++) out[i * dims + d] = t[a * dims + d] * (1 - fr) + t[b * dims + d] * fr
  }
  return { data: out, frames: n }
}

export interface Seed {
  songIndex: number
  start: number
  end: number
}

export interface Candidate {
  time: number
  score: number
}

export interface SpotOptions {
  minGap?: number
  /** Absolute floor on similarity. */
  floor?: number
  /** Standard deviations above the mean similarity. */
  k?: number
}

/** Score curve: best similarity of any template at every frame of `song`. */
function scoreCurve(songUnit: Float32Array, frames: number, dims: number, templates: { data: Float32Array; frames: number }[]): Float32Array {
  const curve = new Float32Array(frames)
  for (const t of templates) {
    const L = t.frames
    for (let p = 0; p + L <= frames; p++) {
      let s = 0
      for (let i = 0; i < L; i++) {
        const a = (p + i) * dims
        const b = i * dims
        let dot = 0
        for (let d = 0; d < dims; d++) dot += songUnit[a + d] * t.data[b + d]
        s += dot
      }
      s /= L
      if (s > curve[p]) curve[p] = s
    }
  }
  return curve
}

export function spot(songs: { pcm: Float32Array; sr: number }[], seeds: Seed[], opts: SpotOptions = {}): Candidate[][] {
  const minGap = opts.minGap ?? 0.25
  const floor = opts.floor ?? 0.45
  const k = opts.k ?? 2.5
  const feats = songs.map((s) => mfcc(s.pcm, s.sr))
  const units = feats.map(unitFrames)
  const dims = feats[0]?.dims ?? 0
  const templates: { data: Float32Array; frames: number }[] = []
  for (const seed of seeds) {
    const F = feats[seed.songIndex]
    const U = units[seed.songIndex]
    if (!F) continue
    const f0 = Math.max(0, Math.round(seed.start * FPS))
    const f1 = Math.min(F.frames, Math.max(f0 + 8, Math.round(Math.min(seed.end, seed.start + 0.8) * FPS)))
    const base = U.slice(f0 * dims, f1 * dims)
    for (const factor of [0.85, 1, 1.15]) templates.push(stretch(base, f1 - f0, dims, factor))
  }
  if (!templates.length) return songs.map(() => [])

  return feats.map((F, si) => {
    const curve = scoreCurve(units[si], F.frames, dims, templates)
    let mean = 0
    for (const v of curve) mean += v
    mean /= Math.max(1, curve.length)
    let sd = 0
    for (const v of curve) sd += (v - mean) ** 2
    sd = Math.sqrt(sd / Math.max(1, curve.length))
    const thr = Math.max(floor, mean + k * sd)
    const peaks: Candidate[] = []
    for (let i = 1; i < curve.length - 1; i++) {
      if (curve[i] >= thr && curve[i] >= curve[i - 1] && curve[i] >= curve[i + 1]) peaks.push({ time: i / FPS, score: curve[i] })
    }
    peaks.sort((a, b) => b.score - a.score)
    const kept: Candidate[] = []
    for (const p of peaks) if (!kept.some((q) => Math.abs(q.time - p.time) < minGap)) kept.push(p)
    return kept.sort((a, b) => a.time - b.time)
  })
}
