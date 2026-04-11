import type { TrackAnalysis } from './types';
import type { GenreId, RhythmHit, GenrePreset } from '../genre/genrePresets';
import { GENRE_PRESETS } from '../genre/genrePresets';
import { getAudioContext, getBeatBus, getDuckNode, setMusicLowCut } from './mixer';

export class GenreBeatLayer {
  private genreId: GenreId;
  private analysis: TrackAnalysis;
  private getTime: () => number;
  private activeDeck: 'A' | 'B';
  private _raf = 0;
  private _running = false;
  private _nextStepIndex = 0;
  private gainNode: GainNode;
  private _dropScheduled = new Set<number>();
  private _riserNode: OscillatorNode | null = null;
  private _cueLoopActive = false;
  private _buildUpActive = false;
  private _buildUpScheduled = false;
  /** Pre-computed 16th-note grid snapped to actual beatTimes for phase-lock. */
  private _sixteenthGrid: number[] = [];

  constructor(
    genreId: GenreId,
    analysis: TrackAnalysis,
    getTime: () => number,
    activeDeck: 'A' | 'B',
  ) {
    this.genreId = genreId;
    this.analysis = analysis;
    this.getTime = getTime;
    this.activeDeck = activeDeck;
    const ac = getAudioContext();
    this.gainNode = ac.createGain();
    this.gainNode.gain.value = GENRE_PRESETS[genreId].beatLayerVolume;
    this.gainNode.connect(getBeatBus());
    this.buildSixteenthGrid();
  }

  /**
   * Pre-compute a 16th-note grid that interpolates between actual beat positions.
   * This eliminates phase drift from using a fixed beatInterval.
   */
  private buildSixteenthGrid() {
    const bt = this.analysis.beatTimes;
    if (bt.length < 2) {
      this._sixteenthGrid = [];
      return;
    }
    const grid: number[] = [];
    for (let i = 0; i < bt.length - 1; i++) {
      const start = bt[i];
      const localInterval = bt[i + 1] - bt[i];
      const sixteenth = localInterval / 4;
      for (let s = 0; s < 4; s++) {
        grid.push(start + s * sixteenth);
      }
    }
    const last = bt[bt.length - 1];
    const avgInterval = this.analysis.beatInterval;
    for (let s = 0; s < 4; s++) {
      grid.push(last + s * (avgInterval / 4));
    }
    this._sixteenthGrid = grid;
  }

  /** Get the time for a given 16th-note step, phase-locked to the beat grid. */
  private stepTime(step: number): number {
    if (this._sixteenthGrid.length === 0) {
      return this.analysis.firstBeatTime + step * (this.analysis.beatInterval / 4);
    }
    if (step < 0) return this._sixteenthGrid[0] + step * (this.analysis.beatInterval / 4);
    if (step < this._sixteenthGrid.length) return this._sixteenthGrid[step];
    const last = this._sixteenthGrid[this._sixteenthGrid.length - 1];
    const overshoot = step - (this._sixteenthGrid.length - 1);
    return last + overshoot * (this.analysis.beatInterval / 4);
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._nextStepIndex = 0;
    this._dropScheduled.clear();
    this._cueLoopActive = false;
    this._buildUpActive = false;
    this._buildUpScheduled = false;
    const cutHz = this.preset.musicLowCutHz;
    if (cutHz > 20) setMusicLowCut(cutHz, 0.15);
    this.tick();
  }

  stop() {
    this._running = false;
    cancelAnimationFrame(this._raf);
    if (this._riserNode) {
      try { this._riserNode.stop(); } catch { /* ok */ }
      this._riserNode = null;
    }
    try { this.gainNode.disconnect(); } catch { /* ok */ }
    setMusicLowCut(20, 0.15);
  }

