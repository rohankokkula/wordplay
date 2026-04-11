/**
 * Web Audio mixer graph.
 *
 * Routing:
 *   source{A,B} → volumeNode → EQ(low/mid/high) → duckNode → crossfadeGain → fxChain.input
 *   fxChain.output → masterGain → destination
 *   sfxGain → masterGain (bypasses FX)
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
let masterGain: GainNode;
let sfxGain: GainNode;
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

  eqA = createDeckEQ(ac);
  eqB = createDeckEQ(ac);

  fxChain = initFXChain();

  eqA.high.connect(duckNodeA);
  eqB.high.connect(duckNodeB);
  duckNodeA.connect(gainA);
  duckNodeB.connect(gainB);
  gainA.connect(fxChain.input);
  gainB.connect(fxChain.input);

  fxChain.output.connect(masterGain);
  sfxGain.connect(masterGain);
  masterGain.connect(ac.destination);

  _initialized = true;
}

/** Entry point for deck audio — connects into EQ → duck → crossfade → FX. */
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

/** Constant-power crossfade: 0 = full A, 1 = full B. */
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
