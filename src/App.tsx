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
import { AutomixController } from './automix/controller';
import { Visualizer } from './components/Visualizer';
import { StatusLog } from './components/StatusLog';
import { TrackTimeline } from './components/TrackTimeline';
import { WordplayLogo } from './components/WordplayLogo';
import { playDiscSfx } from './audio/turntableWindDown';
import { useMediaQuery } from './hooks/useMediaQuery';
import { fetchSyncedLyrics, findCommonPhrases, transcribeWithWhisper } from './lyrics/lyricsService';
import type { TimedLine, WordMatch } from './lyrics/types';
import { apiUrl } from './apiBase';

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

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const DEFAULT_SONGS = [
  { deck: 'A' as const, query: 'Dr. Dre Still D.R.E. ft Snoop Dogg', label: 'Still Dre' },
  { deck: 'B' as const, query: 'Ganpat full song', label: 'Ganpat' },
];

export default function App() {
  const isNarrowLayout = useMediaQuery('(max-width: 800px)');
  const [deckA, setDeckA] = useState<DeckState>(() => INITIAL_DECK('A'));
  const [deckB, setDeckB] = useState<DeckState>(() => INITIAL_DECK('B'));
  const [phase, setPhase] = useState<AutomixPhase>('idle');
  const [blendProgress, setBlendProgress] = useState(0);
  const [activeDeck, setActiveDeck] = useState<'A' | 'B'>('A');
  const [transitionInfo, setTransitionInfo] = useState('');
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [, setOutputPaused] = useState(false);
  const [lyricsA, setLyricsA] = useState<TimedLine[] | null>(null);
  const [lyricsB, setLyricsB] = useState<TimedLine[] | null>(null);
  const [wordMatches, setWordMatches] = useState<WordMatch[]>([]);
  const [wordplayPhrase, setWordplayPhrase] = useState<string | null>(null);
  const [lyricsResolved, setLyricsResolved] = useState({ a: false, b: false });

  const playerARef = useRef<DeckPlayer | null>(null);
  const playerBRef = useRef<DeckPlayer | null>(null);
  const automixRef = useRef<AutomixController | null>(null);
  const [automixLog, setAutomixLog] = useState<LogEntry[]>([]);
  const startTimeRef = useRef(0);
  const activeDeckRef = useRef<'A' | 'B'>('A');
  const loadGenRef = useRef({ A: 0, B: 0 });
  const defaultsLoadedRef = useRef(false);

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
    const automix = new AutomixController();
    automixRef.current = automix;
    playerARef.current = automix.playerA;
    playerBRef.current = automix.playerB;
    const sync = () => {
      const s = automix.getState();
      setPhase(s.phase);
      setBlendProgress(s.blendProgress);
      setActiveDeck(s.activeDeck);
      setTransitionInfo(s.transitionInfo);
      setWordplayPhrase(s.wordplayPhrase);
      setAutomixLog(s.log);
    };
    const unsub = automix.subscribe(sync);
    sync();
    setAnalyserNode(getAnalyser());
    applyMasterGain(1);
    return () => unsub();
  }, []);

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

      if (deck === 'A') setLyricsA(timed);
      else setLyricsB(timed);
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

  /** Auto-load a song by searching YouTube and downloading the first result. */
  const autoLoadSong = useCallback(async (deck: 'A' | 'B', query: string, label: string) => {
    const src = deck === 'A' ? 'a' : 'b' as LogEntry['source'];
    addLog(`Auto-loading ${label}…`, src);
    try {
      const searchRes = await fetch(apiUrl(`/api/music/search?q=${encodeURIComponent(query)}&limit=1`));
      if (!searchRes.ok) throw new Error(`Search failed: ${searchRes.statusText}`);
      const searchData = await searchRes.json() as { results?: { url: string; title: string }[] };
      const hit = searchData.results?.[0];
      if (!hit) throw new Error('No search results');

      addLog(`Found: ${hit.title} — downloading…`, src);
      const dlRes = await fetch(apiUrl('/api/music/download'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: hit.url }),
      });
      if (!dlRes.ok) {
        const text = await dlRes.text();
        throw new Error(text.slice(0, 200));
      }

      const blob = await dlRes.blob();
      const cd = dlRes.headers.get('Content-Disposition');
      let name = `${hit.title.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 80)}.mp3`;
      if (cd) {
        const m = /filename\*?=(?:UTF-8''|")?([^";\n]+)/i.exec(cd);
        if (m) {
          try { name = decodeURIComponent(m[1].replace(/"/g, '').trim()); }
          catch { name = m[1].replace(/"/g, '').trim(); }
        }
      }
      const file = new File([blob], name, { type: blob.type || 'audio/mpeg' });
      await loadFile(deck, file);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(`Auto-load failed (${label}): ${msg}`, src);
    }
  }, [addLog, loadFile]);

  // Auto-load default test songs on mount
  useEffect(() => {
    if (defaultsLoadedRef.current) return;
    defaultsLoadedRef.current = true;
    for (const { deck, query, label } of DEFAULT_SONGS) {
      void autoLoadSong(deck, query, label);
    }
  }, [autoLoadSong]);

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
    setAutomixLog([]);
    addLog('Starting mix...', 'system');
    void automixRef.current?.start();
  }, [addLog]);

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

  const displayLogEntries = useMemo(() => {
    const merged = [...logEntries, ...automixLog];
    merged.sort((a, b) => a.time - b.time || a.id - b.id);
    return merged;
  }, [logEntries, automixLog]);

  const handleDeckSeek = useCallback((deck: 'A' | 'B', ratio: number) => {
    const d = (deck === 'A' ? deckA : deckB).analysis?.duration ?? 0;
    if (d <= 0) return;
    const t = Math.max(0, Math.min(ratio * d, d - 0.01));
    const p = deck === 'A' ? playerARef.current : playerBRef.current;
    p?.seek(t);
  }, [deckA, deckB]);

  return (
    <div className="app-layout">
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

        <StatusLog entries={displayLogEntries} />

        {isNarrowLayout && (
          <StatusLog entries={displayLogEntries} variant="below-play" />
        )}
      </div>
    </div>
  );
}
