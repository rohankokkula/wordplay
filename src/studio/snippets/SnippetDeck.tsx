import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DeckSource } from './masterScheduler'
import { AnimatePresence, motion } from 'motion/react'
import { Loader2, Mic, Music2, Scissors, Trash2, Upload } from 'lucide-react'
import type { DeckState } from '../../audio/types'
import { WaveformEditor, type TrimRegion } from '../../components/WaveformEditor'
import { SnippetChip } from './SnippetChip'
import { useSnippetStore } from './snippetStore'
import { buildClipSnippetsForRegion } from './generate'
import { springs } from '../../motion/springs'
import { cn } from '../../lib/utils'
import { WORDPLAYLIST_DRAG_MIME } from '../../wordplaylistDrag'

interface Props {
  deck: DeckState
  deckId: 'A' | 'B'
  onLoadFile: (file: File) => void
  onSeek: (deck: 'A' | 'B', ratio: number) => void
  onClearDeck: (deck: 'A' | 'B') => void
  onWordplaylistDrop?: (itemId: string) => void
  stemStatus?: 'idle' | 'loading' | 'ready' | 'error'
  stemProgress?: number
  /** Post-separation stem buffers; preview falls back to the full mix if missing. */
  stemBuffers?: { vocals: AudioBuffer; instruments: AudioBuffer } | null
  /** Stop master (and any other deck output) so snippet preview is the only thing playing. */
  onBeforeSnippetPreview?: () => void
}

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function dragHasLoadablePayload(e: React.DragEvent): boolean {
  const types = Array.from(e.dataTransfer.types)
  return types.includes(WORDPLAYLIST_DRAG_MIME) || types.includes('Files')
}

