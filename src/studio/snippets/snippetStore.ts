import { create } from 'zustand'
import type { MasterSnippet, Snippet, SnippetDeck } from './types'
import type { MasterTransition } from './masterTransitions'
import {
  alignTransitionsForMaster,
  fillTransitionGaps,
  DEFAULT_MASTER_TRANSITION,
  masterNetDurationSec,
} from './masterTransitions'

interface SnippetState {
  /** Source snippets per deck — regenerated every time a new file is loaded. */
  byDeck: { A: Snippet[]; B: Snippet[] }
  /** Ordered sequence of clips on the single Master timeline. */
  master: MasterSnippet[]
  /** Transitions[ i ] = join between master[i] and master[i+1]. */
  masterTransitions: MasterTransition[]
  /** Drag preview state — placement index + snippet being dragged over. */
  draggingId: string | null
  hoverIndex: number | null
  /** Which snippet is currently playing a lane preview (for Play/Stop affordance). */
  previewingSnippetId: string | null
  /** 0–1 for the active `previewingSnippetId` (drives UI color progress). */
  previewProgress01: number
  setPreviewingSnippetId: (id: string | null) => void
  setPreviewProgress01: (p: number) => void

  setSnippets: (deck: SnippetDeck, snippets: Snippet[]) => void
  clearSnippets: (deck: SnippetDeck) => void

  addToMaster: (snippet: Snippet, atIndex?: number) => void
  removeFromMaster: (placementId: string) => void
  moveInMaster: (placementId: string, newIndex: number) => void
  clearMaster: () => void
  setMasterTransition: (boundaryIndex: number, t: MasterTransition) => void

  setDragging: (id: string | null) => void
  setHoverIndex: (i: number | null) => void
}

function recalcStarts(seq: MasterSnippet[]): MasterSnippet[] {
  let t = 0
  return seq.map((s) => {
    const dur = Math.max(0.1, s.endSec - s.startSec)
    const next = { ...s, masterStartSec: t }
    t += dur
    return next
  })
}

function placementId(): string {
  return `mp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export const useSnippetStore = create<SnippetState>((set, get) => ({
  byDeck: { A: [], B: [] },
  master: [],
  masterTransitions: [],
  draggingId: null,
  hoverIndex: null,
  previewingSnippetId: null,
  previewProgress01: 0,
  setPreviewingSnippetId: (id) => set({ previewingSnippetId: id, previewProgress01: 0 }),
  setPreviewProgress01: (p) => set({ previewProgress01: Math.max(0, Math.min(1, p)) }),

  setSnippets: (deck, snippets) =>
    set((s) => ({ byDeck: { ...s.byDeck, [deck]: snippets } })),

  clearSnippets: (deck) =>
    set((s) => {
      const wasPreviewingGone = s.byDeck[deck].some((x) => x.id === s.previewingSnippetId)
      return {
        byDeck: { ...s.byDeck, [deck]: [] },
        previewingSnippetId: wasPreviewingGone ? null : s.previewingSnippetId,
        previewProgress01: wasPreviewingGone ? 0 : s.previewProgress01,
        // Also prune any master placements that came from that deck so the
        // timeline never points at a vanished buffer.
        master: recalcStarts(s.master.filter((m) => m.deck !== deck)),
        masterTransitions: alignTransitionsForMaster(
          recalcStarts(s.master.filter((m) => m.deck !== deck)),
          s.master,
          s.masterTransitions,
        ),
      }
    }),

  addToMaster: (snippet, atIndex) =>
    set((s) => {
      const prevM = s.master
      const placement: MasterSnippet = {
        ...snippet,
        placementId: placementId(),
        masterStartSec: 0,
      }
      const next = [...s.master]
      const idx = typeof atIndex === 'number' ? Math.max(0, Math.min(atIndex, next.length)) : next.length
      next.splice(idx, 0, placement)
      const newM = recalcStarts(next)
      return {
        master: newM,
        masterTransitions: alignTransitionsForMaster(newM, prevM, s.masterTransitions),
        hoverIndex: null,
        draggingId: null,
      }
    }),

  removeFromMaster: (placementId) =>
    set((s) => {
      const prevM = s.master
      const newM = recalcStarts(s.master.filter((m) => m.placementId !== placementId))
      return {
        master: newM,
        masterTransitions: alignTransitionsForMaster(newM, prevM, s.masterTransitions),
      }
    }),

  moveInMaster: (placementId, newIndex) => {
    const { master, masterTransitions } = get()
    const from = master.findIndex((m) => m.placementId === placementId)
    if (from < 0) return
    const prevM = master
    const next = [...master]
    const [clip] = next.splice(from, 1)
    const dest = Math.max(0, Math.min(newIndex, next.length))
    next.splice(dest, 0, clip)
    const newM = recalcStarts(next)
    set({
      master: newM,
      masterTransitions: alignTransitionsForMaster(newM, prevM, masterTransitions),
    })
  },

  clearMaster: () => set({ master: [], masterTransitions: [] }),

  setMasterTransition: (boundaryIndex, t) =>
    set((s) => {
      if (boundaryIndex < 0 || boundaryIndex >= s.master.length - 1) return s
      const next = s.masterTransitions.slice()
      while (next.length < s.master.length - 1) {
        next.push({ ...DEFAULT_MASTER_TRANSITION })
      }
      next[boundaryIndex] = t
      return { masterTransitions: next }
    }),

  setDragging: (id) => set({ draggingId: id }),
  setHoverIndex: (i) => set({ hoverIndex: i }),
}))

/** Net playback time (accounting for crossfades and silence gaps). */
export function selectMasterDuration(state: SnippetState): number {
  const tr = fillTransitionGaps(state.master.length, state.masterTransitions)
  return masterNetDurationSec(state.master, tr)
}
