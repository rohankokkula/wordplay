import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Menu, Settings as SettingsIcon, Sparkles, Upload, PanelBottom, X } from 'lucide-react';
import './studio/StudioShell.css';
import { submitSeparate, awaitSeparation, stemFileUrl } from './api/stems';
import { StemLoader } from './components/StemLoader';
import { PublishDialog } from './social/PublishDialog';
import { fetchForkGraph } from './api/social';
import type { MixGraph } from './mix/types';
import type { DeckState, LogEntry } from './audio/types';
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
import { Visualizer } from './components/Visualizer';
import { StatusLog } from './components/StatusLog';
import { WordplayLogo } from './components/WordplayLogo';
import { AppSidebarLeft } from './components/AppSidebarLeft';
import { AppSidebarAccount } from './components/AppSidebarAccount';
import { ExportButton } from './components/ExportButton';
import { playDiscSfx } from './audio/turntableWindDown';
import { usePlaybackQuota } from './auth/usePlaybackQuota';
import { useAuth } from './auth/AuthContext';
import { apiUrl } from './apiBase';
import { fetchSyncedLyrics } from './lyrics/lyricsService';
import { useMixStore } from './mix/store';
import { SnippetDeck } from './studio/snippets/SnippetDeck';
import { MasterDeck } from './studio/snippets/MasterDeck';
import { useSnippetStore } from './studio/snippets/snippetStore';
import { generateSnippets } from './studio/snippets/generate';
import { MasterScheduler } from './studio/snippets/masterScheduler';
import { stopSnippetPreview } from './studio/snippets/snippetPreview';
import { fillTransitionGaps } from './studio/snippets/masterTransitions';
import { stitchMasterMix, StitchedMasterPlayer } from './studio/snippets/masterStitch';

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