  /**
   * Start the snare roll build-up before a transition.
   * Called by the controller N beats before blend.
   */
  startBuildUp(blendStartTime: number) {
    if (this._buildUpScheduled) return;
    this._buildUpScheduled = true;
    this._buildUpActive = true;

    const preset = GENRE_PRESETS[this.genreId];
    if (preset.buildUpBars <= 0) return;

    const beatInterval = this.analysis.beatInterval;
    const buildBeats = preset.buildUpBars * 4;
    const buildDuration = buildBeats * beatInterval;
    const buildStart = blendStartTime - buildDuration;

    const ac = getAudioContext();
    const trackTime = this.getTime();
    const acBuildStart = ac.currentTime + Math.max(0, buildStart - trackTime);

    this.scheduleSnareRollBuild(acBuildStart, buildDuration, beatInterval);
  }

  /**
   * Start cue loop repetition: repeats the rhythm pattern at increasing intensity.
   */
  startCueLoop() {
    this._cueLoopActive = true;
  }

  stopCueLoop() {
    this._cueLoopActive = false;
  }

  private tick = () => {
    if (!this._running) return;
    this.scheduleUpcoming();
    this.scheduleDropEffects();
    this._raf = requestAnimationFrame(this.tick);
  };

  private energyAt(trackTime: number): number {
    const ep = this.analysis.energyProfile;
    if (ep.length === 0) return 0.5;
    const windowDur = this.analysis.duration / ep.length;
    const idx = Math.min(Math.floor(trackTime / windowDur), ep.length - 1);
    return ep[Math.max(0, idx)];
  }

  private duckMusic(when: number, depthOverride?: number) {
    const ac = getAudioContext();
    const duck = getDuckNode(this.activeDeck);
    const dp = this.preset.duck;
    const depth = depthOverride ?? dp.depth;

    duck.gain.setValueAtTime(1.0, when);
    duck.gain.linearRampToValueAtTime(depth, when + dp.attackSec);
    duck.gain.linearRampToValueAtTime(1.0, when + dp.attackSec + dp.releaseSec);
  }

  private scheduleDropEffects() {
    const ac = getAudioContext();
    const trackTime = this.getTime();
    const dropTime = this.analysis.dropTime;

    if (this._dropScheduled.has(0)) return;

    const riserStart = dropTime - 4;
    const lookAhead = 5;

    if (trackTime >= riserStart - lookAhead && trackTime < dropTime - 0.5) {
      this._dropScheduled.add(0);
      const acOffset = ac.currentTime + (riserStart - trackTime);
      const safeStart = Math.max(ac.currentTime + 0.01, acOffset);
      const riserDur = dropTime - riserStart;
      this.scheduleRiser(safeStart, riserDur);

      const crashTime = Math.max(ac.currentTime + 0.01, ac.currentTime + (dropTime - trackTime));
      this.scheduleCrash(crashTime);
    }
  }

