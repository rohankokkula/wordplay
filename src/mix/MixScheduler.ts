/**
 * Walks the node graph and schedules split playback + FX edges over time.
 * Replaces the linear AutomixController used in v1.0.
 *
 * Traversal rules:
 *  - We start from every SplitNode that has no incoming *non-suggested*
 *    edge (the "entry" splits). Ghost-edges are ignored at playback.
 *  - For each edge we pick the next split to play and run the FX handler
 *    just before the crossfade window.
 *  - An InstrumentNode swaps the deck-A instrumental for a synthesized bed.
 *  - If the user has not drawn any edges we fall back to linearly queueing
 *    the splits in the order they were created (deterministic preview).
 */
import { getAudioContext, getStemBus, setStemGain, type StemBus } from '../audio/mixer'
import { runFX } from './fxEngine'
import { getInstrumentBuffer, INSTRUMENT_BEDS } from './instruments'
import type { FXEdge, InstrumentNode as InstrumentNodeT, MixGraph, SplitNode } from './types'

interface ScheduledClip {
  split: SplitNode['split']
  startAt: number
  endAt: number
}

interface Stem {
  vocals: AudioBuffer
  instruments: AudioBuffer
}

export interface SchedulerProgress {
  currentClipIndex: number
  totalClips: number
  elapsed: number
  totalDuration: number
}

export class MixScheduler {
  private ac = getAudioContext()
  private activeSources: AudioBufferSourceNode[] = []
  private timers: number[] = []
  private graph: MixGraph
  private stems: Record<'A' | 'B', Stem>
  private onProgress?: (p: SchedulerProgress) => void
  private onEnd?: () => void
  private _startAt = 0
  private _running = false
  private _rafId = 0
  private _clips: ScheduledClip[] = []

  constructor(opts: {
    graph: MixGraph
    stems: Record<'A' | 'B', Stem>
    onProgress?: (p: SchedulerProgress) => void
    onEnd?: () => void
  }) {
    this.graph = opts.graph
    this.stems = opts.stems
    this.onProgress = opts.onProgress
    this.onEnd = opts.onEnd
  }

  get isRunning() {
    return this._running
  }

  /** Plan playback and kick it off. */
  async start(masterVolume = 1) {
    const plan = this.buildPlan()
    this._clips = plan.clips
    if (plan.clips.length === 0) return
    this._startAt = this.ac.currentTime + 0.15
    this._running = true

    for (const clip of plan.clips) this.scheduleSplit(clip, masterVolume)
    for (const edge of plan.activeEdges) this.scheduleEdge(edge, plan.edgeTimeBySource)
    for (const instr of plan.instruments) await this.scheduleInstrument(instr, plan)
    this.startProgressLoop(plan)

    const totalDuration = plan.clips[plan.clips.length - 1].endAt - this._startAt
    this.timers.push(
      window.setTimeout(() => this.stop(), Math.max(250, totalDuration * 1000 + 200)),
    )
  }

  stop() {
    this._running = false
    for (const s of this.activeSources) {
      try {
        s.stop()
      } catch {
        /* noop */
      }
      s.disconnect()
    }
    this.activeSources = []
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
    cancelAnimationFrame(this._rafId)
    // Reset instrument swap bus so next playback starts clean.
    setStemGain('instrumentsSwap', 0, 0.05)
    setStemGain('vocalsA', 1, 0.05)
    setStemGain('instrumentsA', 1, 0.05)
    setStemGain('vocalsB', 1, 0.05)
    setStemGain('instrumentsB', 1, 0.05)
    this.onEnd?.()
  }

  // ------------------------- planning -------------------------
  private buildPlan() {
    const { graph } = this
    const splitNodes = graph.nodes.filter((n): n is SplitNode => n.kind === 'split')
    const instruments = graph.nodes.filter(
      (n): n is InstrumentNodeT => n.kind === 'instrument',
    )
    const activeEdges = graph.edges.filter((e) => !e.suggested)

    let order: SplitNode[] = []
    if (activeEdges.length === 0) {
      order = splitNodes
    } else {
      const incoming = new Set(activeEdges.map((e) => e.target))
      const entries = splitNodes.filter((n) => !incoming.has(n.id))
      const visited = new Set<string>()
      const next = new Map<string, string>()
      for (const edge of activeEdges) next.set(edge.source, edge.target)
      for (const start of entries.length ? entries : splitNodes) {
        let cur: SplitNode | undefined = start
        while (cur && !visited.has(cur.id)) {
          visited.add(cur.id)
          order.push(cur)
          const nx = next.get(cur.id)
          cur = nx ? splitNodes.find((s) => s.id === nx) : undefined
        }
      }
      for (const s of splitNodes) if (!visited.has(s.id)) order.push(s)
    }

    const secPerBeat = 60 / Math.max(1, graph.masterBpm)
    let tCursor = this._startAt || this.ac.currentTime + 0.15
    const clips: ScheduledClip[] = []
    const edgeTimeBySource = new Map<string, number>()
    for (let i = 0; i < order.length; i++) {
      const n = order[i]
      const dur = Math.max(0.05, n.split.end - n.split.start)
      const clipEnd = tCursor + dur
      clips.push({ split: n.split, startAt: tCursor, endAt: clipEnd })

      const outEdge = activeEdges.find((e) => e.source === n.id)
      let overlap = 0
      if (outEdge) {
        overlap = Math.min(dur * 0.5, secPerBeat * outEdge.blendBeats)
        edgeTimeBySource.set(n.id, clipEnd - overlap)
      }
      tCursor = clipEnd - overlap
    }

    return { clips, activeEdges, edgeTimeBySource, instruments }
  }

