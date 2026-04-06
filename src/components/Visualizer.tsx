import { useRef, useEffect, useCallback, useState } from 'react';
import type { AutomixPhase } from '../audio/types';
import type { TimedLine } from '../lyrics/types';
import {
  findActiveLyricIndex,
  LYRIC_TIMING_LEAD_SEC,
} from '../lyrics/lyricSync';
import butterchurn from 'butterchurn';
import butterchurnPresets from 'butterchurn-presets';

export interface VisualizerProps {
  analyser: AnalyserNode | null;
  phase: AutomixPhase;
  lyrics?: TimedLine[] | null;
  getLyricTime?: () => number;
  wordplayPhrase?: string | null;
}

const CURATED_PRESETS = [
  'Flexi, martin + geiss - dedicated to the sherwin maxawow',
  'Rovastar - Fractopia (Fantic Dancing Lights Mix)',
  'Geiss - Cosmic Dust 2 - Flicker Fix',
  'Flexi + stahlregen - jelly showoff parade',
  'martin - castle in the air',
  'Rovastar + Loadus - Psychedelic Highway',
  'Flexi - predator-prey-4b',
  'Geiss - Cauldron',
  'Flexi, fishbrain + Geiss - The Machine Behind the Curtain',
  'Unchained & Rovastar - Wormhole Pillars (Remix)',
  'Flexi + Martin - cascading decay swing',
  'Zylot - Spiral Artifact',
  'Rovastar & Rocke - Sugar Rush (Angel Candy Mix)',
  'Flexi - truly mind-expanding',
  'Geiss + Flexi + Martin - disconnected',
  'martin - liquid wood slow',
];

const PRESET_CYCLE_MS = 25_000;
const NBSP = '\u00a0';

const LYRIC_FONTS = [
  '"Inter", sans-serif',
  '"Permanent Marker", cursive',
  '"Orbitron", sans-serif',
  '"Righteous", sans-serif',
  '"Concert One", sans-serif',
  '"Audiowide", sans-serif',
  '"Silkscreen", monospace',
  '"Bungee Shade", system-ui',
  '"Monoton", sans-serif',
  '"Rubik Glitch", system-ui',
  '"Press Start 2P", monospace',
  '"Nabla", system-ui',
];

let _fallbackCtx: AudioContext | null = null;
function getFallbackCtx(): AudioContext {
  if (!_fallbackCtx) _fallbackCtx = new AudioContext();
  return _fallbackCtx;
}

function getCreateVisualizer(mod: unknown): typeof butterchurn.createVisualizer {
  const m = mod as Record<string, unknown>;
  if (typeof m.createVisualizer === 'function') return m.createVisualizer as typeof butterchurn.createVisualizer;
  if (m.default && typeof (m.default as Record<string, unknown>).createVisualizer === 'function') {
    return (m.default as typeof butterchurn).createVisualizer;
  }
  throw new Error('[Visualizer] butterchurn has no createVisualizer');
}

function getGetPresets(mod: unknown): typeof butterchurnPresets.getPresets {
  const m = mod as Record<string, unknown>;
  if (typeof m.getPresets === 'function') return m.getPresets as typeof butterchurnPresets.getPresets;
  if (m.default && typeof (m.default as Record<string, unknown>).getPresets === 'function') {
    return (m.default as typeof butterchurnPresets).getPresets;
  }
  throw new Error('[Visualizer] butterchurn-presets has no getPresets');
}