  private scheduleRiser(when: number, dur: number) {
    const ac = getAudioContext();

    // Sawtooth sweep — wide and aggressive
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, when);
    osc.frequency.exponentialRampToValueAtTime(4500, when + dur);

    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0, when);
    gain.gain.linearRampToValueAtTime(0.40, when + dur * 0.85);
    gain.gain.linearRampToValueAtTime(0.0, when + dur);

    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(200, when);
    hp.frequency.exponentialRampToValueAtTime(1200, when + dur);

    // Noise layer for texture
    const noiseDur = dur;
    const noiseBufSize = Math.ceil(ac.sampleRate * noiseDur);
    const noiseBuf = ac.createBuffer(1, noiseBufSize, ac.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseBufSize; i++) nd[i] = Math.random() * 2 - 1;
    const noiseSrc = ac.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    const noiseGain = ac.createGain();
    noiseGain.gain.setValueAtTime(0, when);
    noiseGain.gain.linearRampToValueAtTime(0.18, when + dur * 0.9);
    noiseGain.gain.linearRampToValueAtTime(0, when + dur);
    const noiseHp = ac.createBiquadFilter();
    noiseHp.type = 'highpass';
    noiseHp.frequency.value = 3000;
    noiseSrc.connect(noiseHp);
    noiseHp.connect(noiseGain);
    noiseGain.connect(this.gainNode);
    noiseSrc.start(when);
    noiseSrc.stop(when + dur + 0.05);

    osc.connect(hp);
    hp.connect(gain);
    gain.connect(this.gainNode);
    osc.start(when);
    osc.stop(when + dur + 0.05);
    this._riserNode = osc;
  }

  private scheduleCrash(when: number) {
    const ac = getAudioContext();
    const dur = 1.5;
    const bufSize = Math.ceil(ac.sampleRate * dur);
    const noiseBuf = ac.createBuffer(1, bufSize, ac.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

    const src = ac.createBufferSource();
    src.buffer = noiseBuf;

    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 5000;
    bp.Q.value = 0.35;

    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.65, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + dur);

    src.connect(bp);
    bp.connect(gain);
    gain.connect(this.gainNode);
    src.start(when);
    src.stop(when + dur + 0.05);

    this.synthKick(when, 1.4);
    this.duckMusic(when, 0.3);
  }

  /**
   * Progressive snare roll: accelerates from 8th → 16th → 32nd notes.
   */
  private scheduleSnareRollBuild(startTime: number, duration: number, beatInterval: number) {
    const phases: Array<{ frac: number; endFrac: number; div: number }> = [
      { frac: 0.0,  endFrac: 0.30, div: 2 },
      { frac: 0.30, endFrac: 0.60, div: 4 },
      { frac: 0.60, endFrac: 0.85, div: 8 },
      { frac: 0.85, endFrac: 1.0,  div: 16 },
    ];

    for (const { frac, endFrac, div } of phases) {
      const phaseStart = startTime + duration * frac;
      const phaseEnd = startTime + duration * endFrac;
      const interval = beatInterval / div;
      const hits = Math.ceil((phaseEnd - phaseStart) / interval);

      for (let i = 0; i < hits; i++) {
        const t = phaseStart + i * interval;
        if (t > startTime + duration) break;
        const progress = (t - startTime) / duration;
        const vel = 0.15 + 0.55 * progress;
        this.scheduleSnareHit(t, vel, 0.035 + 0.025 * (1 - progress));
      }
    }
  }

  private scheduleSnareHit(when: number, velocity: number, dur: number) {
    const ac = getAudioContext();

    // Noise body
    const bufLen = Math.ceil(ac.sampleRate * dur);
    const noiseBuf = ac.createBuffer(1, bufLen, ac.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    const src = ac.createBufferSource();
    src.buffer = noiseBuf;

    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3500;
    bp.Q.value = 0.7;

    const g = ac.createGain();
    g.gain.setValueAtTime(velocity, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);

    src.connect(bp);
    bp.connect(g);
    g.connect(this.gainNode);
    src.start(when);
    src.stop(when + dur + 0.01);

    // Tonal snap — gives the snare "crack"
    if (velocity > 0.25) {
      const snap = ac.createOscillator();
      snap.type = 'triangle';
      snap.frequency.setValueAtTime(220, when);
      snap.frequency.exponentialRampToValueAtTime(80, when + dur * 0.5);
      const snapG = ac.createGain();
      snapG.gain.setValueAtTime(velocity * 0.35, when);
      snapG.gain.exponentialRampToValueAtTime(0.001, when + dur * 0.6);
      snap.connect(snapG);
      snapG.connect(this.gainNode);
      snap.start(when);
      snap.stop(when + dur + 0.01);
    }
  }

  private scheduleUpcoming() {
    const ac = getAudioContext();
    const preset = GENRE_PRESETS[this.genreId];
    const pattern = preset.rhythmPattern;
    if (pattern.every((h) => h === null)) return;

    const trackTime = this.getTime();
    const beatInterval = this.analysis.beatInterval;
    const sixteenthDur = beatInterval / 4;
    const firstBeat = this.analysis.firstBeatTime;
    const lookAheadSec = 0.12;

    const elapsed = trackTime - firstBeat;
    if (elapsed < -sixteenthDur) return;

    const currentStep = Math.floor(elapsed / sixteenthDur);
    if (this._nextStepIndex < currentStep) {
      this._nextStepIndex = currentStep;
    }

    const endStep = Math.floor((elapsed + lookAheadSec) / sixteenthDur) + 1;
    const energy = this.energyAt(trackTime);

    const baseVol = preset.beatLayerVolume;
    const energyScale = 0.45 + 0.55 * energy;
    const cueBoost = this._cueLoopActive ? 1.35 : 1.0;
    const targetGain = baseVol * energyScale * cueBoost;
    this.gainNode.gain.setTargetAtTime(targetGain, ac.currentTime, 0.06);

    for (let step = this._nextStepIndex; step <= endStep; step++) {
      const patIdx = ((step % 16) + 16) % 16;
      const hit = pattern[patIdx];
      if (!hit) continue;

      if (!this._cueLoopActive) {
        if (energy < 0.12 && (hit === 'hat' || hit === 'open_hat') && patIdx % 4 !== 0) continue;
        if (energy < 0.06 && hit !== 'kick') continue;
      }

      let st = this.stepTime(step);

      if (patIdx % 2 === 1 && preset.swing > 0) {
        st += sixteenthDur * preset.swing;
      }

      const acTime = ac.currentTime + (st - trackTime);
      if (acTime < ac.currentTime - 0.01) continue;

      const safeTime = Math.max(ac.currentTime + 0.005, acTime);
      this.scheduleHit(hit, safeTime, energy);
    }

    this._nextStepIndex = endStep + 1;
  }

  private get preset(): GenrePreset { return GENRE_PRESETS[this.genreId]; }

  private scheduleHit(type: RhythmHit, when: number, energy: number) {
    switch (type) {
      case 'kick':
        this.synthKick(when, this.preset.kick.velocity * (0.7 + 0.3 * energy));
        this.duckMusic(when);
        break;
      case 'hat':      this.synthHat(when, energy); break;
      case 'clap':     this.synthClap(when, energy); break;
      case 'perc':     this.synthPerc(when, energy); break;
      case 'open_hat': this.synthOpenHat(when, energy); break;
    }
  }

  private synthKick(when: number, velocity = 0.9) {
    const ac = getAudioContext();
    const k = this.preset.kick;

    // Body: sine pitch sweep
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(k.startHz, when);
    osc.frequency.exponentialRampToValueAtTime(k.endHz, when + k.decaySec * 0.5);
    const bodyGain = ac.createGain();
    bodyGain.gain.setValueAtTime(velocity, when);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, when + k.decaySec);
    osc.connect(bodyGain);
    bodyGain.connect(this.gainNode);
    osc.start(when);
    osc.stop(when + k.decaySec + 0.02);

    // Click transient: short noise burst highpassed — gives the "punch"
    const clickDur = 0.008;
    const clickBufLen = Math.ceil(ac.sampleRate * clickDur);
    const clickBuf = ac.createBuffer(1, clickBufLen, ac.sampleRate);
    const cd = clickBuf.getChannelData(0);
    for (let i = 0; i < clickBufLen; i++) cd[i] = Math.random() * 2 - 1;
    const clickSrc = ac.createBufferSource();
    clickSrc.buffer = clickBuf;
    const clickHP = ac.createBiquadFilter();
    clickHP.type = 'highpass';
    clickHP.frequency.value = 3000;
    const clickGain = ac.createGain();
    clickGain.gain.setValueAtTime(velocity * 0.7, when);
    clickGain.gain.exponentialRampToValueAtTime(0.001, when + clickDur);
    clickSrc.connect(clickHP);
    clickHP.connect(clickGain);
    clickGain.connect(this.gainNode);
    clickSrc.start(when);
    clickSrc.stop(when + clickDur + 0.002);

    // Sub-bass layer — heavy sustained low end
    if (this.preset.subBoostDb > 2) {
      const sub = ac.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(k.endHz, when);
      const subGain = ac.createGain();
      subGain.gain.setValueAtTime(velocity * 0.65, when);
      subGain.gain.exponentialRampToValueAtTime(0.001, when + k.decaySec * 1.4);
      sub.connect(subGain);
      subGain.connect(this.gainNode);
      sub.start(when);
      sub.stop(when + k.decaySec * 1.5);
    }
  }

  private synthHat(when: number, energy: number) {
    const ac = getAudioContext();
    const h = this.preset.hat;
    const dur = h.closedDecay + 0.015 * energy;
    const bufSize = Math.ceil(ac.sampleRate * dur);
    const noiseBuf = ac.createBuffer(1, bufSize, ac.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = h.hpFreqBase + h.hpFreqEnergy * energy;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(h.velocity + 0.25 * energy, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + dur);

    src.connect(hp);
    hp.connect(gain);
    gain.connect(this.gainNode);
    src.start(when);
    src.stop(when + dur + 0.01);
  }

  private synthClap(when: number, energy: number) {
    const ac = getAudioContext();
    const clapFreq = this.preset.clapFreq;
    const vel = 0.45 + 0.4 * energy;

    // Multiple micro-bursts simulating overlapping hands
    const bursts = 3;
    for (let b = 0; b < bursts; b++) {
      const offset = b * 0.008;
      const burstDur = 0.025 + 0.01 * energy;
      const bufSize = Math.ceil(ac.sampleRate * burstDur);
      const noiseBuf = ac.createBuffer(1, bufSize, ac.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = clapFreq + 600 * energy + b * 200;
      bp.Q.value = 1.0;
      const g = ac.createGain();
      const burstVel = vel * (1 - b * 0.15);
      g.gain.setValueAtTime(burstVel, when + offset);
      g.gain.exponentialRampToValueAtTime(0.001, when + offset + burstDur);
      src.connect(bp);
      bp.connect(g);
      g.connect(this.gainNode);
      src.start(when + offset);
      src.stop(when + offset + burstDur + 0.01);
    }

    // Tail — longer noise decay that gives the clap its sustain
    const tailDur = 0.07 + 0.04 * energy;
    const tailBufSize = Math.ceil(ac.sampleRate * tailDur);
    const tailBuf = ac.createBuffer(1, tailBufSize, ac.sampleRate);
    const td = tailBuf.getChannelData(0);
    for (let i = 0; i < tailBufSize; i++) td[i] = Math.random() * 2 - 1;
    const tailSrc = ac.createBufferSource();
    tailSrc.buffer = tailBuf;
    const tailBP = ac.createBiquadFilter();
    tailBP.type = 'bandpass';
    tailBP.frequency.value = clapFreq * 0.8;
    tailBP.Q.value = 0.6;
    const tailG = ac.createGain();
    tailG.gain.setValueAtTime(vel * 0.5, when + 0.02);
    tailG.gain.exponentialRampToValueAtTime(0.001, when + 0.02 + tailDur);
    tailSrc.connect(tailBP);
    tailBP.connect(tailG);
    tailG.connect(this.gainNode);
    tailSrc.start(when + 0.02);
    tailSrc.stop(when + 0.02 + tailDur + 0.01);
  }

  private synthPerc(when: number, energy: number) {
    const ac = getAudioContext();
    const vel = 0.40 + 0.35 * energy;

    // Tonal body
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(420 + 100 * energy, when);
    osc.frequency.exponentialRampToValueAtTime(90, when + 0.06);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(vel, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.09);
    osc.connect(gain);
    gain.connect(this.gainNode);
    osc.start(when);
    osc.stop(when + 0.11);

    // Click layer
    const clickDur = 0.006;
    const bufLen = Math.ceil(ac.sampleRate * clickDur);
    const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1;
    const clickSrc = ac.createBufferSource();
    clickSrc.buffer = buf;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4000;
    const cg = ac.createGain();
    cg.gain.setValueAtTime(vel * 0.55, when);
    cg.gain.exponentialRampToValueAtTime(0.001, when + clickDur);
    clickSrc.connect(hp);
    hp.connect(cg);
    cg.connect(this.gainNode);
    clickSrc.start(when);
    clickSrc.stop(when + clickDur + 0.002);
  }

  private synthOpenHat(when: number, energy: number) {
    const ac = getAudioContext();
    const h = this.preset.hat;
    const dur = h.openDecay + 0.08 * energy;
    const bufSize = Math.ceil(ac.sampleRate * dur);
    const noiseBuf = ac.createBuffer(1, bufSize, ac.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = h.hpFreqBase - 1500;
    const gain = ac.createGain();
    gain.gain.setValueAtTime((h.velocity - 0.05) + 0.25 * energy, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + dur);

    src.connect(hp);
    hp.connect(gain);
    gain.connect(this.gainNode);
    src.start(when);
    src.stop(when + dur + 0.01);
  }
}
