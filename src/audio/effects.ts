import { getAudioContext } from './mixer';

/**
 * FX engine. Simplified: just a lowpass filter for sweeps.
 * The filter sits inline (not parallel dry/wet) to avoid routing mute bugs.
 * When not sweeping, frequency is 20kHz (fully open = transparent).
 */

export interface FXChain {
  input: GainNode;
  output: GainNode;
  filterNode: BiquadFilterNode;
  analyser: AnalyserNode;
}

let chain: FXChain | null = null;

export function initFXChain(): FXChain {
  if (chain) return chain;

  const ac = getAudioContext();
  const input = ac.createGain();
  const output = ac.createGain();

  // Analyser for visualizer
  const analyser = ac.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;

  // Inline lowpass filter (20kHz = fully open, transparent)
  const filterNode = ac.createBiquadFilter();
  filterNode.type = 'lowpass';
  filterNode.frequency.value = 20000;
  filterNode.Q.value = 0.7;

  // Simple chain: input → filter → output → analyser
  input.connect(filterNode);
  filterNode.connect(output);
  output.connect(analyser);

  chain = { input, output, filterNode, analyser };
  return chain;
}

export function getFXChain(): FXChain {
  return chain ?? initFXChain();
}

/** Sweep the lowpass filter down to targetFreq over durationSec */
export function sweepFilter(targetFreq: number, durationSec: number) {
  const ac = getAudioContext();
  const now = ac.currentTime;
  const { filterNode } = getFXChain();
  filterNode.frequency.cancelScheduledValues(now);
  filterNode.frequency.setValueAtTime(filterNode.frequency.value, now);
  filterNode.frequency.exponentialRampToValueAtTime(
    Math.max(20, targetFreq),
    now + durationSec,
  );
}

/**
 * Open the lowpass back to fully transparent.
 * Uses a linear Hz ramp so treble returns evenly; exponential ramps sound like a sudden level jump.
 */
export function openFilter(durationSec: number) {
  const ac = getAudioContext();
  const now = ac.currentTime;
  const { filterNode } = getFXChain();
  const dur = Math.max(0.05, durationSec);
  filterNode.frequency.cancelScheduledValues(now);
  const cur = Math.min(20000, Math.max(20, filterNode.frequency.value));
  filterNode.frequency.setValueAtTime(cur, now);
  filterNode.frequency.linearRampToValueAtTime(20000, now + dur);
}

/** Reset everything to clean state */
export function resetAllFX() {
  const ac = getAudioContext();
  const now = ac.currentTime;
  const { filterNode } = getFXChain();
  filterNode.frequency.cancelScheduledValues(now);
  filterNode.frequency.setValueAtTime(20000, now);
}
