import { getAudioContext, getSfxInput, ensureResumed } from './mixer';

/** ~1.6s filtered noise + slowing “motor” — vinyl winding down. */
const DURATION = 1.62;

export async function playTurntableWindDown(): Promise<void> {
  await ensureResumed();
  const ctx = getAudioContext();
  const bus = getSfxInput();
  const t0 = ctx.currentTime;
  const t1 = t0 + DURATION;

  const len = Math.ceil(ctx.sampleRate * DURATION);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    d[i] = (Math.random() * 2 - 1) * 0.42;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buf;

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(2200, t0);
  bp.frequency.exponentialRampToValueAtTime(120, t1);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(10000, t0);
  lp.frequency.exponentialRampToValueAtTime(280, t0 + DURATION * 0.92);

  const nGain = ctx.createGain();
  nGain.gain.setValueAtTime(0.0001, t0);
  nGain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.035);
  nGain.gain.exponentialRampToValueAtTime(0.055, t0 + DURATION * 0.45);
  nGain.gain.exponentialRampToValueAtTime(0.0001, t1);

  noise.connect(bp);
  bp.connect(lp);
  lp.connect(nGain);
  nGain.connect(bus);

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(95, t0);
  osc.frequency.exponentialRampToValueAtTime(18, t1);
  const oGain = ctx.createGain();
  oGain.gain.setValueAtTime(0.0001, t0);
  oGain.gain.exponentialRampToValueAtTime(0.07, t0 + 0.05);
  oGain.gain.exponentialRampToValueAtTime(0.015, t0 + DURATION * 0.55);
  oGain.gain.exponentialRampToValueAtTime(0.0001, t1);
  osc.connect(oGain);
  oGain.connect(bus);

  noise.start(t0);
  noise.stop(t1 + 0.04);
  osc.start(t0);
  osc.stop(t1 + 0.04);
}
