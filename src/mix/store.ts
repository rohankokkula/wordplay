/**
 * Zustand store for the ReactFlow mix canvas. Keeps the source-of-truth
 * graph + the UI selection state used by the canvas components. The
 * `MixScheduler` subscribes to the graph to know what to play when.
 */
import { create } from 'zustand'
import { nanoid } from 'nanoid'
import {
  type AnyNode,
  type FXEdge,
  type FXKind,
  type MixGraph,
  type SplitNode,
  type TrackStemNode,
  type InstrumentNode,
  type LyricGhostNode,
  type DeckId,
  newGraph,
} from './types'
import type { InstrumentId } from './instruments'

interface MixState {
  graph: MixGraph
  selectedNodeId: string | null
  selectedEdgeId: string | null
  /** Per-deck stem asset metadata so we can hydrate TrackStemNodes. */
  stems: Partial<Record<DeckId, { vocalsUrl: string; instrumentsUrl: string; duration: number; title: string; bpm?: number }>>
  /** Live-playhead seconds, updated by scheduler for canvas feedback. */
  playhead: number

  loadGraph: (graph: MixGraph) => void
  setBpm: (bpm: number) => void
  setStem: (
    deck: DeckId,
    meta: { vocalsUrl: string; instrumentsUrl: string; duration: number; title: string; bpm?: number },
  ) => void
  ensureTrackStemNodes: () => void

  addSplit: (deck: DeckId, stem: 'vocals' | 'instruments', start: number, end: number, label?: string) => string
  updateSplit: (id: string, patch: Partial<SplitNode['split']> & { x?: number; y?: number }) => void
  removeNode: (id: string) => void
  addInstrument: (instrument: InstrumentId) => string
  setInstrumentGain: (id: string, gain: number) => void
  moveNode: (id: string, x: number, y: number) => void

  addEdge: (source: string, target: string, fx?: FXKind) => string
  updateEdge: (id: string, patch: Partial<FXEdge>) => void
  removeEdge: (id: string) => void
  acceptGhostEdge: (ghostNodeId: string) => void
  dismissGhostEdge: (ghostNodeId: string) => void
  addGhostSuggestion: (data: Omit<LyricGhostNode, 'id' | 'kind' | 'x' | 'y'> & { x?: number; y?: number }) => string

  select: (nodeId: string | null, edgeId?: string | null) => void
  setPlayhead: (sec: number) => void
  reset: () => void
}

