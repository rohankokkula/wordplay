import type { TrackAnalysis, AutomixPhase, LogEntry } from '../audio/types';
import type { GenreId } from '../genre/genrePresets';
import type { WordMatch } from '../lyrics/types';
import { GENRE_PRESETS, genreTargetBpm } from '../genre/genrePresets';
import { DeckPlayer } from '../audio/deckPlayer';
import { setCrossfader, getDeckEQ, getAudioContext } from '../audio/mixer';
import {
  sweepFilter, openFilter, resetAllFX, setGenreEQ,
  sweepHighpass, openHighpass, setReverbSend,
} from '../audio/effects';
import { GenreBeatLayer } from '../audio/genreBeatLayer';
import { GenreInstrumentalPlayer } from '../audio/genreInstrumental';
import { VocalFXEngine } from '../audio/vocalFX';
import { playAirHorn, playSiren } from '../audio/djSfx';
import {
  blendDurationSec,
  transitionSegmentForOutgoingDeck,
  type TransitionPlan,
} from './transitionPlan';

export interface AutomixState {
  phase: AutomixPhase;
  blendProgress: number;
  crossfaderPosition: number;
  activeDeck: 'A' | 'B';
  currentTrackName: string;
  currentBpm: number;
  transitionInfo: string;
  transitionSegment: {
    deck: 'A' | 'B';
    startSec: number;
    endSec: number;
  } | null;
  wordplayPhrase: string | null;
}

type LogFn = (text: string, source: LogEntry['source']) => void;

const DEFAULT_MAX_RATE = 0.06;

function clampRate(sourceBpm: number, targetBpm: number, maxRate = DEFAULT_MAX_RATE): number {
  const raw = targetBpm / sourceBpm;
  return Math.max(1 - maxRate, Math.min(1 + maxRate, raw));
}

export class AutomixController {
  private playerA: DeckPlayer;
  private playerB: DeckPlayer;
  private analysisA: TrackAnalysis | null = null;
  private analysisB: TrackAnalysis | null = null;
  private nameA = '';
  private nameB = '';
  private _phase: AutomixPhase = 'idle';
  private _blendProgress = 0;
  private _crossfader = 0;
  private _activeDeck: 'A' | 'B' = 'A';
  private blendBeats = 32;
  private _genreId: GenreId = 'neutral';
  private _animFrame = 0;
  private _blendStartTime = 0;
  private _blendDuration = 0;
  private _transitionInfo = '';
  private _transitionSegment: AutomixState['transitionSegment'] = null;
  private _filterReleaseScheduled = false;
  private _beatLayer: GenreBeatLayer | null = null;
  private _instrumental: GenreInstrumentalPlayer | null = null;
  private _vocalFxA: VocalFXEngine | null = null;
  private _vocalFxB: VocalFXEngine | null = null;
  private _wordMatches: WordMatch[] = [];
  private _wordplayPhrase: string | null = null;
  /** Floor: never seek a deck earlier than this (set when we leave that deck). */
  private _lastPlayedA = 0;
  private _lastPlayedB = 0;
  private onChange: (state: AutomixState) => void;
  private log: LogFn;

  constructor(
    playerA: DeckPlayer,
    playerB: DeckPlayer,
    onChange: (state: AutomixState) => void,
    log: LogFn,
  ) {
    this.playerA = playerA;
    this.playerB = playerB;
    this.onChange = onChange;
    this.log = log;
  }

  setAnalysis(deck: 'A' | 'B', a: TrackAnalysis, name: string) {
    if (deck === 'A') { this.analysisA = a; this.nameA = name; }
    else { this.analysisB = a; this.nameB = name; }
  }

  /** Remove analysis for one deck (after user clears / replaces a track). */
  clearDeckAnalysis(deck: 'A' | 'B') {
    if (deck === 'A') {
      this.analysisA = null;
      this.nameA = '';
    } else {
      this.analysisB = null;
      this.nameB = '';
    }
    cancelAnimationFrame(this._animFrame);
    this._animFrame = 0;
    this._transitionInfo = '';
    this._transitionSegment = null;
    this._wordplayPhrase = null;
    if (this._phase !== 'idle' && this._phase !== 'done') {
      this._phase = 'idle';
      this._blendProgress = 0;
    }
    this.emit();
  }

  setBlendBeats(n: number) { this.blendBeats = n; }

