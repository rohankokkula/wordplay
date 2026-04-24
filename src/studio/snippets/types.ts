import type { TrackAnalysis } from '../../audio/types'

export type SnippetDeck = 'A' | 'B'
export type SnippetStem = 'vocals' | 'instruments'

/**
 * A single draggable slice of audio from one deck's stem lane.
 * Every field is derived from the existing `TrackAnalysis` plus the deck id,
 * so we never need a separate segmentation pipeline on the backend.
 */
export interface Snippet {
  id: string
  deck: SnippetDeck
  stem: SnippetStem
  /** Seconds into the source track where this snippet begins. */
  startSec: number
  /** Seconds into the source track where this snippet ends. */
  endSec: number
  /** Human label — usually the section name (Intro, Drop, Hook…). */
  label: string
  /** Short description used on hover + in master deck pill. */
  hint: string
  /** Peak-normalized energy 0..1 — used to size the chip in the lane. */
  energy: number
  /** Title of the source track for display on dropped pills. */
  sourceTitle: string
  /** BPM of the source track — lets the master deck warn about big tempo gaps. */
  bpm: number
}

/**
 * A snippet after it has been dropped on the master deck. We copy the source
 * fields (so the chip still renders even if the source file is unloaded) and
 * tack on a placement id + offset for playback scheduling.
 */
export interface MasterSnippet extends Snippet {
  /** Unique placement id — there can be multiple instances of the same snippet. */
  placementId: string
  /**
   * When this clip should start, measured in seconds along the master
   * timeline. Computed lazily from the sequence order in `masterStore`.
   */
  masterStartSec: number
}
