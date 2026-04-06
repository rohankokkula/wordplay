import type { TimedLine } from './types';

/** Advance time so the active line switches before the LRC stamp (seconds). */
export const LYRIC_TIMING_LEAD_SEC = 0.35;

/** Split a line into words for karaoke-style display (LRC has no word timestamps). */
export function splitLyricWords(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/**
 * Index of the LRC line that should be active at time `t` (largest i with line.time <= t).
 * Use with `t + LYRIC_TIMING_LEAD_SEC` for snappier feel vs the beat.
 */
export function findActiveLyricIndex(lyrics: TimedLine[], t: number): number {
  if (lyrics.length === 0) return -1;
  if (t < lyrics[0].time) return 0;
  let lo = 0;
  let hi = lyrics.length - 1;
  let ans = hi;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lyrics[mid].time <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export interface LyricViewState {
  idx: number;
  prevText: string | null;
  nextText: string | null;
  /** Words of the active line with timing derived from line duration / word count */
  words: string[];
  /** Index of the word that should be highlighted (0..words.length-1) */
  activeWordIdx: number;
  /** 0–1 progress through the current line */
  lineProgress: number;
}

/**
 * Map playback time to lyric view state. Uses each line's start time and the next line's
 * start time to estimate duration, then splits that window evenly across words — better
 * for dense rap than showing one static line until the next LRC timestamp.
 */
export function getLyricViewState(lyrics: TimedLine[], t: number): LyricViewState | null {
  if (lyrics.length === 0) return null;

  let idx = -1;
  for (let i = 0; i < lyrics.length; i++) {
    if (lyrics[i].time <= t) idx = i;
    else break;
  }
  if (idx < 0) return null;

  const lineStart = lyrics[idx].time;
  const rawEnd = idx < lyrics.length - 1 ? lyrics[idx + 1].time : lineStart + 4;
  const lineEnd = Math.max(lineStart + 0.12, rawEnd);
  const lineDur = lineEnd - lineStart;

  const words = splitLyricWords(lyrics[idx].text);
  if (words.length === 0) {
    return {
      idx,
      prevText: idx > 0 ? lyrics[idx - 1].text : null,
      nextText: idx < lyrics.length - 1 ? lyrics[idx + 1].text : null,
      words: [],
      activeWordIdx: 0,
      lineProgress: 0,
    };
  }

  const rel = Math.max(0, Math.min(1, (t - lineStart) / lineDur));
  const slot = lineDur / words.length;
  const activeWordIdx = Math.min(words.length - 1, Math.floor((t - lineStart) / slot));

  return {
    idx,
    prevText: idx > 0 ? lyrics[idx - 1].text : null,
    nextText: idx < lyrics.length - 1 ? lyrics[idx + 1].text : null,
    words,
    activeWordIdx,
    lineProgress: rel,
  };
}
