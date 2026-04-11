import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import type { DeckState, AutomixPhase } from '../audio/types';
import type { WordMatch } from '../lyrics/types';
import { MusicSearch } from './MusicSearch';
import { MixButton } from './MixButton';
import { WORDPLAYLIST_DRAG_MIME } from '../wordplaylistDrag';

interface DeckTimelineProps {
  deck: DeckState;
  deckId: 'A' | 'B';
  wordMatches: WordMatch[];
  onLoadFile: (file: File) => void;
  onSeek: (deck: 'A' | 'B', ratio: number) => void;
  onClearDeck: (deck: 'A' | 'B') => void;
  isMixing: boolean;
  isActive: boolean;
  phase: AutomixPhase;
  showYouTube?: boolean;
  /** Drop a Wordplaylist row onto this deck (same as click-to-load). */
  onWordplaylistDrop?: (itemId: string) => void;
}

interface Props {
  deckA: DeckState;
  deckB: DeckState;
  wordMatches: WordMatch[];
  onLoadFileA: (file: File) => void;
  onLoadFileB: (file: File) => void;
  onSeek: (deck: 'A' | 'B', ratio: number) => void;
  phase: AutomixPhase;
  activeDeck: 'A' | 'B';
  isMixing: boolean;
  blendProgress: number;
  transitionInfo: string;
  canStart: boolean;
  onStart: () => void;
  onStop: () => void;
  onClearDeck: (deck: 'A' | 'B') => void;
  showYouTube?: boolean;
  onWordplaylistDropA?: (itemId: string) => void;
  onWordplaylistDropB?: (itemId: string) => void;
}

function dragHasLoadablePayload(e: React.DragEvent): boolean {
  const types = Array.from(e.dataTransfer.types);
  return types.includes(WORDPLAYLIST_DRAG_MIME) || types.includes('Files');
}

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const BAR_COUNT = 80;

