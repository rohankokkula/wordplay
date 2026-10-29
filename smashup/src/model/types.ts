/**
 * Smashup project schema (v1).
 *
 * Audio is referenced by content hash only — a project never embeds or hosts
 * the songs themselves. Everything derived (analysis, hits, moments) is
 * deterministic from the audio + crate keywords, so it can be recomputed.
 */

export const SCHEMA_VERSION = 1

export type StemName = 'vocals' | 'drums' | 'bass' | 'other'
export const STEM_NAMES: StemName[] = ['vocals', 'drums', 'bass', 'other']

/** Arrangement lanes are stem *roles*, not songs. `full` = no stems available. */
export type Lane = 'vox' | 'drums' | 'bass' | 'music' | 'full'
export const LANE_STEM: Record<Exclude<Lane, 'full'>, StemName> = {
  vox: 'vocals',
  drums: 'drums',
  bass: 'bass',
  music: 'other',
}

export type Camelot = `${number}${'A' | 'B'}`

export interface MusicalKey {
  /** 0 = C … 11 = B */
  tonic: number
  mode: 'major' | 'minor'
  camelot: Camelot
  confidence: number
}

export type SectionRole = 'intro' | 'verse' | 'build' | 'chorus' | 'drop' | 'breath' | 'outro'

export interface SongSection {
  startBar: number
  bars: number
  role: SectionRole
  energy: number
}

export interface SongAnalysis {
  bpm: number
  beatInterval: number
  /** Time of bar 0's downbeat (may be > 0 when the song has a pickup). */
  downbeat: number
  /** Bar start times in seconds. */
  bars: number[]
  key: MusicalKey
  /** Per bar, 0..1 (normalised within the song). */
  energy: number[]
  /** Per bar, 0..1 — from the vocal stem when present, spectral estimate otherwise. */
  vocal: number[]
  sections: SongSection[]
  /** Peak envelope for drawing (≈ 100 points / second). */
  peaks: number[]
  peaksPerSec: number
  duration: number
}

export interface Word {
  w: string
  start: number
  end: number
  p: number
}

export type HitSource = 'aligned' | 'asr' | 'asr-local' | 'lyrics' | 'manual' | 'sidecar' | 'match'

export interface Hit {
  id: string
  songId: string
  text: string
  start: number
  end: number
  confidence: number
  source: HitSource
  accepted: boolean
  /** A "find all like this" candidate waiting for review. */
  suggested?: boolean
  /** How many other hits sit within ±2 bars — chants score high. */
  cluster: number
  /** 0..1 — cluster × energy × repetition. */
  iconic: number
}

export type MomentRole = 'call' | 'build' | 'chant' | 'drop' | 'intro' | 'outro' | 'breath'

/** A phrase-aligned slice anchored on a keyword (or a structural role). The atom of a Smashup. */
export interface Moment {
  id: string
  songId: string
  role: MomentRole
  /** Integer bar index into `analysis.bars`. */
  startBar: number
  bars: number
  /** Keyword hits inside the moment (song seconds). */
  hitTimes: number[]
  energy: number
  vocal: number
  label: string
}

export const PAD_COLORS = ['#ff4d5e', '#ff9f43', '#ffd23f', '#2ee59d'] as const
export const PAD_ROLE_NAMES = ['Call', 'Build', 'Chant', 'Drop'] as const

export interface Pad {
  momentId: string | null
  label: string
}

export type SongStatus = 'empty' | 'queued' | 'decoding' | 'analyzing' | 'remote' | 'ready' | 'error'

export interface Song {
  id: string
  title: string
  /** sha256 of the audio bytes, null until a file is attached. */
  hash: string | null
  fileName: string | null
  status: SongStatus
  progress: number
  stage: string
  error: string | null
  analysis: SongAnalysis | null
  words: Word[] | null
  wordsSource: 'service' | 'sidecar' | 'browser' | 'lyrics' | 'none' | null
  /** Why the word search came back the way it did (shown when hits are 0). */
  wordsNote?: string
  /** Lyrics search hint (template query or user-provided). */
  query?: string
  hits: Hit[]
  moments: Moment[]
  pads: Pad[]
  hasStems: boolean
  /** Template pad labels (e.g. from the paisa table). */
  padLabels?: string[]
  /** For template slots: the preload file slug. */
  preloadSlug?: string
}

