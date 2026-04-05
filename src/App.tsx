import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { DeckState, AutomixPhase, LogEntry } from './audio/types';
import {
  initMixer,
  setCrossfader,
  decodeFile,
  getAnalyser,
  setMasterVolume as applyMasterGain,
  suspendAudioOutput,
  resumeAudioOutput,
  getAudioContext,
} from './audio/mixer';
import { DeckPlayer } from './audio/deckPlayer';
import { analyzeTrackAsync } from './analysis/analyzeTrack';
import { AutomixController, type AutomixState } from './automix/controller';
import { transitionSegmentForOutgoingDeck } from './automix/transitionPlan';
import { UploadCard } from './components/UploadCard';
import { Visualizer } from './components/Visualizer';
import { MixButton } from './components/MixButton';
import { StatusLog } from './components/StatusLog';
import { MusicSearch } from './components/MusicSearch';
import { PlayerDock } from './components/PlayerDock';
import { AutomixBottomBar } from './components/AutomixBottomBar';
import { playTurntableWindDown } from './audio/turntableWindDown';

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
  const [deckA, setDeckA] = useState<DeckState>(() => INITIAL_DECK('A'));
  const [deckB, setDeckB] = useState<DeckState>(() => INITIAL_DECK('B'));
  const [phase, setPhase] = useState<AutomixPhase>('idle');
  const [blendProgress, setBlendProgress] = useState(0);
  const [activeDeck, setActiveDeck] = useState<'A' | 'B'>('A');
  const [currentTrackName, setCurrentTrackName] = useState('');
  const [currentBpm, setCurrentBpm] = useState(0);
  const [transitionInfo, setTransitionInfo] = useState('');
  const [transitionSegment, setTransitionSegment] = useState<
    AutomixState['transitionSegment']
  >(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [blendBeats, setBlendBeats] = useState<number>(32);
  const [masterVolume, setMasterVolumeState] = useState(1);
  const [outputPaused, setOutputPaused] = useState(false);

  const playerARef = useRef<DeckPlayer | null>(null);
  const playerBRef = useRef<DeckPlayer | null>(null);
  const automixRef = useRef<AutomixController | null>(null);
  const startTimeRef = useRef(0);
  const preMuteMasterRef = useRef(1);

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
        setTransitionSegment(state.transitionSegment);
      },
      addLog,
    );
    setAnalyserNode(getAnalyser());
    applyMasterGain(1);
  }, [addLog]);

  useEffect(() => {
    applyMasterGain(masterVolume);
  }, [masterVolume]);

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
      player.setBuffer(buffer);
      addLog(`Decoded: ${file.name} (${Math.round(buffer.duration)}s)`, src);
      addLog('Analyzing BPM, vocals, energy...', src);

      const analysis = await analyzeTrackAsync(buffer);
      setter((p) => ({ ...p, buffer, analysis, isAnalyzing: false }));
      automixRef.current?.setAnalysis(deck, analysis, file.name);

      addLog(`Analysis complete: ${analysis.bpm} BPM`, src);
      if (analysis.vocalSegments.length > 0) {
        addLog(`Found ${analysis.vocalSegments.length} vocal section(s)`, src);
      }
      addLog(`Drop detected at ${fmtTime(analysis.dropTime)}`, src);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unsupported audio format';
      setter((p) => ({ ...p, isAnalyzing: false, error: msg }));
      addLog(`Error: ${msg}`, src);
    }
  }, [addLog]);

  const handleStart = useCallback(() => {
    startTimeRef.current = performance.now() / 1000;
    setLogEntries([]);
    automixRef.current?.setBlendBeats(blendBeats);
    addLog(`Starting automix (${blendBeats}-beat crossfade)...`, 'system');
    automixRef.current?.start();
  }, [addLog, blendBeats]);

  const handleStop = useCallback(() => {
    void playTurntableWindDown();
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

  const toggleAudioPause = useCallback(async () => {
    const ac = getAudioContext();
    if (ac.state === 'suspended') {
      await resumeAudioOutput();
    } else {
      await suspendAudioOutput();
    }
  }, []);

  const handleMasterVolume = useCallback((v: number) => {
    setMasterVolumeState(v);
    applyMasterGain(v);
  }, []);

  const handleDeckVolume = useCallback((deck: 'A' | 'B', v: number) => {
    if (deck === 'A') setDeckA((p) => ({ ...p, volume: v }));
    else setDeckB((p) => ({ ...p, volume: v }));
  }, []);

  const selectActiveDeck = useCallback(
    (d: 'A' | 'B') => {
      if (isMixing) return;
      setActiveDeck(d);
    },
    [isMixing],
  );

  const toggleMuteMaster = useCallback(() => {
    if (masterVolume < 0.005) {
      const v = preMuteMasterRef.current > 0.01 ? preMuteMasterRef.current : 1;
      setMasterVolumeState(v);
      applyMasterGain(v);
    } else {
      preMuteMasterRef.current = masterVolume;
      setMasterVolumeState(0);
      applyMasterGain(0);
    }
  }, [masterVolume]);

  const selectBlendBeats = useCallback(
    (n: number) => {
      setBlendBeats(n);
      automixRef.current?.setBlendBeats(n);
      addLog(`Blend length: ${n} beats`, 'system');
    },
    [addLog],
  );

  const activeDeckState = activeDeck === 'A' ? deckA : deckB;
  const activeDur = activeDeckState.analysis?.duration ?? 0;
  const activeTime = activeDeckState.currentTime;

  const handleSeek = useCallback(
    (ratio: number) => {
      const d = activeDeckState.analysis?.duration ?? 0;
      if (d <= 0) return;
      const t = Math.max(0, Math.min(ratio * d, d - 0.01));
      const p = activeDeck === 'A' ? playerARef.current : playerBRef.current;
      p?.seek(t);
    },
    [activeDeck, activeDeckState.analysis?.duration],
  );

  const dockTitle = isMixing
    ? currentTrackName
    : activeDeckState.file?.name ?? '';
  const dockBpm = isMixing ? currentBpm : activeDeckState.analysis?.bpm ?? 0;

  const isActiveA = activeDeck === 'A' || phase === 'blending';
  const isActiveB = activeDeck === 'B' || phase === 'blending';
  const waveformAccentA =
    deckA.isPlaying && (phase === 'blending' || activeDeck === 'A');
  const waveformAccentB =
    deckB.isPlaying && (phase === 'blending' || activeDeck === 'B');

  const transitionSegA = useMemo(() => {
    if (transitionSegment?.deck === 'A') {
      return {
        startSec: transitionSegment.startSec,
        endSec: transitionSegment.endSec,
      };
    }
    if (
      (phase === 'idle' || phase === 'done') &&
      deckA.analysis &&
      deckB.analysis
    ) {
      return transitionSegmentForOutgoingDeck(deckA.analysis, 0, blendBeats);
    }
    return null;
  }, [transitionSegment, phase, deckA.analysis, deckB.analysis, blendBeats]);

  const transitionSegB = useMemo(() => {
    if (transitionSegment?.deck === 'B') {
      return {
        startSec: transitionSegment.startSec,
        endSec: transitionSegment.endSec,
      };
    }
    return null;
  }, [transitionSegment]);

  return (
    <div className="app-layout">
      <aside className="app-sidebar-left" aria-label="Blend length">
        <div className="beat-panel">
          <h2 className="beat-panel-title">BLEND LENGTH</h2>
          <p className="beat-panel-hint">
            After both tracks are analyzed, pick how many beats the crossfade spans. Timing follows each
            track&apos;s detected beat grid.
          </p>
          {beatPreview ? (
            <p className="beat-panel-meta">
              A {Math.round(beatPreview.bpmA)} BPM
              {' · '}
              B <span className="deck-b">{Math.round(beatPreview.bpmB)} BPM</span>
            </p>
          ) : (
            <p className="beat-panel-meta dim">Load and analyze both tracks to preview durations.</p>
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
          <h1 className="app-title">AUTOMIX DJ</h1>
          <a href="/wordplay" className="wp-nav-link">WORDPLAY</a>
        </header>

        <div className="uploads-row">
          <UploadCard
            deck={deckA}
            label="TRACK A"
            onLoadFile={(f) => loadFile('A', f)}
            accentColor="#6ca8c4"
            isActive={isActiveA}
            waveformAccent={waveformAccentA}
            phase={phase}
            transitionSegment={transitionSegA}
          />
          <UploadCard
            deck={deckB}
            label="TRACK B"
            onLoadFile={(f) => loadFile('B', f)}
            accentColor="#c49a7a"
            isActive={isActiveB}
            waveformAccent={waveformAccentB}
            phase={phase}
            transitionSegment={transitionSegB}
          />
        </div>

        <div className="visualizer-section">
          <Visualizer
            analyser={analyserNode}
            phase={phase}
            blendProgress={blendProgress}
            activeDeck={activeDeck}
          />
        </div>

        <AutomixBottomBar>
          <PlayerDock
            hasAudio={!!(deckA.buffer || deckB.buffer)}
            phase={phase}
            isMixing={isMixing}
            blendProgress={blendProgress}
            activeDeck={activeDeck}
            onSelectDeck={selectActiveDeck}
            deckA={{
              time: deckA.currentTime,
              duration: deckA.analysis?.duration ?? deckA.buffer?.duration ?? 0,
              volume: deckA.volume,
              hasBuffer: !!deckA.buffer,
            }}
            deckB={{
              time: deckB.currentTime,
              duration: deckB.analysis?.duration ?? deckB.buffer?.duration ?? 0,
              volume: deckB.volume,
              hasBuffer: !!deckB.buffer,
            }}
            onDeckVolume={handleDeckVolume}
            currentTrackName={dockTitle}
            currentBpm={dockBpm}
            transitionInfo={transitionInfo}
            activeTime={activeTime}
            activeDur={activeDur}
            outputPaused={outputPaused}
            masterVolume={masterVolume}
            onTogglePause={toggleAudioPause}
            onMasterVolume={handleMasterVolume}
            onSeek={handleSeek}
            onMuteToggle={toggleMuteMaster}
            fmtTime={fmtTime}
          />
        </AutomixBottomBar>
      </div>

      {/* Right sidebar: MixButton at top, then log */}
      <aside className="app-sidebar">
        <div className="sidebar-mix-section">
          <MixButton
            phase={phase}
            canStart={canStart}
            onStart={handleStart}
            onStop={handleStop}
          />
        </div>
        <MusicSearch disabled={isMixing} onAddToDeck={loadFile} />
        <StatusLog entries={logEntries} />
      </aside>
    </div>
  );
}
