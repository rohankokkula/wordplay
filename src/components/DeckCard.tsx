import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type CSSProperties,
  type PointerEvent,
  type DragEvent,
  type MouseEvent,
} from 'react';
import type { DeckState } from '../audio/types';
import type { DeckId } from './MusicSearch';
import { MusicSearch } from './MusicSearch';

const BAR_COUNT = 200;

export interface DeckCardProps {
  deck: DeckState;
  deckId: DeckId;
  accentColor: string;
  isActive: boolean;
  isMixing: boolean;
  blendProgress: number;
  transitionSegment: { startSec: number; endSec: number } | null;
  onLoadFile: (file: File) => void;
  onSeek: (ratio: number) => void;
  onClear: () => void;
}

export function cleanTrackName(filename: string): string {
  const base = filename.replace(/\.[^/.]+$/, '');
  return base.replace(/_/g, ' ').trim();
}

export function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const YT_ID_RE = /[a-zA-Z0-9_-]{11}/g;

function idOk(id: string): boolean {
  return /^[a-zA-Z0-9_-]{11}$/.test(id);
}

export function extractVideoId(filename: string): string | null {
  YT_ID_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = YT_ID_RE.exec(filename)) !== null) {
    if (idOk(m[0])) return m[0];
  }
  return null;
}

function hslBarStyle(peak: number, index: number, total: number): CSSProperties {
  const amp = Math.max(0, Math.min(1, peak));
  let hue: number;
  if (amp < 0.35) {
    hue = 240 + ((180 - 240) * amp) / 0.35;
  } else if (amp < 0.7) {
    hue = 180 + ((30 - 180) * (amp - 0.35)) / 0.35;
  } else {
    hue = 30;
  }
  const pos = total > 1 ? index / (total - 1) : 0;
  hue = (hue + pos * 8) % 360;
  const light = 20 + amp * 40;
  return { backgroundColor: `hsl(${hue} 75% ${light}%)` };
}

function cueMarkerClass(label: string): 'beat' | 'vocal' | 'drop' | 'other' {
  const l = label.toLowerCase();
  if (l.includes('beat')) return 'beat';
  if (l.includes('vocal')) return 'vocal';
  if (l.includes('drop')) return 'drop';
  return 'other';
}

