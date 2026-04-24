import { useCallback, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Play, Plus, SlidersHorizontal, Square, Trash2, X } from 'lucide-react'
import { useSnippetStore, selectMasterDuration } from './snippetStore'
import { SNIPPET_DRAG_MIME } from './SnippetChip'
import { springs } from '../../motion/springs'
import { cn } from '../../lib/utils'
import type { MasterSnippet } from './types'
import type { MasterTransition, MasterTransitionKind } from './masterTransitions'
import {
  DEFAULT_MASTER_TRANSITION,
  fillTransitionGaps,
  TRANSITION_HINT,
  TRANSITION_LABEL,
} from './masterTransitions'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'

interface Props {
  isPlaying: boolean
  progressSec: number
  onPlay: () => void
  onStop: () => void
  onAnalyse: () => void
  analyseBusy: boolean
  bakedReady: boolean
}

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const KINDS: MasterTransitionKind[] = ['linear', 'equal_power', 'cut', 'gap']

export function MasterDeck({
  isPlaying,
  progressSec,
  onPlay,
  onStop,
  onAnalyse,
  analyseBusy,
  bakedReady,
}: Props) {
  const master = useSnippetStore((s) => s.master)
  const setMasterTransition = useSnippetStore((s) => s.setMasterTransition)
  const masterTransitions = useSnippetStore((s) => s.masterTransitions)
  const setHoverIndex = useSnippetStore((s) => s.setHoverIndex)
  const hoverIndex = useSnippetStore((s) => s.hoverIndex)
  const removeFromMaster = useSnippetStore((s) => s.removeFromMaster)
  const addToMaster = useSnippetStore((s) => s.addToMaster)
  const moveInMaster = useSnippetStore((s) => s.moveInMaster)
  const clearMaster = useSnippetStore((s) => s.clearMaster)
  const byDeck = useSnippetStore((s) => s.byDeck)

  const trResolved = useMemo(
    () => fillTransitionGaps(master.length, masterTransitions),
    [master.length, masterTransitions],
  )

  const totalDuration = useSnippetStore(selectMasterDuration)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const [dragPreview, setDragPreview] = useState(false)

  const pillWidths = useMemo(() => {
    if (totalDuration <= 0) return master.map(() => 120)
    return master.map((s) => {
      const dur = Math.max(0.1, s.endSec - s.startSec)
      return Math.max(88, Math.min(280, (dur / Math.max(totalDuration, 1)) * 720))
    })
  }, [master, totalDuration])

  const findSnippetById = useCallback(
    (id: string) => {
      const all = [...byDeck.A, ...byDeck.B]
      return all.find((s) => s.id === id) ?? null
    },
    [byDeck],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(SNIPPET_DRAG_MIME) && !e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragPreview(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragPreview(false)
    setHoverIndex(null)
  }, [setHoverIndex])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragPreview(false)
      const id = e.dataTransfer.getData(SNIPPET_DRAG_MIME)
      const insertAt = hoverIndex ?? master.length
      if (id) {
        const existing = master.find((m) => m.placementId === id)
        if (existing) {
          moveInMaster(id, insertAt)
          return
        }
        const src = findSnippetById(id)
        if (src) {
          addToMaster(src, insertAt)
        }
      }
    },
    [hoverIndex, master, moveInMaster, addToMaster, findSnippetById],
  )

  const playheadRatio = totalDuration > 0 ? Math.min(1, progressSec / totalDuration) : 0

  return (
    <div className="overflow-hidden rounded-md border border-[var(--wp-border)] bg-[var(--wp-surface)]">
      <div className="studio-master-toolbar">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-[var(--wp-muted)]">
          <span className="shrink-0 text-xs font-semibold uppercase tracking-widest text-[var(--wp-text)]">
            Master
          </span>
          <span className="font-mono text-xs tabular-nums">
            {master.length} clip{master.length === 1 ? '' : 's'}
          </span>
          <span className="text-[var(--wp-muted-2)]">·</span>
          <span
            className="font-mono text-xs tabular-nums"
            style={{ color: isPlaying ? 'var(--wp-ready)' : 'var(--wp-muted)' }}
          >
            {fmtTime(progressSec)} / {fmtTime(totalDuration)}
          </span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {master.length > 0 && (
            <button
              type="button"
              className="studio-master-btn"
              onClick={onAnalyse}
              disabled={analyseBusy}
              title="Bounce a single buffer so play starts with no live scheduling glitches"
            >
              {analyseBusy ? '…' : <SlidersHorizontal className="h-3.5 w-3.5" />}{' '}
              {analyseBusy ? 'Stitching…' : 'Analyse'}
            </button>
          )}
          {bakedReady && master.length > 0 && (
            <span
              className="rounded border border-[var(--wp-ready)]/40 bg-[var(--wp-ready)]/10 px-2 py-0.5 text-[10px] text-[var(--wp-ready)]"
              title="Using stitched mix for playback (run Analyse again if you change clips or transitions)"
            >
              Baked
            </span>
          )}
          {master.length > 0 && (
            <button
              type="button"
              className="studio-master-btn studio-master-btn--danger-ghost"
              onClick={clearMaster}
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </button>
          )}
          {isPlaying ? (
            <button type="button" className="studio-master-btn" onClick={onStop}>
              <Square className="h-3.5 w-3.5" /> Stop
            </button>
          ) : (
            <button
              type="button"
              className="studio-master-btn studio-master-btn--play"
              onClick={onPlay}
              disabled={master.length === 0}
            >
              <Play className="h-3.5 w-3.5" /> Play
            </button>
          )}
        </div>
      </div>

      <div
        ref={dropZoneRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'relative min-h-[7rem] border-t border-[var(--wp-border)] bg-[var(--wp-bg)]',
          dragPreview && 'ring-1 ring-inset ring-[var(--wp-accent)]/40',
        )}
      >
        {isPlaying && master.length > 0 && (
          <div
            className="absolute bottom-0 top-0 z-10 w-px bg-[var(--wp-ready)] pointer-events-none"
            style={{ left: `calc(${playheadRatio * 100}% - 0.5px)` }}
          />
        )}

        {master.length === 0 ? (
          <div className="flex min-h-[7rem] flex-col items-center justify-center gap-2 px-4 py-8 text-center">
            <p className="text-sm text-[var(--wp-muted)]">Drop snippet clips here</p>
            <p className="max-w-sm text-xs leading-relaxed text-[var(--wp-muted-2)]">
              Build a sequence from deck A and B — order matters for playback
            </p>
          </div>
        ) : (
          <div className="flex items-stretch gap-0 overflow-x-auto wp-scroll p-2">
            <GapSlot index={0} active={hoverIndex === 0} setHoverIndex={setHoverIndex} />
            {master.map((clip, i) => (
              <MasterRow
                key={clip.placementId}
                clip={clip}
                width={pillWidths[i]}
                gapIndex={i + 1}
                gapActive={hoverIndex === i + 1}
                setHoverIndex={setHoverIndex}
                onRemove={() => removeFromMaster(clip.placementId)}
                showTransition={i < master.length - 1}
                transition={trResolved[i] ?? DEFAULT_MASTER_TRANSITION}
                boundaryIndex={i}
                onSetTransition={setMasterTransition}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MasterRow({
  clip,
  width,
  gapIndex,
  gapActive,
  setHoverIndex,
  onRemove,
  showTransition,
  transition,
  boundaryIndex,
  onSetTransition,
}: {
  clip: MasterSnippet
  width: number
  gapIndex: number
  gapActive: boolean
  setHoverIndex: (n: number | null) => void
  onRemove: () => void
  showTransition: boolean
  transition: MasterTransition
  boundaryIndex: number
  onSetTransition: (i: number, t: MasterTransition) => void
}) {
  return (
    <>
      <MasterClip clip={clip} width={width} onRemove={onRemove} />
      {showTransition && (
        <TransitionJoin
          tr={transition}
          boundaryIndex={boundaryIndex}
          onChange={onSetTransition}
        />
      )}
      <GapSlot index={gapIndex} active={gapActive} setHoverIndex={setHoverIndex} />
    </>
  )
}

function TransitionJoin({
  tr,
  boundaryIndex,
  onChange,
}: {
  tr: MasterTransition
  boundaryIndex: number
  onChange: (i: number, t: MasterTransition) => void
}) {
  const [open, setOpen] = useState(false)
  const durMax = tr.kind === 'cut' ? 0 : 2.5
  return (
    <div className="my-1 flex w-7 shrink-0 flex-col items-center justify-center self-stretch">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--wp-border)] bg-[var(--wp-surface-2)] text-[11px] font-semibold text-[var(--wp-muted)] transition-colors hover:border-[var(--wp-accent-hi)] hover:text-[var(--wp-text)]"
            title="Transition: tap to set type + duration"
            aria-label="Edit transition"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 space-y-3" align="center">
          <p className="text-xs text-[var(--wp-muted)]">Join to next clip</p>
          <div className="space-y-2">
            {KINDS.map((kind) => (
              <label
                key={kind}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded border px-2 py-1.5 text-sm',
                  tr.kind === kind
                    ? 'border-[var(--wp-accent-hi)] bg-[var(--wp-accent)]/8'
                    : 'border-[var(--wp-border)]',
                )}
              >
                <input
                  type="radio"
                  className="mt-0.5"
                  checked={tr.kind === kind}
                  onChange={() => onChange(boundaryIndex, { ...tr, kind })}
                />
                <span>
                  <span className="font-medium text-[var(--wp-text)]">{TRANSITION_LABEL[kind]}</span>
                  <span className="mt-0.5 block text-xs text-[var(--wp-muted-2)]">{TRANSITION_HINT[kind]}</span>
                </span>
              </label>
            ))}
          </div>
          {tr.kind !== 'cut' && (
            <div className="space-y-2">
              <span className="text-xs text-[var(--wp-muted)]">
                {tr.kind === 'gap' ? 'Gap (silence) · sec' : 'Duration · sec'}
              </span>
              <Slider
                value={[
                  Math.min(durMax, Math.max(0.02, tr.crossfadeSec ?? 0.25)),
                ]}
                min={0.02}
                max={durMax}
                step={0.02}
                onValueChange={([v]) => onChange(boundaryIndex, { ...tr, crossfadeSec: v ?? 0.25 })}
              />
              <p className="font-mono text-xs text-[var(--wp-muted)]">{(tr.crossfadeSec ?? 0.25).toFixed(2)}s</p>
            </div>
          )}
        </PopoverContent>
      </Popover>
      <span className="mt-0.5 max-w-[2.5rem] truncate text-center text-[8px] uppercase leading-tight text-[var(--wp-muted-2)]">
        {tr.kind === 'linear' ? 'lin' : tr.kind === 'equal_power' ? 'eq' : tr.kind === 'gap' ? 'gap' : 'cut'}
      </span>
    </div>
  )
}

function GapSlot({
  index,
  active,
  setHoverIndex,
}: {
  index: number
  active: boolean
  setHoverIndex: (n: number | null) => void
}) {
  return (
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(SNIPPET_DRAG_MIME)) return
        e.preventDefault()
        setHoverIndex(index)
      }}
      className={cn('my-1 w-1.5 shrink-0 rounded-full', active ? 'bg-[var(--wp-accent-hi)]' : 'bg-transparent')}
    />
  )
}

