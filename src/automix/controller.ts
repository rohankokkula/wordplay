import type { TrackAnalysis, AutomixPhase, LogEntry } from '../audio/types';
import { DeckPlayer } from '../audio/deckPlayer';
import { setCrossfader } from '../audio/mixer';
import { sweepFilter, openFilter, resetAllFX } from '../audio/effects';
import {
  blendDurationSec,
  transitionSegmentForOutgoingDeck,
} from './transitionPlan';

export interface AutomixState {
  phase: AutomixPhase;
  blendProgress: number;
  crossfaderPosition: number;
  activeDeck: 'A' | 'B';
  currentTrackName: string;
  currentBpm: number;
  transitionInfo: string;
  /** Outgoing deck only: crossfade window on the timeline (for waveform UI). */
  transitionSegment: {
    deck: 'A' | 'B';
    startSec: number;
    endSec: number;
  } | null;
}

type LogFn = (text: string, source: LogEntry['source']) => void;

// Cap playback rate change to ±6% to keep things sounding natural
const MAX_RATE_CHANGE = 0.06;

function clampRate(sourceBpm: number, targetBpm: number): number {
  const raw = targetBpm / sourceBpm;
  return Math.max(1 - MAX_RATE_CHANGE, Math.min(1 + MAX_RATE_CHANGE, raw));
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
  private _animFrame = 0;
  private _blendStartTime = 0;
  private _blendDuration = 0;
  private _transitionInfo = '';
  private _transitionSegment: AutomixState['transitionSegment'] = null;
  /** True once we've started the post-sweep filter reopen during this crossfade */
  private _filterReleaseScheduled = false;
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

  setBlendBeats(n: number) { this.blendBeats = n; }

  async start() {
    if (!this.analysisA || !this.analysisB) return;

    resetAllFX();

    // Both decks play at their natural rate initially — no pre-adjustment
    this.playerA.setPlaybackRate(1);
    this.playerB.setPlaybackRate(1);

    this.log(`Deck A: ${this.analysisA.bpm} BPM`, 'a');
    this.log(`Deck B: ${this.analysisB.bpm} BPM`, 'b');

    this.playerA.setVolume(1);
    this.playerB.setVolume(1);

    const entryB = this.pickEntryPoint(this.analysisB);
    this.playerB.seek(entryB.time);
    this.log(`Deck B entry: ${entryB.label} at ${fmtTime(entryB.time)}`, 'b');

    this._crossfader = 0;
    setCrossfader(0);
    this._activeDeck = 'A';
    this._phase = 'playingA';
    this._transitionInfo = '';
    this._transitionSegment = null;

    this.log(`Playing: ${this.nameA}`, 'a');
    this.logAnalysisSummary('A', this.analysisA);

    this.emit();

    if (!this.playerA.playing) await this.playerA.play();

    this.scheduleBlend();
  }

  stop() {
    this._phase = 'idle';
    this._blendProgress = 0;
    this._transitionInfo = '';
    this._transitionSegment = null;
    cancelAnimationFrame(this._animFrame);
    resetAllFX();
    this.emit();
  }

  private logAnalysisSummary(deck: string, a: TrackAnalysis) {
    const src = (deck === 'A' ? 'a' : 'b') as LogEntry['source'];
    this.log(`${a.bpm} BPM detected`, src);
    if (a.vocalSegments.length > 0) {
      this.log(`${a.vocalSegments.length} vocal section(s) found`, src);
      for (const seg of a.vocalSegments.slice(0, 3)) {
        this.log(`  Vocal: ${fmtTime(seg.start)} – ${fmtTime(seg.end)}`, src);
      }
    } else {
      this.log('No vocal sections detected (instrumental)', src);
    }
    this.log(`Drop at ${fmtTime(a.dropTime)}`, src);
  }

  private pickEntryPoint(a: TrackAnalysis) {
    if (a.cuePoints.length > 0) return a.cuePoints[0];
    return { time: a.firstBeatTime, label: 'First Beat' };
  }

  private detectWordplayTransition(
    analysisFrom: TrackAnalysis,
    analysisTo: TrackAnalysis,
    transitionTime: number,
  ): boolean {
    const win = analysisFrom.beatInterval * 2;
    const vocalEndingAtTransition = analysisFrom.vocalSegments.some(
      (s) => Math.abs(s.end - transitionTime) < win,
    );
    const vocalStartingOnTo = analysisTo.vocalSegments.some(
      (s) => s.start < analysisTo.firstBeatTime + win * 2,
    );
    return vocalEndingAtTransition && vocalStartingOnTo;
  }

  private scheduleBlend() {
    const activeAnalysis = this._activeDeck === 'A' ? this.analysisA! : this.analysisB!;
    const activePlayer = this._activeDeck === 'A' ? this.playerA : this.playerB;

    const ct = activePlayer.currentTime;
    const { startSec, endSec } = transitionSegmentForOutgoingDeck(
      activeAnalysis,
      ct,
      this.blendBeats,
    );
    const transitionPoint = startSec;
    const blendDuration = blendDurationSec(activeAnalysis, this.blendBeats);
    const toName = this._activeDeck === 'A' ? this.nameB : this.nameA;

    this._transitionSegment = {
      deck: this._activeDeck,
      startSec,
      endSec,
    };

    this._transitionInfo = `Transition at ${fmtTime(transitionPoint)} · ${this.blendBeats} beat blend · Next: ${toName}`;
    this.log(`Transition planned at ${fmtTime(transitionPoint)} (${this.blendBeats} beat blend)`, 'system');
    this.emit();

    const check = () => {
      if (this._phase !== 'playingA' && this._phase !== 'playingB') return;

      const ct = activePlayer.currentTime;
      const remaining = activePlayer.duration - ct;

      if (
        ct >= transitionPoint - 0.1 ||
        (remaining <= blendDuration + 0.5 && remaining > 0.5)
      ) {
        this.startBlend(blendDuration);
        return;
      }

      this._animFrame = requestAnimationFrame(check);
    };
    this._animFrame = requestAnimationFrame(check);
  }

  private async startBlend(blendDuration: number) {
    const goingToB = this._activeDeck === 'A';
    const fromAnalysis = goingToB ? this.analysisA! : this.analysisB!;
    const toAnalysis = goingToB ? this.analysisB! : this.analysisA!;
    const fromPlayer = goingToB ? this.playerA : this.playerB;
    const toPlayer = goingToB ? this.playerB : this.playerA;
    const toName = goingToB ? this.nameB : this.nameA;

    this._phase = 'blending';
    this._blendStartTime = performance.now() / 1000;
    this._blendDuration = blendDuration;
    this._transitionInfo = `Blending to ${toName}...`;

    this.emit();

    // Tempo match: gently adjust incoming deck toward outgoing BPM (capped at ±6%)
    const rate = clampRate(toAnalysis.bpm, fromAnalysis.bpm);
    toPlayer.setPlaybackRate(rate);

    const ratePct = ((rate - 1) * 100).toFixed(1);
    if (Math.abs(rate - 1) > 0.005) {
      this.log(`Tempo nudge: ${toAnalysis.bpm} → ${(toAnalysis.bpm * rate).toFixed(1)} BPM (${ratePct}%)`, 'system');
    } else {
      this.log(`BPMs close enough — no tempo change needed`, 'system');
    }

    const isWordplay = this.detectWordplayTransition(
      fromAnalysis, toAnalysis, fromPlayer.currentTime,
    );

    // Start incoming deck
    if (!toPlayer.playing) await toPlayer.play();

    const beatDur = fromAnalysis.beatInterval;

    if (isWordplay) {
      this.log('Wordplay transition — clean beat cut', 'system');
      this.log(`Hard cut to: ${toName}`, goingToB ? 'b' : 'a');
      this.animateCrossfade(goingToB, beatDur * 4, fromPlayer, toPlayer, toName);
    } else {
      // Gentle filter sweep on the outgoing track's last portion
      this.log('Smooth crossfade transition', 'system');
      sweepFilter(800, blendDuration * 0.6);

      this.animateCrossfade(goingToB, blendDuration, fromPlayer, toPlayer, toName);
    }
  }

  private animateCrossfade(
    goingToB: boolean,
    duration: number,
    fromPlayer: DeckPlayer,
    toPlayer: DeckPlayer,
    toName: string,
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

      // Smooth S-curve for natural-sounding crossfade
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

      this._blendProgress = t;
      this._crossfader = blendFrom + (blendTo - blendFrom) * eased;
      setCrossfader(this._crossfader);
      this.emit();

      // Begin reopening the lowpass in the last ~25% of the blend so highs return gradually
      // (avoids a perceived "volume jump" when openFilter ran in 0.5s after the sweep).
      const releaseStart = 0.74;
      if (t >= releaseStart && !this._filterReleaseScheduled) {
        this._filterReleaseScheduled = true;
        const blendTailSec = Math.max(0.05, (1 - t) * this._blendDuration);
        const postBlendAir = 2.8;
        openFilter(blendTailSec + postBlendAir);
      }

      if (t >= 1) {
        fromPlayer.stop();
        this._activeDeck = goingToB ? 'B' : 'A';
        this._phase = goingToB ? 'playingB' : 'playingA';
        this._blendProgress = 0;
        this._crossfader = goingToB ? 1 : 0;
        setCrossfader(this._crossfader);

        // Restore incoming deck to its natural rate
        toPlayer.setPlaybackRate(1);

        if (!this._filterReleaseScheduled) {
          openFilter(Math.max(3.0, this._blendDuration * 0.45));
        }
        this._filterReleaseScheduled = false;

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
    });
  }
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
