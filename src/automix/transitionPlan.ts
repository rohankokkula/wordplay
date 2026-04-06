import type { TrackAnalysis } from '../audio/types';
import type { WordMatch } from '../lyrics/types';

export interface TransitionPlan {
  startSec: number;
  endSec: number;
  isVocalTransition: boolean;
  incomingSeekTime: number;
  effectiveBlendBeats: number;
  matchedPhrase: string | null;
  style: 'eqCrossfade' | 'dropCut' | 'echoFade';
}

export interface TransitionSegment {
  startSec: number;
  endSec: number;
}

export interface TransitionPlanOptions {
  outgoingDeck?: 'A' | 'B';
  minIncomingTime?: number;
}

const PHRASE_BEATS = 32;

export function blendDurationSec(analysis: TrackAnalysis, blendBeats: number): number {
  return analysis.beatInterval * blendBeats;
}

export function autoBlendBeats(outgoing: TrackAnalysis): number {
  const ep = outgoing.energyProfile;
  if (ep.length < 2) return 32;
  let mean = 0;
  for (let i = 0; i < ep.length; i++) mean += ep[i];
  mean /= ep.length;
  let v = 0;
  for (let i = 0; i < ep.length; i++) {
    const d = ep[i] - mean;
    v += d * d;
  }
  v /= ep.length;
  const cv = mean > 1e-6 ? Math.sqrt(v) / mean : 0;
  return Math.round(64 - Math.min(1, cv / 0.45) * (64 - 16));
}

export function quantizeToPhrase(time: number, analysis: TrackAnalysis): number {
  if (analysis.beatTimes.length === 0) return time;
  const bi = analysis.beatInterval;
  let bestPhrase = analysis.beatTimes[0], bestPhraseDist = Infinity;
  let bestBeat = analysis.beatTimes[0], bestBeatDist = Infinity;
  for (let i = 0; i < analysis.beatTimes.length; i++) {
    const bt = analysis.beatTimes[i];
    const d = Math.abs(time - bt);
    if (d < bestBeatDist) { bestBeat = bt; bestBeatDist = d; }
    if (i % PHRASE_BEATS === 0 && d < bestPhraseDist) { bestPhrase = bt; bestPhraseDist = d; }
    if (bt > time + bi * PHRASE_BEATS) break;
  }
  return bestPhraseDist <= bi * PHRASE_BEATS * 0.5 ? bestPhrase : bestBeat;
}

export function findNearestBeatIndex(time: number, beatTimes: number[]): number {
  if (beatTimes.length === 0) return -1;
  const bi = beatTimes.length >= 2 ? beatTimes[1] - beatTimes[0] : 0.5;
  let best = 0, bestDist = Math.abs(time - beatTimes[0]);
  for (let i = 1; i < beatTimes.length; i++) {
    const d = Math.abs(time - beatTimes[i]);
    if (d < bestDist) { best = i; bestDist = d; }
    if (beatTimes[i] > time + bi) break;
  }
  return bestDist < bi * 0.5 ? best : -1;
}

function matchTimes(m: WordMatch, deck: 'A' | 'B'): { out: number; inc: number } {
  const a = m.phraseOnsetA ?? m.timeA, b = m.phraseOnsetB ?? m.timeB;
  return deck === 'A' ? { out: a, inc: b } : { out: b, inc: a };
}

function energyValleySec(a: TrackAnalysis): number | null {
  const ep = a.energyProfile;
  if (ep.length === 0) return null;
  const w = a.duration / ep.length;
  let bestI = Math.floor(ep.length * 0.5), bestE = Infinity;
  for (let i = bestI; i < ep.length; i++) {
    if (ep[i] < bestE) { bestE = ep[i]; bestI = i; }
  }
  return bestI * w;
}

function anchorsForWordplay(a: TrackAnalysis): number[] {
  const d = a.duration, xs: number[] = [];
  for (const s of a.vocalSegments) if (s.end >= d * 0.4) xs.push(s.end);
  const v = energyValleySec(a);
  if (v !== null) xs.push(v);
  return xs;
}

function clearDrop(a: TrackAnalysis): boolean {
  return a.dropTime > 0.5 && a.dropTime < a.duration - 0.5;
}

function defaultSeek(track: TrackAnalysis): number {
  if (clearDrop(track)) return track.dropTime;
  if (track.vocalHooks.length > 0) return track.vocalHooks[0].time;
  return track.firstBeatTime;
}

