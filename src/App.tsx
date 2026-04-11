import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { DeckState, AutomixPhase, LogEntry } from './audio/types';
import {
  initMixer,
  setCrossfader,
  decodeFile,
  getAnalyser,
  setMasterVolume as applyMasterGain,
  getAudioContext,
} from './audio/mixer';
import { DeckPlayer } from './audio/deckPlayer';
import { analyzeTrackAsync } from './analysis/analyzeTrack';
import { AutomixController, type AutomixState } from './automix/controller';
import { Visualizer } from './components/Visualizer';
import { StatusLog } from './components/StatusLog';
import { TrackTimeline } from './components/TrackTimeline';
import { WordplayLogo } from './components/WordplayLogo';
import { playDiscSfx } from './audio/turntableWindDown';
import { useMediaQuery } from './hooks/useMediaQuery';
import { GENRE_PRESETS, GENRE_LIST, type GenreId } from './genre/genrePresets';
import { fetchSyncedLyrics, findCommonPhrases, transcribeWithWhisper } from './lyrics/lyricsService';
import type { TimedLine, WordMatch } from './lyrics/types';

const INITIAL_DECK: (id: 'A' | 'B') => DeckState = (id) => ({
  id,
  file: null,
  buffer: null,
  analysis: null,
  isPlaying: false,
  isAnalyzing: false,
  currentTime: 0,
  volume: 1,
  playbackRate: 1,
  error: null,
});

let logIdCounter = 0;

