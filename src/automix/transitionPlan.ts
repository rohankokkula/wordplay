import type { TrackAnalysis } from '../audio/types';

export function blendDurationSec(analysis: TrackAnalysis, blendBeats: number): number {
  return analysis.beatInterval * blendBeats;
}

/** Where the outgoing deck will start the crossfade (same logic as AutomixController). */
export function pickTransitionPoint(
  a: TrackAnalysis,
  currentTime: number,
  blendBeats: number,
): number {
  const blendDur = blendDurationSec(a, blendBeats);

  for (const seg of a.vocalSegments) {
    if (seg.end > currentTime + 2 && seg.end < a.duration - blendDur) {
      return seg.end;
    }
  }

  const windowDur = a.duration / a.energyProfile.length;
  const currentIdx = Math.floor(currentTime / windowDur);
  for (let i = currentIdx + 4; i < a.energyProfile.length - Math.ceil(blendDur / windowDur); i++) {
    if (a.energyProfile[i] < 0.3 && (i === 0 || a.energyProfile[i] < a.energyProfile[i - 1])) {
      return i * windowDur;
    }
  }

  return Math.max(currentTime + 2, a.duration - blendDur);
}

export function transitionSegmentForOutgoingDeck(
  analysis: TrackAnalysis,
  currentTime: number,
  blendBeats: number,
): { startSec: number; endSec: number } {
  const startSec = pickTransitionPoint(analysis, currentTime, blendBeats);
  const dur = blendDurationSec(analysis, blendBeats);
  const endSec = Math.min(analysis.duration, startSec + dur);
  return { startSec, endSec };
}
