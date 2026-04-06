import type { TrackAnalysis } from '../audio/types';
import type { GenreId } from '../genre/genrePresets';
import type { WordMatch } from '../lyrics/types';
import { GENRE_PRESETS } from '../genre/genrePresets';

export function blendDurationSec(
  analysis: TrackAnalysis,
  blendBeats: number,
  genreId: GenreId = 'neutral',
): number {
  const base = analysis.beatInterval * blendBeats;
  return base * GENRE_PRESETS[genreId].blendDurationScale;
}

const PHRASE_BEATS = 32;

function quantizeToPhrase(time: number, analysis: TrackAnalysis): number {
  if (analysis.beatTimes.length === 0) return time;

  let bestPhrase = analysis.beatTimes[0];
  let bestPhraseDist = Infinity;
  let bestBeat = analysis.beatTimes[0];
  let bestBeatDist = Infinity;

  for (let i = 0; i < analysis.beatTimes.length; i++) {
    const bt = analysis.beatTimes[i];
    const d = Math.abs(time - bt);

    if (d < bestBeatDist) {
      bestBeat = bt;
      bestBeatDist = d;
    }

    if (i % PHRASE_BEATS === 0 && d < bestPhraseDist) {
      bestPhrase = bt;
      bestPhraseDist = d;
    }

    if (bt > time + analysis.beatInterval * PHRASE_BEATS) break;
  }

  const phraseWindow = analysis.beatInterval * PHRASE_BEATS * 0.5;
  if (bestPhraseDist <= phraseWindow) return bestPhrase;
  return bestBeat;
}

/**
 * Find the best vocal hook on the incoming track to seek to.
 * Returns the hook time, or the first vocal start, or firstBeatTime.
 */
export function pickIncomingEntryForVocalBlend(incoming: TrackAnalysis): number {
  if (incoming.vocalHooks.length > 0) {
    return incoming.vocalHooks[0].time;
  }
  if (incoming.vocalSegments.length > 0) {
    return incoming.vocalSegments[0].start;
  }
  return incoming.firstBeatTime;
}

export interface TransitionPlan {
  startSec: number;
  endSec: number;
  isVocalTransition: boolean;
  incomingSeekTime: number;
  effectiveBlendBeats: number;
  /** The matched lyric phrase that triggered this transition (e.g. "tum se"). */
  matchedPhrase?: string;
}

/**
 * Pick the transition point. The core logic:
 *
 * 1. VOCAL HOOK PRIORITY — If the outgoing track has vocal hooks detected,
 *    try to transition at the START of a hook (where "Tum se" lives).
 *    This creates a vocal-to-vocal handoff where both tracks are singing
 *    the same type of phrase. The crossfade is SHORT (8 beats) so it
 *    sounds like a deliberate mashup, not a muddy overlap.
 *
 * 2. VOCAL ENDING — If no hook aligns, transition at the END of a vocal
 *    section (the old behavior) for a clean gap.
 *
 * 3. ENERGY VALLEY — Fallback: pick a low-energy, phrase-aligned moment.
 */
function matchTimesForDeck(m: WordMatch, outgoingDeck: 'A' | 'B'): { out: number; inc: number } {
  const a = m.phraseOnsetA ?? m.timeA;
  const b = m.phraseOnsetB ?? m.timeB;
  if (outgoingDeck === 'A') {
    return { out: a, inc: b };
  }
  return { out: b, inc: a };
}