  setWordMatches(matches: WordMatch[]) {
    this._wordMatches = matches;
    console.log(`[automix] setWordMatches: ${matches.length} match(es)`,
      matches.slice(0, 5).map(m => `"${m.phrase}" A@${(m.phraseOnsetA ?? m.timeA).toFixed(2)} B@${(m.phraseOnsetB ?? m.timeB).toFixed(2)}`));
    // Lyrics often finish loading after MIX — re-plan so wordplay uses LRCLib times (jump to phrase, not t=0)
    if (this._phase === 'playingA' || this._phase === 'playingB') {
      cancelAnimationFrame(this._animFrame);
      this.scheduleBlend();
    }
  }

  setGenreStyle(id: GenreId) {
    this._genreId = id;
    const p = GENRE_PRESETS[id];
    setGenreEQ(p.eqLowShelfGain, p.subBoostDb);
    this.preloadInstrumental(id);
  }

  private async preloadInstrumental(id: GenreId) {
    if (!GENRE_PRESETS[id].instrumentalUrl) return;
    if (!this._instrumental) {
      this._instrumental = new GenreInstrumentalPlayer();
    }
    const ok = await this._instrumental.loadForGenre(id);
    if (ok) {
      this.log(`Genre instrumental loaded for ${GENRE_PRESETS[id].label}`, 'system');
    }
  }

  private get genre() { return GENRE_PRESETS[this._genreId]; }

  async start() {
    if (!this.analysisA || !this.analysisB) return;

    resetAllFX();
    this.resetDeckEQs();
    setGenreEQ(this.genre.eqLowShelfGain, this.genre.subBoostDb);

    const maxRate = this.genre.maxRateChange;
    const targetA = genreTargetBpm(this.analysisA.bpm, this.genre);
    const targetB = genreTargetBpm(this.analysisB.bpm, this.genre);
    const rateA = clampRate(this.analysisA.bpm, targetA, maxRate);
    const rateB = clampRate(this.analysisB.bpm, targetB, maxRate);
    this.playerA.setPlaybackRate(rateA);
    this.playerB.setPlaybackRate(rateB);

    this.log(`Deck A: ${this.analysisA.bpm} BPM`, 'a');
    this.log(`Deck B: ${this.analysisB.bpm} BPM`, 'b');
    if (this._genreId !== 'neutral') {
      this.log(`Genre: ${this.genre.label} · ${this.genre.transitionStyle} transitions`, 'system');
      if (Math.abs(rateA - 1) > 0.005) {
        this.log(`Deck A nudged to ~${(this.analysisA.bpm * rateA).toFixed(1)} BPM`, 'a');
      }
    }

    const hooksA = this.analysisA.vocalHooks?.length ?? 0;
    const hooksB = this.analysisB.vocalHooks?.length ?? 0;
    if (hooksA > 0 || hooksB > 0) {
      this.log(`Vocal hooks: ${hooksA} on A, ${hooksB} on B`, 'system');
    }

    this.playerA.setVolume(1);
    this.playerB.setVolume(1);

    this._crossfader = 0;
    setCrossfader(0);
    this._activeDeck = 'A';
    this._phase = 'playingA';
    this._transitionInfo = '';
    this._transitionSegment = null;
    this._lastPlayedA = 0;
    this._lastPlayedB = 0;

    this.log(`Playing: ${this.nameA}`, 'a');
    this.logAnalysisSummary('A', this.analysisA);

    this.emit();

    this.startBeatLayer(this.analysisA, 'A');
    this.startVocalFX();

    if (!this.playerA.playing) await this.playerA.play();

    this.fadeInInstrumental(this.analysisA, rateA);

    this.scheduleBlend();
  }

  stop() {
    this._phase = 'idle';
    this._blendProgress = 0;
    this._transitionInfo = '';
    this._transitionSegment = null;
    this._wordplayPhrase = null;
    cancelAnimationFrame(this._animFrame);
    resetAllFX();
    this.resetDeckEQs();
    this.stopBeatLayer();
    this.stopVocalFX();
    this._instrumental?.stop();
    this.emit();
  }

  private resetDeckEQs() {
    const ac = getAudioContext();
    const now = ac.currentTime;
    for (const deck of ['A', 'B'] as const) {
      const eq = getDeckEQ(deck);
      for (const node of [eq.low, eq.mid, eq.high]) {
        node.gain.cancelScheduledValues(now);
        node.gain.setValueAtTime(0, now);
      }
    }
  }

