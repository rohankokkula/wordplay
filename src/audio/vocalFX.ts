import type { TrackAnalysis, VocalHook, VocalSegment } from './types';
import { getAudioContext } from './mixer';
import { getFXChain } from './effects';
import { createReverbIR } from './effects';

/**
 * VocalFXEngine — intelligent, position-aware vocal effects.
 *
 * 1. **Reverb throws** — short reverb swells on the outgoing deck when a vocal
 *    phrase is about to end, creating a smooth "wash" tail that real DJs do
 *    by hitting the reverb send momentarily.
 *
 * 2. **Drop reverb** — builds reverb wet mix leading into a detected drop,
 *    then cuts it dry for the impact.
 *
 * 3. **Hook reverb** — subtle reverb bloom when a vocal hook is reached,
 *    adding space and presence.
 *
 * 4. **Vocal cues** — grabs a short audio snippet from the buffer and replays
 *    it with a rhythmic echo (1/8 or 1/16 delay), like DJs looping the last
 *    word 2-4 times before a drop or transition.
 */

interface CueEvent {
  triggerAt: number;
  sliceStart: number;
  sliceEnd: number;
  repeats: number;
  delayBeats: number;
}

interface ReverbThrow {
  rampUpAt: number;
  peakWet: number;
  holdDur: number;
  fadeDur: number;
}

export class VocalFXEngine {
  private analysis: TrackAnalysis;
  private getTime: () => number;
  private buffer: AudioBuffer;
  private deck: 'A' | 'B';
  private _raf = 0;
  private _running = false;

  private _scheduledReverbThrows = new Set<string>();
  private _scheduledCues = new Set<string>();
  private _activeCueSources: AudioBufferSourceNode[] = [];

  // Per-deck reverb (separate from global FX chain reverb)
  private reverbSend: GainNode;
  private convolver: ConvolverNode;
  private reverbReturn: GainNode;

  constructor(
    analysis: TrackAnalysis,
    buffer: AudioBuffer,
    getTime: () => number,
    deck: 'A' | 'B',
  ) {
    this.analysis = analysis;
    this.buffer = buffer;
    this.getTime = getTime;
    this.deck = deck;

    const ac = getAudioContext();

    this.reverbSend = ac.createGain();
    this.reverbSend.gain.value = 0;

    this.convolver = ac.createConvolver();
    this.convolver.buffer = createReverbIR(1.8, 4.0);

    this.reverbReturn = ac.createGain();
    this.reverbReturn.gain.value = 0.55;

    this.reverbSend.connect(this.convolver);
    this.convolver.connect(this.reverbReturn);
    this.reverbReturn.connect(getFXChain().input);
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._scheduledReverbThrows.clear();
    this._scheduledCues.clear();
    this.tick();
  }

  stop() {
    this._running = false;
    cancelAnimationFrame(this._raf);
    for (const src of this._activeCueSources) {
      try { src.stop(); } catch { /* ok */ }
    }
    this._activeCueSources = [];
    try { this.reverbSend.disconnect(); } catch { /* ok */ }
    try { this.convolver.disconnect(); } catch { /* ok */ }
    try { this.reverbReturn.disconnect(); } catch { /* ok */ }
  }

  /**
   * Fire a reverb swell right now (called externally from controller
   * during transitions for the outgoing deck's vocal tail).
   */
  triggerTransitionReverb(durationSec: number) {
    const ac = getAudioContext();
    const now = ac.currentTime;
    const wet = 0.7;
    this.reverbSend.gain.cancelScheduledValues(now);
    this.reverbSend.gain.setValueAtTime(0, now);
    this.reverbSend.gain.linearRampToValueAtTime(wet, now + durationSec * 0.2);
    this.reverbSend.gain.setValueAtTime(wet, now + durationSec * 0.6);
    this.reverbSend.gain.linearRampToValueAtTime(0, now + durationSec);
  }

  /**
   * Fire a vocal cue right now (called externally from controller
   * before transitions / drops).
   * Grabs `sliceDur` seconds of audio ending at `trackTime` and
   * repeats it `repeats` times at `delayBeatFrac` beat intervals.
   */
  triggerCue(trackTime: number, sliceDur: number, repeats: number, delayBeatFrac: number) {
    const ac = getAudioContext();
    const sr = ac.sampleRate;
    const bi = this.analysis.beatInterval;
    const delay = bi * delayBeatFrac;

    const sliceStart = Math.max(0, trackTime - sliceDur);
    const sliceEnd = trackTime;
    const startSample = Math.floor(sliceStart * sr);
    const endSample = Math.min(Math.floor(sliceEnd * sr), this.buffer.length);
    if (endSample - startSample < 100) return;

    const sliceBuf = this.extractSlice(startSample, endSample);
    if (!sliceBuf) return;

    const now = ac.currentTime;

    for (let i = 0; i < repeats; i++) {
      const when = now + i * delay;
      const vol = 0.6 - (i * 0.1);
      if (vol <= 0.05) break;

      this.playCueSlice(sliceBuf, when, vol, i === repeats - 1);
    }
  }

  private tick = () => {
    if (!this._running) return;
    this.checkReverbThrows();
    this.checkAutoCues();
    this._raf = requestAnimationFrame(this.tick);
  };

  // ── Automatic reverb throws at vocal phrase endings ──

