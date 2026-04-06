export interface TimedLine {
  time: number;
  text: string;
}

export interface WordMatch {
  phrase: string;
  /** LRC line start time (whole line) */
  timeA: number;
  lineA: string;
  timeB: number;
  lineB: string;
  score: number;
  /**
   * Estimated time when the matched phrase begins on each track (not just line start).
   * Used for wordplay jumps (e.g. "monica" mid-line → ~01:23 not 00:00).
   */
  phraseOnsetA?: number;
  phraseOnsetB?: number;
}