  private startBeatLayer(analysis: TrackAnalysis, deck: 'A' | 'B') {
    this.stopBeatLayer();
    if (this.genre.beatLayerVolume <= 0) return;

    const player = deck === 'A' ? this.playerA : this.playerB;
    this._beatLayer = new GenreBeatLayer(
      this._genreId,
      analysis,
      () => player.currentTime,
      deck,
    );
    this._beatLayer.start();
  }

  private stopBeatLayer() {
    this._beatLayer?.stop();
    this._beatLayer = null;
  }

  /**
   * Track plays first at full volume. After 4 bars, the genre instrumental
   * fades in over 8 bars, tempo-matched to the active track's BPM.
   * The instrumental volume settles at 0.55 — present but not overpowering vocals.
   */
  private fadeInInstrumental(analysis: TrackAnalysis, rate: number) {
    const inst = this._instrumental;
    if (!inst?.loaded) return;

    const bi = analysis.beatInterval;
    const delayBars = 4;
    const fadeInBars = 8;
    const delaySec = bi * delayBars * 4;
    const fadeInSec = bi * fadeInBars * 4;

    inst.setPlaybackRate(rate);
    inst.setVolume(0, 0.01);

    setTimeout(async () => {
      if (this._phase === 'idle' || this._phase === 'done') return;

      await inst.play();
      inst.rampVolume(0.55, fadeInSec);
      this.log(
        `Genre instrumental fading in over ${fadeInBars} bars (${fadeInSec.toFixed(1)}s)`,
        'system',
      );
    }, delaySec * 1000);
  }

  private startVocalFX() {
    this.stopVocalFX();
    const bufA = this.playerA.audioBuffer;
    const bufB = this.playerB.audioBuffer;
    if (this.analysisA && bufA) {
      this._vocalFxA = new VocalFXEngine(
        this.analysisA, bufA, () => this.playerA.currentTime, 'A',
      );
      this._vocalFxA.start();
    }
    if (this.analysisB && bufB) {
      this._vocalFxB = new VocalFXEngine(
        this.analysisB, bufB, () => this.playerB.currentTime, 'B',
      );
      this._vocalFxB.start();
    }
  }

  private stopVocalFX() {
    this._vocalFxA?.stop();
    this._vocalFxA = null;
    this._vocalFxB?.stop();
    this._vocalFxB = null;
  }

  private getVocalFX(deck: 'A' | 'B'): VocalFXEngine | null {
    return deck === 'A' ? this._vocalFxA : this._vocalFxB;
  }

  private logAnalysisSummary(deck: string, a: TrackAnalysis) {
    const src = (deck === 'A' ? 'a' : 'b') as LogEntry['source'];
    this.log(`${a.bpm} BPM detected`, src);
    if (a.vocalSegments.length > 0) {
      this.log(`${a.vocalSegments.length} vocal section(s)`, src);
    } else {
      this.log('No vocal sections (instrumental)', src);
    }
    if (a.vocalHooks?.length > 0) {
      this.log(`${a.vocalHooks.length} hook point(s) at ${a.vocalHooks.map(h => fmtTime(h.time)).join(', ')}`, src);
    }
    this.log(`Drop at ${fmtTime(a.dropTime)}`, src);
  }

  // ── Transition scheduling ─────────────────────────────────────