export const useMixStore = create<MixState>((set, get) => ({
  graph: newGraph(120),
  selectedNodeId: null,
  selectedEdgeId: null,
  stems: {},
  playhead: 0,

  loadGraph: (graph) => set({ graph, selectedNodeId: null, selectedEdgeId: null }),

  setBpm: (bpm) => set((s) => ({ graph: { ...s.graph, masterBpm: bpm } })),

  setStem: (deck, meta) =>
    set((s) => ({ stems: { ...s.stems, [deck]: meta } })),

  ensureTrackStemNodes: () => {
    const { graph, stems } = get()
    const nextNodes: AnyNode[] = [...graph.nodes]
    const exists = (deck: DeckId, stem: 'vocals' | 'instruments') =>
      nextNodes.some(
        (n) =>
          n.kind === 'track-stem' &&
          (n as TrackStemNode).deck === deck &&
          (n as TrackStemNode).stem === stem,
      )
    for (const deck of ['A', 'B'] as DeckId[]) {
      const meta = stems[deck]
      if (!meta) continue
      const xBase = deck === 'A' ? 60 : 60
      let yBase = deck === 'A' ? 60 : 420
      for (const stem of ['vocals', 'instruments'] as const) {
        if (exists(deck, stem)) continue
        nextNodes.push({
          id: `track-${deck}-${stem}`,
          kind: 'track-stem',
          deck,
          stem,
          title: meta.title,
          duration: meta.duration,
          x: xBase,
          y: yBase,
        })
        yBase += 150
      }
    }
    set({ graph: { ...graph, nodes: nextNodes } })
  },

  addSplit: (deck, stem, start, end, label) => {
    const id = `split-${nanoid(8)}`
    const splitNode: SplitNode = {
      id,
      kind: 'split',
      x: 360 + Math.random() * 60,
      y: (deck === 'A' ? 80 : 440) + (stem === 'vocals' ? 0 : 150),
      split: { id, deck, stem, start, end, label },
    }
    set((s) => ({
      graph: { ...s.graph, nodes: [...s.graph.nodes, splitNode] },
      selectedNodeId: id,
    }))
    return id
  },

  updateSplit: (id, patch) =>
    set((s) => ({
      graph: {
        ...s.graph,
        nodes: s.graph.nodes.map((n) => {
          if (n.id !== id || n.kind !== 'split') return n
          const next: SplitNode = { ...n }
          if (patch.x !== undefined) next.x = patch.x
          if (patch.y !== undefined) next.y = patch.y
          const splitPatch: Partial<SplitNode['split']> = {}
          for (const k of ['deck', 'stem', 'start', 'end', 'label', 'barHint'] as const) {
            if (patch[k] !== undefined) (splitPatch as Record<string, unknown>)[k] = patch[k]
          }
          next.split = { ...next.split, ...splitPatch }
          return next
        }),
      },
    })),

  removeNode: (id) =>
    set((s) => ({
      graph: {
        ...s.graph,
        nodes: s.graph.nodes.filter((n) => n.id !== id && !(n.kind === 'master-out')),
        edges: s.graph.edges.filter((e) => e.source !== id && e.target !== id),
      },
      selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
    })),

  addInstrument: (instrument) => {
    const id = `instr-${nanoid(6)}`
    const node: InstrumentNode = {
      id,
      kind: 'instrument',
      instrument,
      gain: 0.7,
      x: 600,
      y: 300,
    }
    set((s) => ({
      graph: {
        ...s.graph,
        nodes: [...s.graph.nodes, node],
      },
      selectedNodeId: id,
    }))
    return id
  },

  setInstrumentGain: (id, gain) =>
    set((s) => ({
      graph: {
        ...s.graph,
        nodes: s.graph.nodes.map((n) =>
          n.id === id && n.kind === 'instrument' ? { ...n, gain } : n,
        ),
      },
    })),

  moveNode: (id, x, y) =>
    set((s) => ({
      graph: {
        ...s.graph,
        nodes: s.graph.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
      },
    })),

  addEdge: (source, target, fx = 'none') => {
    if (source === target) return ''
    const existing = get().graph.edges.find((e) => e.source === source && e.target === target)
    if (existing) return existing.id
    const id = `edge-${nanoid(6)}`
    const edge: FXEdge = {
      id,
      source,
      target,
      fx,
      blendBeats: 2,
      wet: 0.5,
    }
    set((s) => ({
      graph: { ...s.graph, edges: [...s.graph.edges, edge] },
      selectedEdgeId: id,
    }))
    return id
  },

  updateEdge: (id, patch) =>
    set((s) => ({
      graph: {
        ...s.graph,
        edges: s.graph.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      },
    })),

  removeEdge: (id) =>
    set((s) => ({
      graph: { ...s.graph, edges: s.graph.edges.filter((e) => e.id !== id) },
      selectedEdgeId: s.selectedEdgeId === id ? null : s.selectedEdgeId,
    })),

  addGhostSuggestion: (data) => {
    const id = `ghost-${nanoid(6)}`
    const node: LyricGhostNode = {
      id,
      kind: 'lyric-ghost',
      x: data.x ?? 500,
      y: data.y ?? 260,
      phrase: data.phrase,
      fromSplitId: data.fromSplitId,
      toSplitId: data.toSplitId,
      confidence: data.confidence,
    }
    const edgeId = `edge-${nanoid(6)}`
    const edge: FXEdge = {
      id: edgeId,
      source: data.fromSplitId,
      target: data.toSplitId,
      fx: 'echo',
      blendBeats: 2,
      wet: 0.4,
      suggested: true,
    }
    set((s) => ({
      graph: { ...s.graph, nodes: [...s.graph.nodes, node], edges: [...s.graph.edges, edge] },
    }))
    return id
  },

  acceptGhostEdge: (ghostNodeId) =>
    set((s) => {
      const ghost = s.graph.nodes.find((n) => n.id === ghostNodeId) as LyricGhostNode | undefined
      if (!ghost) return s
      return {
        graph: {
          ...s.graph,
          nodes: s.graph.nodes.filter((n) => n.id !== ghostNodeId),
          edges: s.graph.edges.map((e) =>
            e.source === ghost.fromSplitId && e.target === ghost.toSplitId
              ? { ...e, suggested: false }
              : e,
          ),
        },
      }
    }),

  dismissGhostEdge: (ghostNodeId) =>
    set((s) => {
      const ghost = s.graph.nodes.find((n) => n.id === ghostNodeId) as LyricGhostNode | undefined
      if (!ghost) return s
      return {
        graph: {
          ...s.graph,
          nodes: s.graph.nodes.filter((n) => n.id !== ghostNodeId),
          edges: s.graph.edges.filter(
            (e) => !(e.source === ghost.fromSplitId && e.target === ghost.toSplitId && e.suggested),
          ),
        },
      }
    }),

  select: (nodeId, edgeId = null) => set({ selectedNodeId: nodeId, selectedEdgeId: edgeId }),
  setPlayhead: (sec) => set({ playhead: sec }),
  reset: () => set({ graph: newGraph(120), selectedNodeId: null, selectedEdgeId: null, playhead: 0, stems: {} }),
}))
