import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
} from 'react';
import { apiUrl } from '../apiBase';
import { DEV_YOUTUBE_UI_ENABLED } from '../devYoutube';

export type DeckId = 'A' | 'B';

type SearchHit = {
  id: string;
  title: string;
  duration: number | null;
  url: string;
  thumbnail?: string;
};

/** If the field looks like a YouTube watch/embed/short URL, return canonical watch URL + id. */
function parseYouTubePaste(raw: string): { id: string; url: string } | null {
  let t = raw.trim();
  if (t.length < 12) return null;
  if (!/^https?:\/\//i.test(t)) {
    t = `https://${t}`;
  }
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '').toLowerCase();

  const idOk = (id: string) => /^[a-zA-Z0-9_-]{11}$/.test(id);

  if (host === 'youtu.be') {
    const id = url.pathname.replace(/^\//, '').split('/')[0] ?? '';
    if (idOk(id)) {
      return { id, url: `https://www.youtube.com/watch?v=${id}` };
    }
    return null;
  }

  if (!host.endsWith('youtube.com')) return null;

  if (url.pathname === '/watch' || url.pathname.startsWith('/watch')) {
    const v = url.searchParams.get('v');
    if (v && idOk(v)) {
      return { id: v, url: `https://www.youtube.com/watch?v=${v}` };
    }
  }

  const pathMatch = url.pathname.match(
    /\/(?:embed|shorts|live|v)\/([a-zA-Z0-9_-]{11})/,
  );
  if (pathMatch && idOk(pathMatch[1])) {
    const id = pathMatch[1];
    return { id, url: `https://www.youtube.com/watch?v=${id}` };
  }

  return null;
}