  private scheduleBlend() {
    cancelAnimationFrame(this._animFrame);

    const activeAnalysis = this._activeDeck === 'A' ? this.analysisA! : this.analysisB!;
    const incomingAnalysis = this._activeDeck === 'A' ? this.analysisB! : this.analysisA!;
    const activePlayer = this._activeDeck === 'A' ? this.playerA : this.playerB;
    const incomingPlayer = this._activeDeck === 'A' ? this.playerB : this.playerA;

    const ct = activePlayer.currentTime;
    const incFloor = this._activeDeck === 'A' ? this._lastPlayedB : this._lastPlayedA;
    console.log(`[automix] scheduleBlend: deck=${this._activeDeck} ct=${ct.toFixed(2)} wordMatches=${this._wordMatches.length} incFloor=${incFloor.toFixed(2)}`);
    const plan = transitionSegmentForOutgoingDeck(
      activeAnalysis,
      ct,
      this.blendBeats,
      this._genreId,
      incomingAnalysis,
      this._wordMatches,
      this._activeDeck,
      incFloor,
    );
    console.log(`[automix] plan: phrase=${plan.matchedPhrase ?? 'NONE'} start=${plan.startSec.toFixed(2)} seekInc=${plan.incomingSeekTime.toFixed(2)} vocal=${plan.isVocalTransition}`);
    const transitionPoint = plan.startSec;
    const effectiveBlendBeats = plan.effectiveBlendBeats;
    const blendDuration = blendDurationSec(activeAnalysis, effectiveBlendBeats, this._genreId);
    const toName = this._activeDeck === 'A' ? this.nameB : this.nameA;

    // Seek incoming deck to the vocal-aligned entry point
    incomingPlayer.seek(plan.incomingSeekTime);

    this._transitionSegment = { deck: this._activeDeck, startSec: plan.startSec, endSec: plan.endSec };

    const transType = plan.matchedPhrase
      ? `wordplay "${plan.matchedPhrase}"`
      : plan.isVocalTransition ? 'vocal hook' : this.genre.transitionStyle;
    this._transitionInfo = `Transition at ${fmtTime(transitionPoint)} · ${effectiveBlendBeats} beat ${transType} · Next: ${toName}`;

    if (plan.matchedPhrase) {
      this._wordplayPhrase = plan.matchedPhrase;
      this.log(`WORDPLAY: "${plan.matchedPhrase}" at ${fmtTime(transitionPoint)}`, 'system');
      this.log(`Incoming seeks to "${plan.matchedPhrase}" at ${fmtTime(plan.incomingSeekTime)}`, 'system');
    } else if (plan.isVocalTransition) {
      this.log(`Vocal-to-vocal transition planned at ${fmtTime(transitionPoint)}`, 'system');
      this.log(`Incoming seeks to vocal hook at ${fmtTime(plan.incomingSeekTime)}`, 'system');
    } else {
      this.log(`Transition planned: ${this.genre.transitionStyle} at ${fmtTime(transitionPoint)}`, 'system');
    }
    this.emit();

    const buildUpBeats = this.genre.buildUpBars * 4;
    const buildUpSec = buildUpBeats * activeAnalysis.beatInterval;
    let buildUpTriggered = false;

    const check = () => {
      if (this._phase !== 'playingA' && this._phase !== 'playingB') return;

      const ct = activePlayer.currentTime;
      const remaining = activePlayer.duration - ct;

      if (!buildUpTriggered && ct >= transitionPoint - buildUpSec - 0.2 && buildUpSec > 0) {
        buildUpTriggered = true;
        if (this._beatLayer) {
          this._beatLayer.startCueLoop();
          this._beatLayer.startBuildUp(transitionPoint);
          this.log('Build-up started', 'system');
        }
        // Pre-transition vocal cue: echo the nearest vocal ending
        const activeFX = this.getVocalFX(this._activeDeck);
        if (activeFX && activeAnalysis.vocalSegments.length > 0) {
          const bi = activeAnalysis.beatInterval;
          const nearSeg = activeAnalysis.vocalSegments.find(
            s => s.end > ct && s.end < transitionPoint,
          );
          if (nearSeg) {
            const delay = Math.max(0, nearSeg.end - ct);
            setTimeout(() => {
              const sliceDur = Math.min(0.4, bi * 0.7);
              activeFX.triggerCue(nearSeg.end, sliceDur, 4, 0.25);
              this.log('Pre-transition vocal cue', 'system');
            }, delay * 1000);
          }
        }
      }

      if (
        ct >= transitionPoint - 0.1 ||
        (remaining <= blendDuration + 0.5 && remaining > 0.5)
      ) {
        if (this._beatLayer) this._beatLayer.stopCueLoop();
        this.startBlend(blendDuration, plan);
        return;
      }

      this._animFrame = requestAnimationFrame(check);
    };
    this._animFrame = requestAnimationFrame(check);
  }

