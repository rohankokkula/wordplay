/**
 * ReactFlow-powered mix canvas. The rest of the mix system (store, scheduler,
 * FX engine, renderMix) is agnostic to UI — this file is where the user
 * actually wires their graph together.
 *
 * Custom node types:
 *   - TrackStemNode: source lane for a deck + stem (vocals / instruments).
 *   - SplitNode: a clip range drawn from a TrackStemNode.
 *   - InstrumentNode: synthesized background bed that replaces deck-A inst.
 *   - MasterOutNode: sink, always present.
 *   - LyricGhostNode: dashed suggested transition.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  addEdge as rfAddEdge,
  type Connection,
  type Edge as RFEdge,
  type EdgeChange,
  type Node as RFNode,
  type NodeChange,
  BackgroundVariant,
  ReactFlowProvider,
} from 'reactflow'
import 'reactflow/dist/style.css'

import { useMixStore } from './store'
import type {
  AnyNode,
  FXEdge,
  FXKind,
  InstrumentNode as InstrumentNodeT,
  LyricGhostNode as LyricGhostNodeT,
  SplitNode as SplitNodeT,
  TrackStemNode as TrackStemNodeT,
} from './types'
import { FX_META } from './types'
import { TrackStemNode } from './nodes/TrackStemNode'
import { SplitNode } from './nodes/SplitNode'
import { InstrumentNode } from './nodes/InstrumentNode'
import { MasterOutNode } from './nodes/MasterOutNode'
import { LyricGhostNode } from './nodes/LyricGhostNode'
import { FXEdgeEditor } from './FXEdgeEditor'
import { AnimatePresence } from 'motion/react'

const NODE_TYPES = {
  'track-stem': TrackStemNode,
  split: SplitNode,
  instrument: InstrumentNode,
  'master-out': MasterOutNode,
  'lyric-ghost': LyricGhostNode,
}

function toRFNodes(nodes: AnyNode[]): RFNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.kind,
    position: { x: n.x, y: n.y },
    data: n,
    draggable: n.kind !== 'master-out',
  }))
}

function toRFEdges(edges: FXEdge[]): RFEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: !e.suggested,
    style: {
      stroke: FX_META[e.fx].color,
      strokeWidth: 3,
      strokeDasharray: e.suggested ? '8 6' : '0',
      filter: e.suggested ? 'none' : `drop-shadow(0 0 6px ${FX_META[e.fx].color}66)`,
      opacity: e.suggested ? 0.75 : 1,
    },
    data: e,
    label: FX_META[e.fx].label,
    labelStyle: {
      fill: '#fff',
      fontSize: 11,
      fontWeight: 500,
    },
    labelBgStyle: {
      fill: FX_META[e.fx].color,
      opacity: 0.85,
    },
    labelBgPadding: [6, 3] as [number, number],
    labelBgBorderRadius: 999,
  }))
}

export function MixCanvas() {
  return (
    <ReactFlowProvider>
      <MixCanvasInner />
    </ReactFlowProvider>
  )
}

function MixCanvasInner() {
  const graph = useMixStore((s) => s.graph)
  const selectedEdgeId = useMixStore((s) => s.selectedEdgeId)
  const select = useMixStore((s) => s.select)
  const moveNode = useMixStore((s) => s.moveNode)
  const addEdge = useMixStore((s) => s.addEdge)
  const removeEdge = useMixStore((s) => s.removeEdge)
  const removeNode = useMixStore((s) => s.removeNode)
  const ensureTrackStemNodes = useMixStore((s) => s.ensureTrackStemNodes)

  useEffect(() => {
    ensureTrackStemNodes()
  }, [ensureTrackStemNodes])

  const { fitView } = useReactFlow()
  const fitTimer = useRef<number | null>(null)

  const rfNodes = useMemo(() => toRFNodes(graph.nodes), [graph.nodes])
  const rfEdges = useMemo(() => toRFEdges(graph.edges), [graph.edges])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes) {
        if (c.type === 'position' && c.position && c.id) {
          moveNode(c.id, c.position.x, c.position.y)
        }
        if (c.type === 'remove') removeNode(c.id)
      }
    },
    [moveNode, removeNode],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const c of changes) {
        if (c.type === 'remove') removeEdge(c.id)
      }
    },
    [removeEdge],
  )

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return
      addEdge(conn.source, conn.target, 'none' as FXKind)
      // Satisfy ReactFlow's addEdge if you want to chain; we rely on our store.
      void rfAddEdge
    },
    [addEdge],
  )

  useEffect(() => {
    if (fitTimer.current) clearTimeout(fitTimer.current)
    fitTimer.current = window.setTimeout(() => fitView({ duration: 600, padding: 0.2 }), 180)
    return () => {
      if (fitTimer.current) clearTimeout(fitTimer.current)
    }
  }, [graph.nodes.length, fitView])

  const selectedEdge = useMemo(
    () => (selectedEdgeId ? graph.edges.find((e) => e.id === selectedEdgeId) : null),
    [selectedEdgeId, graph.edges],
  )

  return (
    <div className="relative h-full w-full rounded-2xl overflow-hidden border border-[var(--wp-border)] bg-[linear-gradient(180deg,rgba(20,18,30,0.8),rgba(10,10,15,0.8))]">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, n) => select(n.id, null)}
        onEdgeClick={(_, e) => select(null, e.id)}
        onPaneClick={() => select(null, null)}
        fitView
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        nodesDraggable
        elementsSelectable
        panOnScroll
        zoomOnPinch
        panOnDrag
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#ffffff20" />
        <Controls className="!bg-[var(--wp-surface)] !border-[var(--wp-border)]" />
        <MiniMap
          className="!bg-[var(--wp-surface)] !border-[var(--wp-border)] rounded-lg"
          nodeColor={(node) => {
            const d = node.data as AnyNode
            if (d.kind === 'track-stem') return (d as TrackStemNodeT).deck === 'A' ? '#8b7fd6' : '#22d3ee'
            if (d.kind === 'split') return '#f472b6'
            if (d.kind === 'instrument') return '#fbbf24'
            if (d.kind === 'lyric-ghost') return '#94a3b8'
            return '#8B7FD6'
          }}
        />
      </ReactFlow>

      <AnimatePresence>
        {selectedEdge && <FXEdgeEditor key={selectedEdge.id} edge={selectedEdge} />}
      </AnimatePresence>
    </div>
  )
}