  private checkReverbThrows() {
    const trackTime = this.getTime();
    const lookAhead = 0.8;

    for (const seg of this.analysis.vocalSegments) {
      const throwTime = seg.end - 0.3;
      const key = `seg-${seg.start.toFixed(1)}`;
      if (this._scheduledReverbThrows.has(key)) continue;

      if (trackTime >= throwTime - lookAhead && trackTime < throwTime + 0.1) {
        this._scheduledReverbThrows.add(key);
        this.scheduleReverbThrow(throwTime - trackTime, 0.5, 0.8);
      }
    }

    // Reverb swell before drop
    const dropApproach = this.analysis.dropTime - 2.0;
    const dropKey = `drop-${this.analysis.dropTime.toFixed(1)}`;
    if (!this._scheduledReverbThrows.has(dropKey)) {
      if (trackTime >= dropApproach - lookAhead && trackTime < dropApproach + 0.1) {
        this._scheduledReverbThrows.add(dropKey);
        this.scheduleReverbThrow(dropApproach - trackTime, 0.65, 1.8);
      }
    }

    // Reverb bloom on hooks
    for (const hook of this.analysis.vocalHooks) {
      const hookKey = `hook-${hook.time.toFixed(1)}`;
      if (this._scheduledReverbThrows.has(hookKey)) continue;

      if (trackTime >= hook.time - lookAhead && trackTime < hook.time + 0.1) {
        this._scheduledReverbThrows.add(hookKey);
        this.scheduleReverbThrow(hook.time - trackTime, 0.35, 0.6);
      }
    }
  }

  private scheduleReverbThrow(offsetFromNow: number, peakWet: number, totalDur: number) {
    const ac = getAudioContext();
    const start = ac.currentTime + Math.max(0, offsetFromNow);
    const rampUp = totalDur * 0.2;
    const hold = totalDur * 0.3;
    const fade = totalDur * 0.5;

    this.reverbSend.gain.cancelScheduledValues(start);
    this.reverbSend.gain.setValueAtTime(0, start);
    this.reverbSend.gain.linearRampToValueAtTime(peakWet, start + rampUp);
    this.reverbSend.gain.setValueAtTime(peakWet, start + rampUp + hold);
    this.reverbSend.gain.linearRampToValueAtTime(0, start + rampUp + hold + fade);
  }

  // ── Automatic vocal cues before drops and at hook entries ──

  private checkAutoCues() {
    const trackTime = this.getTime();
    const bi = this.analysis.beatInterval;
    const lookAhead = 0.3;

    // Vocal cue echo before the drop — grab the last ~0.4s of vocal and stutter
    const cuePoint = this.analysis.dropTime - bi * 4;
    const cueKey = `drop-cue-${this.analysis.dropTime.toFixed(1)}`;
    if (!this._scheduledCues.has(cueKey)) {
      if (trackTime >= cuePoint - lookAhead && trackTime < cuePoint + 0.1) {
        const nearestVocalEnd = this.findNearestVocalEnd(cuePoint);
        if (nearestVocalEnd !== null && Math.abs(nearestVocalEnd - cuePoint) < bi * 6) {
          this._scheduledCues.add(cueKey);
          this.triggerCue(nearestVocalEnd, 0.4, 4, 0.5);
        }
      }
    }

    // Vocal cue at end of each vocal segment (echo the last snippet)
    for (const seg of this.analysis.vocalSegments) {
      const segDur = seg.end - seg.start;
      if (segDur < 2.0) continue;

      const echoPoint = seg.end - bi * 2;
      const segKey = `seg-cue-${seg.start.toFixed(1)}`;
      if (this._scheduledCues.has(segKey)) continue;

      if (trackTime >= echoPoint - lookAhead && trackTime < echoPoint + 0.1) {
        this._scheduledCues.add(segKey);
        const sliceDur = Math.min(0.5, bi * 0.8);
        this.triggerCue(echoPoint + sliceDur, sliceDur, 3, 0.5);
      }
    }
  }

  private findNearestVocalEnd(time: number): number | null {
    let best: number | null = null;
    let bestDist = Infinity;
    for (const seg of this.analysis.vocalSegments) {
      const dist = Math.abs(seg.end - time);
      if (dist < bestDist) {
        bestDist = dist;
        best = seg.end;
      }
    }
    return best;
  }

  // ── Audio slice extraction & playback ──

  private extractSlice(startSample: number, endSample: number): AudioBuffer | null {
    const ac = getAudioContext();
    const len = endSample - startSample;
    if (len <= 0) return null;

    const channels = this.buffer.numberOfChannels;
    const slice = ac.createBuffer(channels, len, ac.sampleRate);

    for (let ch = 0; ch < channels; ch++) {
      const src = this.buffer.getChannelData(ch);
      const dst = slice.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        dst[i] = src[startSample + i];
      }
    }
    return slice;
  }

  private playCueSlice(sliceBuf: AudioBuffer, when: number, volume: number, isLast: boolean) {
    const ac = getAudioContext();

    const src = ac.createBufferSource();
    src.buffer = sliceBuf;

    const gain = ac.createGain();
    gain.gain.setValueAtTime(volume, when);

    // Apply a fast fade-out envelope for the last 30% of the slice
    const dur = sliceBuf.duration;
    gain.gain.setValueAtTime(volume, when + dur * 0.7);
    gain.gain.linearRampToValueAtTime(volume * 0.3, when + dur);

    // Highpass to isolate the vocal region a bit
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 250;

    // Slight pitch shift on later repeats: detune slightly for that "DJ echo" feel
    if (!isLast) {
      src.detune.value = 0;
    }

    src.connect(hp);
    hp.connect(gain);

    // Send through the vocal reverb for a washed-out tail
    gain.connect(this.reverbSend);
    gain.connect(getFXChain().input);

    src.start(when);
    src.stop(when + dur + 0.05);

    this._activeCueSources.push(src);
    src.onended = () => {
      const idx = this._activeCueSources.indexOf(src);
      if (idx >= 0) this._activeCueSources.splice(idx, 1);
    };
  }
}
