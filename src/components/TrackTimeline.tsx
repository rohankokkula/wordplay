import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Upload, Trash2, Loader2, ArrowLeftRight } from 'lucide-react'
import type { DeckState, AutomixPhase } from '../audio/types'
import type { WordMatch } from '../lyrics/types'
import { MusicSearch } from './MusicSearch'
import { MixButton } from './MixButton'
import { Button } from './ui/button'
import { WaveformEditor, type TrimRegion } from './WaveformEditor'
import { WORDPLAYLIST_DRAG_MIME } from '../wordplaylistDrag'
import { cn } from '../lib/utils'

interface DeckTimelineProps {
  deck: DeckState
  deckId: 'A' | 'B'
  wordMatches: WordMatch[]
  region: TrimRegion
  onRegionChange: (region: TrimRegion) => void
  onLoadFile: (file: File) => void
  onSeek: (deck: 'A' | 'B', ratio: number) => void
  onClearDeck: (deck: 'A' | 'B') => void
  isMixing: boolean
  isActive: boolean
  phase: AutomixPhase
  showYouTube?: boolean
  onWordplaylistDrop?: (itemId: string) => void
}

interface Props {
  deckA: DeckState
  deckB: DeckState
  wordMatches: WordMatch[]
  onLoadFileA: (file: File) => void
  onLoadFileB: (file: File) => void
  onSeek: (deck: 'A' | 'B', ratio: number) => void
  phase: AutomixPhase
  activeDeck: 'A' | 'B'
  isMixing: boolean
  blendProgress: number
  transitionInfo: string
  canStart: boolean
  onStart: () => void
  onStop: () => void
  onClearDeck: (deck: 'A' | 'B') => void
  showYouTube?: boolean
  onWordplaylistDropA?: (itemId: string) => void
  onWordplaylistDropB?: (itemId: string) => void
}

