export type GenreId =
  | 'neutral'
  | 'afrobeat'
  | 'bollytech'
  | 'techno'
  | 'trance'
  | 'house'
  | 'dnb';

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
  /** Volume floor during duck (0 = silence, 1 = no duck). Lower = more pump. */
  depth: number;
  /** Seconds to reach duck floor. */
  attackSec: number;
  /** Seconds to release back to 1.0. */
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
  /** Sub-bass resonance boost in dB applied via a peaking filter around 55–80 Hz. */
  subBoostDb: number;
  /** Clap bandpass center frequency. */
  clapFreq: number;
  /** Sidechain duck profile — how the music ducks when the genre kick hits. */
  duck: DuckProfile;
  /** Highpass cutoff (Hz) applied to the music path to carve room for genre kick. 20 = off. */
  musicLowCutHz: number;
  /** YouTube URL for a genre instrumental bed track (auto-downloaded and cached). */
  instrumentalUrl: string | null;
  /** YouTube playlist URL — backend picks a random track from this playlist. */
  instrumentalPlaylistUrl: string | null;
}

const DEFAULT_KICK: KickTuning  = { startHz: 160, endHz: 35, decaySec: 0.18, velocity: 0.9 };
const DEFAULT_HAT: HatTuning    = { hpFreqBase: 7000, hpFreqEnergy: 2000, closedDecay: 0.035, openDecay: 0.10, velocity: 0.35 };

const STRAIGHT_16: RhythmHit[] = Array(16).fill(null);

