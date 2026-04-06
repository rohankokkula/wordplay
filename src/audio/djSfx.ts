import { getAudioContext, getSfxInput } from './mixer';

/**
 * Synthesized DJ sound effects.
 * All effects route through getSfxInput() → masterGain (bypasses FX chain).
 */

export function playAirHorn(duration = 0.8): void {
  const ac = getAudioContext();
  const now = ac.currentTime;
  const out = getSfxInput();

  const freqs = [440, 554, 659];
  const master = ac.createGain();
  master.gain.setValueAtTime(0.35, now);
  master.gain.linearRampToValueAtTime(0.4, now + 0.05);
  master.gain.exponentialRampToValueAtTime(0.001, now + duration);

  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 800;
  bp.Q.value = 2.5;
  bp.connect(master);
  master.connect(out);

  for (const freq of freqs) {
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.linearRampToValueAtTime(freq * 1.02, now + 0.02);
    const g = ac.createGain();
    g.gain.value = 0.3;
    osc.connect(g);
    g.connect(bp);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }
}

export function playSiren(duration = 2.0): void {
  const ac = getAudioContext();
  const now = ac.currentTime;
  const out = getSfxInput();

  const osc = ac.createOscillator();
  osc.type = 'sine';

  const lfo = ac.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 3;
  const lfoGain = ac.createGain();
  lfoGain.gain.value = 300;
  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);

  osc.frequency.setValueAtTime(900, now);

  const env = ac.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(0.25, now + 0.1);
  env.gain.setValueAtTime(0.25, now + duration - 0.3);
  env.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc.connect(env);
  env.connect(out);

  lfo.start(now);
  osc.start(now);
  lfo.stop(now + duration + 0.05);
  osc.stop(now + duration + 0.05);
}

export function playVinylBrake(duration = 1.5): void {
  const ac = getAudioContext();
  const now = ac.currentTime;
  const out = getSfxInput();

  const bufLen = Math.ceil(ac.sampleRate * duration);
  const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

  const src = ac.createBufferSource();
  src.buffer = buf;
  src.playbackRate.setValueAtTime(1, now);
  src.playbackRate.exponentialRampToValueAtTime(0.01, now + duration);

  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(8000, now);
  lp.frequency.exponentialRampToValueAtTime(200, now + duration);

  const env = ac.createGain();
  env.gain.setValueAtTime(0.3, now);
  env.gain.linearRampToValueAtTime(0.0, now + duration);

  src.connect(lp);
  lp.connect(env);
  env.connect(out);
  src.start(now);
  src.stop(now + duration + 0.1);
}

export function playSnareRoll(density: number, duration: number): void {
  const ac = getAudioContext();
  const now = ac.currentTime;
  const out = getSfxInput();

  const interval = 60 / (density * 4);
  const hits = Math.ceil(duration / interval);

  for (let i = 0; i < hits; i++) {
    const t = now + i * interval;
    const progress = i / hits;

    const noiseDur = 0.04 + 0.02 * (1 - progress);
    const bufLen = Math.ceil(ac.sampleRate * noiseDur);
    const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let j = 0; j < bufLen; j++) data[j] = Math.random() * 2 - 1;

    const src = ac.createBufferSource();
    src.buffer = buf;

    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2500 + 1500 * progress;
    bp.Q.value = 0.8;

    const g = ac.createGain();
    const vel = 0.15 + 0.25 * progress;
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + noiseDur);

    src.connect(bp);
    bp.connect(g);
    g.connect(out);
    src.start(t);
    src.stop(t + noiseDur + 0.01);
  }
}

/**
 * Generate a synthetic reverb impulse response.
 * Returns an AudioBuffer suitable for a ConvolverNode.
 */
export function createReverbIR(duration = 2.0, decay = 3.0): AudioBuffer {
  const ac = getAudioContext();
  const len = Math.ceil(ac.sampleRate * duration);
  const buf = ac.createBuffer(2, len, ac.sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / ac.sampleRate;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-t * decay);
    }
  }
  return buf;
}
