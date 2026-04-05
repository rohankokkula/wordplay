import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { WordplayLogo } from '../components/WordplayLogo';

interface MatchInfo {
  word: string;
  word_a: string;
  word_b: string;
  time_a: number;
  time_b: number;
  match_type: string;
  score: number;
  energy_state_a: string;
  energy_state_b: string;
  near_phrase_a: boolean;
  near_phrase_b: boolean;
}

interface TransitionInfo {
  word: string | null;
  time_a: number;
  time_b: number;
  match_type: string;
  energy_a: string;
  energy_b: string;
  bpm_a: number;
  bpm_b: number;
  key_a: string;
  key_b: string;
}

interface TrackAnalysis {
  bpm: number;
  duration: number;
  key: string;
  camelot: string;
  drop_time: number;
  has_vocals: boolean;
  vocal_words: Array<{ word: string; start: number; end: number }>;
  phrase_boundaries: number[];
  energy_curve: number[];
  beat_times: number[];
}

type JobStatus =
  | 'idle'
  | 'uploading'
  | 'analyzing_a'
  | 'analyzing_b'
  | 'matching'
  | 'selecting'
  | 'ready'
  | 'generating'
  | 'done'
  | 'error';

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function lyricsFromWords(words: Array<{ word: string }>): string {
  if (!words.length) return '—';
  return words.map((w) => w.word).join(' ');
}