  // ------------------------- scheduling -------------------------
  private scheduleSplit(clip: ScheduledClip, masterVolume: number) {
    const { split, startAt } = clip
    const bufMap = this.stems[split.deck]
    const pickStem = split.stem === 'both' ? 'instruments' : split.stem
    const buffers =
      split.stem === 'both'
        ? ([bufMap.vocals, bufMap.instruments] as AudioBuffer[])
        : [bufMap[pickStem]]
    const busKeys: StemBus[] =
      split.stem === 'both'
        ? [(`vocals${split.deck}` as StemBus), (`instruments${split.deck}` as StemBus)]
        : [(`${pickStem}${split.deck}` as StemBus)]

    for (let i = 0; i < buffers.length; i++) {
      const src = this.ac.createBufferSource()
      src.buffer = buffers[i]
      const g = this.ac.createGain()
      g.gain.value = masterVolume
      src.connect(g)
      g.connect(getStemBus(busKeys[i]))
      try {
        src.start(startAt, split.start, Math.max(0.05, split.end - split.start))
      } catch {
        /* start may throw if already started */
      }
      this.activeSources.push(src)
    }
  }

  private scheduleEdge(edge: FXEdge, edgeTimeBySource: Map<string, number>) {
    const t = edgeTimeBySource.get(edge.source)
    if (t === undefined) return
    const delay = Math.max(0, (t - this.ac.currentTime) * 1000)
    const id = window.setTimeout(() => runFX(edge, this.graph.masterBpm), delay)
    this.timers.push(id)
  }

  private async scheduleInstrument(node: InstrumentNodeT, plan: { clips: ScheduledClip[] }) {
    if (plan.clips.length === 0) return
    const bed = INSTRUMENT_BEDS.find((b) => b.id === node.instrument)
    if (!bed) return
    const buffer = await getInstrumentBuffer(node.instrument)
    const rate = this.graph.masterBpm / bed.nativeBpm
    const startAt = plan.clips[0].startAt
    const endAt = plan.clips[plan.clips.length - 1].endAt

    const src = this.ac.createBufferSource()
    src.buffer = buffer
    src.loop = true
    src.playbackRate.value = rate
    const g = this.ac.createGain()
    g.gain.value = node.gain
    src.connect(g)
    g.connect(getStemBus('instrumentsSwap'))
    try {
      src.start(startAt)
      src.stop(endAt + 0.5)
    } catch {
      /* noop */
    }
    this.activeSources.push(src)

    // Duck deck-A instruments while the swap plays.
    const delayMs = Math.max(0, (startAt - this.ac.currentTime) * 1000)
    this.timers.push(
      window.setTimeout(() => setStemGain('instrumentsA', 0, 0.25), delayMs),
      window.setTimeout(() => {
        setStemGain('instrumentsSwap', node.gain, 0.25)
      }, delayMs),
      window.setTimeout(
        () => {
          setStemGain('instrumentsA', 1, 0.4)
          setStemGain('instrumentsSwap', 0, 0.4)
        },
        Math.max(delayMs, (endAt - this.ac.currentTime) * 1000),
      ),
    )
  }

  private startProgressLoop(plan: { clips: ScheduledClip[] }) {
    const total = plan.clips.length ? plan.clips[plan.clips.length - 1].endAt - this._startAt : 0
    const tick = () => {
      if (!this._running) return
      const elapsed = Math.max(0, this.ac.currentTime - this._startAt)
      let idx = 0
      for (let i = 0; i < plan.clips.length; i++) {
        if (this.ac.currentTime >= plan.clips[i].startAt) idx = i
      }
      this.onProgress?.({
        currentClipIndex: idx,
        totalClips: plan.clips.length,
        elapsed,
        totalDuration: total,
      })
      this._rafId = requestAnimationFrame(tick)
    }
    this._rafId = requestAnimationFrame(tick)
  }
}