  private async startBlend(blendDuration: number, plan: TransitionPlan) {
    const goingToB = this._activeDeck === 'A';
    const fromAnalysis = goingToB ? this.analysisA! : this.analysisB!;
    const toAnalysis = goingToB ? this.analysisB! : this.analysisA!;
    const fromPlayer = goingToB ? this.playerA : this.playerB;
    const toPlayer = goingToB ? this.playerB : this.playerA;
    const toName = goingToB ? this.nameB : this.nameA;
    const toDeck: 'A' | 'B' = goingToB ? 'B' : 'A';
    const fromDeck: 'A' | 'B' = goingToB ? 'A' : 'B';

    // Remember where we are on the outgoing deck so we never seek it back here
    if (goingToB) {
      this._lastPlayedA = fromPlayer.currentTime;
    } else {
      this._lastPlayedB = fromPlayer.currentTime;
    }

    this._phase = 'blending';
    this._blendStartTime = performance.now() / 1000;
    this._blendDuration = blendDuration;

    const modeLabel = plan.isVocalTransition ? 'vocal mashup' : this.genre.transitionStyle;
    this._transitionInfo = `Blending to ${toName} (${modeLabel})...`;

    this.emit();

    const rate = clampRate(toAnalysis.bpm, fromAnalysis.bpm, this.genre.maxRateChange);
    toPlayer.setPlaybackRate(rate);
    this._instrumental?.setPlaybackRate(rate);

    if (Math.abs(rate - 1) > 0.005) {
      this.log(`Tempo nudge: ${toAnalysis.bpm} → ${(toAnalysis.bpm * rate).toFixed(1)} BPM`, 'system');
    }

    const bpmGap = Math.abs(fromAnalysis.bpm - toAnalysis.bpm);
    const forceCut = this.genre.hardCutBpmGap > 0 && bpmGap >= this.genre.hardCutBpmGap;

    if (!toPlayer.playing) await toPlayer.play();

    if (this.genre.useAirHorn) {
      playAirHorn();
      this.log('Air horn!', 'system');
    }
    if (this.genre.useSiren) {
      playSiren(Math.min(2, blendDuration * 0.4));
      this.log('Siren sweep', 'system');
    }

    // ── Vocal FX: reverb throw on outgoing vocal tail + cue echo ──
    const fromVFX = this.getVocalFX(fromDeck);
    if (fromVFX) {
      fromVFX.triggerTransitionReverb(blendDuration * 0.6);
      this.log('Reverb throw on outgoing vocals', 'system');

      if (fromAnalysis.vocalSegments.length > 0) {
        const ct = fromPlayer.currentTime;
        const nearSeg = fromAnalysis.vocalSegments.find(s => s.end > ct && s.end < ct + blendDuration);
        if (nearSeg) {
          const bi = fromAnalysis.beatInterval;
          const sliceDur = Math.min(0.45, bi * 0.8);
          fromVFX.triggerCue(nearSeg.end, sliceDur, 3, 0.5);
          this.log('Vocal cue echo on outgoing phrase', 'system');
        }
      }
    }

    // ── Vocal-to-vocal mashup transition ──
    // Both tracks are singing — use a mid-kill EQ technique:
    // Kill mids on outgoing (removes its vocals) while bringing in the new track's vocals.
    // This avoids two voices clashing and makes it sound like one track morphs into the other.
    if (plan.isVocalTransition && !forceCut) {
      this.log('Vocal mashup: mid-kill EQ swap', 'system');
      this.startBeatLayer(toAnalysis, toDeck);
      this.executeVocalMashup(goingToB, blendDuration, fromPlayer, toPlayer, toName, toAnalysis, toDeck, fromDeck);
      return;
    }

    if (forceCut) {
      const reason = `BPM gap (${bpmGap.toFixed(0)}) — hard cut`;
      this.log(reason, 'system');
      this.startBeatLayer(toAnalysis, toDeck);
      this.executeDropSwitch(goingToB, fromAnalysis.beatInterval * 4, fromPlayer, toPlayer, toName, toAnalysis, toDeck);
      return;
    }

    const style = this.genre.transitionStyle;
    this.log(`Transition: ${style}`, 'system');

    switch (style) {
      case 'eqSwap':
        this.executeEqSwap(goingToB, blendDuration, fromPlayer, toPlayer, toName, toAnalysis, toDeck, fromDeck);
        break;
      case 'filterFade':
        this.executeFilterFade(goingToB, blendDuration, fromPlayer, toPlayer, toName, toAnalysis, toDeck);
        break;
      case 'dropSwitch':
        this.startBeatLayer(toAnalysis, toDeck);
        this.executeDropSwitch(goingToB, fromAnalysis.beatInterval * 4, fromPlayer, toPlayer, toName, toAnalysis, toDeck);
        break;
      case 'echoOut':
        this.executeEchoOut(goingToB, blendDuration, fromPlayer, toPlayer, toName, toAnalysis, toDeck, fromDeck);
        break;
    }
  }

