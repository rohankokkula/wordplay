/**
 * Genre presets — post v1.1.0 only `neutral` remains. The multi-genre
 * beat-layering system was removed in favor of the instrument-bed node in
 * the ReactFlow canvas (`src/mix/instruments.ts`) which gives users a
 * first-class, swappable instrumental rather than a fixed preset.
 */
export type GenreId = 'neutral';

export type RhythmHit = 'kick' | 'hat' | 'clap' | 'perc' | 'open_hat' | null;

export type TransitionStyle = 'eqSwap' | 'filterFade' | 'dropSwitch' | 'echoOut';

export interface KickTuning {
  startHz: number;
  endHz: number;
  decaySec: number;
  velocity: number;
}

export interface HatTuning {
  hpFreqBase: number;
  hpFreqEnergy: number;
  closedDecay: number;
  openDecay: number;
  velocity: number;
}

export interface DuckProfile {
  depth: number;
  attackSec: number;
  releaseSec: number;
}

export interface GenrePreset {
  id: GenreId;
  label: string;
  bpmRange: [number, number];
  defaultBlendBeats: number;
  blendDurationScale: number;
  sweepFloorHz: number;
  sweepDurationScale: number;
  hardCutBpmGap: number;
  rhythmPattern: RhythmHit[];
  beatLayerVolume: number;
  swing: number;
  eqLowShelfGain: number;
  maxRateChange: number;
  transitionStyle: TransitionStyle;
  useAirHorn: boolean;
  useSiren: boolean;
  cueRepeatBars: number;
  buildUpBars: number;
  kick: KickTuning;
  hat: HatTuning;
  subBoostDb: number;
  clapFreq: number;
  duck: DuckProfile;
  musicLowCutHz: number;
  instrumentalUrl: string | null;
  instrumentalPlaylistUrl: string | null;
}

const DEFAULT_KICK: KickTuning = { startHz: 160, endHz: 35, decaySec: 0.18, velocity: 0.9 };
const DEFAULT_HAT: HatTuning = {
  hpFreqBase: 7000,
  hpFreqEnergy: 2000,
  closedDecay: 0.035,
  openDecay: 0.1,
  velocity: 0.35,
};

const STRAIGHT_16: RhythmHit[] = Array(16).fill(null);

export const GENRE_PRESETS: Record<GenreId, GenrePreset> = {
  neutral: {
    id: 'neutral',
    label: 'Neutral',
    bpmRange: [60, 200],
    defaultBlendBeats: 32,
    blendDurationScale: 1.0,
    sweepFloorHz: 800,
    sweepDurationScale: 1.0,
    hardCutBpmGap: 0,
    rhythmPattern: [...STRAIGHT_16],
    beatLayerVolume: 0,
    swing: 0,
    eqLowShelfGain: 0,
    maxRateChange: 0.06,
    transitionStyle: 'filterFade',
    useAirHorn: false,
    useSiren: false,
    cueRepeatBars: 0,
    buildUpBars: 0,
    kick: { ...DEFAULT_KICK },
    hat: { ...DEFAULT_HAT },
    subBoostDb: 0,
    clapFreq: 2200,
    duck: { depth: 0.45, attackSec: 0.003, releaseSec: 0.1 },
    musicLowCutHz: 20,
    instrumentalUrl: null,
    instrumentalPlaylistUrl: null,
  },
};

export const GENRE_LIST: GenreId[] = ['neutral'];

export function genreTargetBpm(detectedBpm: number, genre: GenrePreset): number {
  const [lo, hi] = genre.bpmRange;
  if (detectedBpm >= lo && detectedBpm <= hi) return detectedBpm;
  const maxShift = detectedBpm * genre.maxRateChange;
  if (detectedBpm < lo) return Math.min(lo, detectedBpm + maxShift);
  return Math.max(hi, detectedBpm - maxShift);
}
