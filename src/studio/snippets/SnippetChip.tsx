import { motion } from 'motion/react'
import { Play, Plus, Square } from 'lucide-react'
import { useMemo } from 'react'
import { useSnippetStore } from './snippetStore'
import { playSnippetPreview, stopSnippetPreview } from './snippetPreview'
import { springs } from '../../motion/springs'
import { cn } from '../../lib/utils'
import type { Snippet } from './types'
import type { DeckSource } from './masterScheduler'

export const SNIPPET_DRAG_MIME = 'application/x-wordplay-snippet'

interface Props {
  snippet: Snippet
  index: number
  laneTotal: number
  /** Buffers for this deck — used to audition the slice before adding to master. */
  previewSource: DeckSource | null
  /** Called before starting preview (e.g. stop master mix so you only hear the slice). */
  onBeforePreview?: () => void
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function barsFromSeed(seed: string, count: number, peak: number): number[] {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    const rand = ((h >>> 0) % 1000) / 1000
    const pos = Math.abs(i - count / 2) / (count / 2)
    const shape = 1 - pos * 0.4
    const v = 0.3 + rand * 0.7 * shape * peak
    out.push(Math.max(0.12, Math.min(1, v)))
  }
  return out
}

export function SnippetChip({ snippet, index, laneTotal, previewSource, onBeforePreview }: Props) {
  const setDragging = useSnippetStore((s) => s.setDragging)
  const addToMaster = useSnippetStore((s) => s.addToMaster)
  const isDragging = useSnippetStore((s) => s.draggingId === snippet.id)
  const isPreviewing = useSnippetStore((s) => s.previewingSnippetId === snippet.id)
  const previewProgress = useSnippetStore((s) =>
    s.previewingSnippetId === snippet.id ? s.previewProgress01 : 0,
  )

  const canPreview = useMemo(() => {
    if (!previewSource) return false
    const stemBuf = snippet.stem === 'vocals' ? previewSource.stems?.vocals : previewSource.stems?.instruments
    return !!(stemBuf ?? previewSource.full)
  }, [previewSource, snippet.stem])

  const dur = Math.max(1, snippet.endSec - snippet.startSec)
  const ratio = Math.max(0.03, Math.min(0.5, dur / Math.max(8, laneTotal)))
  const chipWidth = Math.max(120, Math.min(220, ratio * 900))

  const isVocal = snippet.stem === 'vocals'
  const deckAccent = snippet.deck === 'A' ? 'var(--wp-accent)' : 'var(--wp-ready)'
  const stemAccent = isVocal ? deckAccent : 'var(--wp-muted)'
  const bars = barsFromSeed(snippet.id, 24, 0.3 + snippet.energy * 0.7)

  return (
    <div
      draggable
      onDragStart={(e) => {
        setDragging(snippet.id)
        e.dataTransfer.effectAllowed = 'copy'
        try {
          e.dataTransfer.setData(SNIPPET_DRAG_MIME, snippet.id)
          e.dataTransfer.setData('text/plain', `${snippet.label} ${snippet.hint}`)
        } catch {
          /* ignore */
        }
      }}
      onDragEnd={() => setDragging(null)}
      onDoubleClick={() => addToMaster(snippet)}
      title={`${snippet.label} · ${snippet.hint} · play = preview, + / double-click = add to master`}
      className={cn('shrink-0', isDragging && 'opacity-50')}
    >
      <motion.div
        layout
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ ...springs.silky, delay: index * 0.01 }}
        className={cn(
          'group relative flex select-none flex-col overflow-hidden rounded border bg-[var(--wp-surface-2)]',
          'cursor-grab active:cursor-grabbing',
          isPreviewing && snippet.deck === 'A' && 'border-[var(--wp-accent)]/45',
          isPreviewing && snippet.deck === 'B' && 'border-[var(--wp-ready)]/45',
        )}
        style={{
          width: chipWidth,
          minHeight: 60,
          borderColor: isDragging ? deckAccent : !isPreviewing ? 'var(--wp-border)' : undefined,
          boxShadow: isPreviewing
            ? `0 0 0 1px color-mix(in oklab, ${deckAccent} 35%, transparent), 0 0 16px -4px color-mix(in oklab, ${deckAccent} 45%, transparent)`
            : undefined,
        }}
      >
        {/* Color sweep + glow while preview plays */}
        {isPreviewing && (
          <div
            className="pointer-events-none absolute inset-0 z-0"
            style={{
              background: `linear-gradient(105deg, color-mix(in oklab, ${deckAccent} 42%, transparent) 0%, color-mix(in oklab, ${deckAccent} 12%, transparent) 35%, transparent 70%)`,
              clipPath: `inset(0 ${100 - previewProgress * 100}% 0 0)`,
            }}
            aria-hidden
          />
        )}
        <div className="studio-snippet-chip__row-top relative z-[1]">
          <span className="truncate text-[0.8125rem] font-medium leading-tight text-[var(--wp-text)]">{snippet.label}</span>
          <span className="shrink-0 text-[0.625rem] font-medium tabular-nums text-[var(--wp-muted-2)]">{snippet.deck}</span>
        </div>
        <div className="studio-snippet-chip__row-wave relative z-[1]">
          {bars.map((v, i) => {
            const p = (i + 0.5) / bars.length
            const past = isPreviewing && p <= previewProgress
            return (
              <span
                key={i}
                className="flex-1 rounded-[1px] transition-[background,filter] duration-75"
                style={{
                  height: `${Math.max(12, v * 100)}%`,
                  background: past
                    ? `color-mix(in oklab, ${deckAccent} 85%, var(--wp-muted-2))`
                    : `color-mix(in oklab, ${stemAccent} 50%, var(--wp-muted-2))`,
                  boxShadow: past ? `0 0 5px color-mix(in oklab, ${deckAccent} 40%, transparent)` : undefined,
                }}
              />
            )
          })}
        </div>
        <div className="studio-snippet-chip__row-actions relative z-[1]">
          <span className="min-w-0 text-[0.625rem] font-medium tabular-nums text-[var(--wp-muted)]">
            {fmtTime(snippet.startSec)}–{fmtTime(snippet.endSec)}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                if (isPreviewing) {
                  stopSnippetPreview()
                  return
                }
                onBeforePreview?.()
                playSnippetPreview(snippet, previewSource)
              }}
              disabled={!canPreview}
              aria-label={isPreviewing ? 'Stop preview' : 'Preview this slice'}
              title={
                !canPreview
                  ? 'Load track audio to preview'
                  : isPreviewing
                    ? 'Stop preview'
                    : 'Play this slice (stops master if playing)'
              }
              className={cn(
                'inline-flex h-6 w-6 items-center justify-center rounded border text-[var(--wp-muted)] transition-colors',
                isPreviewing
                  ? 'border-[var(--wp-accent-hi)] bg-[var(--wp-accent)]/15 text-[var(--wp-accent-hi)]'
                  : 'border-[var(--wp-border)] hover:border-[var(--wp-border-hi)] hover:text-[var(--wp-text)]',
                !canPreview && 'pointer-events-none opacity-40',
              )}
            >
              {isPreviewing ? <Square className="h-2.5 w-2.5 fill-current" /> : <Play className="h-3 w-3" />}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                addToMaster(snippet)
              }}
              aria-label="Add to master"
              className="inline-flex h-6 w-6 items-center justify-center rounded border border-transparent text-[var(--wp-muted)] opacity-90 transition-opacity hover:border-[var(--wp-border)] hover:text-[var(--wp-text)] group-hover:opacity-100"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