  // ── vocalMashup: vocal-only swap ──
  // Keep outgoing deck's instruments (bass + highs) playing at full volume.
  // Fade out only outgoing vocals (mids). Fade in only incoming vocals (mids).
  // The crossfader stays centered for most of the blend so nothing is muted
  // or compressed — then gently completes the handoff at the end.

  private executeVocalMashup(
    goingToB: boolean, duration: number,
    fromPlayer: DeckPlayer, toPlayer: DeckPlayer,
    toName: string, toAnalysis: TrackAnalysis, toDeck: 'A' | 'B', fromDeck: 'A' | 'B',
  ) {
    const ac = getAudioContext();
    const now = ac.currentTime;
    const fromEQ = getDeckEQ(fromDeck);
    const toEQ = getDeckEQ(toDeck);

    // Outgoing: fade out vocals only, keep instruments untouched
    fromEQ.mid.gain.setValueAtTime(0, now);
    fromEQ.mid.gain.linearRampToValueAtTime(-18, now + duration * 0.4);
    fromEQ.low.gain.setValueAtTime(0, now);
    fromEQ.high.gain.setValueAtTime(0, now);
    // Gently fade instruments in the last 30% so the handoff isn't abrupt
    fromEQ.low.gain.linearRampToValueAtTime(0, now + duration * 0.7);
    fromEQ.low.gain.linearRampToValueAtTime(-12, now + duration);
    fromEQ.high.gain.linearRampToValueAtTime(0, now + duration * 0.7);
    fromEQ.high.gain.linearRampToValueAtTime(-8, now + duration);

    // Incoming: start with vocals only (mids), no bass/highs to avoid clashing instruments
    toEQ.mid.gain.setValueAtTime(-24, now);
    toEQ.mid.gain.linearRampToValueAtTime(0, now + duration * 0.35);
    toEQ.low.gain.setValueAtTime(-30, now);
    toEQ.low.gain.linearRampToValueAtTime(-30, now + duration * 0.6);
    toEQ.low.gain.linearRampToValueAtTime(0, now + duration * 0.9);
    toEQ.high.gain.setValueAtTime(-20, now);
    toEQ.high.gain.linearRampToValueAtTime(-20, now + duration * 0.5);
    toEQ.high.gain.linearRampToValueAtTime(0, now + duration * 0.85);

    this.animateVocalCrossfade(goingToB, duration, fromPlayer, toPlayer, toName, toAnalysis, toDeck);
  }

  // ── eqSwap: bass swap via per-deck EQ ─────────────────────────

  private executeEqSwap(
    goingToB: boolean, duration: number,
    fromPlayer: DeckPlayer, toPlayer: DeckPlayer,
    toName: string, toAnalysis: TrackAnalysis, toDeck: 'A' | 'B', fromDeck: 'A' | 'B',
  ) {
    const ac = getAudioContext();
    const now = ac.currentTime;
    const fromEQ = getDeckEQ(fromDeck);
    const toEQ = getDeckEQ(toDeck);

    toEQ.low.gain.setValueAtTime(-24, now);
    toEQ.low.gain.linearRampToValueAtTime(0, now + duration * 0.8);
    fromEQ.low.gain.setValueAtTime(0, now);
    fromEQ.low.gain.linearRampToValueAtTime(-24, now + duration * 0.7);

    toEQ.high.gain.setValueAtTime(-6, now);
    toEQ.high.gain.linearRampToValueAtTime(0, now + duration * 0.6);

    const switchDelay = duration * 0.45;
    setTimeout(() => {
      if (this._phase === 'blending') {
        this.startBeatLayer(toAnalysis, toDeck);
      }
    }, switchDelay * 1000);

    this.animateCrossfade(goingToB, duration, fromPlayer, toPlayer, toName, toAnalysis, toDeck);
  }

  // ── filterFade: lowpass sweep + highpass on outgoing ───────────