export interface Crate {
  id: string
  name: string
  keyword: string
  aliases: string[]
  songs: Song[]
  createdAt: number
  template?: string
  /** Whisper language hint for in-browser transcription. */
  language?: 'auto' | 'hindi' | 'urdu' | 'punjabi' | 'english'
}

/* ── Arrangement ─────────────────────────────────────────────────────── */

export type MoveId =
  | 'wordCut'
  | 'callResponse'
  | 'acapellaIn'
  | 'loopRoll'
  | 'echoThrow'
  | 'bassSwap'
  | 'filterHandover'
  | 'dropSwap'
  | 'spinback'
  | 'dropOut'

export type Layer =
  /** All stems of one song. */
  | 'solo'
  /** This song's vocal over the previous song's beat — a true mashup layer. */
  | 'acapellaOver'
  /** Vocal only, wet — the cold-open tease. */
  | 'tease'

export interface SectionSpec {
  momentId: string
  layer: Layer
  /** For `acapellaOver`: song whose beat continues underneath. */
  bedSongId?: string
  locked?: boolean
  reason: string
}

export interface SeamSpec {
  move: MoveId
  bars: number
  reason: string
}

/** The editable, serialisable plan. Audio timing is derived from it. */
export interface Plan {
  id: string
  seed: number
  curve: CurvePreset
  sections: SectionSpec[]
  /** seams[i] joins sections[i] → sections[i+1]. */
  seams: SeamSpec[]
  score: number
  summary: string[]
}

export type CurvePreset = 'wave' | 'climb' | 'peak'

export interface Master {
  bpm: number
  key: MusicalKey
  /** Per song: playback rate applied (master / effective song bpm) and semitone shift. */
  songs: Record<string, { rate: number; semitones: number; tempoBreak: boolean; keyClash: boolean; note: string }>
  summary: string[]
}

export interface Automation {
  /** [timeOffsetSec, value] pairs relative to clip start; linear ramps between. */
  gain?: [number, number][]
  lpf?: [number, number][]
  hpf?: [number, number][]
  lowShelfDb?: [number, number][]
  delaySend?: [number, number][]
  reverbSend?: [number, number][]
  /** Playback-rate multiplier (spinback). */
  rate?: [number, number][]
}

/** A concrete scheduled piece of audio (derived, not edited directly). */
export interface Clip {
  id: string
  lane: Lane
  songId: string
  stem: StemName | 'full'
  /** Seconds in the *warped* song buffer. */
  srcStart: number
  /** Seconds on the master timeline. */
  at: number
  dur: number
  gain: number
  auto: Automation
  sectionIndex: number
  /** Retrigger loop: replay [srcStart, srcStart+len) every `every` seconds. */
  loop?: { len: number; every: number }
}

export type SfxKind = 'riser' | 'crash' | 'brake' | 'kick'
export interface Sfx {
  kind: SfxKind
  at: number
  dur: number
}

export interface TimelineSection {
  index: number
  at: number
  dur: number
  bpm: number
  bars: number
  songId: string
  layer: Layer
  momentId: string
  role: MomentRole
  tension: number
}

export interface TimelineSeam {
  index: number
  at: number
  dur: number
  move: MoveId
}

export interface Timeline {
  duration: number
  clips: Clip[]
  sfx: Sfx[]
  sections: TimelineSection[]
  seams: TimelineSeam[]
  /** Keyword moments on the master clock, for markers. */
  keywordTimes: { at: number; songId: string }[]
  /** Global tempo for delay sync etc. */
  bpm: number
}