export function pickTransitionPlan(
  outgoing: TrackAnalysis,
  currentTime: number,
  blendBeats: number,
  genreId: GenreId = 'neutral',
  incoming?: TrackAnalysis,
  wordMatches?: WordMatch[],
  outgoingDeck: 'A' | 'B' = 'A',
  /** Never seek the incoming deck before this time (where it last stopped). */
  minIncomingTime = 0,
): TransitionPlan {
  const blendDur = blendDurationSec(outgoing, blendBeats, genreId);
  const vocalBlendBeats = Math.min(blendBeats, 8);
  const floor = Math.max(0, minIncomingTime);

  // ── Strategy 0: Word-match (highest priority — the "Wordplay" transition) ──
  // Seek the incoming track to 2-3 seconds BEFORE the matched phrase so the
  // genre instrumental plays for a beat or two, then the vocal swaps in naturally.
  // The floor only prevents seeking to literally 0:00 — any non-zero timestamp
  // is valid for creative back-and-forth wordplay jumps.
  if (wordMatches && wordMatches.length > 0) {
    const wordBlendBeats = Math.min(blendBeats, 4);
    const wordDur = blendDurationSec(outgoing, wordBlendBeats, genreId);
    const bi = outgoing.beatInterval;
    const leadInSec = Math.max(2.0, bi * 4);

    const mapped = wordMatches.map((m) => ({ m, ...matchTimesForDeck(m, outgoingDeck) }));
    const ordered = [...mapped].sort((a, b) => a.out - b.out);

    for (const { m, out: outTime } of ordered) {
      if (outTime < currentTime - 0.2) continue;
      if (outTime > outgoing.duration - wordDur) continue;

      const normPhrase = m.phrase.toLowerCase();
      // Allow any incoming timestamp > 5 seconds (blocks only true start-of-track)
      const safeFloor = Math.max(5, floor);
      const incCandidates = mapped
        .filter((c) => c.m.phrase.toLowerCase() === normPhrase && c.inc > safeFloor)
        .map((c) => c.inc);

      if (incCandidates.length === 0) {
        console.log(`[wordplay] phrase="${m.phrase}" outTime=${outTime.toFixed(2)} — no inc candidates past floor ${safeFloor.toFixed(2)}, skipping`);
        continue;
      }

      const incTime = incCandidates[Math.floor(Math.random() * incCandidates.length)];
      const seekTo = Math.max(safeFloor, incTime - leadInSec);

      console.log(
        `[wordplay] phrase="${m.phrase}" outTime=${outTime.toFixed(2)} floor=${safeFloor.toFixed(2)} ` +
        `incCandidates=[${incCandidates.map(t => t.toFixed(2)).join(',')}] ` +
        `picked=${incTime.toFixed(2)} seekTo=${seekTo.toFixed(2)} (lead-in ${(incTime - seekTo).toFixed(1)}s)`,
      );

      return {
        startSec: outTime,
        endSec: Math.min(outgoing.duration, outTime + wordDur),
        isVocalTransition: true,
        incomingSeekTime: seekTo,
        effectiveBlendBeats: wordBlendBeats,
        matchedPhrase: m.phrase,
      };
    }

    console.log(`[wordplay] all cues past or no valid inc times (floor=${floor.toFixed(2)}), falling through`);
  }

  // ── Strategy 1: Vocal hook on outgoing track ──
  if (outgoing.vocalHooks.length > 0 && incoming) {
    const incomingHasVocals = incoming.vocalSegments.length > 0;

    if (incomingHasVocals) {
      for (const hook of outgoing.vocalHooks) {
        if (hook.time <= currentTime + 2) continue;
        if (hook.time > outgoing.duration - blendDur * 0.5) continue;

        const hookPhrase = quantizeToPhrase(hook.time, outgoing);
        const rawEntry = pickIncomingEntryForVocalBlend(incoming);
        const vocalDur = blendDurationSec(outgoing, vocalBlendBeats, genreId);

        return {
          startSec: hookPhrase,
          endSec: Math.min(outgoing.duration, hookPhrase + vocalDur),
          isVocalTransition: true,
          incomingSeekTime: Math.max(floor, rawEntry),
          effectiveBlendBeats: vocalBlendBeats,
        };
      }
    }
  }

  // ── Strategy 2: End of a vocal section (clean gap transition) ──
  for (const seg of outgoing.vocalSegments) {
    if (seg.end > currentTime + 2 && seg.end < outgoing.duration - blendDur) {
      const exitTime = quantizeToPhrase(seg.end, outgoing);
      const rawEntry = incoming
        ? pickIncomingEntryForVocalBlend(incoming)
        : 0;

      return {
        startSec: exitTime,
        endSec: Math.min(outgoing.duration, exitTime + blendDur),
        isVocalTransition: false,
        incomingSeekTime: Math.max(floor, rawEntry),
        effectiveBlendBeats: blendBeats,
      };
    }
  }

  // ── Strategy 3: Energy valley / phrase boundary fallback ──
  const windowDur = outgoing.duration / outgoing.energyProfile.length;
  const currentIdx = Math.floor(currentTime / windowDur);
  const endIdx = outgoing.energyProfile.length - Math.ceil(blendDur / windowDur);

  let bestIdx = -1;
  let bestScore = Infinity;

  for (let i = currentIdx + 4; i < endIdx; i++) {
    const e = outgoing.energyProfile[i];
    const falling = i > 0 && outgoing.energyProfile[i] < outgoing.energyProfile[i - 1];

    let score = e + (falling ? -0.15 : 0);

    const candidateTime = i * windowDur;
    const beatIdx = findNearestBeatIndex(candidateTime, outgoing);
    if (beatIdx >= 0 && beatIdx % PHRASE_BEATS === 0) score -= 0.25;
    else if (beatIdx >= 0 && beatIdx % 4 === 0) score -= 0.08;

    if (incoming) {
      const inWindowDur = incoming.duration / incoming.energyProfile.length;
      const entryIdx = Math.min(
        Math.floor(incoming.firstBeatTime / inWindowDur) + 2,
        incoming.energyProfile.length - 1,
      );
      if (entryIdx > 0 && incoming.energyProfile[entryIdx] > incoming.energyProfile[entryIdx - 1]) {
        score -= 0.1;
      }
    }

    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  const exitTime = bestIdx >= 0
    ? quantizeToPhrase(bestIdx * windowDur, outgoing)
    : quantizeToPhrase(Math.max(currentTime + 2, outgoing.duration - blendDur), outgoing);

  const rawEntry = incoming
    ? pickIncomingEntryForVocalBlend(incoming)
    : 0;

  return {
    startSec: exitTime,
    endSec: Math.min(outgoing.duration, exitTime + blendDur),
    isVocalTransition: false,
    incomingSeekTime: Math.max(floor, rawEntry),
    effectiveBlendBeats: blendBeats,
  };
}

function findNearestBeatIndex(time: number, a: TrackAnalysis): number {
  if (a.beatTimes.length === 0) return -1;
  let best = 0;
  let bestDist = Math.abs(time - a.beatTimes[0]);
  for (let i = 1; i < a.beatTimes.length; i++) {
    const d = Math.abs(time - a.beatTimes[i]);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
    if (a.beatTimes[i] > time + a.beatInterval) break;
  }
  return bestDist < a.beatInterval * 0.5 ? best : -1;
}

export function transitionSegmentForOutgoingDeck(
  analysis: TrackAnalysis,
  currentTime: number,
  blendBeats: number,
  genreId: GenreId = 'neutral',
  incoming?: TrackAnalysis,
  wordMatches?: WordMatch[],
  outgoingDeck: 'A' | 'B' = 'A',
  minIncomingTime = 0,
): TransitionPlan {
  return pickTransitionPlan(analysis, currentTime, blendBeats, genreId, incoming, wordMatches, outgoingDeck, minIncomingTime);
}