  private executeFilterFade(
    goingToB: boolean, duration: number,
    fromPlayer: DeckPlayer, toPlayer: DeckPlayer,
    toName: string, toAnalysis: TrackAnalysis, toDeck: 'A' | 'B',
  ) {
    const sweepFloor = this.genre.sweepFloorHz;
    const sweepScale = this.genre.sweepDurationScale;
    const sweepDur = duration * 0.6 * sweepScale;

    sweepFilter(sweepFloor, sweepDur);

    const hpTarget = this._genreId === 'trance' ? 1200 : 800;
    sweepHighpass(hpTarget, sweepDur * 0.8);

    const openDelay = sweepDur * 0.9;
    setTimeout(() => {
      if (this._phase === 'blending') openHighpass(duration * 0.4);
    }, openDelay * 1000);

    // For trance, re-open the lowpass slowly to create the euphoric "filter opening"
    if (this._genreId === 'trance') {
      setTimeout(() => {
        if (this._phase === 'blending') openFilter(duration * 0.5);
      }, (openDelay + duration * 0.05) * 1000);
    }

    const switchDelay = duration * 0.45;
    setTimeout(() => {
      if (this._phase === 'blending') {
        this.startBeatLayer(toAnalysis, toDeck);
      }
    }, switchDelay * 1000);

    this.animateCrossfade(goingToB, duration, fromPlayer, toPlayer, toName, toAnalysis, toDeck);
  }

  // ── dropSwitch: hard cut at next downbeat ─────────────────────

  private executeDropSwitch(
    goingToB: boolean, duration: number,
    fromPlayer: DeckPlayer, toPlayer: DeckPlayer,
    toName: string, toAnalysis: TrackAnalysis, toDeck: 'A' | 'B',
  ) {
    this.animateCrossfade(goingToB, duration, fromPlayer, toPlayer, toName, toAnalysis, toDeck);
  }

  // ── echoOut: reverb send ramp + filter close on outgoing ──────

  private executeEchoOut(
    goingToB: boolean, duration: number,
    fromPlayer: DeckPlayer, toPlayer: DeckPlayer,
    toName: string, toAnalysis: TrackAnalysis, toDeck: 'A' | 'B', fromDeck: 'A' | 'B',
  ) {
    setReverbSend(0.8, duration * 0.3);
    sweepFilter(this.genre.sweepFloorHz * 1.5, duration * 0.5);

    const fromEQ = getDeckEQ(fromDeck);
    const ac = getAudioContext();
    const now = ac.currentTime;
    fromEQ.high.gain.setValueAtTime(0, now);
    fromEQ.high.gain.linearRampToValueAtTime(-12, now + duration * 0.6);

    setTimeout(() => {
      setReverbSend(0, duration * 0.3);
    }, duration * 0.7 * 1000);

    const switchDelay = duration * 0.4;
    setTimeout(() => {
      if (this._phase === 'blending') {
        this.startBeatLayer(toAnalysis, toDeck);
      }
    }, switchDelay * 1000);

    this.animateCrossfade(goingToB, duration, fromPlayer, toPlayer, toName, toAnalysis, toDeck);
  }

  // ── Vocal crossfade: hold both decks audible, late handoff ────

  private animateVocalCrossfade(
    goingToB: boolean,
    duration: number,
    fromPlayer: DeckPlayer,
    toPlayer: DeckPlayer,
    toName: string,
    toAnalysis: TrackAnalysis,
    toDeck: 'A' | 'B',
  ) {
    // During the first 70%, keep crossfader near center so both decks
    // stay audible (instruments of A + vocals of B). Then glide to B.
    const blendFrom = goingToB ? 0 : 1;
    const blendTo = goingToB ? 1 : 0;
    const midpoint = (blendFrom + blendTo) / 2;
    this._blendStartTime = performance.now() / 1000;
    this._blendDuration = duration;
    this._filterReleaseScheduled = false;

    this.log(`Vocal crossfade over ${duration.toFixed(1)}s`, 'system');

    const monitor = () => {
      const elapsed = performance.now() / 1000 - this._blendStartTime;
      const t = Math.min(1, elapsed / this._blendDuration);

      let cf: number;
      if (t < 0.65) {
        // Ease toward midpoint (both decks audible)
        const p = t / 0.65;
        const eased = p * p * (3 - 2 * p); // smoothstep
        cf = blendFrom + (midpoint - blendFrom) * eased;
      } else {
        // Glide from midpoint to target
        const p = (t - 0.65) / 0.35;
        const eased = p * p * (3 - 2 * p);
        cf = midpoint + (blendTo - midpoint) * eased;
      }

      this._blendProgress = t;
      this._crossfader = cf;
      setCrossfader(cf);
      this.emit();

      if (t >= 1) {
        fromPlayer.stop();
        this._activeDeck = goingToB ? 'B' : 'A';
        this._phase = goingToB ? 'playingB' : 'playingA';
        this._blendProgress = 0;
        this._crossfader = goingToB ? 1 : 0;
        setCrossfader(this._crossfader);

        toPlayer.setPlaybackRate(1);
        this._filterReleaseScheduled = false;
        this.resetDeckEQs();
        setReverbSend(0, 0.2);
        openFilter(Math.max(3.0, this._blendDuration * 0.45));
        openHighpass(Math.max(3.0, this._blendDuration * 0.45));

        this.startBeatLayer(toAnalysis, toDeck);

        this._wordplayPhrase = null;
        this.log(`Now playing: ${toName}`, goingToB ? 'b' : 'a');
        this._transitionInfo = '';
        this.emit();

        this.scheduleBlend();
        return;
      }

      this._animFrame = requestAnimationFrame(monitor);
    };
    this._animFrame = requestAnimationFrame(monitor);
  }