function fmtDur(sec: number | null): string {
  if (sec == null || !isFinite(sec) || sec < 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Remaining time for “est. … left” (no leading tilde). */
function fmtEtaRemain(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '';
  if (sec < 90) return `${Math.max(1, Math.round(sec))}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

/** Rough expected file size for MP3-ish audio when Content-Length is missing (bytes). */
function estimatedBytesFromDuration(durationSec: number | null): number | null {
  if (durationSec == null || !isFinite(durationSec) || durationSec <= 0) return null;
  return Math.max(80_000, Math.floor(durationSec * 16_000));
}

function errorFromApiBody(text: string, fallback: string): string {
  const t = text.trim();
  if (!t) return fallback;
  try {
    const j = JSON.parse(t) as { detail?: unknown };
    const d = j.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d) && d.length && typeof d[0] === 'object' && d[0] !== null && 'msg' in d[0]) {
      return (d as { msg: string }[]).map((x) => x.msg).join('; ');
    }
  } catch {
    /* not JSON */
  }
  return t.length > 200 ? `${t.slice(0, 200)}…` : t;
}

type Props = {
  disabled?: boolean;
  onAddToDeck: (deck: DeckId, file: File) => void;
  /** When set, results load only into this deck — single action per row. */
  targetDeck?: DeckId;
  className?: string;
  /** In-deck card: tight layout, tap row to load, no noisy short-query errors. */
  variant?: 'default' | 'embedded';
};

/** YouTube search UI; never mounted in production (see `devYoutube.ts`). */
export function MusicSearch(props: Props) {
  if (!DEV_YOUTUBE_UI_ENABLED) {
    return null;
  }
  return <MusicSearchImpl {...props} />;
}

function MusicSearchImpl({
  disabled,
  onAddToDeck,
  targetDeck,
  className,
  variant = 'default',
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  /** Elapsed seconds while the current download runs (same row / button). */
  const [loadElapsedSec, setLoadElapsedSec] = useState(0);
  /** Estimated seconds remaining (from byte progress + total size). */
  const [loadEtaSec, setLoadEtaSec] = useState<number | null>(null);

  const downloadBytesRef = useRef(0);
  const downloadTotalBytesRef = useRef<number | null>(null);

  useEffect(() => {
    if (!downloadingKey) {
      setLoadElapsedSec(0);
      setLoadEtaSec(null);
      return;
    }
    const t0 = performance.now();
    const id = window.setInterval(() => {
      const elapsed = (performance.now() - t0) / 1000;
      setLoadElapsedSec(elapsed);
      const received = downloadBytesRef.current;
      const total = downloadTotalBytesRef.current;
      if (total != null && total > 0 && received > 0 && elapsed > 0.05) {
        const speed = received / elapsed;
        const remaining = Math.max(0, (total - received) / speed);
        setLoadEtaSec(remaining > 0.35 && remaining < 7200 ? remaining : null);
      } else {
        setLoadEtaSec(null);
      }
    }, 100);
    return () => clearInterval(id);
  }, [downloadingKey]);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearchError(variant === 'embedded' ? '' : 'Type at least 2 characters');
      return;
    }

    const yt = parseYouTubePaste(q);
    if (yt) {
      setSearchError('');
      setResults([
        {
          id: yt.id,
          title: 'YouTube link (paste)',
          duration: null,
          url: yt.url,
          thumbnail: `https://img.youtube.com/vi/${yt.id}/mqdefault.jpg`,
        },
      ]);
      return;
    }

    setSearching(true);
    setSearchError('');
    try {
      const res = await fetch(
        apiUrl(`/api/music/search?q=${encodeURIComponent(q)}&limit=5`),
      );
      const raw = await res.text();
      if (!res.ok) {
        throw new Error(errorFromApiBody(raw, res.statusText));
      }
      const data = JSON.parse(raw) as { results?: SearchHit[] };
      setResults(Array.isArray(data.results) ? data.results : []);
    } catch (e) {
      setResults([]);
      setSearchError(
        e instanceof Error ? e.message : 'Search failed — is the backend running on port 8000?',
      );
    } finally {
      setSearching(false);
    }
  }, [query, variant]);

  const hasQuery = query.trim().length > 0;

  const addFromUrl = useCallback(
    async (deck: DeckId, hit: SearchHit) => {
      const key = `${hit.id}-${deck}`;
      setDownloadingKey(key);
      setSearchError('');
      downloadBytesRef.current = 0;
      downloadTotalBytesRef.current = null;
      try {
        const res = await fetch(apiUrl('/api/music/download'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: hit.url }),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(errorFromApiBody(text, res.statusText));
        }

        const cl = res.headers.get('content-length');
        if (cl) {
          const n = parseInt(cl, 10);
          if (!Number.isNaN(n) && n > 0) downloadTotalBytesRef.current = n;
        }
        if (downloadTotalBytesRef.current == null) {
          const est = estimatedBytesFromDuration(hit.duration);
          if (est != null) downloadTotalBytesRef.current = est;
        }

        const body = res.body;
        if (!body) {
          const ab = await res.arrayBuffer();
          downloadBytesRef.current = ab.byteLength;
          const blob = new Blob([ab], {
            type: res.headers.get('Content-Type') || 'audio/mpeg',
          });
          const cd = res.headers.get('Content-Disposition');
          let name = `${hit.title.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 80)}.mp3`;
          if (cd) {
            const m = /filename\*?=(?:UTF-8''|")?([^";\n]+)/i.exec(cd);
            if (m) {
              try {
                name = decodeURIComponent(m[1].replace(/"/g, '').trim());
              } catch {
                name = m[1].replace(/"/g, '').trim();
              }
            }
          }
          const type = blob.type || 'audio/mpeg';
          onAddToDeck(deck, new File([blob], name, { type }));
          return;
        }

        const reader = body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.length;
            downloadBytesRef.current = received;
          }
        }

        const buf = new Uint8Array(received);
        let offset = 0;
        for (const c of chunks) {
          buf.set(c, offset);
          offset += c.length;
        }

        const blob = new Blob([buf], {
          type: res.headers.get('Content-Type') || 'audio/mpeg',
        });
        const cd = res.headers.get('Content-Disposition');
        let name = `${hit.title.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 80)}.mp3`;
        if (cd) {
          const m = /filename\*?=(?:UTF-8''|")?([^";\n]+)/i.exec(cd);
          if (m) {
            try {
              name = decodeURIComponent(m[1].replace(/"/g, '').trim());
            } catch {
              name = m[1].replace(/"/g, '').trim();
            }
          }
        }
        const type = blob.type || 'audio/mpeg';
        const file = new File([blob], name, { type });
        onAddToDeck(deck, file);
      } catch (e) {
        setSearchError(
          e instanceof Error
            ? e.message
            : 'Download failed — check the API is running and reachable',
        );
      } finally {
        setDownloadingKey(null);
      }
    },
    [onAddToDeck],
  );

  const rootClass = [
    'music-search',
    variant === 'embedded' ? 'music-search--embedded' : '',
    disabled ? 'music-search--disabled' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClass}>
      <div className="music-search-row">
        <input
          type="search"
          className="music-search-input"
          placeholder="Search or paste YouTube link…"
          autoComplete="off"
          aria-label="Search YouTube or paste a video URL"
          value={query}
          disabled={disabled || searching}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
        />
        <button
          type="button"
          className={`music-search-go${hasQuery ? ' music-search-go--active' : ''}`}
          disabled={disabled || searching}
          onClick={runSearch}
          aria-label={searching ? 'Searching…' : 'Search YouTube'}
        >
          {searching ? (
            <span className="music-search-go-loading" aria-hidden>
              …
            </span>
          ) : (
            <svg
              className="music-search-yt-svg"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="-35.20005 -41.33325 305.0671 247.9995"
              aria-hidden
            >
              <path
                className="music-search-yt-tube"
                d="M229.763 25.817c-2.699-10.162-10.65-18.165-20.748-20.881C190.716 0 117.333 0 117.333 0S43.951 0 25.651 4.936C15.553 7.652 7.6 15.655 4.903 25.817 0 44.236 0 82.667 0 82.667s0 38.429 4.903 56.85C7.6 149.68 15.553 157.681 25.65 160.4c18.3 4.934 91.682 4.934 91.682 4.934s73.383 0 91.682-4.934c10.098-2.718 18.049-10.72 20.748-20.882 4.904-18.421 4.904-56.85 4.904-56.85s0-38.431-4.904-56.85"
              />
              <path
                className="music-search-yt-play"
                d="M93.333 117.559l61.333-34.89-61.333-34.894z"
              />
            </svg>
          )}
        </button>
      </div>
      {searchError && <p className="music-search-error">{searchError}</p>}
      {results.length > 0 && (
        <ul className="music-results">
          {results.map((hit) => {
            const embed =
              variant === 'embedded' && targetDeck
                ? {
                    onClick: () => {
                      if (disabled || downloadingKey !== null) return;
                      void addFromUrl(targetDeck, hit);
                    },
                    onKeyDown: (e: KeyboardEvent<HTMLLIElement>) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      if (disabled || downloadingKey !== null) return;
                      void addFromUrl(targetDeck, hit);
                    },
                  }
                : {};

            const isDownloadingThis =
              downloadingKey != null &&
              (targetDeck
                ? downloadingKey === `${hit.id}-${targetDeck}`
                : downloadingKey === `${hit.id}-A` ||
                  downloadingKey === `${hit.id}-B`);

            return (
              <li
                key={hit.id}
                className={`music-result${variant === 'embedded' && targetDeck ? ' music-result--embed' : ''}${isDownloadingThis ? ' music-result--loading' : ''}`}
                aria-busy={isDownloadingThis}
                aria-live={isDownloadingThis ? 'polite' : undefined}
                {...(variant === 'embedded' && targetDeck
                  ? {
                      role: 'button' as const,
                      tabIndex: 0,
                      ...embed,
                    }
                  : {})}
              >
                <div className="music-result-text">
                  <span className="music-result-title">{hit.title}</span>
                  {isDownloadingThis ? (
                    <span className="music-result-load-elapsed">
                      Loading {loadElapsedSec.toFixed(1)}s
                      {loadEtaSec != null && (
                        <span className="music-result-load-eta">
                          {' '}
                          · est. {fmtEtaRemain(loadEtaSec)} left
                        </span>
                      )}
                    </span>
                  ) : (
                    hit.duration != null && (
                      <span className="music-result-dur">{fmtDur(hit.duration)}</span>
                    )
                  )}
                </div>
                {variant === 'embedded' && targetDeck ? (
                  <span className="music-result-embed-hint" aria-hidden>
                    {isDownloadingThis ? (
                      <span className="music-result-embed-spinner" />
                    ) : (
                      '→'
                    )}
                  </span>
                ) : (
                  <div className="music-result-actions">
                    {targetDeck ? (
                      <button
                        type="button"
                        className={`music-deck-btn music-deck-single music-deck-${targetDeck.toLowerCase()}`}
                        disabled={disabled || downloadingKey !== null}
                        title={`Load to track ${targetDeck}`}
                        onClick={() => addFromUrl(targetDeck, hit)}
                      >
                        {downloadingKey === `${hit.id}-${targetDeck}` ? '…' : 'Load'}
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="music-deck-btn music-deck-a"
                          disabled={disabled || downloadingKey !== null}
                          title="Load to track A"
                          onClick={() => addFromUrl('A', hit)}
                        >
                          {downloadingKey === `${hit.id}-A` ? '…' : 'A'}
                        </button>
                        <button
                          type="button"
                          className="music-deck-btn music-deck-b"
                          disabled={disabled || downloadingKey !== null}
                          title="Load to track B"
                          onClick={() => addFromUrl('B', hit)}
                        >
                          {downloadingKey === `${hit.id}-B` ? '…' : 'B'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
