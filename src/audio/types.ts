export interface VocalSegment {
  start: number;
  end: number;
}

export interface CuePoint {
  time: number;
  label: string;
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
