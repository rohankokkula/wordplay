/**
 * Curated instrument beds — 5 options that ship with v1.1.
 *
 * Each bed is a short loop we procedurally generate on first play (so we
 * don't ship large audio assets) and then feed through the `instrumentsSwap`
 * bus in `mixer.ts`. When the canvas enables an `InstrumentNode`, the
 * original deck-A instrumental stem ducks to 0 while the bed pipes through
 * the same EQ/FX chain so it feels like a first-class instrument.
 *
 * Loops stretch to match the active BPM by adjusting
 * `AudioBufferSourceNode.playbackRate` at schedule time.
 */
import { getAudioContext } from '../audio/mixer'

export type InstrumentId = 'piano' | 'eight-oh-eight' | 'synthwave' | 'lofi' | 'afro-perc'

export interface InstrumentBed {
  id: InstrumentId
  name: string
  description: string
  nativeBpm: number
  swatch: string
  icon: string
}

export const INSTRUMENT_BEDS: InstrumentBed[] = [
  {
    id: 'piano',
    name: 'Piano',
    description: 'Soft grand piano chords, mellow backbone for ballads.',
    nativeBpm: 90,
    swatch: 'from-[#a78bfa] to-[#6d28d9]',
    icon: '🎹',
  },
  {
    id: 'eight-oh-eight',
    name: '808',
    description: 'Trap-ready 808 kick + sub with crisp hats.',
    nativeBpm: 140,
    swatch: 'from-[#f472b6] to-[#be185d]',
    icon: '🥁',
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    description: 'Saw-lead pads with a pumping side-chain arp.',
    nativeBpm: 110,
    swatch: 'from-[#22d3ee] to-[#1d4ed8]',
    icon: '🌆',
  },
  {
    id: 'lofi',
    name: 'Lo-fi',
    description: 'Jazzy keys with vinyl crackle, perfect for chill drops.',
    nativeBpm: 75,
    swatch: 'from-[#fbbf24] to-[#b45309]',
    icon: '☕',
  },
  {
    id: 'afro-perc',
    name: 'Afrobeat',
    description: 'Shekeres + dun-dun drums driving 120bpm grooves.',
    nativeBpm: 120,
    swatch: 'from-[#34d399] to-[#065f46]',
    icon: '🥥',
  },
]

const cache = new Map<InstrumentId, AudioBuffer>()

/**
 * Procedurally synthesize a 4-bar loop for the requested instrument bed. We
 * render offline into an `AudioBuffer` so repeated plays have no cost.
 */
export async function getInstrumentBuffer(id: InstrumentId): Promise<AudioBuffer> {
  const existing = cache.get(id)
  if (existing) return existing

  const ac = getAudioContext()
  const bpm = INSTRUMENT_BEDS.find((b) => b.id === id)!.nativeBpm
  const beats = 16
  const duration = (60 / bpm) * beats
  const sampleRate = ac.sampleRate
  const frames = Math.floor(duration * sampleRate)
  const offline = new OfflineAudioContext(2, frames, sampleRate)

  switch (id) {
    case 'piano':
      renderPiano(offline, bpm, beats)
      break
    case 'eight-oh-eight':
      render808(offline, bpm, beats)
      break
    case 'synthwave':
      renderSynthwave(offline, bpm, beats)
      break
    case 'lofi':
      renderLofi(offline, bpm, beats)
      break
    case 'afro-perc':
      renderAfroPerc(offline, bpm, beats)
      break
  }

  const buffer = await offline.startRendering()
  cache.set(id, buffer)
  return buffer
}

// ----------------- synthesis primitives -----------------
const NOTE: Record<string, number> = {
  C3: 130.81,
  D3: 146.83,
  E3: 164.81,
  F3: 174.61,
  G3: 196.0,
  A3: 220.0,
  B3: 246.94,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  G4: 392.0,
  A4: 440.0,
  B4: 493.88,
  C5: 523.25,
  C2: 65.41,
  G2: 98.0,
  A2: 110.0,
  E2: 82.41,
  F2: 87.31,
}

function adsr(
  ac: BaseAudioContext,
  target: AudioParam,
  t0: number,
  peak: number,
  a: number,
  d: number,
  s: number,
  r: number,
  dur: number,
) {
  target.setValueAtTime(0, t0)
  target.linearRampToValueAtTime(peak, t0 + a)
  target.linearRampToValueAtTime(peak * s, t0 + a + d)
  target.setValueAtTime(peak * s, t0 + Math.max(a + d, dur - r))
  target.linearRampToValueAtTime(0, t0 + dur)
}

