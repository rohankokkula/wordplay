import type { MasterSnippet } from './types'

/** How two adjacent clips on the master deck join. */
export type MasterTransitionKind = 'linear' | 'equal_power' | 'cut' | 'gap'

export interface MasterTransition {
  kind: MasterTransitionKind
  /**
   * Crossfade length in seconds (linear / equal_power) — or silence gap (gap) — ignored for `cut`. Clamped in UI.
   */
  crossfadeSec: number
}

export const DEFAULT_MASTER_TRANSITION: MasterTransition = { kind: 'linear', crossfadeSec: 0.25 }

export const TRANSITION_LABEL: Record<MasterTransitionKind, string> = {
  linear: 'Linear crossfade',
  equal_power: 'Equal power',
  cut: 'Hard cut',
  gap: 'Silence gap',
}

export const TRANSITION_HINT: Record<MasterTransitionKind, string> = {
  linear: 'Straight overlap — good default',
  equal_power: 'Cosine/sine curve — less dip in the middle',
  cut: 'No overlap, instant splice',
  gap: 'Insert silence; duration = gap length',
}

/**
 * For linear / equal_power: max overlap in seconds between two clips, matching scheduler.
 */
export function boundaryOverlapSec(
  tr: MasterTransition,
  durationPrev: number,
  durationNext: number,
): number {
  if (tr.kind === 'cut' || tr.kind === 'gap') return 0
  const t = tr.crossfadeSec
  return Math.max(0, Math.min(t, (durationPrev * 0.49), (durationNext * 0.49)))
}

/**
 * Net playback length: sum(clip) − sum(overlap) + sum(gap).
 */
export function masterNetDurationSec(
  master: MasterSnippet[],
  transitions: MasterTransition[],
): number {
  if (master.length === 0) return 0
  let total = 0
  for (let i = 0; i < master.length; i++) {
    const d = Math.max(0.1, master[i].endSec - master[i].startSec)
    total += d
    if (i < master.length - 1) {
      const tr = transitions[i] ?? DEFAULT_MASTER_TRANSITION
      const dNext = Math.max(0.1, master[i + 1].endSec - master[i + 1].startSec)
      if (tr.kind === 'gap') {
        total += Math.max(0, tr.crossfadeSec)
      } else {
        const ov = boundaryOverlapSec(tr, d, dNext)
        total -= ov
      }
    }
  }
  return Math.max(0, total)
}

/**
 * Rebuild transition array so each boundary (placementId, placementId) reuses
 * a previous setting when the pair is unchanged; otherwise default.
 */
export function alignTransitionsForMaster(
  newMaster: MasterSnippet[],
  prevMaster: MasterSnippet[],
  prevT: MasterTransition[],
): MasterTransition[] {
  if (newMaster.length < 2) return []
  const out: MasterTransition[] = []
  for (let i = 0; i < newMaster.length - 1; i++) {
    const a = newMaster[i].placementId
    const b = newMaster[i + 1].placementId
    let reu: MasterTransition | undefined
    for (let j = 0; j < prevMaster.length - 1; j++) {
      if (prevMaster[j].placementId === a && prevMaster[j + 1].placementId === b) {
        reu = prevT[j] ?? DEFAULT_MASTER_TRANSITION
        break
      }
    }
    out[i] = reu ? { ...reu } : { ...DEFAULT_MASTER_TRANSITION }
  }
  return out
}

export function fillTransitionGaps(
  nClips: number,
  existing: MasterTransition[] | undefined,
): MasterTransition[] {
  if (nClips < 2) return []
  const t = nClips - 1
  const out: MasterTransition[] = []
  for (let i = 0; i < t; i++) {
    out[i] = existing?.[i] ? { ...existing[i]! } : { ...DEFAULT_MASTER_TRANSITION }
  }
  return out
}