function DeckTimeline({
  deck, deckId, wordMatches, onLoadFile, onSeek, onClearDeck,
  isMixing, isActive, phase, showYouTube, onWordplaylistDrop,
}: DeckTimelineProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const barsContainerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [dragRatio, setDragRatio] = useState<number | null>(null);

  const duration = deck.analysis?.duration ?? 0;
  const liveProgress = duration > 0 ? Math.min(1, deck.currentTime / duration) : 0;
  const progress = dragRatio ?? liveProgress;

  useEffect(() => {
    const ph = playheadRef.current;
    const bc = barsContainerRef.current;
    if (!ph || !bc) return;

    let raf = 0;
    const sync = () => {
      if (draggingRef.current) {
        raf = requestAnimationFrame(sync);
        return;
      }
      const dur = deck.analysis?.duration ?? 0;
      const p = dur > 0 ? Math.min(1, deck.currentTime / dur) : 0;
      ph.style.left = `${p * 100}%`;
      const bars = bc.children;
      const barCount = bars.length;
      const playedIdx = Math.floor(p * barCount);
      for (let i = 0; i < barCount; i++) {
        const bar = bars[i] as HTMLElement;
        if (i < playedIdx) {
          if (!bar.classList.contains('played')) bar.classList.add('played');
        } else {
          if (bar.classList.contains('played')) bar.classList.remove('played');
        }
      }
      raf = requestAnimationFrame(sync);
    };
    raf = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(raf);
  }, [deck.analysis?.duration, deck.currentTime]);

  const handleDeckDragOver = useCallback((e: React.DragEvent) => {
    if (!dragHasLoadablePayload(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    e.currentTarget.classList.add('drag-over');
  }, []);

  const handleDeckDragLeave = useCallback((e: React.DragEvent) => {
    e.currentTarget.classList.remove('drag-over');
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.currentTarget.classList.remove('drag-over');
      const id = e.dataTransfer.getData(WORDPLAYLIST_DRAG_MIME);
      if (id.trim() && onWordplaylistDrop) {
        onWordplaylistDrop(id);
        return;
      }
      const file = e.dataTransfer.files[0];
      if (file) onLoadFile(file);
    },
    [onLoadFile, onWordplaylistDrop],
  );

  const ratioFromPointer = useCallback((clientX: number) => {
    if (!barRef.current) return 0;
    const rect = barRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const paintAtRatio = useCallback((r: number) => {
    if (playheadRef.current) playheadRef.current.style.left = `${r * 100}%`;
    if (barsContainerRef.current) {
      const bars = barsContainerRef.current.children;
      const idx = Math.floor(r * bars.length);
      for (let i = 0; i < bars.length; i++) {
        (bars[i] as HTMLElement).classList.toggle('played', i < idx);
      }
    }
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!barRef.current || duration <= 0) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    draggingRef.current = true;
    const r = ratioFromPointer(e.clientX);
    setDragRatio(r);
    paintAtRatio(r);
  }, [duration, ratioFromPointer, paintAtRatio]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const r = ratioFromPointer(e.clientX);
    setDragRatio(r);
    paintAtRatio(r);
  }, [ratioFromPointer, paintAtRatio]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const r = ratioFromPointer(e.clientX);
    setDragRatio(null);
    onSeek(deckId, r);
  }, [deckId, onSeek, ratioFromPointer]);

  const handleBarClick = useCallback((e: React.MouseEvent) => {
    if (!barRef.current || duration <= 0) return;
    const ratio = ratioFromPointer(e.clientX);
    onSeek(deckId, ratio);
  }, [deckId, duration, onSeek, ratioFromPointer]);

  const matchTimestamps = useMemo(() => {
    if (!duration) return [];
    return wordMatches.map(m => {
      const t = deckId === 'A'
        ? (m.phraseOnsetA ?? m.timeA)
        : (m.phraseOnsetB ?? m.timeB);
      return {
        phrase: m.phrase,
        pos: (t / duration) * 100,
        time: t,
      };
    }).filter(m => m.pos >= 0 && m.pos <= 100);
  }, [wordMatches, duration, deckId]);

  if (!deck.file && !deck.isAnalyzing) {
    return (
      <div
        className={`tl-deck tl-deck--empty tl-deck--${deckId.toLowerCase()}`}
        onDrop={handleDrop}
        onDragOver={handleDeckDragOver}
        onDragLeave={handleDeckDragLeave}
      >
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onLoadFile(f); }}
        />
        <div className="tl-empty-content">
          <span className="tl-deck-label">DECK {deckId}</span>
          <div className="tl-empty-row">
            <button type="button" className="tl-upload-btn" onClick={() => inputRef.current?.click()}>
              Upload your music
            </button>
            {showYouTube && (
              <MusicSearch
                variant="embedded"
                targetDeck={deckId}
                disabled={isMixing}
                onAddToDeck={(_d, file) => onLoadFile(file)}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`tl-deck tl-deck--${deckId.toLowerCase()} ${isActive ? 'tl-deck--active' : ''} ${deck.isPlaying ? 'tl-deck--playing' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDeckDragOver}
      onDragLeave={handleDeckDragLeave}
    >
      {deck.isAnalyzing && (
        <div className="tl-analyzing">
          <div className="spinner" /> Analyzing...
        </div>
      )}

      {deck.error && <div className="tl-error">{deck.error}</div>}

      {deck.file && (
        <div className="tl-loaded">
          <div className="tl-header">
            <span className="tl-deck-label">DECK {deckId}</span>
            <span className="tl-title" title={deck.file.name}>
              {deck.file.name.replace(/\.(mp3|m4a|webm|opus|wav|flac|ogg)$/i, '')}
            </span>
            {deck.analysis && (
              <>
                <span className="tl-bpm-chip">{Math.round(deck.analysis.bpm)} BPM</span>
                <span className="tl-dur">{fmtTime(deck.analysis.duration)}</span>
              </>
            )}
            {deck.isPlaying && isMixing && <span className="tl-live-dot" />}
          </div>

          {deck.analysis && (
            <div
              className={`tl-bar-wrap ${draggingRef.current ? 'tl-bar-wrap--dragging' : ''}`}
              ref={barRef}
              onClick={handleBarClick}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              <div className="tl-waveform" ref={barsContainerRef}>
                {Array.from({ length: BAR_COUNT }, (_, i) => {
                  const idx = Math.floor((i / BAR_COUNT) * deck.analysis!.peaks.length);
                  const h = Math.max(2, Math.min(28, deck.analysis!.peaks[idx] * 24));
                  return (
                    <div
                      key={i}
                      className="tl-wave-bar"
                      style={{ height: `${h}px` }}
                    />
                  );
                })}
              </div>

              <div className="tl-playhead" ref={playheadRef} style={{ left: `${progress * 100}%` }}>
                <div className="tl-playhead-knob" />
              </div>

              {dragRatio !== null && (
                <div className="tl-seek-tooltip" style={{ left: `${progress * 100}%` }}>
                  {fmtTime(progress * duration)}
                </div>
              )}

              {matchTimestamps.map((m, i) => (
                <div
                  key={i}
                  className="tl-mix-marker"
                  style={{ left: `${m.pos}%` }}
                  title={`"${m.phrase}" at ${fmtTime(m.time)}`}
                >
                  <span className="tl-mix-marker-label">MIX</span>
                </div>
              ))}
            </div>
          )}

          <div className="tl-controls">
            <div className="tl-controls-times">
              {deck.analysis ? (
                <>
                  <span className="tl-time">{fmtTime(deck.currentTime)}</span>
                  <span className="tl-time tl-time--dim">
                    -{fmtTime(Math.max(0, duration - deck.currentTime))}
                  </span>
                </>
              ) : (
                <span className="tl-time tl-time--dim">—</span>
              )}
            </div>
            <button
              type="button"
              className="tl-deck-clear"
              title="Remove track and load another (stops mix if playing)"
              aria-label={`Remove track from deck ${deckId}`}
              onClick={() => onClearDeck(deckId)}
            >
              <span className="tl-deck-clear-icon" aria-hidden>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" />
                </svg>
              </span>
              <span className="tl-deck-clear-label">Remove</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface WordplaySuggestion {
  match: WordMatch;
  timeA: number;
  timeB: number;
  secsUntil: number;
  status: 'passed' | 'now' | 'imminent' | 'upcoming';
}

function triggerOnDeck(m: WordMatch, deck: 'A' | 'B'): number {
  return deck === 'A' ? (m.phraseOnsetA ?? m.timeA) : (m.phraseOnsetB ?? m.timeB);
}

function useWordplaySuggestions(
  wordMatches: WordMatch[],
  deckA: DeckState,
  deckB: DeckState,
  activeDeck: 'A' | 'B',
): WordplaySuggestion[] {
  return useMemo(() => {
    if (wordMatches.length === 0) return [];

    const activeTime = activeDeck === 'A' ? deckA.currentTime : deckB.currentTime;

    const seen = new Set<string>();
    const suggestions: WordplaySuggestion[] = [];

    for (const m of wordMatches) {
      const tA = triggerOnDeck(m, 'A');
      const tB = triggerOnDeck(m, 'B');
      const triggerTime = activeDeck === 'A' ? tA : tB;
      const diff = triggerTime - activeTime;
      const key = `${m.phrase.toLowerCase()}|${tA.toFixed(1)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let status: WordplaySuggestion['status'];
      if (diff < -2) status = 'passed';
      else if (diff < 0.5) status = 'now';
      else if (diff < 5) status = 'imminent';
      else status = 'upcoming';

      suggestions.push({ match: m, timeA: tA, timeB: tB, secsUntil: Math.max(0, diff), status });
    }

    suggestions.sort((a, b) => a.timeA - b.timeA);
    return suggestions;
  }, [wordMatches, deckA.currentTime, deckB.currentTime, activeDeck]);
}

export function TrackTimeline({
  deckA, deckB, wordMatches,
  onLoadFileA, onLoadFileB, onSeek, onClearDeck,
  phase, activeDeck, isMixing, blendProgress, transitionInfo,
  canStart, onStart, onStop, showYouTube,
  onWordplaylistDropA, onWordplaylistDropB,
}: Props) {
  const [merged, setMerged] = useState(false);

  useEffect(() => {
    if (phase === 'blending') {
      setMerged(true);
    } else if (phase === 'idle' || phase === 'done') {
      setMerged(false);
    }
  }, [phase]);

  const activeDeckState = activeDeck === 'A' ? deckA : deckB;
  const isActiveA = activeDeck === 'A' || phase === 'blending';
  const isActiveB = activeDeck === 'B' || phase === 'blending';

  const suggestions = useWordplaySuggestions(wordMatches, deckA, deckB, activeDeck);
  const activeSuggestions = suggestions.filter((s) => s.status !== 'passed');

  return (
    <div className={`track-timeline ${merged ? 'track-timeline--merged' : ''}`}>
      {transitionInfo && isMixing ? (
        <div className="tl-transport-bar">
          <span className="tl-transition-info">{transitionInfo}</span>
        </div>
      ) : null}

      {activeSuggestions.length > 0 && (
        <div className="tl-suggestions-panel">
          <div className="tl-suggestions-header">
            <span className="tl-suggestions-title">WORDPLAY TIMELINE</span>
            <span className="tl-suggestions-count">{activeSuggestions.length} cue{activeSuggestions.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="tl-suggestions-scroll">
            {activeSuggestions.map((s, i) => (
              <div
                key={i}
                className={`tl-suggestion-row tl-suggestion-row--${s.status}`}
              >
                <span className="tl-sug-phrase">"{s.match.phrase}"</span>
                <span className="tl-sug-times">
                  <span className="tl-sug-deck-label">A</span>
                  <span className="tl-sug-time">{fmtTime(s.timeA)}</span>
                  <span className="tl-sug-arrow">→</span>
                  <span className="tl-sug-deck-label">B</span>
                  <span className="tl-sug-time">{fmtTime(s.timeB)}</span>
                </span>
                <span className="tl-sug-status">
                  {s.status === 'now' ? (
                    <span className="tl-sug-badge tl-sug-badge--now">NOW</span>
                  ) : s.status === 'imminent' ? (
                    <span className="tl-sug-badge tl-sug-badge--imminent">{Math.ceil(s.secsUntil)}s</span>
                  ) : (
                    <span className="tl-sug-badge tl-sug-badge--upcoming">in {Math.ceil(s.secsUntil)}s</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="tl-body">
        <div className="tl-tracks-area">
          {merged ? (
            <div className="tl-merged-view">
              <div className="tl-merged-decks">
                <DeckTimeline
                  deck={activeDeckState}
                  deckId={activeDeck}
                  wordMatches={wordMatches}
                  onLoadFile={activeDeck === 'A' ? onLoadFileA : onLoadFileB}
                  onSeek={onSeek}
                  onClearDeck={onClearDeck}
                  isMixing={isMixing}
                  isActive={true}
                  phase={phase}
                  showYouTube={showYouTube}
                  onWordplaylistDrop={activeDeck === 'A' ? onWordplaylistDropA : onWordplaylistDropB}
                />
              </div>
            </div>
          ) : (
            <div className="tl-dual-view">
              <DeckTimeline
                deck={deckA}
                deckId="A"
                wordMatches={wordMatches}
                onLoadFile={onLoadFileA}
                onSeek={onSeek}
                onClearDeck={onClearDeck}
                isMixing={isMixing}
                isActive={isActiveA}
                phase={phase}
                showYouTube={showYouTube}
                onWordplaylistDrop={onWordplaylistDropA}
              />

              {wordMatches.length > 0 && deckA.analysis && deckB.analysis && (
                <div className="tl-match-connector">
                  {wordMatches.slice(0, 5).map((m, i) => (
                    <div
                      key={i}
                      className="tl-match-pill"
                      title={`"${m.phrase}" — A@${fmtTime(triggerOnDeck(m, 'A'))} ↔ B@${fmtTime(triggerOnDeck(m, 'B'))}`}
                    >
                      <span className="tl-match-phrase">"{m.phrase}"</span>
                      <span className="tl-match-times">
                        {fmtTime(triggerOnDeck(m, 'A'))} &harr; {fmtTime(triggerOnDeck(m, 'B'))}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <DeckTimeline
                deck={deckB}
                deckId="B"
                wordMatches={wordMatches}
                onLoadFile={onLoadFileB}
                onSeek={onSeek}
                onClearDeck={onClearDeck}
                isMixing={isMixing}
                isActive={isActiveB}
                phase={phase}
                showYouTube={showYouTube}
                onWordplaylistDrop={onWordplaylistDropB}
              />
            </div>
          )}
        </div>

        <div className="tl-disc-area">
          <MixButton
            phase={phase}
            canStart={canStart}
            onStart={onStart}
            onStop={onStop}
          />
        </div>
      </div>
    </div>
  );
}