function dragHasLoadablePayload(e: React.DragEvent): boolean {
  const types = Array.from(e.dataTransfer.types)
  return types.includes(WORDPLAYLIST_DRAG_MIME) || types.includes('Files')
}

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function DeckTimeline({
  deck,
  deckId,
  region,
  onRegionChange,
  onLoadFile,
  onSeek,
  onClearDeck,
  isMixing,
  isActive,
  showYouTube,
  onWordplaylistDrop,
}: DeckTimelineProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const duration = deck.analysis?.duration ?? 0
  const peaks = useMemo(() => {
    const p = deck.analysis?.peaks
    return p ? Array.from(p) : []
  }, [deck.analysis])

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

  // Empty state — no file loaded
  if (!deck.file && !deck.isAnalyzing) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          'rounded-2xl border border-dashed bg-[var(--wp-surface)]/50 backdrop-blur-xl p-6 flex flex-col items-center justify-center gap-4 min-h-[200px] transition-colors',
          dragOver
            ? 'border-[var(--wp-accent)] bg-[var(--wp-surface-2)]/80 shadow-[var(--wp-shadow-glow)]'
            : 'border-[var(--wp-border)]',
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
        <div className="flex flex-col items-center gap-2">
          <span
            className="wp-label"
            style={{ color: deckAccent }}
          >
            Deck {deckId}
          </span>
          <p className="wp-muted text-center max-w-[280px]">
            Drop an audio file, pick from your Wordplaylist, or browse below.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            size="sm"
            onClick={() => inputRef.current?.click()}
            className="gap-1.5 bg-[var(--wp-accent)] hover:bg-[var(--wp-accent-hi)] text-white"
          >
            <Upload className="h-4 w-4" />
            Upload track
          </Button>
          {showYouTube && (
            <MusicSearch
              variant="embedded"
              targetDeck={deckId}
              disabled={isMixing}
              onAddToDeck={(_d, file) => onLoadFile(file)}
            />
          )}
        </div>
      </motion.div>
    )
  }

  const trimmedDuration = Math.max(0, (region.end - region.start) * duration)
  const title = deck.file?.name.replace(/\.(mp3|m4a|webm|opus|wav|flac|ogg)$/i, '') ?? ''

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={cn(
        'rounded-2xl border bg-[var(--wp-surface)]/60 backdrop-blur-xl p-4 flex flex-col gap-3 transition-all',
        dragOver && 'border-[var(--wp-accent)] shadow-[var(--wp-shadow-glow)]',
        !dragOver && isActive
          ? 'border-[var(--wp-border-hi)] wp-elevated'
          : 'border-[var(--wp-border)]',
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-3 min-w-0">
        <span
          className="inline-flex h-7 items-center justify-center rounded-full px-2.5 text-[11px] font-semibold tracking-wider uppercase shrink-0"
          style={{
            background: `color-mix(in oklab, ${deckAccent} 18%, transparent)`,
            color: deckAccent,
            border: `1px solid color-mix(in oklab, ${deckAccent} 45%, transparent)`,
          }}
        >
          Deck {deckId}
        </span>
        <div className="min-w-0 flex-1">
          <div className="wp-title truncate" title={title}>
            {deck.isAnalyzing ? 'Analyzing…' : title || '—'}
          </div>
          <div className="flex items-center gap-2 wp-caption">
            {deck.analysis && (
              <>
                <span className="wp-mono text-[var(--wp-text)]">
                  {Math.round(deck.analysis.bpm)} BPM
                </span>
                <span className="text-[var(--wp-muted-2)]">·</span>
                <span className="wp-mono">{fmtTime(duration)}</span>
                {(region.start > 0 || region.end < 1) && (
                  <>
                    <span className="text-[var(--wp-muted-2)]">·</span>
                    <span className="wp-mono text-[var(--wp-ready)]">
                      trim {fmtTime(trimmedDuration)}
                    </span>
                  </>
                )}
              </>
            )}
            {deck.isAnalyzing && (
              <span className="inline-flex items-center gap-1.5 text-[var(--wp-muted)]">
                <Loader2 className="h-3 w-3 animate-spin" /> loading
              </span>
            )}
          </div>
        </div>
        {deck.isPlaying && isMixing && (
          <span className="relative h-2 w-2 shrink-0" aria-label="Live">
            <span
              className="absolute inset-0 rounded-full animate-ping"
              style={{ background: deckAccent, opacity: 0.65 }}
            />
            <span
              className="relative block h-2 w-2 rounded-full"
              style={{ background: deckAccent }}
            />
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onClearDeck(deckId)}
          className="gap-1.5 text-[var(--wp-muted)] hover:text-[var(--wp-danger)] hover:bg-[var(--wp-surface-2)]"
          title="Remove track"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Remove</span>
        </Button>
      </div>

      {deck.error && (
        <div className="wp-caption text-[var(--wp-danger)] bg-[var(--wp-danger)]/10 border border-[var(--wp-danger)]/30 rounded-lg px-3 py-2">
          {deck.error}
        </div>
      )}

      {/* Waveform editor */}
      {deck.analysis ? (
        <WaveformEditor
          peaks={peaks}
          duration={duration}
          currentTime={deck.currentTime}
          region={region}
          onRegionChange={onRegionChange}
          onSeek={(r) => onSeek(deckId, r)}
          deckId={deckId}
          disabled={isMixing}
        />
      ) : (
        <div className="h-[120px] sm:h-[140px] rounded-xl bg-[var(--wp-waveform-bg)] flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--wp-muted)]" />
        </div>
      )}

      {/* Footer time strip */}
      <div className="flex items-center justify-between wp-mono text-[var(--wp-muted)] px-1">
        <span>{fmtTime(deck.currentTime)}</span>
        <span className="wp-caption text-[var(--wp-muted-2)]">
          drag the <span className="text-[var(--wp-ready)]">green handles</span> to trim · click waveform to scrub
        </span>
        <span>-{fmtTime(Math.max(0, duration - deck.currentTime))}</span>
      </div>
    </motion.div>
  )
}

interface WordplaySuggestion {
  match: WordMatch
  timeA: number
  timeB: number
  secsUntil: number
  status: 'passed' | 'now' | 'imminent' | 'upcoming'
}

function triggerOnDeck(m: WordMatch, deck: 'A' | 'B'): number {
  return deck === 'A' ? (m.phraseOnsetA ?? m.timeA) : (m.phraseOnsetB ?? m.timeB)
}

function useWordplaySuggestions(
  wordMatches: WordMatch[],
  deckA: DeckState,
  deckB: DeckState,
  activeDeck: 'A' | 'B',
): WordplaySuggestion[] {
  return useMemo(() => {
    if (wordMatches.length === 0) return []
    const activeTime = activeDeck === 'A' ? deckA.currentTime : deckB.currentTime
    const seen = new Set<string>()
    const out: WordplaySuggestion[] = []
    for (const m of wordMatches) {
      const tA = triggerOnDeck(m, 'A')
      const tB = triggerOnDeck(m, 'B')
      const triggerTime = activeDeck === 'A' ? tA : tB
      const diff = triggerTime - activeTime
      const key = `${m.phrase.toLowerCase()}|${tA.toFixed(1)}`
      if (seen.has(key)) continue
      seen.add(key)
      let status: WordplaySuggestion['status']
      if (diff < -2) status = 'passed'
      else if (diff < 0.5) status = 'now'
      else if (diff < 5) status = 'imminent'
      else status = 'upcoming'
      out.push({ match: m, timeA: tA, timeB: tB, secsUntil: Math.max(0, diff), status })
    }
    out.sort((a, b) => a.timeA - b.timeA)
    return out
  }, [wordMatches, deckA.currentTime, deckB.currentTime, activeDeck])
}

export function TrackTimeline({
  deckA,
  deckB,
  wordMatches,
  onLoadFileA,
  onLoadFileB,
  onSeek,
  onClearDeck,
  phase,
  activeDeck,
  isMixing,
  transitionInfo,
  canStart,
  onStart,
  onStop,
  showYouTube,
  onWordplaylistDropA,
  onWordplaylistDropB,
}: Props) {
  const [regionA, setRegionA] = useState<TrimRegion>({ start: 0, end: 1 })
  const [regionB, setRegionB] = useState<TrimRegion>({ start: 0, end: 1 })

  // Reset region when a fresh track is loaded on that deck
  useEffect(() => {
    setRegionA({ start: 0, end: 1 })
  }, [deckA.file])
  useEffect(() => {
    setRegionB({ start: 0, end: 1 })
  }, [deckB.file])

  const suggestions = useWordplaySuggestions(wordMatches, deckA, deckB, activeDeck)
  const activeSuggestions = suggestions.filter((s) => s.status !== 'passed')

  return (
    <div className="flex flex-col gap-4">
      {/* Transition banner */}
      <AnimatePresence>
        {transitionInfo && isMixing && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="wp-glass rounded-xl px-3 py-2 flex items-center gap-2"
          >
            <ArrowLeftRight className="h-4 w-4 text-[var(--wp-accent-hi)]" />
            <span className="wp-body">{transitionInfo}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Wordplay cues */}
      {activeSuggestions.length > 0 && (
        <div className="rounded-xl border border-[var(--wp-border)] bg-[var(--wp-surface)]/60 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="wp-label">Wordplay timeline</span>
            <span className="wp-caption">
              {activeSuggestions.length} cue{activeSuggestions.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex flex-col gap-1.5 max-h-[160px] overflow-y-auto wp-scroll pr-1">
            {activeSuggestions.map((s, i) => (
              <div
                key={i}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-2.5 py-1.5',
                  s.status === 'now' && 'bg-[var(--wp-ready)]/15 border border-[var(--wp-ready)]/40',
                  s.status === 'imminent' && 'bg-[var(--wp-accent)]/10 border border-[var(--wp-accent)]/30',
                  s.status === 'upcoming' && 'bg-[var(--wp-surface-2)]',
                )}
              >
                <span className="wp-body truncate flex-1 italic">"{s.match.phrase}"</span>
                <span className="wp-mono text-[var(--wp-muted)] text-[11px] whitespace-nowrap">
                  A {fmtTime(s.timeA)} → B {fmtTime(s.timeB)}
                </span>
                {s.status === 'now' ? (
                  <span className="inline-flex items-center rounded-md bg-[var(--wp-ready)] text-[var(--wp-bg)] text-[10px] font-bold px-1.5 py-0.5">NOW</span>
                ) : s.status === 'imminent' ? (
                  <span className="inline-flex items-center rounded-md bg-[var(--wp-accent)] text-white text-[10px] font-bold px-1.5 py-0.5">
                    {Math.ceil(s.secsUntil)}s
                  </span>
                ) : (
                  <span className="wp-mono text-[var(--wp-muted)] text-[10px]">in {Math.ceil(s.secsUntil)}s</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Decks + mix button */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)] gap-4 items-stretch">
        <DeckTimeline
          deck={deckA}
          deckId="A"
          region={regionA}
          onRegionChange={setRegionA}
          wordMatches={wordMatches}
          onLoadFile={onLoadFileA}
          onSeek={onSeek}
          onClearDeck={onClearDeck}
          isMixing={isMixing}
          isActive={activeDeck === 'A' || phase === 'blending'}
          phase={phase}
          showYouTube={showYouTube}
          onWordplaylistDrop={onWordplaylistDropA}
        />

        <div className="flex items-center justify-center">
          <MixButton
            phase={phase}
            canStart={canStart}
            onStart={onStart}
            onStop={onStop}
          />
        </div>

        <DeckTimeline
          deck={deckB}
          deckId="B"
          region={regionB}
          onRegionChange={setRegionB}
          wordMatches={wordMatches}
          onLoadFile={onLoadFileB}
          onSeek={onSeek}
          onClearDeck={onClearDeck}
          isMixing={isMixing}
          isActive={activeDeck === 'B' || phase === 'blending'}
          phase={phase}
          showYouTube={showYouTube}
          onWordplaylistDrop={onWordplaylistDropB}
        />
      </div>
    </div>
  )
}
