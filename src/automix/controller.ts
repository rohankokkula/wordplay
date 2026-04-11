import type { TrackAnalysis, AutomixPhase, LogEntry } from '../audio/types';
import type { WordMatch } from '../lyrics/types';
import { DeckPlayer } from '../audio/deckPlayer';
import { setCrossfader, getDeckEQ, getAudioContext } from '../audio/mixer';
import {
  sweepFilter, openFilter, resetAllFX,
  sweepHighpass, openHighpass, setReverbSend,
} from '../audio/effects';
import { VocalFXEngine } from '../audio/vocalFX';
import {
  blendDurationSec,
  transitionSegmentForOutgoingDeck,
  type TransitionPlan,
  autoBlendBeats,
} from './transitionPlan';

export type TransitionSegment = {
  deck: 'A' | 'B';
  startSec: number;
  endSec: number;
};

export interface AutomixState {
  phase: AutomixPhase;
  blendProgress: number;
  crossfaderPosition: number;
  activeDeck: 'A' | 'B';
  currentTrackName: string;
  currentBpm: number;
  transitionInfo: string;
  transitionSegment: TransitionSegment | null;
  wordplayPhrase: string | null;
  wordMatches: WordMatch[];
  log: LogEntry[];
}

let logIdCounter = 0;

export function clampRate(sourceBpm: number, targetBpm: number, maxChange = 0.06): number {
  const raw = targetBpm / sourceBpm;
  return Math.max(1 - maxChange, Math.min(1 + maxChange, raw));
}

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class AutomixController {
  playerA: DeckPlayer;
  playerB: DeckPlayer;
  analysisA: TrackAnalysis | null = null;
  analysisB: TrackAnalysis | null = null;
  nameA = '';
  nameB = '';
  private _phase: AutomixPhase = 'idle';
  private _crossfader = 0;
  private _activeDeck: 'A' | 'B' = 'A';
  private _blendProgress = 0;
  private _blendStartTime = 0;
  private _blendDuration = 0;
  private _transitionInfo = '';
  private _transitionSegment: TransitionSegment | null = null;
  private _wordplayPhrase: string | null = null;
  private _wordMatches: WordMatch[] = [];
  private _animFrame = 0;
  private _vocalFXA: VocalFXEngine | null = null;
  private _vocalFXB: VocalFXEngine | null = null;
  private _lastPlayedA = 0;
  private _lastPlayedB = 0;
  private _log: LogEntry[] = [];
  private _listeners = new Set<() => void>();
  private _blendBeats = 32;
  private _mixStartPerf = 0;

  constructor() {
    this.playerA = new DeckPlayer('A');
    this.playerB = new DeckPlayer('B');
  }

  subscribe(fn: () => void): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  private emit() {
    for (const fn of this._listeners) fn();
  }

  setAnalysis(deck: 'A' | 'B', analysis: TrackAnalysis, name: string) {
    if (deck === 'A') {
      this.analysisA = analysis;
      this.nameA = name;
    } else {
      this.analysisB = analysis;
      this.nameB = name;
    }
  }

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

  setWordMatches(matches: WordMatch[]) {
    this._wordMatches = matches;
    if (this._phase === 'playingA' || this._phase === 'playingB') {
      cancelAnimationFrame(this._animFrame);
      this.scheduleBlend();
    }
    this.emit();
  }

  setBlendBeats(n: number) {
    this._blendBeats = n;
  }

  log(msg: string, source: LogEntry['source']) {
    const elapsed = this._mixStartPerf > 0 ? performance.now() / 1000 - this._mixStartPerf : 0;
    this._log.push({
      id: logIdCounter++,
      time: Math.max(0, elapsed),
      text: msg,
      source,
    });
    this.emit();
  }

  getState(): AutomixState {
    const activeAnalysis = this._activeDeck === 'A' ? this.analysisA : this.analysisB;
    return {
      phase: this._phase,
      blendProgress: this._blendProgress,
      crossfaderPosition: this._crossfader,
      activeDeck: this._activeDeck,
      currentTrackName: this._activeDeck === 'A' ? this.nameA : this.nameB,
      currentBpm: activeAnalysis?.bpm ?? 0,
      transitionInfo: this._transitionInfo,
      transitionSegment: this._transitionSegment,
      wordplayPhrase: this._wordplayPhrase,
      wordMatches: this._wordMatches,
      log: this._log,
    };
  }

  async start() {
    if (!this.analysisA || !this.analysisB) return;

    this._mixStartPerf = performance.now() / 1000;
    this._log = [];
    resetAllFX();
    this.resetDeckEQs();

    this.playerA.setPlaybackRate(1);
    this.playerB.setPlaybackRate(1);
    this.playerA.setVolume(1);
    this.playerB.setVolume(1);

    const suggested = autoBlendBeats(this.analysisA);
    if (this._blendBeats === 32 && suggested !== 32) {
      this.log(`Auto blend suggestion: ${suggested} beats (energy); UI length ${this._blendBeats}`, 'system');
    }

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

    this.startVocalFX();

    if (!this.playerA.playing) await this.playerA.play();

    this.scheduleBlend();
  }

  stop() {
    this._phase = 'idle';
    this._blendProgress = 0;
    this._transitionInfo = '';
    this._transitionSegment = null;
    this._wordplayPhrase = null;
    this._mixStartPerf = 0;
    cancelAnimationFrame(this._animFrame);
    this._animFrame = 0;
    resetAllFX();
    this.resetDeckEQs();
    this.stopVocalFX();
    this.playerA.stop();
    this.playerB.stop();
    this.emit();
  }

  resetDeckEQs() {
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

  startVocalFX() {
    this.stopVocalFX();
    const bufA = this.playerA.audioBuffer;
    const bufB = this.playerB.audioBuffer;
    if (this.analysisA && bufA) {
      this._vocalFXA = new VocalFXEngine(
        this.analysisA,
        bufA,
        () => this.playerA.currentTime,
        'A',
      );
      this._vocalFXA.start();
    }
    if (this.analysisB && bufB) {
      this._vocalFXB = new VocalFXEngine(
        this.analysisB,
        bufB,
        () => this.playerB.currentTime,
        'B',
      );
      this._vocalFXB.start();
    }
  }

  stopVocalFX() {
    this._vocalFXA?.stop();
    this._vocalFXA = null;
    this._vocalFXB?.stop();
    this._vocalFXB = null;
  }

  private getVocalFX(deck: 'A' | 'B'): VocalFXEngine | null {
    return deck === 'A' ? this._vocalFXA : this._vocalFXB;
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
      this.log(
        `${a.vocalHooks.length} hook point(s) at ${a.vocalHooks.map((h) => fmtTime(h.time)).join(', ')}`,
        src,
      );
    }
    this.log(`Drop at ${fmtTime(a.dropTime)}`, src);
  }

  private scheduleBlend() {
    cancelAnimationFrame(this._animFrame);

    const activeAnalysis = this._activeDeck === 'A' ? this.analysisA! : this.analysisB!;
    const incomingAnalysis = this._activeDeck === 'A' ? this.analysisB! : this.analysisA!;
    const activePlayer = this._activeDeck === 'A' ? this.playerA : this.playerB;
    const incomingPlayer = this._activeDeck === 'A' ? this.playerB : this.playerA;

    const ct = activePlayer.currentTime;
    const incFloor = this._activeDeck === 'A' ? this._lastPlayedB : this._lastPlayedA;

    const plan = transitionSegmentForOutgoingDeck(
      activeAnalysis,
      incomingAnalysis,
      this._wordMatches,
      this._blendBeats,
      { outgoingDeck: this._activeDeck, minIncomingTime: incFloor },
    );

    const transitionPoint = plan.startSec;
    const blendDuration = blendDurationSec(activeAnalysis, plan.effectiveBlendBeats);
    const toName = this._activeDeck === 'A' ? this.nameB : this.nameA;

    incomingPlayer.seek(plan.incomingSeekTime);

    this._transitionSegment = {
      deck: this._activeDeck,
      startSec: plan.startSec,
      endSec: plan.endSec,
    };

    const transType = plan.matchedPhrase
      ? `wordplay "${plan.matchedPhrase}"`
      : plan.isVocalTransition
        ? 'vocal blend'
        : `${plan.style} mix`;

    this._transitionInfo = `Transition at ${fmtTime(transitionPoint)} · ${plan.effectiveBlendBeats} beat ${transType} · Next: ${toName}`;

    if (plan.matchedPhrase) {
      this._wordplayPhrase = plan.matchedPhrase;
      this.log(`WORDPLAY: "${plan.matchedPhrase}" at ${fmtTime(transitionPoint)}`, 'system');
      this.log(`Incoming seeks to ${fmtTime(plan.incomingSeekTime)}`, 'system');
    } else if (plan.isVocalTransition) {
      this.log(`Vocal-aligned transition at ${fmtTime(transitionPoint)} (${plan.style})`, 'system');
    } else {
      this.log(`Transition planned at ${fmtTime(transitionPoint)} (${plan.style})`, 'system');
    }
    this.emit();

    const check = () => {
      if (this._phase !== 'playingA' && this._phase !== 'playingB') return;

      const cur = activePlayer.currentTime;
      const remaining = activePlayer.duration - cur;
      const startDue = cur >= transitionPoint - 0.08;
      const nearEnd = remaining <= blendDuration + 0.5 && remaining > 0.5;

      if (startDue || nearEnd) {
        void this.startBlend(plan);
        return;
      }

      this._animFrame = requestAnimationFrame(check);
    };
    this._animFrame = requestAnimationFrame(check);
  }

  private async startBlend(plan: TransitionPlan) {
    cancelAnimationFrame(this._animFrame);
    this._animFrame = 0;

    const goingToB = this._activeDeck === 'A';
    const fromAnalysis = goingToB ? this.analysisA! : this.analysisB!;
    const toAnalysis = goingToB ? this.analysisB! : this.analysisA!;
    const fromPlayer = goingToB ? this.playerA : this.playerB;
    const toPlayer = goingToB ? this.playerB : this.playerA;
    const toName = goingToB ? this.nameB : this.nameA;
    const toDeck: 'A' | 'B' = goingToB ? 'B' : 'A';
    const fromDeck: 'A' | 'B' = goingToB ? 'A' : 'B';

    if (goingToB) this._lastPlayedA = fromPlayer.currentTime;
    else this._lastPlayedB = fromPlayer.currentTime;

    const blendDuration = blendDurationSec(fromAnalysis, plan.effectiveBlendBeats);
    const style = plan.style;

    this._phase = 'blending';
    this._blendStartTime = performance.now() / 1000;
    this._blendDuration = blendDuration;
    this._transitionInfo = `Blending to ${toName} (${style})…`;
    this.emit();

    const rate = clampRate(toAnalysis.bpm, fromAnalysis.bpm, 0.06);
    toPlayer.setPlaybackRate(rate);
    if (Math.abs(rate - 1) > 0.005) {
      this.log(`Tempo nudge: ${toAnalysis.bpm} → ${(toAnalysis.bpm * rate).toFixed(1)} BPM`, 'system');
    }

    if (!toPlayer.playing) await toPlayer.play();

    this.log(`Style: ${style}`, 'system');

    switch (style) {
      case 'eqCrossfade':
        await this.animateEQCrossfade(
          goingToB,
          blendDuration,
          fromPlayer,
          toPlayer,
          toName,
          toAnalysis,
          toDeck,
          fromDeck,
        );
        break;
      case 'dropCut':
        await this.executeDropCut(goingToB, blendDuration, fromPlayer, toPlayer, toName, toDeck, fromDeck);
        break;
      case 'echoFade':
        await this.executeEchoFade(
          goingToB,
          blendDuration,
          fromPlayer,
          toPlayer,
          toName,
          toDeck,
          fromDeck,
        );
        break;
      default:
        await this.animateEQCrossfade(
          goingToB,
          blendDuration,
          fromPlayer,
          toPlayer,
          toName,
          toAnalysis,
          toDeck,
          fromDeck,
        );
    }
  }

  /**
   * EQ crossfade: both decks audible throughout.
   * Crossfader snaps to center immediately so both are heard,
   * then EQ bands swap (bass first, then mids, then highs),
   * and crossfader commits to the incoming deck at the end.
   */
  private animateEQCrossfade(
    goingToB: boolean,
    blendDuration: number,
    fromPlayer: DeckPlayer,
    toPlayer: DeckPlayer,
    toName: string,
    toAnalysis: TrackAnalysis,
    toDeck: 'A' | 'B',
    fromDeck: 'A' | 'B',
  ): Promise<void> {
    const fromEQ = getDeckEQ(fromDeck);
    const toEQ = getDeckEQ(toDeck);
    const blendTo = goingToB ? 1 : 0;

    this._blendStartTime = performance.now() / 1000;
    this._blendDuration = blendDuration;

    const ac = getAudioContext();
    const t0 = ac.currentTime;

    // Both decks at equal power from the start — incoming is audible immediately
    this._crossfader = 0.5;
    setCrossfader(0.5);

    // Incoming starts with bass cut, outgoing at full EQ
    fromEQ.low.gain.setValueAtTime(0, t0);
    fromEQ.mid.gain.setValueAtTime(0, t0);
    fromEQ.high.gain.setValueAtTime(0, t0);
    toEQ.low.gain.setValueAtTime(-18, t0);
    toEQ.mid.gain.setValueAtTime(-6, t0);
    toEQ.high.gain.setValueAtTime(-3, t0);

    toPlayer.setVolume(1);

    this.log(`EQ crossfade (${blendDuration.toFixed(1)}s)`, 'system');

    return new Promise((resolve) => {
      const step = () => {
        const elapsed = performance.now() / 1000 - this._blendStartTime;
        const t = Math.min(1, elapsed / blendDuration);
        this._blendProgress = t;

        // Phase 1 (0-50%): swap bass — outgoing loses bass, incoming gains it
        const bT = Math.min(1, t / 0.5);
        const bE = smoothstep(bT);
        fromEQ.low.gain.setValueAtTime(lerp(0, -24, bE), ac.currentTime);
        toEQ.low.gain.setValueAtTime(lerp(-18, 0, bE), ac.currentTime);

        // Phase 2 (25-75%): swap mids + add reverb tail on outgoing
        if (t >= 0.25) {
          const mT = Math.min(1, (t - 0.25) / 0.5);
          const mE = smoothstep(mT);
          fromEQ.mid.gain.setValueAtTime(lerp(0, -18, mE), ac.currentTime);
          toEQ.mid.gain.setValueAtTime(lerp(-6, 0, mE), ac.currentTime);
          const revCurve = mE * 0.5 * (1 - Math.max(0, (t - 0.65) / 0.2));
          setReverbSend(Math.max(0, revCurve), 0.02);
        }

        // Phase 3 (50-100%): swap highs + move crossfader from center to incoming
        if (t >= 0.5) {
          const hT = (t - 0.5) / 0.5;
          const hE = smoothstep(hT);
          fromEQ.high.gain.setValueAtTime(lerp(0, -15, hE), ac.currentTime);
          toEQ.high.gain.setValueAtTime(lerp(-3, 0, hE), ac.currentTime);
          const cf = lerp(0.5, blendTo, hE);
          this._crossfader = cf;
          setCrossfader(cf);
        }

        this.emit();

        if (t >= 1) {
          this.finalizeBlend(goingToB, fromPlayer, toPlayer, toName, toAnalysis, toDeck);
          resolve();
          return;
        }
        this._animFrame = requestAnimationFrame(step);
      };
      this._animFrame = requestAnimationFrame(step);
    });
  }

  private executeDropCut(
    goingToB: boolean,
    blendDuration: number,
    fromPlayer: DeckPlayer,
    toPlayer: DeckPlayer,
    toName: string,
    toDeck: 'A' | 'B',
    fromDeck: 'A' | 'B',
  ): Promise<void> {
    const blendTo = goingToB ? 1 : 0;
    const sweepDur = Math.min(0.28, Math.max(0.12, blendDuration * 0.2));

    this.log(`Drop cut (sweep ${sweepDur.toFixed(2)}s)`, 'system');
    sweepFilter(380, sweepDur);

    return new Promise((resolve) => {
      window.setTimeout(() => {
        if (this._phase !== 'blending') {
          resolve();
          return;
        }
        fromPlayer.stop();
        this._crossfader = blendTo;
        setCrossfader(blendTo);
        openFilter(0.12);
        openHighpass(0.12);
        setReverbSend(0, 0.05);
        const toAnalysis = goingToB ? this.analysisB! : this.analysisA!;
        this.finalizeBlend(goingToB, fromPlayer, toPlayer, toName, toAnalysis, toDeck);
        resolve();
      }, sweepDur * 1000 + 15);
    });
  }

  private executeEchoFade(
    goingToB: boolean,
    blendDuration: number,
    fromPlayer: DeckPlayer,
    toPlayer: DeckPlayer,
    toName: string,
    toDeck: 'A' | 'B',
    fromDeck: 'A' | 'B',
  ): Promise<void> {
    const toAnalysis = goingToB ? this.analysisB! : this.analysisA!;
    const blendTo = goingToB ? 1 : 0;

    const fromVFX = this.getVocalFX(fromDeck);
    fromVFX?.triggerTransitionReverb(blendDuration * 0.55);
    setReverbSend(0.72, blendDuration * 0.15);

    // Both decks audible: crossfader at center, incoming fades in via volume
    this._crossfader = 0.5;
    setCrossfader(0.5);
    toPlayer.setVolume(0);
    toPlayer.rampVolume(1, blendDuration * 0.7);

    this._blendStartTime = performance.now() / 1000;
    this._blendDuration = blendDuration;

    this.log(`Echo fade (${blendDuration.toFixed(1)}s)`, 'system');

    return new Promise((resolve) => {
      const tick = () => {
        const elapsed = performance.now() / 1000 - this._blendStartTime;
        const u = Math.min(1, elapsed / blendDuration);
        this._blendProgress = u;
        const eased = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;

        // Move crossfader from center to incoming in second half
        if (u >= 0.4) {
          const cfT = (u - 0.4) / 0.6;
          this._crossfader = lerp(0.5, blendTo, smoothstep(cfT));
          setCrossfader(this._crossfader);
        }

        const ac = getAudioContext();
        const now = ac.currentTime;
        const fromEQ = getDeckEQ(fromDeck);
        fromEQ.high.gain.setValueAtTime(lerp(0, -12, eased), now);
        fromEQ.mid.gain.setValueAtTime(lerp(0, -8, eased), now);

        this.emit();

        if (u >= 1) {
          setReverbSend(0, 0.2);
          this.finalizeBlend(goingToB, fromPlayer, toPlayer, toName, toAnalysis, toDeck);
          resolve();
          return;
        }
        this._animFrame = requestAnimationFrame(tick);
      };
      this._animFrame = requestAnimationFrame(tick);
    });
  }

  private finalizeBlend(
    goingToB: boolean,
    fromPlayer: DeckPlayer,
    toPlayer: DeckPlayer,
    toName: string,
    _toAnalysis: TrackAnalysis,
    toDeck: 'A' | 'B',
  ) {
    cancelAnimationFrame(this._animFrame);
    this._animFrame = 0;

    fromPlayer.stop();
    this._activeDeck = goingToB ? 'B' : 'A';
    this._phase = goingToB ? 'playingB' : 'playingA';
    this._blendProgress = 0;
    this._crossfader = goingToB ? 1 : 0;
    setCrossfader(this._crossfader);

    toPlayer.setPlaybackRate(1);
    toPlayer.setVolume(1);

    this.resetDeckEQs();
    setReverbSend(0, 0.2);
    openFilter(Math.max(2.5, this._blendDuration * 0.4));
    openHighpass(Math.max(2.5, this._blendDuration * 0.4));

    this._wordplayPhrase = null;
    this._transitionInfo = '';
    this.log(`Now playing: ${toName}`, goingToB ? 'b' : 'a');
    this.emit();

    this.scheduleBlend();
  }
}
