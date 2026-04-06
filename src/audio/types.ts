export interface VocalSegment {
  start: number;
  end: number;
}

export interface CuePoint {
  time: number;
  label: string;
}

/**
 * A recurring vocal phrase — likely a chorus/hook.
 * The transition engine prefers cutting at the START of these
 * because hooks are where listeners expect repetition (e.g. "Tum se").
 */
export interface VocalHook {
  time: number;
  energy: number;
  segmentIndex: number;
}

export interface TrackAnalysis {
  bpm: number;
  beatInterval: number;
  firstBeatTime: number;
  beatTimes: number[];
  duration: number;
  peaks: Float32Array;
  vocalSegments: VocalSegment[];
  energyProfile: Float32Array;
  dropTime: number;
  cuePoints: CuePoint[];
  /** Detected repeating vocal entry points (chorus/hook starts). */
  vocalHooks: VocalHook[];
}

export type DeckId = 'A' | 'B';

export interface DeckState {
  id: DeckId;
  file: File | null;
  buffer: AudioBuffer | null;
  analysis: TrackAnalysis | null;
  isPlaying: boolean;
  isAnalyzing: boolean;
  currentTime: number;
  volume: number;
  playbackRate: number;
  error: string | null;
}

export type AutomixPhase =
  | 'idle'
  | 'playingA'
  | 'blending'
  | 'playingB'
  | 'done';

export interface LogEntry {
  id: number;
  time: number;
  text: string;
  source: 'a' | 'b' | 'system';
}