function playOsc(
  ac: OfflineAudioContext,
  freq: number,
  t0: number,
  dur: number,
  gainLevel = 0.2,
  type: OscillatorType = 'sine',
  destination?: AudioNode,
) {
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.type = type
  osc.frequency.value = freq
  osc.connect(g)
  g.connect(destination ?? ac.destination)
  adsr(ac, g.gain, t0, gainLevel, 0.005, 0.1, 0.7, 0.15, dur)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

function playNoise(ac: OfflineAudioContext, t0: number, dur: number, level = 0.1, lp = 8000) {
  const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * dur) + 1, ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.5
  const src = ac.createBufferSource()
  src.buffer = buffer
  const filter = ac.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = lp
  const g = ac.createGain()
  adsr(ac, g.gain, t0, level, 0.002, 0.02, 0.2, 0.05, dur)
  src.connect(filter)
  filter.connect(g)
  g.connect(ac.destination)
  src.start(t0)
  src.stop(t0 + dur + 0.02)
}

function renderPiano(ac: OfflineAudioContext, bpm: number, beats: number) {
  const beatSec = 60 / bpm
  const chords: string[][] = [
    ['C3', 'E3', 'G3', 'C4'],
    ['A3', 'C4', 'E4'],
    ['F3', 'A3', 'C4', 'F4'],
    ['G3', 'B3', 'D4', 'G4'],
  ]
  for (let b = 0; b < beats; b++) {
    const t = b * beatSec
    const ch = chords[Math.floor(b / 4) % chords.length]
    for (const n of ch) {
      playOsc(ac, NOTE[n], t, beatSec * 2, 0.08, 'triangle')
      playOsc(ac, NOTE[n] * 2, t, beatSec * 2, 0.03, 'sine')
    }
  }
}

function render808(ac: OfflineAudioContext, bpm: number, beats: number) {
  const beatSec = 60 / bpm
  for (let b = 0; b < beats; b++) {
    const t = b * beatSec
    if (b % 4 === 0 || b % 4 === 2) {
      const osc = ac.createOscillator()
      const g = ac.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(110, t)
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.2)
      adsr(ac, g.gain, t, 0.9, 0.001, 0.05, 0.2, 0.15, 0.4)
      osc.connect(g)
      g.connect(ac.destination)
      osc.start(t)
      osc.stop(t + 0.45)
    }
    playNoise(ac, t + beatSec * 0.5, 0.03, 0.15, 6000)
    playNoise(ac, t, 0.025, 0.05, 10000)
  }
}

function renderSynthwave(ac: OfflineAudioContext, bpm: number, beats: number) {
  const beatSec = 60 / bpm
  const arp = ['C3', 'G3', 'C4', 'E4']
  for (let b = 0; b < beats; b++) {
    const t = b * beatSec
    const note = arp[b % arp.length]
    playOsc(ac, NOTE[note], t, beatSec * 0.9, 0.1, 'sawtooth')
    if (b % 4 === 0) playOsc(ac, NOTE.C2, t, beatSec * 2, 0.15, 'sawtooth')
    playNoise(ac, t + beatSec * 0.5, 0.02, 0.08, 5000)
  }
}

function renderLofi(ac: OfflineAudioContext, bpm: number, beats: number) {
  const beatSec = 60 / bpm
  const chords: string[][] = [
    ['F3', 'A3', 'C4', 'E4'],
    ['E3', 'G3', 'B3', 'D4'],
    ['A3', 'C4', 'E4', 'G4'],
    ['D3', 'F3', 'A3', 'C4'],
  ]
  for (let b = 0; b < beats; b++) {
    const t = b * beatSec
    const ch = chords[Math.floor(b / 4) % chords.length]
    if (b % 2 === 0) for (const n of ch) playOsc(ac, NOTE[n], t, beatSec * 2, 0.06, 'triangle')
    if (b % 2 === 1) playNoise(ac, t, 0.03, 0.1, 4000)
  }
  playNoise(ac, 0, beats * beatSec, 0.015, 1200)
}

function renderAfroPerc(ac: OfflineAudioContext, bpm: number, beats: number) {
  const beatSec = 60 / bpm
  for (let b = 0; b < beats; b++) {
    const t = b * beatSec
    if (b % 4 === 0 || b % 4 === 2) {
      const osc = ac.createOscillator()
      const g = ac.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(160, t)
      osc.frequency.exponentialRampToValueAtTime(60, t + 0.15)
      adsr(ac, g.gain, t, 0.5, 0.001, 0.04, 0.2, 0.1, 0.3)
      osc.connect(g)
      g.connect(ac.destination)
      osc.start(t)
      osc.stop(t + 0.35)
    }
    if (b % 2 === 1) playNoise(ac, t, 0.04, 0.12, 9000)
    if (b % 3 === 0) playNoise(ac, t + beatSec * 0.5, 0.02, 0.08, 12000)
  }
}