  // ── Shared crossfade animation ────────────────────────────────

  private animateCrossfade(
    goingToB: boolean,
    duration: number,
    fromPlayer: DeckPlayer,
    toPlayer: DeckPlayer,
    toName: string,
    toAnalysis: TrackAnalysis,
    toDeck: 'A' | 'B',
  ) {
    const blendFrom = goingToB ? 0 : 1;
    const blendTo = goingToB ? 1 : 0;
    this._blendStartTime = performance.now() / 1000;
    this._blendDuration = duration;
    this._filterReleaseScheduled = false;

    this.log(`Crossfading over ${duration.toFixed(1)}s`, 'system');

    const monitor = () => {
      const elapsed = performance.now() / 1000 - this._blendStartTime;
      const t = Math.min(1, elapsed / this._blendDuration);

      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

      this._blendProgress = t;
      this._crossfader = blendFrom + (blendTo - blendFrom) * eased;
      setCrossfader(this._crossfader);
      this.emit();

      const releaseStart = 0.74;
      if (t >= releaseStart && !this._filterReleaseScheduled) {
        this._filterReleaseScheduled = true;
        const blendTailSec = Math.max(0.05, (1 - t) * this._blendDuration);
        const postBlendAir = 2.8;
        openFilter(blendTailSec + postBlendAir);
        openHighpass(blendTailSec + postBlendAir);
      }

      if (t >= 1) {
        fromPlayer.stop();
        this._activeDeck = goingToB ? 'B' : 'A';
        this._phase = goingToB ? 'playingB' : 'playingA';
        this._blendProgress = 0;
        this._crossfader = goingToB ? 1 : 0;
        setCrossfader(this._crossfader);

        toPlayer.setPlaybackRate(1);

        if (!this._filterReleaseScheduled) {
          openFilter(Math.max(3.0, this._blendDuration * 0.45));
          openHighpass(Math.max(3.0, this._blendDuration * 0.45));
        }
        this._filterReleaseScheduled = false;

        this.resetDeckEQs();
        setReverbSend(0, 0.2);

        this.startBeatLayer(toAnalysis, toDeck);

        this._wordplayPhrase = null;
        this.log(`Now playing: ${toName}`, goingToB ? 'b' : 'a');
        this._transitionInfo = '';
        this.emit();

        this.scheduleBlend();
        return;
      }

      this._animFrame = requestAnimationFrame(monitor);
    };
    this._animFrame = requestAnimationFrame(monitor);
  }

  private emit() {
    const activeAnalysis = this._activeDeck === 'A' ? this.analysisA : this.analysisB;
    this.onChange({
      phase: this._phase,
      blendProgress: this._blendProgress,
      crossfaderPosition: this._crossfader,
      activeDeck: this._activeDeck,
      currentTrackName: this._activeDeck === 'A' ? this.nameA : this.nameB,
      currentBpm: activeAnalysis?.bpm ?? 0,
      transitionInfo: this._transitionInfo,
      transitionSegment: this._transitionSegment,
      wordplayPhrase: this._wordplayPhrase,
    });
  }
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