function clipBars(seed: string, n: number): number[] {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    const rand = ((h >>> 0) % 1000) / 1000
    const pos = Math.abs(i - n / 2) / (n / 2)
    const v = 0.35 + rand * 0.65 * (1 - pos * 0.35)
    out.push(Math.max(0.18, Math.min(1, v)))
  }
  return out
}

function MasterClip({
  clip,
  width,
  onRemove,
}: {
  clip: MasterSnippet
  width: number
  onRemove: () => void
}) {
  const setDragging = useSnippetStore((s) => s.setDragging)
  const deckAccent = clip.deck === 'A' ? 'var(--wp-accent)' : 'var(--wp-ready)'
  const isVocal = clip.stem === 'vocals'
  const bars = clipBars(clip.placementId, Math.max(16, Math.floor(width / 8)))

  return (
    <div
      draggable
      onDragStart={(e) => {
        setDragging(clip.placementId)
        e.dataTransfer.setData(SNIPPET_DRAG_MIME, clip.placementId)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragEnd={() => setDragging(null)}
      className="shrink-0"
    >
      <motion.div
        layout
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={springs.snappy}
        className="group flex flex-col overflow-hidden rounded border border-[var(--wp-border)] bg-[var(--wp-surface-2)]"
        style={{
          width,
          minHeight: 84,
          borderLeftWidth: 3,
          borderLeftColor: deckAccent,
        }}
      >
        <div className="flex items-start justify-between gap-1 border-b border-[var(--wp-border)] px-2 py-1.5">
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[10px] font-mono font-semibold text-[var(--wp-muted)]">{clip.deck}</span>
              <span className="text-[10px] uppercase text-[var(--wp-muted-2)]">{isVocal ? 'vox' : 'inst'}</span>
            </div>
            <p className="truncate text-[12px] font-medium text-[var(--wp-text)]">{clip.label}</p>
          </div>
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 rounded p-0.5 text-[var(--wp-muted)] opacity-0 transition-opacity hover:bg-[var(--wp-surface)] hover:text-[var(--wp-danger)] group-hover:opacity-100"
            aria-label="Remove"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex h-5 items-end gap-px px-1.5 py-1">
          {bars.map((v, i) => (
            <span
              key={i}
              className="flex-1 rounded-[1px] bg-[var(--wp-border)]"
              style={{ height: `${v * 100}%`, background: `color-mix(in oklab, ${deckAccent} 45%, var(--wp-border))` }}
            />
          ))}
        </div>
        <div className="mt-auto border-t border-[var(--wp-border)] px-2 py-1.5 text-[10px] text-[var(--wp-muted)]">
          <div className="font-mono tabular-nums">
            {fmtTime(clip.startSec)} – {fmtTime(clip.endSec)}
          </div>
          {clip.sourceTitle && (
            <div className="mt-0.5 truncate text-[var(--wp-muted-2)]" title={clip.sourceTitle}>
              {clip.sourceTitle}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  )
}