export function Visualizer({
  analyser,
  phase,
  lyrics,
  getLyricTime,
  wordplayPhrase,
}: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const vizRef = useRef<ReturnType<typeof butterchurn.createVisualizer> | null>(null);
  const frameRef = useRef(0);
  const presetIdxRef = useRef(0);
  const lastCycleRef = useRef(0);
  const connectedRef = useRef<AnalyserNode | null>(null);
  const allPresetsRef = useRef<Record<string, unknown> | null>(null);
  const poolRef = useRef<string[]>([]);
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [vizPaused, setVizPaused] = useState(false);
  const vizPausedRef = useRef(false);

  /* ── Lyric refs: all written imperatively from rAF, never via setState ── */
  const rowPrevRef = useRef<HTMLDivElement>(null);
  const rowCurrRef = useRef<HTMLDivElement>(null);
  const rowNextRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const lyricIdxRef = useRef(-1);
  const fontIdxRef = useRef(0);
  /* Beat-reactive blink state */
  const blinkWhiteRef = useRef(true);
  const freqDataRef = useRef<Uint8Array | null>(null);
  const energyAvgRef = useRef(0);

  const lyricsRef = useRef(lyrics);
  lyricsRef.current = lyrics;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const getLyricTimeRef = useRef(getLyricTime);
  getLyricTimeRef.current = getLyricTime;
  const wordplayPhraseRef = useRef(wordplayPhrase);
  wordplayPhraseRef.current = wordplayPhrase;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          setReady(true);
          ro.disconnect();
        }
      }
    });
    ro.observe(container);
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setReady(true);
      ro.disconnect();
    }
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const syncFs = () => {
      const el = containerRef.current;
      if (!el) return;
      const fs =
        document.fullscreenElement === el ||
        (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement === el;
      setIsFullscreen(fs);
    };
    document.addEventListener('fullscreenchange', syncFs);
    document.addEventListener('webkitfullscreenchange', syncFs as EventListener);
    syncFs();
    return () => {
      document.removeEventListener('fullscreenchange', syncFs);
      document.removeEventListener('webkitfullscreenchange', syncFs as EventListener);
    };
  }, []);

  const toggleFullscreen = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    try {
      const fs =
        document.fullscreenElement === el ||
        (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement === el;
      if (fs) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else (document as unknown as { webkitExitFullscreen?: () => Promise<void> }).webkitExitFullscreen?.();
      } else if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else {
        await (el as unknown as { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen?.();
      }
    } catch (err) {
      console.warn('[Visualizer] fullscreen:', err);
    }
  }, []);

  const toggleVizPause = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setVizPaused((p) => {
      const next = !p;
      vizPausedRef.current = next;
      return next;
    });
  }, []);

  /* ── Butterchurn init ── */
  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ac = analyser
      ? (analyser.context as AudioContext)
      : getFallbackCtx();

    const rect = container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    canvas.width = w;
    canvas.height = h;

    let createViz: typeof butterchurn.createVisualizer;
    let loadPresets: typeof butterchurnPresets.getPresets;
    try {
      createViz = getCreateVisualizer(butterchurn);
      loadPresets = getGetPresets(butterchurnPresets);
    } catch (err) {
      console.error(err);
      setInitError(String(err));
      return;
    }

    let viz: ReturnType<typeof butterchurn.createVisualizer>;
    try {
      viz = createViz(ac, canvas, { width: w, height: h, pixelRatio: window.devicePixelRatio || 1 });
    } catch (err) {
      console.error('[Visualizer] createVisualizer failed:', err);
      setInitError(`WebGL init failed: ${err}`);
      return;
    }

    vizRef.current = viz;
    setInitError(null);

    if (analyser && connectedRef.current !== analyser) {
      try { viz.connectAudio(analyser); connectedRef.current = analyser; }
      catch (err) { console.warn('[Visualizer] connectAudio failed:', err); }
    }

    const presets = loadPresets();
    allPresetsRef.current = presets;
    const curated = CURATED_PRESETS.filter(k => k in presets);
    const pool = curated.length >= 4 ? curated : Object.keys(presets);
    poolRef.current = pool;
    const startIdx = Math.floor(Math.random() * pool.length);
    presetIdxRef.current = startIdx;
    viz.loadPreset(presets[pool[startIdx]], 0.0);
    lastCycleRef.current = performance.now();

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const nw = Math.max(1, Math.round(entry.contentRect.width));
        const nh = Math.max(1, Math.round(entry.contentRect.height));
        canvas.width = nw;
        canvas.height = nh;
        viz.setRendererSize(nw, nh);
      }
    });
    ro.observe(container);

    /* ── Unified rAF loop: Butterchurn + imperative lyric DOM writes ── */
    const draw = () => {
      if (!vizPausedRef.current) {
        viz.render();
        const now = performance.now();
        if (now - lastCycleRef.current > PRESET_CYCLE_MS) {
          lastCycleRef.current = now;
          const nextIdx = (presetIdxRef.current + 1) % pool.length;
          presetIdxRef.current = nextIdx;
          viz.loadPreset(presets[pool[nextIdx]], 3.0);
        }
      }

      // Lyrics UI disabled for now
      // beatBlink();
      // syncLyricsDom();

      frameRef.current = requestAnimationFrame(draw);
    };
    frameRef.current = requestAnimationFrame(draw);

    return () => { cancelAnimationFrame(frameRef.current); ro.disconnect(); };
  }, [analyser, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Beat-reactive blink: read analyser energy each frame, toggle white/black
   * when a transient (beat) is detected. Between beats, randomly flip with
   * low probability so it still feels alive.
   */
  const beatBlink = useCallback(() => {
    const prev = rowPrevRef.current;
    const curr = rowCurrRef.current;
    const next = rowNextRef.current;
    if (!prev || !curr || !next) return;

    const an = analyser;
    if (!an) return;

    if (!freqDataRef.current || freqDataRef.current.length !== an.frequencyBinCount) {
      freqDataRef.current = new Uint8Array(an.frequencyBinCount);
    }
    const fd = freqDataRef.current;
    an.getByteFrequencyData(fd);

    // Low-frequency energy (kick/snare range, bins 0-15 ≈ 0-650 Hz)
    let sum = 0;
    const bins = Math.min(16, fd.length);
    for (let i = 0; i < bins; i++) sum += fd[i];
    const energy = sum / bins / 255; // 0–1

    const prevAvg = energyAvgRef.current;
    const smoothing = 0.85;
    energyAvgRef.current = prevAvg * smoothing + energy * (1 - smoothing);

    const isBeat = energy > energyAvgRef.current + 0.12 && energy > 0.25;
    const randomFlip = Math.random() < 0.06;

    if (isBeat || randomFlip) {
      blinkWhiteRef.current = !blinkWhiteRef.current;
    }

    const w = blinkWhiteRef.current;
    const currColor = w ? '#ffffff' : '#000000';
    const prevNextColor = w ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.6)';

    curr.style.color = currColor;
    prev.style.color = prevNextColor;
    next.style.color = prevNextColor;
  }, [analyser]);

  /**
   * Pure-DOM lyric sync — runs inside the Butterchurn rAF loop.
   * Reads audio time, finds the active index, writes textContent directly.
   * No React setState, no CSS transitions, no batching delay.
   */
  const syncLyricsDom = useCallback(() => {
    const win = windowRef.current;
    const prev = rowPrevRef.current;
    const curr = rowCurrRef.current;
    const next = rowNextRef.current;
    if (!win || !prev || !curr || !next) return;

    const p = phaseRef.current;
    const isActive = p !== 'idle' && p !== 'done';
    const isBlending = p === 'blending';

    if (!isActive) {
      if (win.style.display !== 'none') win.style.display = 'none';
      lyricIdxRef.current = -1;
      return;
    }

    // During blending: show wordplay text in the same 3-row strip
    if (isBlending) {
      if (win.style.display === 'none') win.style.display = '';
      const wp = wordplayPhraseRef.current;
      const label = wp ? `WORDPLAYING "${wp}"` : 'WORDPLAYING';

      if (curr.textContent !== label) {
        prev.textContent = NBSP;
        curr.textContent = label;
        next.textContent = NBSP;
        curr.classList.add('viz-lyrics-row--wp');
      }
      lyricIdxRef.current = -1;
      return;
    }

    // Normal playback: sync lyrics from audio clock
    curr.classList.remove('viz-lyrics-row--wp');

    const lines = lyricsRef.current;
    const getTime = getLyricTimeRef.current;
    if (!lines?.length || !getTime) {
      if (win.style.display !== 'none') win.style.display = 'none';
      lyricIdxRef.current = -1;
      return;
    }

    if (win.style.display === 'none') win.style.display = '';

    const t = getTime() + LYRIC_TIMING_LEAD_SEC;
    const idx = findActiveLyricIndex(lines, t);
    if (idx < 0 || idx === lyricIdxRef.current) return;

    lyricIdxRef.current = idx;
    prev.textContent = idx > 0 ? lines[idx - 1].text : NBSP;
    curr.textContent = lines[idx].text;
    next.textContent = idx < lines.length - 1 ? lines[idx + 1].text : NBSP;
  }, []);

  const cycleLyricFont = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const win = windowRef.current;
    if (!win) return;
    fontIdxRef.current = (fontIdxRef.current + 1) % LYRIC_FONTS.length;
    win.style.fontFamily = LYRIC_FONTS[fontIdxRef.current];
  }, []);

  const cyclePreset = useCallback(() => {
    if (!vizRef.current || !allPresetsRef.current || poolRef.current.length === 0) return;
    presetIdxRef.current = (presetIdxRef.current + 1) % poolRef.current.length;
    const name = poolRef.current[presetIdxRef.current];
    vizRef.current.loadPreset(allPresetsRef.current[name], 2.0);
  }, []);

  const handleClick = useCallback(() => {
    const ac = analyser?.context as AudioContext | undefined;
    if (ac?.state === 'suspended') ac.resume();
    cyclePreset();
  }, [cyclePreset, analyser]);

  return (
    <div className="visualizer" onClick={handleClick}>
      <div ref={containerRef} className="visualizer-inner">
        <canvas ref={canvasRef} className="visualizer-canvas" />

        <div className="visualizer-toolbar">
          <button
            type="button"
            className="visualizer-icon-btn"
            title={vizPaused ? 'Resume visualizer' : 'Pause visualizer'}
            aria-label={vizPaused ? 'Resume visualizer' : 'Pause visualizer'}
            aria-pressed={vizPaused}
            onClick={toggleVizPause}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {vizPaused ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="visualizer-icon-btn"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            aria-pressed={isFullscreen}
            onClick={toggleFullscreen}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {isFullscreen ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
            )}
          </button>
        </div>

        {initError && (
          <div className="visualizer-idle-hint" style={{ color: 'rgba(255,100,100,0.5)' }}>
            {initError}
          </div>
        )}

        {!initError && phase === 'idle' && (
          <div className="visualizer-idle-hint">CLICK TO CYCLE PRESETS</div>
        )}

        {/* Lyrics UI disabled for now */}
      </div>
    </div>
  );
}