export const GENRE_PRESETS: Record<GenreId, GenrePreset> = {

  /* ────────────────── Neutral ────────────────── */
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
    duck: { depth: 0.45, attackSec: 0.003, releaseSec: 0.10 },
    musicLowCutHz: 20,
    instrumentalUrl: null,
    instrumentalPlaylistUrl: null,
  },

  /* ────────────────── Afrobeat ────────────────── */
  // Classic Afrobeat: kick on 1 and 3&, clap on 2 & 4, shaker/perc fills.
  // The "1 ... 3&" kick gives the characteristic push-pull bounce.
  afrobeat: {
    id: 'afrobeat',
    label: 'Afrobeat',
    bpmRange: [95, 130],
    defaultBlendBeats: 32,
    blendDurationScale: 1.0,
    sweepFloorHz: 600,
    sweepDurationScale: 1.1,
    hardCutBpmGap: 20,
    rhythmPattern: [
      // beat 1        beat 2        beat 3        beat 4
      'kick',     null,       'hat',      'perc',     // 1 . hat perc
      'clap',     'hat',      'kick',     'hat',      // clap hat 3& hat
      'hat',      'perc',     'clap',     'hat',      // hat perc clap hat
      'perc',     'hat',      'perc',     'open_hat', // perc hat perc oh
    ],
    beatLayerVolume: 0.48,
    swing: 0.40,
    eqLowShelfGain: 5,
    maxRateChange: 0.06,
    transitionStyle: 'eqSwap',
    useAirHorn: false,
    useSiren: false,
    cueRepeatBars: 2,
    buildUpBars: 4,
    kick: { startHz: 150, endHz: 42, decaySec: 0.24, velocity: 1.0 },
    hat: { hpFreqBase: 6000, hpFreqEnergy: 1500, closedDecay: 0.04, openDecay: 0.13, velocity: 0.38 },
    subBoostDb: 5,
    clapFreq: 1800,
    duck: { depth: 0.25, attackSec: 0.003, releaseSec: 0.060 },
    musicLowCutHz: 90,
    instrumentalUrl: 'https://www.youtube.com/watch?v=CcUi4sF_zM4',
    instrumentalPlaylistUrl: 'https://www.youtube.com/playlist?list=PLmezMUAfEE4bP0umEuInqoUWCAbRzyFEG',
  },

  /* ────────────────── Bollytech ────────────────── */
  bollytech: {
    id: 'bollytech',
    label: 'Bollytech',
    bpmRange: [128, 145],
    defaultBlendBeats: 16,
    blendDurationScale: 0.8,
    sweepFloorHz: 400,
    sweepDurationScale: 0.7,
    hardCutBpmGap: 18,
    rhythmPattern: [
      'kick',     'hat',      'perc',     'hat',
      'clap',     'hat',      'kick',     'open_hat',
      'kick',     'hat',      'perc',     'hat',
      'clap',     'perc',     'hat',      'open_hat',
    ],
    beatLayerVolume: 0.55,
    swing: 0.1,
    eqLowShelfGain: 6,
    maxRateChange: 0.45,
    transitionStyle: 'dropSwitch',
    useAirHorn: true,
    useSiren: true,
    cueRepeatBars: 1,
    buildUpBars: 2,
    kick: { startHz: 200, endHz: 38, decaySec: 0.18, velocity: 1.1 },
    hat: { hpFreqBase: 8000, hpFreqEnergy: 2000, closedDecay: 0.028, openDecay: 0.09, velocity: 0.45 },
    subBoostDb: 7,
    clapFreq: 2500,
    duck: { depth: 0.25, attackSec: 0.003, releaseSec: 0.065 },
    musicLowCutHz: 100,
    instrumentalUrl: null,
    instrumentalPlaylistUrl: null,
  },

  /* ────────────────── Techno ────────────────── */
  techno: {
    id: 'techno',
    label: 'Techno',
    bpmRange: [126, 150],
    defaultBlendBeats: 64,
    blendDurationScale: 1.3,
    sweepFloorHz: 300,
    sweepDurationScale: 0.8,
    hardCutBpmGap: 10,
    rhythmPattern: [
      'kick',     null,       'hat',      null,
      'kick',     null,       'clap',     'hat',
      'kick',     null,       'hat',      null,
      'kick',     null,       'clap',     'open_hat',
    ],
    beatLayerVolume: 0.52,
    swing: 0,
    eqLowShelfGain: 7,
    maxRateChange: 0.06,
    transitionStyle: 'eqSwap',
    useAirHorn: false,
    useSiren: false,
    cueRepeatBars: 4,
    buildUpBars: 8,
    kick: { startHz: 200, endHz: 28, decaySec: 0.24, velocity: 1.15 },
    hat: { hpFreqBase: 8500, hpFreqEnergy: 1500, closedDecay: 0.022, openDecay: 0.07, velocity: 0.36 },
    subBoostDb: 8,
    clapFreq: 2800,
    duck: { depth: 0.22, attackSec: 0.002, releaseSec: 0.070 },
    musicLowCutHz: 110,
    instrumentalUrl: null,
    instrumentalPlaylistUrl: null,
  },

  /* ────────────────── Trance ────────────────── */
  trance: {
    id: 'trance',
    label: 'Trance',
    bpmRange: [136, 150],
    defaultBlendBeats: 128,
    blendDurationScale: 1.6,
    sweepFloorHz: 200,
    sweepDurationScale: 1.8,
    hardCutBpmGap: 0,
    rhythmPattern: [
      'kick',     null,       'hat',      'open_hat',
      'kick',     null,       'clap',     'open_hat',
      'kick',     null,       'hat',      'open_hat',
      'kick',     null,       'clap',     'open_hat',
    ],
    beatLayerVolume: 0.50,
    swing: 0,
    eqLowShelfGain: 5,
    maxRateChange: 0.06,
    transitionStyle: 'filterFade',
    useAirHorn: false,
    useSiren: true,
    cueRepeatBars: 4,
    buildUpBars: 16,
    kick: { startHz: 220, endHz: 36, decaySec: 0.22, velocity: 1.1 },
    hat: { hpFreqBase: 9000, hpFreqEnergy: 2500, closedDecay: 0.022, openDecay: 0.15, velocity: 0.38 },
    subBoostDb: 6,
    clapFreq: 3200,
    duck: { depth: 0.20, attackSec: 0.002, releaseSec: 0.080 },
    musicLowCutHz: 100,
    instrumentalUrl: null,
    instrumentalPlaylistUrl: null,
  },

  /* ────────────────── House ────────────────── */
  house: {
    id: 'house',
    label: 'House',
    bpmRange: [118, 132],
    defaultBlendBeats: 64,
    blendDurationScale: 1.1,
    sweepFloorHz: 500,
    sweepDurationScale: 1.0,
    hardCutBpmGap: 12,
    rhythmPattern: [
      'kick',     null,       'hat',      null,
      'kick',     null,       'clap',     'hat',
      'kick',     null,       'hat',      null,
      'kick',     null,       'clap',     'open_hat',
    ],
    beatLayerVolume: 0.45,
    swing: 0.15,
    eqLowShelfGain: 5,
    maxRateChange: 0.06,
    transitionStyle: 'echoOut',
    useAirHorn: false,
    useSiren: false,
    cueRepeatBars: 2,
    buildUpBars: 4,
    kick: { startHz: 160, endHz: 36, decaySec: 0.22, velocity: 1.05 },
    hat: { hpFreqBase: 7500, hpFreqEnergy: 1800, closedDecay: 0.032, openDecay: 0.13, velocity: 0.38 },
    subBoostDb: 5,
    clapFreq: 2200,
    duck: { depth: 0.28, attackSec: 0.003, releaseSec: 0.075 },
    musicLowCutHz: 85,
    instrumentalUrl: null,
    instrumentalPlaylistUrl: null,
  },

  /* ────────────────── Drum & Bass ────────────────── */
  dnb: {
    id: 'dnb',
    label: 'Drum & Bass',
    bpmRange: [170, 178],
    defaultBlendBeats: 32,
    blendDurationScale: 0.7,
    sweepFloorHz: 500,
    sweepDurationScale: 0.5,
    hardCutBpmGap: 25,
    rhythmPattern: [
      'kick',     null,       'hat',      null,
      null,       'hat',      'clap',     null,
      null,       'hat',      'kick',     'hat',
      null,       'hat',      'clap',     'open_hat',
    ],
    beatLayerVolume: 0.52,
    swing: 0.05,
    eqLowShelfGain: 6,
    maxRateChange: 0.06,
    transitionStyle: 'dropSwitch',
    useAirHorn: false,
    useSiren: false,
    cueRepeatBars: 2,
    buildUpBars: 4,
    kick: { startHz: 220, endHz: 26, decaySec: 0.16, velocity: 1.15 },
    hat: { hpFreqBase: 9500, hpFreqEnergy: 2000, closedDecay: 0.018, openDecay: 0.055, velocity: 0.42 },
    subBoostDb: 9,
    clapFreq: 2600,
    duck: { depth: 0.30, attackSec: 0.002, releaseSec: 0.050 },
    musicLowCutHz: 120,
    instrumentalUrl: null,
    instrumentalPlaylistUrl: null,
  },
};

export const GENRE_LIST: GenreId[] = [
  'neutral', 'afrobeat', 'bollytech', 'techno', 'trance', 'house', 'dnb',
];

export function genreTargetBpm(detectedBpm: number, genre: GenrePreset): number {
  const [lo, hi] = genre.bpmRange;
  if (detectedBpm >= lo && detectedBpm <= hi) return detectedBpm;

  const maxShift = detectedBpm * genre.maxRateChange;
  if (detectedBpm < lo) return Math.min(lo, detectedBpm + maxShift);
  return Math.max(hi, detectedBpm - maxShift);
}