export default function App() {
  const { user, token, logout } = useAuth();
  const quota = usePlaybackQuota();
  const [deckA, setDeckA] = useState<DeckState>(() => INITIAL_DECK('A'));
  const [deckB, setDeckB] = useState<DeckState>(() => INITIAL_DECK('B'));
  const [activeDeck] = useState<'A' | 'B'>('A');
  const [, setCurrentTrackName] = useState('');
  const [, setCurrentBpm] = useState(0);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);

  const [publishOpen, setPublishOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [stemState, setStemState] = useState<{
    A?: { status: 'idle' | 'loading' | 'ready' | 'error'; progress: number; error?: string; buffers?: { vocals: AudioBuffer; instruments: AudioBuffer } };
    B?: { status: 'idle' | 'loading' | 'ready' | 'error'; progress: number; error?: string; buffers?: { vocals: AudioBuffer; instruments: AudioBuffer } };
  }>({});
  const [masterPlaying, setMasterPlaying] = useState(false);
  const [masterProgress, setMasterProgress] = useState(0);
  const [searchParams] = useSearchParams();
  const schedulerRef = useRef<MasterScheduler | null>(null);
  const stitchedPlayerRef = useRef<StitchedMasterPlayer | null>(null);
  const [bakedBuffer, setBakedBuffer] = useState<AudioBuffer | null>(null);
  const [stitching, setStitching] = useState(false);

  const setStem = useMixStore((s) => s.setStem);
  const loadMixGraph = useMixStore((s) => s.loadGraph);

  const setSnippets = useSnippetStore((s) => s.setSnippets);
  const clearSnippets = useSnippetStore((s) => s.clearSnippets);
  const masterSequence = useSnippetStore((s) => s.master);
  const masterTransitions = useSnippetStore((s) => s.masterTransitions);

  const playerARef = useRef<DeckPlayer | null>(null);
  const playerBRef = useRef<DeckPlayer | null>(null);
  const startTimeRef = useRef(0);
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
    setAnalyserNode(getAnalyser());
    applyMasterGain(1);
    startTimeRef.current = performance.now() / 1000;
    addLog('Studio ready · drop tracks on both decks', 'system');
  }, [addLog]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setLibraryOpen(false);
      setLogOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    playerARef.current?.setVolume(deckA.volume);
  }, [deckA.volume]);

  useEffect(() => {
    playerBRef.current?.setVolume(deckB.volume);
  }, [deckB.volume]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const pA = playerARef.current;
      const pB = playerBRef.current;
      if (pA?.playing) setDeckA((p) => ({ ...p, currentTime: pA.currentTime, isPlaying: true }));
      else setDeckA((p) => (p.isPlaying ? { ...p, isPlaying: false } : p));
      if (pB?.playing) setDeckB((p) => ({ ...p, currentTime: pB.currentTime, isPlaying: true }));
      else setDeckB((p) => (p.isPlaying ? { ...p, isPlaying: false } : p));
      quota.tick(!!(pA?.playing || pB?.playing) || masterPlaying);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [quota.tick, masterPlaying]);

  const loadFile = useCallback(async (deck: 'A' | 'B', file: File) => {
    const gen = ++loadGenRef.current[deck];
    const setter = deck === 'A' ? setDeckA : setDeckB;
    const player = deck === 'A' ? playerARef.current! : playerBRef.current!;
    const src = deck === 'A' ? 'a' : 'b' as LogEntry['source'];

    setter((p) => ({
      ...p,
      file,
      isAnalyzing: true,
      isPlaying: false,
      currentTime: 0,
      analysis: null,
      error: null,
    }));

    addLog(`Loading: ${file.name}`, src);

    try {
      const buffer = await decodeFile(file);
      if (loadGenRef.current[deck] !== gen) return;
      player.setBuffer(buffer);
      addLog(`Decoded: ${file.name} (${Math.round(buffer.duration)}s)`, src);
      addLog('Analyzing audio…', src);

      const [analysis] = await Promise.all([
        analyzeTrackAsync(buffer),
        fetchSyncedLyrics(file.name, buffer.duration).catch(() => null),
      ]);

      if (loadGenRef.current[deck] !== gen) return;

      setter((p) => ({ ...p, buffer, analysis, isAnalyzing: false }));
      setCurrentTrackName(file.name);
      setCurrentBpm(analysis.bpm);

      addLog(`Analysis complete: ${analysis.bpm} BPM`, src);
      if (analysis.vocalSegments.length > 0) {
        addLog(`Found ${analysis.vocalSegments.length} vocal section(s)`, src);
      }
      addLog(`Drop detected at ${fmtTime(analysis.dropTime)}`, src);

      // Immediately generate snippet lanes (UI-side; actual stem buffers
      // come later when Demucs finishes on the backend).
      const cleanTitle = file.name.replace(/\.(mp3|m4a|webm|opus|wav|flac|ogg)$/i, '');
      setSnippets(deck, generateSnippets({ deck, title: cleanTitle, analysis }));
      addLog('Snippet lanes ready · stems separating in background', src);
    } catch (err) {
      if (loadGenRef.current[deck] !== gen) return;
      const raw = err instanceof Error ? err.message : String(err);
      const msg = raw || 'Unsupported audio format';
      setter((p) => ({ ...p, isAnalyzing: false, error: msg }));
      addLog(`Error (${deck}): ${msg}`, src);
      console.error(`[loadFile ${deck}]`, err);
    }
  }, [addLog, setSnippets]);

  const loadFromWordplaylist = useCallback(
    async (deck: 'A' | 'B', itemId: string) => {
      if (!token) return;
      const res = await fetch(apiUrl(`/api/playlist/${itemId}/file`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition');
      let name = 'track.mp3';
      if (cd) {
        const star = /filename\*=(?:UTF-8'')?([^;\n]+)/i.exec(cd);
        const quoted = /filename="([^"]+)"/i.exec(cd);
        const plain = /filename=([^;\s]+)/i.exec(cd);
        if (star?.[1]) name = decodeURIComponent(star[1].trim().replace(/^"(.*)"$/, '$1'));
        else if (quoted?.[1]) name = quoted[1];
        else if (plain?.[1]) name = plain[1].replace(/^"(.*)"$/, '$1');
      }
      const file = new File([blob], name, { type: blob.type || 'audio/mpeg' });
      loadFile(deck, file);
    },
    [token, loadFile],
  );

  const clearDeck = useCallback(
    (deck: 'A' | 'B') => {
      stopSnippetPreview();
      loadGenRef.current[deck]++;
      const src = deck === 'A' ? 'a' : 'b' as LogEntry['source'];

      const player = deck === 'A' ? playerARef.current : playerBRef.current;
      player?.clearBuffer();

      if (deck === 'A') setDeckA(INITIAL_DECK('A'));
      else setDeckB(INITIAL_DECK('B'));

      clearSnippets(deck);
      setStemState((prev) => ({ ...prev, [deck]: undefined }));
      addLog(`Deck ${deck} cleared — load another track`, src);
    },
    [addLog, clearSnippets],
  );

  const handleDeckSeek = useCallback((deck: 'A' | 'B', ratio: number) => {
    const d = (deck === 'A' ? deckA : deckB).analysis?.duration ?? 0;
    if (d <= 0) return;
    const t = Math.max(0, Math.min(ratio * d, d - 0.01));
    const p = deck === 'A' ? playerARef.current : playerBRef.current;
    p?.seek(t);
  }, [deckA, deckB]);

  /**
   * When a deck gets a file, kick off Demucs separation and store the
   * resulting buffers so the snippet playback can actually play stems.
   */
  const triggerStemSeparation = useCallback(
    async (deck: 'A' | 'B', file: File, title: string, duration: number, bpm?: number) => {
      setStemState((prev) => ({ ...prev, [deck]: { status: 'loading', progress: 0 } }));
      try {
        const res = await submitSeparate(file, token);
        const final = await awaitSeparation(res.job_id, (p) => {
          setStemState((prev) => ({
            ...prev,
            [deck]: { status: 'loading', progress: p },
          }));
        });
        if (final.status !== 'done' || !final.result) {
          throw new Error(final.error || 'Separation failed');
        }
        const [vBuf, iBuf] = await Promise.all([
          fetch(stemFileUrl(final.result.vocals_url)).then((r) => r.arrayBuffer()).then((b) => getAudioContext().decodeAudioData(b)),
          fetch(stemFileUrl(final.result.instruments_url)).then((r) => r.arrayBuffer()).then((b) => getAudioContext().decodeAudioData(b)),
        ]);
        setStemState((prev) => ({
          ...prev,
          [deck]: { status: 'ready', progress: 100, buffers: { vocals: vBuf, instruments: iBuf } },
        }));
        setStem(deck, {
          vocalsUrl: final.result.vocals_url,
          instrumentsUrl: final.result.instruments_url,
          duration,
          title,
          bpm,
        });
        addLog(`Stems ready for deck ${deck}`, deck === 'A' ? 'a' : 'b');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStemState((prev) => ({ ...prev, [deck]: { status: 'error', progress: 0, error: msg } }));
        addLog(`Stem separation failed on deck ${deck}: ${msg}`, deck === 'A' ? 'a' : 'b');
      }
    },
    [token, setStem, addLog],
  );

  useEffect(() => {
    if (deckA.buffer && deckA.file && stemState.A?.status === undefined) {
      void triggerStemSeparation('A', deckA.file, deckA.file.name, deckA.buffer.duration, deckA.analysis?.bpm);
    }
  }, [deckA.buffer, deckA.file, deckA.analysis?.bpm, stemState.A?.status, triggerStemSeparation]);

  useEffect(() => {
    if (deckB.buffer && deckB.file && stemState.B?.status === undefined) {
      void triggerStemSeparation('B', deckB.file, deckB.file.name, deckB.buffer.duration, deckB.analysis?.bpm);
    }
  }, [deckB.buffer, deckB.file, deckB.analysis?.bpm, stemState.B?.status, triggerStemSeparation]);

  /** Remix / fork — if /studio?fork=<slug> hydrate the canvas with that graph. */
  useEffect(() => {
    const forkSlug = searchParams.get('fork');
    if (!forkSlug) return;
    void fetchForkGraph(forkSlug, token)
      .then((res) => {
        if (res.graph_json) {
          loadMixGraph(res.graph_json as MixGraph);
        }
      })
      .catch(() => {});
  }, [searchParams, token, loadMixGraph]);

  const mixSignature = useMemo(
    () => masterSequence.map((m) => m.placementId).join() + JSON.stringify(masterTransitions),
    [masterSequence, masterTransitions],
  );
  useEffect(() => {
    setBakedBuffer(null);
  }, [mixSignature]);

  const runMasterAnalyse = useCallback(async () => {
    if (masterSequence.length === 0) return;
    setStitching(true);
    try {
      const tr = fillTransitionGaps(masterSequence.length, masterTransitions);
      const buf = await stitchMasterMix(
        masterSequence,
        tr,
        {
          A: { stems: stemState.A?.buffers ?? null, full: deckA.buffer },
          B: { stems: stemState.B?.buffers ?? null, full: deckB.buffer },
        },
      );
      setBakedBuffer(buf);
      addLog('Master stitched — gap-free play ready (baked buffer)', 'system');
    } catch (e) {
      addLog(`Stitch / analyse failed: ${(e as Error).message}`, 'system');
    } finally {
      setStitching(false);
    }
  }, [masterSequence, masterTransitions, stemState, deckA.buffer, deckB.buffer, addLog]);

  const playMaster = useCallback(() => {
    stopSnippetPreview();
    schedulerRef.current?.stop();
    stitchedPlayerRef.current?.stop();
    if (masterSequence.length === 0) return;
    void playDiscSfx();
    const tr = fillTransitionGaps(masterSequence.length, masterTransitions);
    const src = {
      A: { stems: stemState.A?.buffers ?? null, full: deckA.buffer },
      B: { stems: stemState.B?.buffers ?? null, full: deckB.buffer },
    };
    if (bakedBuffer) {
      if (!stitchedPlayerRef.current) stitchedPlayerRef.current = new StitchedMasterPlayer();
      stitchedPlayerRef.current.start(
        bakedBuffer,
        (p) => setMasterProgress(p),
        () => {
          setMasterPlaying(false);
          setMasterProgress(0);
          addLog('Master mix complete', 'system');
        },
      );
      setMasterPlaying(true);
      setMasterProgress(0);
      addLog(`Master (baked) · ${masterSequence.length} clips`, 'system');
      return;
    }
    schedulerRef.current = new MasterScheduler(masterSequence, src, {
      onEnd: () => {
        setMasterPlaying(false);
        setMasterProgress(0);
        addLog('Master mix complete', 'system');
      },
      onTick: (p) => setMasterProgress(p),
      transitions: tr,
    });
    schedulerRef.current.start();
    setMasterPlaying(true);
    setMasterProgress(0);
    addLog(`Master mix live (${masterSequence.length} clips)`, 'system');
  }, [masterSequence, masterTransitions, stemState, deckA.buffer, deckB.buffer, bakedBuffer, addLog]);

  const stopMaster = useCallback(() => {
    void playDiscSfx();
    schedulerRef.current?.stop();
    schedulerRef.current = null;
    stitchedPlayerRef.current?.stop();
    setMasterPlaying(false);
    setMasterProgress(0);
    addLog('Master mix stopped', 'system');
  }, [addLog]);

  /** No disc SFX — used when starting a per-snippet preview so the master chain does not cover it. */
  const silenceMasterForSnippetPreview = useCallback(() => {
    schedulerRef.current?.stop();
    schedulerRef.current = null;
    setMasterPlaying(false);
    setMasterProgress(0);
  }, []);

  useEffect(
    () => () => {
      schedulerRef.current?.stop();
      stitchedPlayerRef.current?.stop();
    },
    [],
  );

  const stemsReady = stemState.A?.status === 'ready' && stemState.B?.status === 'ready';
  const stemBuffersForPublish = useMemo(() => {
    if (!stemsReady) return null;
    return {
      A: stemState.A!.buffers!,
      B: stemState.B!.buffers!,
    };
  }, [stemsReady, stemState]);

  return (
    <div className="studio-app">
      {quota.exceeded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-lg border border-[var(--wp-border)] bg-[var(--wp-surface)] p-6 text-center shadow-lg">
            <h2 className="font-display text-lg mb-2 text-[var(--wp-text)]">Free playback limit reached</h2>
            <p className="text-sm text-[var(--wp-muted)] mb-5 leading-relaxed">
              You&apos;ve used your 20 minutes of free playback. Sign in with Google for unlimited access.
            </p>
            <button type="button" className="studio-btn-primary w-full" onClick={logout}>
              Sign in with Google
            </button>
          </div>
        </div>
      )}

      {/* Library: plain side panel, no Radix sheet */}
      {libraryOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default bg-black/45"
            aria-label="Close library"
            onClick={() => setLibraryOpen(false)}
          />
          <aside
            className="fixed left-0 top-0 z-50 flex h-full w-[min(20rem,100vw)] flex-col border-r border-[var(--wp-border)] bg-[var(--wp-surface)] shadow-xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--wp-border)] px-2 py-2">
              <span className="px-2 text-xs font-semibold uppercase tracking-widest text-[var(--wp-muted)]">
                Library
              </span>
              <button
                type="button"
                className="studio-icon-btn"
                onClick={() => setLibraryOpen(false)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto wp-scroll p-0">
              <AppSidebarLeft
                token={token}
                quota={{
                  isPremium: quota.isPremium,
                  remainingMinutes: quota.remainingMinutes,
                  usedSeconds: quota.usedSeconds,
                }}
                isMixing={masterPlaying}
                onLoadPlaylistFile={(f) => {
                  setLibraryOpen(false);
                  loadFile('A', f);
                }}
              />
            </div>
          </aside>
        </>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <header className="studio-topbar">
          <div className="studio-topbar__inner">
            <button
              type="button"
              className="studio-icon-btn"
              onClick={() => setLibraryOpen(true)}
              aria-label="Open library"
            >
              <Menu className="h-5 w-5" />
            </button>

            <Link to="/studio" className="mr-1 flex min-w-0 items-center">
              <WordplayLogo className="h-7 sm:h-8" title="Wordplay" />
            </Link>

            <div className="min-w-0 flex-1" />

            <nav className="studio-topbar__nav" aria-label="Studio actions">
              <Link to="/feed" className="studio-text-btn hidden sm:inline-flex">
                <Sparkles className="h-4 w-4" /> Feed
              </Link>

              <button
                type="button"
                className="studio-text-btn"
                onClick={() => setLogOpen((v) => !v)}
                aria-pressed={logOpen}
                aria-label="Live log"
                title="Live log (Esc to close)"
              >
                <PanelBottom className="h-4 w-4" />
                <span className="hidden sm:inline">Log</span>
              </button>

              <button
                type="button"
                className="studio-btn-primary"
                onClick={() => setPublishOpen(true)}
                disabled={!stemsReady || !token}
                title={!stemsReady ? 'Separate stems on both decks first' : !token ? 'Sign in to publish' : 'Publish'}
              >
                <Upload className="h-4 w-4" />
                <span className="hidden sm:inline">Publish</span>
              </button>

              <Link
                to="/settings"
                className="studio-icon-btn"
                aria-label="Settings"
                title="Settings"
              >
                <SettingsIcon className="h-4 w-4" />
              </Link>

              <div className="ml-0.5 hidden sm:block">
                <ExportButton />
              </div>
            </nav>
          </div>
        </header>

        <div className="studio-scroll wp-scroll">
          <div className="studio-container">
            {(stemState.A || stemState.B) && !stemsReady && (
              <div className="studio-stem-banners -mt-1 flex flex-col gap-2">
                {stemState.A && stemState.A.status !== 'ready' && (
                  <StemLoader
                    label={`Deck A · ${deckA.file?.name ?? 'track'}`}
                    progress={stemState.A.progress}
                    phase={stemState.A.status === 'loading' ? 'running' : stemState.A.status === 'error' ? 'error' : 'done'}
                    error={stemState.A.error}
                  />
                )}
                {stemState.B && stemState.B.status !== 'ready' && (
                  <StemLoader
                    label={`Deck B · ${deckB.file?.name ?? 'track'}`}
                    progress={stemState.B.progress}
                    phase={stemState.B.status === 'loading' ? 'running' : stemState.B.status === 'error' ? 'error' : 'done'}
                    error={stemState.B.error}
                  />
                )}
              </div>
            )}

            <section className="studio-panel studio-panel--viz" aria-label="Visualizer">
              <div className="visualizer-section">
                <Visualizer
                  analyser={analyserNode}
                  phase={masterPlaying ? 'playingA' : 'idle'}
                  lyrics={null}
                  getLyricTime={() => 0}
                  wordplayPhrase={null}
                />
              </div>
            </section>

            <div className="studio-decks">
              <SnippetDeck
                deck={deckA}
                deckId="A"
                onLoadFile={(f) => loadFile('A', f)}
                onSeek={handleDeckSeek}
                onClearDeck={clearDeck}
                onWordplaylistDrop={(id) => { void loadFromWordplaylist('A', id); }}
                stemStatus={stemState.A?.status}
                stemProgress={stemState.A?.progress}
                stemBuffers={stemState.A?.buffers ?? null}
                onBeforeSnippetPreview={silenceMasterForSnippetPreview}
              />
              <SnippetDeck
                deck={deckB}
                deckId="B"
                onLoadFile={(f) => loadFile('B', f)}
                onSeek={handleDeckSeek}
                onClearDeck={clearDeck}
                onWordplaylistDrop={(id) => { void loadFromWordplaylist('B', id); }}
                stemStatus={stemState.B?.status}
                stemProgress={stemState.B?.progress}
                stemBuffers={stemState.B?.buffers ?? null}
                onBeforeSnippetPreview={silenceMasterForSnippetPreview}
              />
            </div>

            <section aria-label="Master mix">
              <MasterDeck
                isPlaying={masterPlaying}
                progressSec={masterProgress}
                onPlay={playMaster}
                onStop={stopMaster}
                onAnalyse={runMasterAnalyse}
                analyseBusy={stitching}
                bakedReady={bakedBuffer != null}
              />
            </section>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {logOpen && (
          <motion.div
            initial={{ y: 200, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 200, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 40 }}
            className="fixed bottom-0 left-0 right-0 z-40 p-0 sm:p-0"
          >
            <div className="studio-log mx-auto w-full sm:px-0">
              <div className="studio-log__head">
                <span className="text-xs font-semibold uppercase tracking-widest text-[var(--wp-muted)]">
                  Live log
                </span>
                <button
                  type="button"
                  className="studio-icon-btn h-8 w-8"
                  onClick={() => setLogOpen(false)}
                  aria-label="Close log"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 max-h-[38vh] overflow-y-auto p-3">
                <StatusLog entries={logEntries} variant="default" />
              </div>
              <div className="border-t border-[var(--wp-border)] p-0">
                <AppSidebarAccount user={user} onLogout={logout} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        stems={stemBuffersForPublish}
      />

      {/* Active deck indicator used for future active-deck routing */}
      <span className="sr-only">Active deck: {activeDeck}</span>
    </div>
  );
}
