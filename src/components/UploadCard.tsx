import { useRef, useCallback } from 'react';
import type { DeckState, AutomixPhase } from '../audio/types';

interface UploadCardProps {
  deck: DeckState;
  label: string;
  onLoadFile: (file: File) => void;
  accentColor: string;
  isActive: boolean;
  /** When false, mini-waveform stays monochrome (no deck accent on played bars). */
  waveformAccent: boolean;
  phase: AutomixPhase;
  /** Planned crossfade window on this deck’s timeline (outgoing deck), or idle preview for A. */
  transitionSegment: { startSec: number; endSec: number } | null;
}

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const BAR_COUNT = 60;

export function UploadCard({
  deck,
  label,
  onLoadFile,
  accentColor,
  isActive,
  waveformAccent,
  phase,
  transitionSegment,
}: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) onLoadFile(file);
  }, [onLoadFile]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('drag-over');
  };

  const duration = deck.analysis?.duration ?? 0;
  const progress = duration > 0 ? Math.min(1, deck.currentTime / duration) : 0;
  const remaining = duration - deck.currentTime;
  const isMixing = phase !== 'idle' && phase !== 'done';

  // Compute which bar index the drop falls on
  const dropBarIdx = deck.analysis
    ? Math.floor((deck.analysis.dropTime / deck.analysis.duration) * BAR_COUNT)
    : -1;

  const transBarRange =
    transitionSegment && duration > 0
      ? {
          start: (transitionSegment.startSec / duration) * BAR_COUNT,
          end: (transitionSegment.endSec / duration) * BAR_COUNT,
        }
      : null;

  return (
    <div
      className={`upload-card ${deck.analysis ? 'loaded' : ''} ${isActive ? 'card-active' : ''}`}
      style={{ '--accent': accentColor } as React.CSSProperties}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={() => !deck.file && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onLoadFile(file);
        }}
      />

      <div className="upload-header-row">
        <div className="upload-label">{label}</div>
        {deck.isPlaying && isMixing && (
          <div className="upload-live-badge">
            <span className="upload-live-dot" aria-hidden />
            LIVE
          </div>
        )}
      </div>

      {deck.isAnalyzing && (
        <div className="upload-status">
          <div className="spinner" />
          <span>Analyzing...</span>
        </div>
      )}

      {deck.error && <div className="upload-error">{deck.error}</div>}

      {!deck.file && !deck.isAnalyzing && (
        <div className="upload-prompt">
          Drop audio file here<br />or click to browse
        </div>
      )}

      {deck.file && !deck.isAnalyzing && (
        <div className="upload-info">
          <div className="upload-filename">{deck.file.name}</div>
          {deck.analysis && (
            <div className="upload-meta">
              <span className="upload-bpm">{deck.analysis.bpm} BPM</span>
              <span className="upload-duration">{fmtTime(deck.analysis.duration)}</span>
              {deck.analysis.vocalSegments.length > 0 && (
                <span className="upload-vocals">
                  {deck.analysis.vocalSegments.length} vocal{deck.analysis.vocalSegments.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}

          {deck.analysis && (
            <div
              className={`upload-wave-track${waveformAccent ? '' : ' upload-wave-track--mono'}`}
            >
              <div
                className={`upload-miniwave${waveformAccent ? '' : ' upload-miniwave--mono'}`}
              >
                {Array.from({ length: BAR_COUNT }, (_, i) => {
                  const idx = Math.floor((i / BAR_COUNT) * deck.analysis!.peaks.length);
                  const h = Math.max(2, deck.analysis!.peaks[idx] * 28);
                  const played = (i / BAR_COUNT) < progress;
                  const isDrop = i >= dropBarIdx && i < dropBarIdx + 3;
                  const isTransition =
                    transBarRange != null &&
                    i >= Math.floor(transBarRange.start) &&
                    i < Math.ceil(transBarRange.end);
                  return (
                    <div
                      key={i}
                      className={`miniwave-bar ${played ? 'played' : ''} ${isDrop ? 'drop-bar' : ''} ${isTransition ? 'transition-bar' : ''}`}
                      style={{ height: `${h}px` }}
                    />
                  );
                })}
              </div>
              {/* Beat tick marks (every 4th beat = downbeat) */}
              {deck.analysis.beatTimes.filter((_, i) => i % 4 === 0).map((bt, i) => {
                const pos = (bt / duration) * 100;
                if (pos > 100) return null;
                return (
                  <div
                    key={`beat-${i}`}
                    className="beat-tick"
                    style={{ left: `${pos}%` }}
                  />
                );
              })}
              {dropBarIdx >= 0 && (
                <div
                  className="drop-marker"
                  style={{ left: `${(dropBarIdx / BAR_COUNT) * 100}%` }}
                >
                  DROP
                </div>
              )}
              {transBarRange != null && transBarRange.end > transBarRange.start && (
                <div
                  className="transition-marker"
                  style={{ left: `${(transBarRange.start / BAR_COUNT) * 100}%` }}
                >
                  BLEND
                </div>
              )}
              {isMixing && deck.isPlaying && (
                <div
                  className="playhead-line"
                  style={{ left: `${progress * 100}%` }}
                />
              )}
            </div>
          )}

          {deck.analysis && isMixing && deck.isPlaying && (
            <div
              className={`upload-time-row${waveformAccent ? '' : ' upload-time-row--mono'}`}
            >
              <span className="upload-time-current">{fmtTime(deck.currentTime)}</span>
              <span className="upload-time-remaining">-{fmtTime(remaining)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