export function DeckCard({
  deck,
  deckId,
  accentColor,
  isActive,
  isMixing,
  blendProgress,
  transitionSegment,
  onLoadFile,
  onSeek,
  onClear,
}: DeckCardProps) {
  const deckSlug = deckId.toLowerCase();
  const inputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const barsContainerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const timeRef = useRef(deck.currentTime);
  timeRef.current = deck.currentTime;

  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [waveDragging, setWaveDragging] = useState(false);

  useEffect(() => {
    setThumbFailed(false);
  }, [deck.file?.name]);

  const analysis = deck.analysis;
  const duration = analysis?.duration ?? 0;

  const liveProgress =
    duration > 0 ? Math.min(1, deck.currentTime / duration) : 0;
  const progress = dragRatio ?? liveProgress;

  useEffect(() => {
    const ph = playheadRef.current;
    const bc = barsContainerRef.current;
    if (!ph || !bc || !analysis) return;

    let raf = 0;
    const sync = () => {
      if (draggingRef.current) {
        raf = requestAnimationFrame(sync);
        return;
      }
      const dur = analysis.duration;
      const t = timeRef.current;
      const p = dur > 0 ? Math.min(1, t / dur) : 0;
      ph.style.left = `${p * 100}%`;
      const bars = bc.children;
      const barCount = bars.length;
      const playedIdx = Math.floor(p * barCount);
      for (let i = 0; i < barCount; i++) {
        const bar = bars[i] as HTMLElement;
        if (i < playedIdx) {
          if (!bar.classList.contains('played')) bar.classList.add('played');
        } else if (bar.classList.contains('played')) {
          bar.classList.remove('played');
        }
      }
      raf = requestAnimationFrame(sync);
    };
    raf = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(raf);
  }, [analysis]);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.currentTarget.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) onLoadFile(file);
    },
    [onLoadFile],
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

  const handlePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!barRef.current || duration <= 0) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      draggingRef.current = true;
      setWaveDragging(true);
      const r = ratioFromPointer(e.clientX);
      setDragRatio(r);
      paintAtRatio(r);
    },
    [duration, ratioFromPointer, paintAtRatio],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const r = ratioFromPointer(e.clientX);
      setDragRatio(r);
      paintAtRatio(r);
    },
    [ratioFromPointer, paintAtRatio],
  );

  const endDrag = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setWaveDragging(false);
      const r = ratioFromPointer(e.clientX);
      setDragRatio(null);
      onSeek(r);
    },
    [onSeek, ratioFromPointer],
  );

  const handleBarClick = useCallback(
    (e: MouseEvent) => {
      if (!barRef.current || duration <= 0) return;
      const ratio = ratioFromPointer(e.clientX);
      onSeek(ratio);
    },
    [duration, onSeek, ratioFromPointer],
  );

  const barElements = useMemo(() => {
    if (!analysis) return null;
    const peaks = analysis.peaks;
    const n = peaks.length;
    return Array.from({ length: BAR_COUNT }, (_, i) => {
      const idx = Math.floor((i / BAR_COUNT) * n);
      const peak = peaks[idx] ?? 0;
      const h = Math.max(2, Math.min(48, peak * 44 + 4));
      return (
        <div
          key={i}
          className="deck-wave-bar"
          style={{
            ...hslBarStyle(peak, i, BAR_COUNT),
            height: `${h}px`,
          }}
        />
      );
    });
  }, [analysis]);

  const cueMarkers = useMemo(() => {
    if (!analysis) return [];
    const dur = analysis.duration;
    if (dur <= 0) return [];
    return analysis.cuePoints.map((cue, i) => {
      const left = Math.max(0, Math.min(100, (cue.time / dur) * 100));
      const kind = cueMarkerClass(cue.label);
      let color = accentColor;
      if (kind === 'vocal') color = 'var(--success, #4ade80)';
      else if (kind === 'drop') color = 'var(--accent-b, #f97316)';
      else if (kind === 'beat') color = accentColor;
      else color = 'var(--text-muted, #71717a)';
      return (
        <div
          key={`${cue.time}-${i}`}
          className="deck-cue"
          style={{ left: `${left}%`, color }}
          title={cue.label}
        />
      );
    });
  }, [analysis, accentColor]);

  const transitionStyle = useMemo((): CSSProperties | undefined => {
    if (!transitionSegment || !analysis || !isMixing) return undefined;
    const dur = analysis.duration;
    if (dur <= 0) return undefined;
    const left = (transitionSegment.startSec / dur) * 100;
    const w =
      ((transitionSegment.endSec - transitionSegment.startSec) / dur) * 100;
    return {
      left: `${left}%`,
      width: `${Math.max(0, w)}%`,
      opacity: Math.max(0.2, Math.min(1, blendProgress || 0.6)),
    };
  }, [transitionSegment, analysis, isMixing, blendProgress]);

  const videoId = deck.file ? extractVideoId(deck.file.name) : null;
  const showThumb = videoId && !thumbFailed;

  if (!deck.file && !deck.isAnalyzing) {
    return (
      <div
        className={`deck-card deck-card--empty deck-card--${deckSlug} ${
          isActive ? 'deck-card--active' : ''
        }`}
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.currentTarget.classList.add('drag-over');
        }}
        onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
      >
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onLoadFile(f);
          }}
        />
        <div className="deck-empty">
          <p className="deck-empty-label">Search or drop a track</p>
          <MusicSearch
            variant="embedded"
            targetDeck={deckId}
            disabled={isMixing}
            onAddToDeck={(_d, file) => onLoadFile(file)}
          />
        </div>
      </div>
    );
  }

  if (deck.isAnalyzing && !analysis) {
    return (
      <div
        className={`deck-card deck-card--${deckSlug} ${
          isActive ? 'deck-card--active' : ''
        }`}
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.currentTarget.classList.add('drag-over');
        }}
        onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
      >
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onLoadFile(f);
          }}
        />
        <div className="deck-analyzing">
          <div className="spinner" />
          <span>Analyzing...</span>
        </div>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div
        className={`deck-card deck-card--${deckSlug} ${
          isActive ? 'deck-card--active' : ''
        }`}
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.currentTarget.classList.add('drag-over');
        }}
        onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
      >
        {deck.error && <div className="tl-error">{deck.error}</div>}
        <div className="deck-header">
          <div
            className="deck-thumb deck-thumb--placeholder"
            style={{
              background: `linear-gradient(135deg, ${accentColor}44, transparent)`,
            }}
          />
          <div className="deck-info">
            <div className="deck-title" title={deck.file?.name ?? ''}>
              {deck.file ? cleanTrackName(deck.file.name) : '—'}
            </div>
            <div className="deck-artist" />
          </div>
          <button
            type="button"
            className="deck-clear-btn"
            aria-label="Clear deck"
            onClick={onClear}
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  const title = deck.file ? cleanTrackName(deck.file.name) : '—';

  return (
    <div
      className={`deck-card deck-card--${deckSlug} ${
        isActive ? 'deck-card--active' : ''
      }`}
      onDrop={handleDrop}
      onDragOver={(e) => {
        e.preventDefault();
        e.currentTarget.classList.add('drag-over');
      }}
      onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onLoadFile(f);
        }}
      />

      {deck.isAnalyzing && (
        <div className="deck-analyzing">
          <div className="spinner" />
          <span>Analyzing...</span>
        </div>
      )}

      {deck.error && <div className="tl-error">{deck.error}</div>}

      <div className="deck-header">
        {showThumb ? (
          <img
            className="deck-thumb"
            src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
            alt=""
            onError={() => setThumbFailed(true)}
          />
        ) : (
          <div
            className="deck-thumb deck-thumb--placeholder"
            style={{
              background: `linear-gradient(135deg, ${accentColor}55, ${accentColor}18)`,
            }}
          />
        )}
        <div className="deck-info">
          <div className="deck-title" title={deck.file?.name ?? ''}>
            {title}
          </div>
          <div className="deck-artist" />
          <div className="deck-badges">
            <span
              className="deck-badge deck-badge--bpm"
              style={{ borderColor: accentColor, color: accentColor }}
            >
              {`${Math.round(analysis.bpm)} BPM`}
            </span>
            <span className="deck-badge deck-badge--dur">
              {fmtTime(analysis.duration)}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="deck-clear-btn"
          aria-label="Clear deck"
          onClick={onClear}
        >
          ×
        </button>
      </div>

      <div
        className={`deck-waveform-wrap ${
          waveDragging ? 'deck-waveform-wrap--dragging' : ''
        }`}
        ref={barRef}
        onClick={handleBarClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="deck-waveform" ref={barsContainerRef}>
          {barElements}
        </div>

        <div
          className="deck-playhead"
          ref={playheadRef}
          style={{ left: `${progress * 100}%` }}
        >
          <div className="deck-playhead-knob" />
        </div>

        {cueMarkers}

        {transitionStyle && (
          <div
            className="deck-transition-overlay"
            style={transitionStyle}
          />
        )}

        {dragRatio !== null && (
          <div
            className="tl-seek-tooltip"
            style={{ left: `${progress * 100}%` }}
          >
            {fmtTime(progress * duration)}
          </div>
        )}
      </div>
    </div>
  );
}
