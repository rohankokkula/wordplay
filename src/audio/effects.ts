import { getAudioContext, setMusicLowCut } from './mixer';
import { createReverbIR } from './djSfx';

export interface FXChain {
  input: GainNode;
  output: GainNode;
  filterNode: BiquadFilterNode;
  highpassNode: BiquadFilterNode;
  genreEQ: BiquadFilterNode;
  subBoost: BiquadFilterNode;
  analyser: AnalyserNode;
  reverbSend: GainNode;
  reverbDry: GainNode;
  convolver: ConvolverNode;
}

let chain: FXChain | null = null;

export function initFXChain(): FXChain {
  if (chain) return chain;

  const ac = getAudioContext();
  const input = ac.createGain();
  const output = ac.createGain();

  const analyser = ac.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;

  const filterNode = ac.createBiquadFilter();
  filterNode.type = 'lowpass';
  filterNode.frequency.value = 20000;
  filterNode.Q.value = 0.7;

  const highpassNode = ac.createBiquadFilter();
  highpassNode.type = 'highpass';
  highpassNode.frequency.value = 20;
  highpassNode.Q.value = 0.7;

  const genreEQ = ac.createBiquadFilter();
  genreEQ.type = 'lowshelf';
  genreEQ.frequency.value = 250;
  genreEQ.gain.value = 0;

  const subBoost = ac.createBiquadFilter();
  subBoost.type = 'peaking';
  subBoost.frequency.value = 65;
  subBoost.Q.value = 1.2;
  subBoost.gain.value = 0;

  const reverbDry = ac.createGain();
  reverbDry.gain.value = 1;

  const reverbSend = ac.createGain();
  reverbSend.gain.value = 0;

  const convolver = ac.createConvolver();
  convolver.buffer = createReverbIR(2.0, 3.0);

  const reverbReturn = ac.createGain();
  reverbReturn.gain.value = 0.7;

  // Chain: input → lowpass → highpass → genreEQ → subBoost → [dry + wet reverb] → output → analyser
  input.connect(filterNode);
  filterNode.connect(highpassNode);
  highpassNode.connect(genreEQ);
  genreEQ.connect(subBoost);

  subBoost.connect(reverbDry);
  reverbDry.connect(output);

  subBoost.connect(reverbSend);
  reverbSend.connect(convolver);
  convolver.connect(reverbReturn);
  reverbReturn.connect(output);

  output.connect(analyser);

  chain = { input, output, filterNode, highpassNode, genreEQ, subBoost, analyser, reverbSend, reverbDry, convolver };
  return chain;
}

export function getFXChain(): FXChain {
  return chain ?? initFXChain();
}

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

export function sweepHighpass(targetFreq: number, durationSec: number) {
  const ac = getAudioContext();
  const now = ac.currentTime;
  const { highpassNode } = getFXChain();
  highpassNode.frequency.cancelScheduledValues(now);
  highpassNode.frequency.setValueAtTime(highpassNode.frequency.value, now);
  highpassNode.frequency.exponentialRampToValueAtTime(
    Math.max(20, targetFreq),
    now + durationSec,
  );
}

export function openHighpass(durationSec: number) {
  const ac = getAudioContext();
  const now = ac.currentTime;
  const { highpassNode } = getFXChain();
  const dur = Math.max(0.05, durationSec);
  highpassNode.frequency.cancelScheduledValues(now);
  const cur = Math.max(20, highpassNode.frequency.value);
  highpassNode.frequency.setValueAtTime(cur, now);
  highpassNode.frequency.exponentialRampToValueAtTime(20, now + dur);
}

export function setReverbSend(wetGain: number, rampSec = 0.1) {
  const ac = getAudioContext();
  const now = ac.currentTime;
  const { reverbSend, reverbDry } = getFXChain();
  reverbSend.gain.cancelScheduledValues(now);
  reverbSend.gain.setTargetAtTime(Math.max(0, Math.min(1, wetGain)), now, rampSec);
  reverbDry.gain.cancelScheduledValues(now);
  reverbDry.gain.setTargetAtTime(Math.max(0, 1 - wetGain * 0.5), now, rampSec);
}

export function resetAllFX() {
  const ac = getAudioContext();
  const now = ac.currentTime;
  const { filterNode, highpassNode, genreEQ, subBoost, reverbSend, reverbDry } = getFXChain();
  filterNode.frequency.cancelScheduledValues(now);
  filterNode.frequency.setValueAtTime(20000, now);
  highpassNode.frequency.cancelScheduledValues(now);
  highpassNode.frequency.setValueAtTime(20, now);
  genreEQ.gain.cancelScheduledValues(now);
  genreEQ.gain.setValueAtTime(0, now);
  subBoost.gain.cancelScheduledValues(now);
  subBoost.gain.setValueAtTime(0, now);
  reverbSend.gain.cancelScheduledValues(now);
  reverbSend.gain.setValueAtTime(0, now);
  reverbDry.gain.cancelScheduledValues(now);
  reverbDry.gain.setValueAtTime(1, now);
  setMusicLowCut(20, 0.05);
}

export function setGenreEQ(gainDb: number, subBoostDb = 0) {
  const ac = getAudioContext();
  const now = ac.currentTime;
  const { genreEQ, subBoost } = getFXChain();
  genreEQ.gain.cancelScheduledValues(now);
  genreEQ.gain.setTargetAtTime(gainDb, now, 0.05);
  subBoost.gain.cancelScheduledValues(now);
  subBoost.gain.setTargetAtTime(subBoostDb, now, 0.05);
}
