import { getAudioContext } from './mixer';

export interface FXChain {
  input: GainNode;
  output: GainNode;
  filterNode: BiquadFilterNode;
  highpassNode: BiquadFilterNode;
  analyser: AnalyserNode;
  reverbSend: GainNode;
  reverbDry: GainNode;
  convolver: ConvolverNode;
}

let chain: FXChain | null = null;

export function createReverbIR(decaySec: number, durationSec: number): AudioBuffer {
  const ac = getAudioContext();
  const len = Math.floor(ac.sampleRate * durationSec);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp((-3 * i) / (ac.sampleRate * decaySec));
    }
  }
  return buf;
}

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

  const reverbDry = ac.createGain();
  reverbDry.gain.value = 1;

  const reverbSend = ac.createGain();
  reverbSend.gain.value = 0;

  const convolver = ac.createConvolver();
  convolver.buffer = createReverbIR(2.0, 3.0);

  const reverbReturn = ac.createGain();
  reverbReturn.gain.value = 0.7;

  input.connect(filterNode);
  filterNode.connect(highpassNode);
  highpassNode.connect(reverbDry);
  reverbDry.connect(output);

  highpassNode.connect(reverbSend);
  reverbSend.connect(convolver);
  convolver.connect(reverbReturn);
  reverbReturn.connect(output);

  output.connect(analyser);

  chain = { input, output, filterNode, highpassNode, analyser, reverbSend, reverbDry, convolver };
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
  const { filterNode, highpassNode, reverbSend, reverbDry } = getFXChain();
  filterNode.frequency.cancelScheduledValues(now);
  filterNode.frequency.setValueAtTime(20000, now);
  highpassNode.frequency.cancelScheduledValues(now);
  highpassNode.frequency.setValueAtTime(20, now);
  reverbSend.gain.cancelScheduledValues(now);
  reverbSend.gain.setValueAtTime(0, now);
  reverbDry.gain.cancelScheduledValues(now);
  reverbDry.gain.setValueAtTime(1, now);
}
