/**
 * Web Audio mixer graph with FX bus.
 *
 * Routing:
 *   source{A,B} → volumeNode{A,B} → duckNode → gainNode{A,B} ─┐
 *   beatBus (genre drums) ─────────────────────────────────────┤
 *                                                               ├→ fxChain.input → fxChain.output → masterGain → destination
 *   sfxGain (turntable SFX only — not genre drums) ───────────→ masterGain
 *
 * beatBus goes through the FX chain so filter sweeps + EQ affect drums equally.
 * duckNode on the music path allows sidechain-style ducking from kick hits.
 */

import { initFXChain, type FXChain } from './effects';

export interface DeckEQ {
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
}

let ctx: AudioContext | null = null;
let gainA: GainNode;
let gainB: GainNode;
let duckNodeA: GainNode;
let duckNodeB: GainNode;
let musicLowCutA: BiquadFilterNode;
let musicLowCutB: BiquadFilterNode;
let masterGain: GainNode;
let sfxGain: GainNode;
let beatBus: GainNode;
let fxChain: FXChain;
let eqA: DeckEQ;
let eqB: DeckEQ;

export function getAudioContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
  }
  return ctx;
}

export function ensureResumed(): Promise<void> {
  const ac = getAudioContext();
  if (ac.state === 'suspended') return ac.resume();
  return Promise.resolve();
}

let _initialized = false;

function createDeckEQ(ac: AudioContext): DeckEQ {
  const low = ac.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = 120;
  low.gain.value = 0;

  const mid = ac.createBiquadFilter();
  mid.type = 'peaking';
  mid.frequency.value = 1000;
  mid.Q.value = 0.7;
  mid.gain.value = 0;

  const high = ac.createBiquadFilter();
  high.type = 'highshelf';
  high.frequency.value = 3000;
  high.gain.value = 0;

  low.connect(mid);
  mid.connect(high);

  return { low, mid, high };
}

export function initMixer() {
  if (_initialized) return;
  const ac = getAudioContext();

  gainA = ac.createGain();
  gainB = ac.createGain();
  duckNodeA = ac.createGain();
  duckNodeB = ac.createGain();
  masterGain = ac.createGain();
  sfxGain = ac.createGain();
  sfxGain.gain.value = 0.9;

  beatBus = ac.createGain();
  beatBus.gain.value = 1;

  eqA = createDeckEQ(ac);
  eqB = createDeckEQ(ac);

  musicLowCutA = ac.createBiquadFilter();
  musicLowCutA.type = 'highpass';
  musicLowCutA.frequency.value = 20;
  musicLowCutA.Q.value = 0.707;

  musicLowCutB = ac.createBiquadFilter();
  musicLowCutB.type = 'highpass';
  musicLowCutB.frequency.value = 20;
  musicLowCutB.Q.value = 0.707;

  fxChain = initFXChain();

  // Music path: volumeNode → eqLow → eqMid → eqHigh → lowCut → duckNode → crossfade gain → FX chain
  eqA.high.connect(musicLowCutA);
  eqB.high.connect(musicLowCutB);
  musicLowCutA.connect(duckNodeA);
  musicLowCutB.connect(duckNodeB);
  duckNodeA.connect(gainA);
  duckNodeB.connect(gainB);
  gainA.connect(fxChain.input);
  gainB.connect(fxChain.input);

  beatBus.connect(fxChain.input);

  fxChain.output.connect(masterGain);
  sfxGain.connect(masterGain);
  masterGain.connect(ac.destination);

  _initialized = true;
}

/**
 * Entry point for deck audio sources.
 * Sources should connect here → goes through per-deck EQ → duck → crossfade → FX.
 */
export function getGainNode(deck: 'A' | 'B'): GainNode {
  initMixer();
  return deck === 'A' ? eqA.low : eqB.low;
}

export function getDuckNode(deck: 'A' | 'B'): GainNode {
  initMixer();
  return deck === 'A' ? duckNodeA : duckNodeB;
}

export function getDeckEQ(deck: 'A' | 'B'): DeckEQ {
  initMixer();
  return deck === 'A' ? eqA : eqB;
}

export function getAnalyser(): AnalyserNode {
  initMixer();
  return fxChain.analyser;
}

export function setCrossfader(position: number) {
  initMixer();
  const theta = position * Math.PI * 0.5;
  const now = getAudioContext().currentTime;
  gainA.gain.setTargetAtTime(Math.cos(theta), now, 0.02);
  gainB.gain.setTargetAtTime(Math.sin(theta), now, 0.02);
}

export function setMasterVolume(volume: number) {
  initMixer();
  const now = getAudioContext().currentTime;
  masterGain.gain.setTargetAtTime(volume, now, 0.02);
}

/** Beat bus — genre drums route here (goes through FX chain with the music). */
export function getBeatBus(): GainNode {
  initMixer();
  return beatBus;
}

/**
 * Carve the track's sub-bass to make room for genre kick.
 * Set freqHz > 20 to activate (e.g. 80-120 Hz); set to 20 to bypass.
 */
export function setMusicLowCut(freqHz: number, rampSec = 0.08) {
  initMixer();
  const ac = getAudioContext();
  const now = ac.currentTime;
  const target = Math.max(20, Math.min(500, freqHz));
  for (const f of [musicLowCutA, musicLowCutB]) {
    f.frequency.cancelScheduledValues(now);
    f.frequency.setValueAtTime(f.frequency.value, now);
    f.frequency.linearRampToValueAtTime(target, now + rampSec);
  }
}

/** One-shot UI SFX only (turntable wind-down etc) — bypasses FX chain. */
export function getSfxInput(): GainNode {
  initMixer();
  return sfxGain;
}

export function suspendAudioOutput(): Promise<void> {
  return getAudioContext().suspend();
}

export function resumeAudioOutput(): Promise<void> {
  return getAudioContext().resume();
}

export function getAudioOutputState(): AudioContextState {
  return getAudioContext().state;
}

export function decodeFile(file: File): Promise<AudioBuffer> {
  const ac = getAudioContext();
  return file.arrayBuffer().then((buf) => ac.decodeAudioData(buf));
}