function transitionStyle(o: TrackAnalysis, i: TrackAnalysis): TransitionPlan['style'] {
  const g = Math.abs(o.bpm - i.bpm);
  if (g > 8) return 'echoFade';
  if (clearDrop(i) && g < 3) return 'dropCut';
  return 'eqCrossfade';
}

function vocalGapExit(o: TrackAnalysis, blendDur: number): number | null {
  const d = o.duration, minE = d * 0.4;
  for (const s of [...o.vocalSegments].sort((a, b) => a.end - b.end)) {
    if (s.end < minE) continue;
    const q = quantizeToPhrase(s.end, o);
    if (q + blendDur <= d - 0.02) return q;
  }
  return null;
}

function bestWordplay(
  o: TrackAnalysis,
  matches: WordMatch[],
  blendDur: number,
  deck: 'A' | 'B',
  anchors: number[],
): WordMatch | null {
  if (!matches.length || !anchors.length) return null;
  const d = o.duration, bi = o.beatInterval, near = bi * 16;
  let best: WordMatch | null = null, bestScore = Infinity;
  for (const m of matches) {
    const outT = matchTimes(m, deck).out;
    if (outT < d * 0.4 || outT + blendDur > d - 0.05) continue;
    let da = Infinity;
    for (const x of anchors) da = Math.min(da, Math.abs(outT - x));
    if (da > near) continue;
    const phraseDist = Math.abs(outT - quantizeToPhrase(outT, o));
    const score = da * 100 + phraseDist;
    if (score < bestScore) { bestScore = score; best = m; }
  }
  return best;
}

function buildPlan(
  start: number,
  o: TrackAnalysis,
  i: TrackAnalysis,
  beats: number,
  kind: 'vocalGap' | 'valley' | 'wordplay' | 'fallback',
  wm: WordMatch | null,
  deck: 'A' | 'B',
  floor: number,
): TransitionPlan {
  const vocal = kind === 'vocalGap' || kind === 'wordplay';
  const eff = kind === 'wordplay' ? Math.min(beats, 16) : beats;
  const bd = blendDurationSec(o, eff);
  let seek: number;
  if (kind === 'wordplay' && wm) {
    const inc = matchTimes(wm, deck).inc;
    const lead = Math.min(3, Math.max(2, o.beatInterval * 2));
    seek = Math.max(floor, inc - lead);
  } else seek = Math.max(floor, defaultSeek(i));
  return {
    startSec: start,
    endSec: Math.min(o.duration, start + bd),
    isVocalTransition: vocal,
    incomingSeekTime: seek,
    effectiveBlendBeats: eff,
    matchedPhrase: wm ? wm.phrase : null,
    style: transitionStyle(o, i),
  };
}

export function pickTransitionPlan(
  outgoing: TrackAnalysis,
  incoming: TrackAnalysis,
  wordMatches: WordMatch[] | undefined,
  blendBeats?: number,
  opts?: TransitionPlanOptions,
): TransitionPlan {
  const beats = blendBeats ?? autoBlendBeats(outgoing);
  const blendDur = blendDurationSec(outgoing, beats);
  const floor = Math.max(0, opts?.minIncomingTime ?? 0);
  const deck = opts?.outgoingDeck ?? 'A';

  const vg = vocalGapExit(outgoing, blendDur);
  if (vg !== null) return buildPlan(vg, outgoing, incoming, beats, 'vocalGap', null, deck, floor);

  const vr = energyValleySec(outgoing);
  if (vr !== null) {
    const qv = quantizeToPhrase(vr, outgoing);
    if (qv + blendDur <= outgoing.duration - 0.02) {
      return buildPlan(qv, outgoing, incoming, beats, 'valley', null, deck, floor);
    }
  }

  const ax = anchorsForWordplay(outgoing);
  const wp = wordMatches?.length ? bestWordplay(outgoing, wordMatches, blendDur, deck, ax) : null;
  if (wp) {
    const q = quantizeToPhrase(matchTimes(wp, deck).out, outgoing);
    if (q + blendDur <= outgoing.duration - 0.02) {
      return buildPlan(q, outgoing, incoming, beats, 'wordplay', wp, deck, floor);
    }
  }

  const fb = quantizeToPhrase(outgoing.duration * 0.75, outgoing);
  return buildPlan(fb, outgoing, incoming, beats, 'fallback', null, deck, floor);
}

export function transitionSegmentForOutgoingDeck(
  outgoing: TrackAnalysis,
  incoming: TrackAnalysis,
  wordMatches: WordMatch[] | undefined,
  blendBeats?: number,
  opts?: TransitionPlanOptions,
): TransitionPlan {
  return pickTransitionPlan(outgoing, incoming, wordMatches, blendBeats, opts);
}
