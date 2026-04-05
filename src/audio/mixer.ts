/**
 * Web Audio mixer graph with FX bus.
 *
 * source{A,B} → volumeNode{A,B} → gainNode{A,B} → fxChain.input → fxChain.output → masterGain → destination
 *
 * Constant-power crossfade on gainA/gainB: gainA = cos(θ), gainB = sin(θ)
 */

import { initFXChain, type FXChain } from './effects';

let ctx: AudioContext | null = null;
let gainA: GainNode;
let gainB: GainNode;
let masterGain: GainNode;
let sfxGain: GainNode;
let fxChain: FXChain;

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

export function initMixer() {
  if (_initialized) return;
  const ac = getAudioContext();

  gainA = ac.createGain();
  gainB = ac.createGain();
  masterGain = ac.createGain();
  sfxGain = ac.createGain();
  sfxGain.gain.value = 0.9;

  fxChain = initFXChain();

  gainA.connect(fxChain.input);
  gainB.connect(fxChain.input);
  fxChain.output.connect(masterGain);
  sfxGain.connect(masterGain);
  masterGain.connect(ac.destination);

  _initialized = true;
}

export function getGainNode(deck: 'A' | 'B'): GainNode {
  initMixer();
  return deck === 'A' ? gainA : gainB;
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

/** One-shot SFX / drum hits — sums into the master bus with the music. */
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