export function SnippetDeck({
  deck,
  deckId,
  onLoadFile,
  onSeek,
  onClearDeck,
  onWordplaylistDrop,
  stemStatus,
  stemProgress,
  stemBuffers,
  onBeforeSnippetPreview,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [clipRegion, setClipRegion] = useState<TrimRegion>({ start: 0, end: 1 })
  const addToMaster = useSnippetStore((s) => s.addToMaster)

  const snippets = useSnippetStore((s) => s.byDeck[deckId])
  const vocalSnippets = useMemo(() => snippets.filter((s) => s.stem === 'vocals'), [snippets])
  const instrSnippets = useMemo(() => snippets.filter((s) => s.stem === 'instruments'), [snippets])

  const previewSource: DeckSource | null = useMemo(() => {
    if (!deck.buffer) return null
    return { stems: stemBuffers ?? null, full: deck.buffer }
  }, [deck.buffer, stemBuffers])

  const duration = deck.analysis?.duration ?? 0
  const fileKey = deck.file?.name ?? ''
  const peaks = useMemo(() => {
    const p = deck.analysis?.peaks
    return p ? Array.from(p) : []
  }, [deck.analysis])

  useEffect(() => {
    if (!deck.analysis || duration <= 0) return
    setClipRegion({ start: 0, end: Math.min(1, 8 / duration) })
  }, [fileKey, duration, deck.analysis])

  const title = deck.file?.name.replace(/\.(mp3|m4a|webm|opus|wav|flac|ogg)$/i, '') ?? ''

  const handleAddSelectionToMaster = useCallback(() => {
    if (!deck.analysis || duration <= 0) return
    const startSec = clipRegion.start * duration
    const endSec = clipRegion.end * duration
    const pair = buildClipSnippetsForRegion(deckId, title, deck.analysis, startSec, endSec)
    if (!pair) return
    addToMaster(pair.vocals)
    addToMaster(pair.instruments)
  }, [addToMaster, clipRegion.end, clipRegion.start, deck.analysis, deckId, duration, title])

  const clipStartSec = clipRegion.start * duration
  const clipEndSec = clipRegion.end * duration

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!dragHasLoadablePayload(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => setDragOver(false), [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const id = e.dataTransfer.getData(WORDPLAYLIST_DRAG_MIME)
      if (id.trim() && onWordplaylistDrop) {
        onWordplaylistDrop(id)
        return
      }
      const file = e.dataTransfer.files[0]
      if (file) onLoadFile(file)
    },
    [onLoadFile, onWordplaylistDrop],
  )

  const deckAccent = deckId === 'A' ? 'var(--wp-accent)' : 'var(--wp-ready)'

  if (!deck.file && !deck.isAnalyzing) {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springs.silky}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          'studio-deck flex min-h-[11rem] flex-col items-center justify-center gap-4 rounded-md border-2 border-dashed p-8 text-center',
          dragOver ? 'border-[var(--wp-accent)] bg-[var(--wp-surface-2)]' : 'border-[var(--wp-border)]',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onLoadFile(f)
          }}
        />
        <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: deckAccent }}>
          Deck {deckId}
        </div>
        <p className="max-w-xs text-sm leading-relaxed text-[var(--wp-muted)]">
          Drop a file to split into two lanes — <span className="text-[var(--wp-text)]">Vocals</span> and{' '}
          <span className="text-[var(--wp-text)]">Instruments</span> (the backing / non-vocal stem).
        </p>
        <button
          type="button"
          className="studio-deck-btn"
          style={{ borderColor: deckAccent, color: deckAccent }}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="h-4 w-4" />
          Choose file
        </button>
      </motion.div>
    )
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.silky}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={cn(
        'studio-deck studio-deck--panel flex flex-col gap-5 rounded-md border p-5',
        dragOver ? 'border-[var(--wp-accent)]' : 'border-[var(--wp-border)]',
        'bg-[var(--wp-surface)]',
      )}
    >
      <div className="flex min-w-0 items-start gap-4">
        <span
          className="shrink-0 self-start rounded px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide"
          style={{ background: `color-mix(in oklab, ${deckAccent} 15%, transparent)`, color: deckAccent }}
        >
          {deckId}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="studio-deck__title truncate text-[var(--wp-text)]" title={title}>
            {deck.isAnalyzing ? 'Analyzing…' : title || '—'}
          </h3>
          <div className="studio-deck__meta mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[var(--wp-muted)]">
            {deck.analysis && (
              <>
                <span className="text-[var(--wp-text)]">{Math.round(deck.analysis.bpm)} BPM</span>
                <span className="text-[var(--wp-muted-2)]">·</span>
                <span>{fmtTime(duration)}</span>
              </>
            )}
            {stemStatus === 'loading' && (
              <span className="inline-flex items-center gap-1 text-[var(--wp-accent-hi)]">
                <Loader2 className="h-3 w-3 animate-spin" />
                Stems {stemProgress ? `${Math.round(stemProgress)}%` : '…'}
              </span>
            )}
            {stemStatus === 'ready' && <span className="text-[var(--wp-ready)]">Stems ready</span>}
            {deck.isAnalyzing && !deck.analysis && (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Decoding
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          className="studio-deck-btn studio-deck-btn--ghost ml-auto shrink-0"
          onClick={() => onClearDeck(deckId)}
          title="Remove track"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Remove</span>
        </button>
      </div>

      {deck.error && (
        <p className="rounded border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {deck.error}
        </p>
      )}

      {deck.analysis ? (
        <div className="flex flex-col gap-3">
          <WaveformEditor
            peaks={peaks}
            duration={duration}
            currentTime={deck.currentTime}
            region={clipRegion}
            onRegionChange={setClipRegion}
            onSeek={(r) => onSeek(deckId, r)}
            deckId={deckId}
          />
          <div className="studio-deck__clipper">
            <div className="studio-deck__clipper-main">
              <span className="studio-deck__clipper-label">Clip to master</span>
              <span className="studio-deck__clipper-time" title="Drag the green handles on the waveform to change the range">
                {fmtTime(clipStartSec)} – {fmtTime(clipEndSec)}
              </span>
            </div>
            <button
              type="button"
              className="studio-deck-btn studio-deck-btn--primary shrink-0"
              onClick={handleAddSelectionToMaster}
              title="Add vocal and instrumental slices for this range to the master deck"
            >
              <Scissors className="h-3.5 w-3.5" />
              Add to master
            </button>
          </div>
        </div>
      ) : (
        <div className="flex h-[100px] items-center justify-center rounded border border-[var(--wp-border)] bg-[var(--wp-waveform-bg)]">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--wp-muted)]" />
        </div>
      )}

      <Lane
        kind="vocals"
        deckAccent={deckAccent}
        count={vocalSnippets.length}
        stemStatus={stemStatus}
      >
        <AnimatePresence>
          {vocalSnippets.map((s, i) => (
            <SnippetChip
              key={s.id}
              snippet={s}
              index={i}
              laneTotal={duration}
              previewSource={previewSource}
              onBeforePreview={onBeforeSnippetPreview}
            />
          ))}
        </AnimatePresence>
      </Lane>

      <Lane
        kind="instruments"
        deckAccent={deckAccent}
        count={instrSnippets.length}
        stemStatus={stemStatus}
      >
        <AnimatePresence>
          {instrSnippets.map((s, i) => (
            <SnippetChip
              key={s.id}
              snippet={s}
              index={i}
              laneTotal={duration}
              previewSource={previewSource}
              onBeforePreview={onBeforeSnippetPreview}
            />
          ))}
        </AnimatePresence>
      </Lane>

      <p className="studio-deck__footer-hint mx-auto max-w-prose">
        Play = preview the slice (stops master) · + or double-click = add to master · drag to master · waveform clip
        adds both stems
      </p>
    </motion.div>
  )
}

function Lane({
  kind,
  deckAccent,
  count,
  stemStatus,
  children,
}: {
  kind: 'vocals' | 'instruments'
  deckAccent: string
  count: number
  stemStatus?: 'idle' | 'loading' | 'ready' | 'error'
  children: React.ReactNode
}) {
  const isVocals = kind === 'vocals'
  const label = isVocals ? 'Vocals' : 'Instruments'
  const icon = isVocals ? <Mic className="h-3.5 w-3.5" /> : <Music2 className="h-3.5 w-3.5" />
  const stemsReady = stemStatus === 'ready'

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-[var(--wp-muted)]" style={{ color: deckAccent }} aria-hidden>
            {icon}
          </span>
          <span className="studio-deck__lane-title text-[var(--wp-text)]">{label}</span>
          {count > 0 && <span className="studio-deck__lane-count">{count} clips</span>}
        </div>
        {isVocals && !stemsReady && count > 0 && (
          <span
            className="studio-deck__lane-tag shrink-0"
            title="From analysis; isolated stem when separation finishes"
          >
            · estimate
          </span>
        )}
        {isVocals && stemsReady && <span className="studio-deck__lane-tag shrink-0 text-[var(--wp-ready)]">· isolated</span>}
      </div>
      <div
        className="studio-deck__lane-strip wp-scroll overflow-x-auto"
        style={isVocals ? { borderLeftWidth: 3, borderLeftColor: deckAccent } : { borderLeftWidth: 1 }}
      >
        {count === 0 ? (
          <div className="studio-deck__lane-empty">
            {stemStatus === 'loading' ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Slicing…
              </span>
            ) : (
              'No slices yet'
            )}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}