/** Crossfade length options in beats (4/4 grid from analysis). */
const BLEND_BEAT_OPTIONS = [8, 16, 32, 64, 128] as const;

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function App() {
  const isNarrowLayout = useMediaQuery('(max-width: 800px)');
  const [deckA, setDeckA] = useState<DeckState>(() => INITIAL_DECK('A'));
  const [deckB, setDeckB] = useState<DeckState>(() => INITIAL_DECK('B'));
  const [phase, setPhase] = useState<AutomixPhase>('idle');
  const [blendProgress, setBlendProgress] = useState(0);
  const [activeDeck, setActiveDeck] = useState<'A' | 'B'>('A');
  const [, setCurrentTrackName] = useState('');
  const [, setCurrentBpm] = useState(0);
  const [transitionInfo, setTransitionInfo] = useState('');
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [blendBeats, setBlendBeats] = useState<number>(32);
  const [genreStyle, setGenreStyleState] = useState<GenreId>('neutral');
  const [, setOutputPaused] = useState(false);
  const [lyricsA, setLyricsA] = useState<TimedLine[] | null>(null);
  const [lyricsB, setLyricsB] = useState<TimedLine[] | null>(null);
  const [wordMatches, setWordMatches] = useState<WordMatch[]>([]);
  const [wordplayPhrase, setWordplayPhrase] = useState<string | null>(null);
  const [lyricsResolved, setLyricsResolved] = useState({ a: false, b: false });

  const playerARef = useRef<DeckPlayer | null>(null);
  const playerBRef = useRef<DeckPlayer | null>(null);
  const automixRef = useRef<AutomixController | null>(null);
  const startTimeRef = useRef(0);
  const activeDeckRef = useRef<'A' | 'B'>('A');
  /** Incremented when a deck is cleared so in-flight loadFile runs ignore stale results. */
  const loadGenRef = useRef({ A: 0, B: 0 });

  const addLog = useCallback((text: string, source: LogEntry['source']) => {
    const elapsed = (performance.now() / 1000) - startTimeRef.current;
    setLogEntries((prev) => [
      ...prev,
      { id: logIdCounter++, time: Math.max(0, elapsed), text, source },
    ]);
  }, []);

  useEffect(() => {
    initMixer();
    setCrossfader(0);
    playerARef.current = new DeckPlayer('A');
    playerBRef.current = new DeckPlayer('B');
    automixRef.current = new AutomixController(
      playerARef.current,
      playerBRef.current,
      (state: AutomixState) => {
        setPhase(state.phase);
        setBlendProgress(state.blendProgress);
        setActiveDeck(state.activeDeck);
        setCurrentTrackName(state.currentTrackName);
        setCurrentBpm(state.currentBpm);
        setTransitionInfo(state.transitionInfo);
        setWordplayPhrase(state.wordplayPhrase);
      },
      addLog,
    );
    setAnalyserNode(getAnalyser());
    applyMasterGain(1);
  }, [addLog]);

  useEffect(() => {
    activeDeckRef.current = activeDeck;
  }, [activeDeck]);

  const getLyricTime = useCallback((): number => {
    const d = activeDeckRef.current;
    const p = d === 'A' ? playerARef.current : playerBRef.current;
    return p?.currentTime ?? 0;
  }, []);

  useEffect(() => {
    playerARef.current?.setVolume(deckA.volume);
  }, [deckA.volume]);

  useEffect(() => {
    playerBRef.current?.setVolume(deckB.volume);
  }, [deckB.volume]);

  useEffect(() => {
    const ac = getAudioContext();
    const sync = () => setOutputPaused(ac.state === 'suspended');
    ac.addEventListener('statechange', sync);
    sync();
    return () => ac.removeEventListener('statechange', sync);
  }, []);

  useEffect(() => {
    if (lyricsResolved.a && lyricsResolved.b && lyricsA && lyricsB) {
      const matches = findCommonPhrases(lyricsA, lyricsB);
      setWordMatches(matches);
      automixRef.current?.setWordMatches(matches);
      if (matches.length > 0) {
        addLog(`Found ${matches.length} wordplay hook(s): "${matches[0].phrase}"`, 'system');
      } else {
        addLog('No overlapping lyric hooks between tracks', 'system');
      }
    } else {
      setWordMatches([]);
      automixRef.current?.setWordMatches([]);
    }
  }, [lyricsA, lyricsB, lyricsResolved.a, lyricsResolved.b, addLog]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const pA = playerARef.current;
      const pB = playerBRef.current;
      if (pA?.playing) setDeckA((p) => ({ ...p, currentTime: pA.currentTime, isPlaying: true }));
      else setDeckA((p) => (p.isPlaying ? { ...p, isPlaying: false } : p));
      if (pB?.playing) setDeckB((p) => ({ ...p, currentTime: pB.currentTime, isPlaying: true }));
      else setDeckB((p) => (p.isPlaying ? { ...p, isPlaying: false } : p));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const loadFile = useCallback(async (deck: 'A' | 'B', file: File) => {
    const gen = ++loadGenRef.current[deck];
    const setter = deck === 'A' ? setDeckA : setDeckB;
    const player = deck === 'A' ? playerARef.current! : playerBRef.current!;
    const src = deck === 'A' ? 'a' : 'b' as LogEntry['source'];
    const rk = deck === 'A' ? 'a' : 'b' as 'a' | 'b';

    setter((p) => ({
      ...p,
      file,
      isAnalyzing: true,
      isPlaying: false,
      currentTime: 0,
      analysis: null,
      error: null,
    }));
    setLyricsResolved((r) => ({ ...r, [rk]: false }));
    if (deck === 'A') setLyricsA(null);
    else setLyricsB(null);

    addLog(`Loading: ${file.name}`, src);

    try {
      const buffer = await decodeFile(file);
      if (loadGenRef.current[deck] !== gen) return;
      player.setBuffer(buffer);
      addLog(`Decoded: ${file.name} (${Math.round(buffer.duration)}s)`, src);
      addLog('Analyzing audio + fetching synced lyrics…', src);

      const [analysis, lrcLines] = await Promise.all([
        analyzeTrackAsync(buffer),
        fetchSyncedLyrics(file.name, buffer.duration),
      ]);

      if (loadGenRef.current[deck] !== gen) return;

      setter((p) => ({ ...p, buffer, analysis, isAnalyzing: false }));
      automixRef.current?.setAnalysis(deck, analysis, file.name);

      let timed = lrcLines ?? [];
      let lyricsSource = 'LRCLib';

      if (timed.length === 0) {
        addLog('LRCLib miss — transcribing with Whisper…', src);
        const whisperLines = await transcribeWithWhisper(file);
        if (loadGenRef.current[deck] !== gen) return;
        if (whisperLines && whisperLines.length > 0) {
          timed = whisperLines;
          lyricsSource = 'Whisper';
        }
      }

      if (deck === 'A') {
        setLyricsA(timed);
      } else {
        setLyricsB(timed);
      }
      setLyricsResolved((r) => ({ ...r, [rk]: true }));

      if (timed.length > 0) {
        addLog(`Synced lyrics: ${timed.length} lines (${lyricsSource})`, src);
      } else {
        addLog('No lyrics found (LRCLib miss + Whisper unavailable)', src);
      }

      addLog(`Analysis complete: ${analysis.bpm} BPM`, src);
      if (analysis.vocalSegments.length > 0) {
        addLog(`Found ${analysis.vocalSegments.length} vocal section(s)`, src);
      }
      addLog(`Drop detected at ${fmtTime(analysis.dropTime)}`, src);
    } catch (err) {
      if (loadGenRef.current[deck] !== gen) return;
      const raw = err instanceof Error ? err.message : String(err);
      const msg = raw || 'Unsupported audio format';
      setter((p) => ({ ...p, isAnalyzing: false, error: msg }));
      setLyricsResolved((r) => ({ ...r, [rk]: true }));
      if (deck === 'A') setLyricsA([]);
      else setLyricsB([]);
      addLog(`Error (${deck}): ${msg}`, src);
      console.error(`[loadFile ${deck}]`, err);
    }
  }, [addLog]);

  const clearDeck = useCallback(
    (deck: 'A' | 'B') => {
      loadGenRef.current[deck]++;
      const rk = deck === 'A' ? 'a' : 'b';
      const src = deck === 'A' ? 'a' : 'b' as LogEntry['source'];

      if (phase !== 'idle' && phase !== 'done') {
        automixRef.current?.stop();
        playerARef.current?.stop();
        playerBRef.current?.stop();
        setDeckA((p) => ({ ...p, isPlaying: false }));
        setDeckB((p) => ({ ...p, isPlaying: false }));
        setTransitionInfo('');
      }

      const player = deck === 'A' ? playerARef.current : playerBRef.current;
      player?.clearBuffer();
      automixRef.current?.clearDeckAnalysis(deck);

      if (deck === 'A') {
        setDeckA(INITIAL_DECK('A'));
        setLyricsA(null);
      } else {
        setDeckB(INITIAL_DECK('B'));
        setLyricsB(null);
      }
      setLyricsResolved((r) => ({ ...r, [rk]: true }));
      addLog(`Deck ${deck} cleared — load another track`, src);
    },
    [addLog, phase],
  );

  const handleStart = useCallback(() => {
    void playDiscSfx();
    startTimeRef.current = performance.now() / 1000;
    setLogEntries([]);
    automixRef.current?.setBlendBeats(blendBeats);
    addLog(`Starting (${blendBeats}-beat crossfade)...`, 'system');
    automixRef.current?.start();
  }, [addLog, blendBeats]);

  const handleStop = useCallback(() => {
    void playDiscSfx();
    automixRef.current?.stop();
    playerARef.current?.stop();
    playerBRef.current?.stop();
    setDeckA((p) => ({ ...p, isPlaying: false }));
    setDeckB((p) => ({ ...p, isPlaying: false }));
    setTransitionInfo('');
    addLog('Mix stopped', 'system');
  }, [addLog]);

  const canStart = !!(deckA.analysis && deckB.analysis);
  const isMixing = phase !== 'idle' && phase !== 'done';

  const activeLyrics = activeDeck === 'A' ? lyricsA : lyricsB;

  const beatPreview = useMemo(() => {
    const a = deckA.analysis;
    const b = deckB.analysis;
    if (!a || !b) return null;
    const avgInterval = (a.beatInterval + b.beatInterval) / 2;
    return {
      avgInterval,
      bpmA: a.bpm,
      bpmB: b.bpm,
    };
  }, [deckA.analysis, deckB.analysis]);


  const selectBlendBeats = useCallback(
    (n: number) => {
      setBlendBeats(n);
      automixRef.current?.setBlendBeats(n);
      addLog(`Blend length: ${n} beats`, 'system');
    },
    [addLog],
  );

  const selectGenre = useCallback(
    (id: GenreId) => {
      setGenreStyleState(id);
      const preset = GENRE_PRESETS[id];
      automixRef.current?.setGenreStyle(id);
      setBlendBeats(preset.defaultBlendBeats);
      automixRef.current?.setBlendBeats(preset.defaultBlendBeats);
      addLog(`Genre: ${preset.label} (${preset.defaultBlendBeats}-beat default)`, 'system');
    },
    [addLog],
  );

  const handleDeckSeek = useCallback((deck: 'A' | 'B', ratio: number) => {
    const d = (deck === 'A' ? deckA : deckB).analysis?.duration ?? 0;
    if (d <= 0) return;
    const t = Math.max(0, Math.min(ratio * d, d - 0.01));
    const p = deck === 'A' ? playerARef.current : playerBRef.current;
    p?.seek(t);
  }, [deckA, deckB]);

  return (
    <div className="app-layout">
      <aside className="app-sidebar-left" aria-label="Genre and blend length">
        <div className="genre-panel">
          <h2 className="genre-panel-title">GENRE STYLE</h2>
          <p className="genre-panel-desc">
            Shapes the rhythm, transitions, and feel of the mix.
          </p>
          <div className="genre-buttons">
            {GENRE_LIST.map((gid) => {
              const preset = GENRE_PRESETS[gid];
              return (
                <button
                  key={gid}
                  type="button"
                  className={`genre-btn${genreStyle === gid ? ' active' : ''}`}
                  disabled={isMixing}
                  onClick={() => selectGenre(gid)}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="beat-panel">
          <h2 className="beat-panel-title">BLEND LENGTH</h2>
          <p className="beat-panel-one-liner">
            Bigger numbers mean the two songs overlap for longer when they mix.
          </p>
          {beatPreview && (
            <p className="beat-panel-meta">
              A {Math.round(beatPreview.bpmA)} BPM
              {' · '}
              B <span className="deck-b">{Math.round(beatPreview.bpmB)} BPM</span>
            </p>
          )}
          <div className="beat-buttons">
            {BLEND_BEAT_OPTIONS.map((n) => {
              const approxSec =
                beatPreview != null ? n * beatPreview.avgInterval : null;
              return (
                <button
                  key={n}
                  type="button"
                  className={`beat-select-btn${blendBeats === n ? ' active' : ''}`}
                  disabled={isMixing}
                  onClick={() => selectBlendBeats(n)}
                >
                  <span className="beat-select-label">{n} beats</span>
                  {approxSec != null && (
                    <span className="beat-select-duration">~{approxSec.toFixed(1)}s avg</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="app-header">
          <WordplayLogo className="app-header-wordplay-logo" title="Wordplay" />
        </header>

        <div className="visualizer-section">
          <Visualizer
            analyser={analyserNode}
            phase={phase}
            lyrics={activeLyrics}
            getLyricTime={getLyricTime}
            wordplayPhrase={wordplayPhrase}
          />
        </div>

        <TrackTimeline
          deckA={deckA}
          deckB={deckB}
          wordMatches={wordMatches}
          onLoadFileA={(f) => loadFile('A', f)}
          onLoadFileB={(f) => loadFile('B', f)}
          onSeek={handleDeckSeek}
          phase={phase}
          activeDeck={activeDeck}
          isMixing={isMixing}
          blendProgress={blendProgress}
          transitionInfo={transitionInfo}
          canStart={canStart}
          onStart={handleStart}
          onStop={handleStop}
          onClearDeck={clearDeck}
        />

        {isNarrowLayout && (
          <StatusLog entries={logEntries} variant="below-play" />
        )}
      </div>

      <aside className="app-sidebar">
        {!isNarrowLayout && <StatusLog entries={logEntries} />}
      </aside>

    </div>
  );
}
