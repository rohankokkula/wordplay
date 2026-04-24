/**
 * Types for the node-based mix canvas. These describe the serializable
 * graph that is both persisted to `wordplay_post.graph_json` (for remixing)
 * and walked at playback time by the `MixScheduler`.
 */
import type { InstrumentId } from './instruments'

export type DeckId = 'A' | 'B'
export type StemKind = 'vocals' | 'instruments' | 'both'

export type FXKind = 'none' | 'reverb' | 'echo' | 'lowpass' | 'filter-sweep' | 'stutter'

export const FX_META: Record<
  FXKind,
  { label: string; color: string; description: string; shortcut?: string }
> = {
  none: {
    label: 'Cut',
    color: '#94a3b8',
    description: 'Hard cut, no effect — clean transition.',
  },
  reverb: {
    label: 'Reverb',
    color: '#a78bfa',
    description: 'Lush tail, ideal for outros and breakdowns.',
  },
  echo: {
    label: 'Echo',
    color: '#22d3ee',
    description: 'Dubby delay wash between splits.',
  },
  lowpass: {
    label: 'Lowpass',
    color: '#fb923c',
    description: 'Muffle the outgoing section into the next one.',
  },
  'filter-sweep': {
    label: 'Sweep',
    color: '#f472b6',
    description: 'Riser filter open → close like a classic DJ sweep.',
  },
  stutter: {
    label: 'Stutter',
    color: '#facc15',
    description: 'Rhythmic gate chop on the transition beat.',
  },
}

/** A single clip/range on a deck stem. Times are expressed in source-seconds. */
export interface Split {
  /** UUID */
  id: string
  /** Which deck + stem this split draws from. */
  deck: DeckId
  stem: StemKind
  /** Source start/end in seconds. */
  start: number
  end: number
  /** Optional friendly label. */
  label?: string
  /** Optional snap-hint bar index (0 = first bar of parent deck). */
  barHint?: number
}

export type NodeKind = 'track-stem' | 'split' | 'instrument' | 'master-out' | 'lyric-ghost'

interface BaseNode {
  id: string
  kind: NodeKind
  x: number
  y: number
}

export interface TrackStemNode extends BaseNode {
  kind: 'track-stem'
  deck: DeckId
  stem: 'vocals' | 'instruments'
  title: string
  duration: number
  waveform?: number[]
}

export interface SplitNode extends BaseNode {
  kind: 'split'
  split: Split
}

export interface InstrumentNode extends BaseNode {
  kind: 'instrument'
  instrument: InstrumentId
  gain: number
}

export interface MasterOutNode extends BaseNode {
  kind: 'master-out'
}

export interface LyricGhostNode extends BaseNode {
  kind: 'lyric-ghost'
  phrase: string
  fromSplitId: string
  toSplitId: string
  confidence: number
}

export type AnyNode = TrackStemNode | SplitNode | InstrumentNode | MasterOutNode | LyricGhostNode

export interface FXEdge {
  id: string
  source: string
  target: string
  /** The kind of FX to apply on this transition line. */
  fx: FXKind
  /** Crossfade duration in beats (1, 2, 4, 8). */
  blendBeats: 1 | 2 | 4 | 8
  /** Wetness/intensity 0..1. */
  wet: number
  /** Whether this is an accepted transition (false = suggested lyric-ghost edge). */
  suggested?: boolean
}

export interface MixGraph {
  version: 1
  nodes: AnyNode[]
  edges: FXEdge[]
  masterBpm: number
  createdAt: string
}

export function newGraph(bpm = 120): MixGraph {
  return {
    version: 1,
    nodes: [{ id: 'master', kind: 'master-out', x: 900, y: 260 }],
    edges: [],
    masterBpm: bpm,
    createdAt: new Date().toISOString(),
  }
}