export default function WordplayPage() {
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [analysisA, setAnalysisA] = useState<TrackAnalysis | null>(null);
  const [analysisB, setAnalysisB] = useState<TrackAnalysis | null>(null);
  const [matches, setMatches] = useState<MatchInfo[]>([]);
  const [transition, setTransition] = useState<TransitionInfo | null>(null);
  const [selectedMatch, setSelectedMatch] = useState(0);
  const [mixReady, setMixReady] = useState(false);

  const inputARef = useRef<HTMLInputElement>(null);
  const inputBRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const logEndRef = useRef<HTMLDivElement>(null);
  const startInFlightRef = useRef(false);
  const autoStartedKeyRef = useRef<string | null>(null);

  const startAnalysis = useCallback(async () => {
    if (!fileA || !fileB || startInFlightRef.current) return;

    startInFlightRef.current = true;
    setStatus('uploading');
    setProgress(5);
    setStep('Upload…');
    setError(null);
    setMixReady(false);
    setMatches([]);
    setTransition(null);
    setAnalysisA(null);
    setAnalysisB(null);

    const form = new FormData();
    form.append('track_a', fileA);
    form.append('track_b', fileB);

    try {
      const res = await fetch('/api/wordplay/analyze', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Upload failed');

      setJobId(data.job_id);
      pollRef.current = setInterval(() => pollStatus(data.job_id), 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to upload');
      setStatus('error');
    } finally {
      startInFlightRef.current = false;
    }
  }, [fileA, fileB]);

  const pollStatus = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/wordplay/status/${id}`);
      const data = await res.json();

      setStatus(data.status);
      setProgress(data.progress || 0);
      setStep(data.step || '');

      if (data.analysis_a) setAnalysisA(data.analysis_a);
      if (data.analysis_b) setAnalysisB(data.analysis_b);

      if (data.error) {
        setError(data.error);
        clearInterval(pollRef.current);
      }

      if (data.status === 'ready') {
        clearInterval(pollRef.current);
        setAnalysisA(data.analysis_a);
        setAnalysisB(data.analysis_b);
        setMatches(data.matches || []);
        setTransition(data.transition);
      }

      if (data.status === 'done') {
        clearInterval(pollRef.current);
        setMixReady(true);
      }
    } catch {
      // retry
    }
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [analysisA, analysisB, step, status]);

  useEffect(() => {
    setAnalysisA(null);
    setAnalysisB(null);
    setMatches([]);
    setTransition(null);
    setError(null);
    setMixReady(false);
    setJobId(null);
    setStatus('idle');
    setStep('');
    setProgress(0);
    autoStartedKeyRef.current = null;
    clearInterval(pollRef.current);
  }, [fileA, fileB]);

  useEffect(() => {
    if (!fileA || !fileB || status !== 'idle') return;
    const key = `${fileA.size}-${fileB.size}-${fileA.lastModified}-${fileB.lastModified}`;
    if (autoStartedKeyRef.current === key) return;
    autoStartedKeyRef.current = key;
    startAnalysis();
  }, [fileA, fileB, status, startAnalysis]);

  const generateMix = useCallback(async () => {
    if (!jobId) return;
    setStatus('generating');
    setStep('Render mix…');

    try {
      const res = await fetch(`/api/wordplay/generate/${jobId}?match_index=${selectedMatch}`, { method: 'POST' });
      if (!res.ok) throw new Error('Generate failed');
      pollRef.current = setInterval(() => pollStatus(jobId), 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
      setStatus('error');
    }
  }, [jobId, selectedMatch, pollStatus]);

  const playMix = useCallback(() => {
    if (!jobId || !audioRef.current) return;
    audioRef.current.src = `/api/wordplay/download/${jobId}`;
    audioRef.current.play();
  }, [jobId]);

  const isProcessing = !['idle', 'ready', 'done', 'error'].includes(status);

  const vocalComparison = useMemo(() => {
    const aw = analysisA?.vocal_words ?? [];
    const bw = analysisB?.vocal_words ?? [];
    const setA = new Set(aw.map((w) => w.word));
    const setB = new Set(bw.map((w) => w.word));
    const shared = [...setA].filter((w) => setB.has(w)).sort();
    return { shared, countA: aw.length, countB: bw.length };
  }, [analysisA, analysisB]);

  const logEvents = useMemo(() => {
    const rows: { k: string; line: string }[] = [];
    if (fileA && fileB) {
      rows.push({ k: 'u', line: `· ${fmtSize(fileA.size)} · ${fmtSize(fileB.size)}` });
    }
    if (step) rows.push({ k: 's', line: step });
    if (analysisA?.vocal_words?.length) {
      rows.push({ k: 'a', line: `A  ${lyricsFromWords(analysisA.vocal_words)}` });
    }
    if (analysisB?.vocal_words?.length) {
      rows.push({ k: 'b', line: `B  ${lyricsFromWords(analysisB.vocal_words)}` });
    }
    if (status === 'ready' || status === 'done' || status === 'generating') {
      if (vocalComparison.shared.length) {
        rows.push({ k: 'x', line: `∩  ${vocalComparison.shared.join(' · ')}` });
      }
    }
    return rows;
  }, [fileA, fileB, step, analysisA, analysisB, status, vocalComparison.shared]);

  return (
    <div className="wp-dash">
      <header className="wp-dash-head">
        <Link to="/" className="wp-dash-home" aria-label="Home">
          ←
        </Link>
        <Link to="/" className="wp-dash-logo-link" aria-label="Wordplay">
          <WordplayLogo className="wp-dash-logo" />
        </Link>
      </header>

      <div className="wp-dash-grid">
        <main className="wp-dash-main">
          <section className="wp-panel wp-panel-decks">
            <div className="wp-deck">
              <button
                type="button"
                className="wp-drop"
                disabled={isProcessing}
                onClick={() => !isProcessing && inputARef.current?.click()}
              >
                <input
                  ref={inputARef}
                  type="file"
                  accept="audio/*"
                  hidden
                  onChange={(e) => setFileA(e.target.files?.[0] ?? null)}
                />
                <span className="wp-drop-label">A</span>
                <span className="wp-drop-meta">
                  {fileA ? fmtSize(fileA.size) : 'audio'}
                </span>
              </button>
              {analysisA && (
                <div className="wp-meta">
                  <span>{Math.round(analysisA.bpm)}</span>
                  <span>{analysisA.camelot}</span>
                  <span>{fmtTime(analysisA.duration)}</span>
                </div>
              )}
            </div>
            <div className="wp-deck">
              <button
                type="button"
                className="wp-drop wp-drop-b"
                disabled={isProcessing}
                onClick={() => !isProcessing && inputBRef.current?.click()}
              >
                <input
                  ref={inputBRef}
                  type="file"
                  accept="audio/*"
                  hidden
                  onChange={(e) => setFileB(e.target.files?.[0] ?? null)}
                />
                <span className="wp-drop-label">B</span>
                <span className="wp-drop-meta">
                  {fileB ? fmtSize(fileB.size) : 'audio'}
                </span>
              </button>
              {analysisB && (
                <div className="wp-meta">
                  <span>{Math.round(analysisB.bpm)}</span>
                  <span>{analysisB.camelot}</span>
                  <span>{fmtTime(analysisB.duration)}</span>
                </div>
              )}
            </div>
          </section>

          {isProcessing && (
            <div className="wp-bar-wrap">
              <div className="wp-bar">
                <div className="wp-bar-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {error && <p className="wp-err">{error}</p>}

          {transition && (
            <section className="wp-panel wp-panel-tight">
              <div className="wp-kv">
                <span className="wp-k">match</span>
                <span className="wp-v wp-v-hot">{transition.word || 'energy'}</span>
              </div>
              <div className="wp-kv">
                <span className="wp-k">t</span>
                <span className="wp-v">
                  {fmtTime(transition.time_a)} → {fmtTime(transition.time_b)}
                </span>
              </div>
              <div className="wp-kv-row">
                <span>
                  {transition.bpm_a}→{transition.bpm_b} bpm
                </span>
                <span className="wp-dim">{transition.match_type}</span>
              </div>
            </section>
          )}

          {vocalComparison.shared.length > 0 && (
            <p className="wp-overlap">shared · {vocalComparison.shared.join(' ')}</p>
          )}

          {matches.length > 0 && (
            <section className="wp-panel">
              <div className="wp-matches">
                {matches.map((m, i) => (
                  <button
                    key={`${m.time_a}-${m.time_b}-${i}`}
                    type="button"
                    className={`wp-mi${i === selectedMatch ? ' on' : ''}`}
                    onClick={() => setSelectedMatch(i)}
                  >
                    <span className="wp-mw">{m.word}</span>
                    <span className="wp-mt">{m.match_type}</span>
                    <span className="wp-mm">
                      {fmtTime(m.time_a)} {fmtTime(m.time_b)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <div className="wp-actions">
            {status === 'ready' && (
              <button type="button" className="wp-act" onClick={generateMix}>
                generate mix
              </button>
            )}
            {status === 'done' && mixReady && (
              <button type="button" className="wp-act wp-act-go" onClick={playMix}>
                play
              </button>
            )}
          </div>

          <audio ref={audioRef} controls className="wp-aud" />
        </main>

        <aside className="wp-dash-side" aria-label="Transcript log">
          <div className="wp-side-h">log</div>
          <div className="wp-log">
            {logEvents.map((row, i) => (
              <pre key={i} className={`wp-log-line wp-log-${row.k}`}>
                {row.line}
              </pre>
            ))}
            <div ref={logEndRef} />
          </div>
        </aside>
      </div>
    </div>
  );
}
