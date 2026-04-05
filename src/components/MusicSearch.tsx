import { useState, useCallback } from 'react';

export type DeckId = 'A' | 'B';

type SearchHit = {
  id: string;
  title: string;
  duration: number | null;
  url: string;
};

function fmtDur(sec: number | null): string {
  if (sec == null || !isFinite(sec) || sec < 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
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
};

export function MusicSearch({ disabled, onAddToDeck }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearchError('Type at least 2 characters');
      return;
    }
    setSearching(true);
    setSearchError('');
    try {
      const res = await fetch(`/api/music/search?q=${encodeURIComponent(q)}&limit=5`);
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
  }, [query]);

  const addFromUrl = useCallback(
    async (deck: DeckId, hit: SearchHit) => {
      const key = `${hit.id}-${deck}`;
      setDownloadingKey(key);
      setSearchError('');
      try {
        const res = await fetch('/api/music/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: hit.url }),
        });
        const buf = await res.arrayBuffer();
        if (!res.ok) {
          const text = new TextDecoder().decode(buf);
          throw new Error(errorFromApiBody(text, res.statusText));
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
          e instanceof Error ? e.message : 'Download failed — check ffmpeg and yt-dlp on the server',
        );
      } finally {
        setDownloadingKey(null);
      }
    },
    [onAddToDeck],
  );

  return (
    <div className="music-search">
      <h2 className="music-search-title">ADD FROM WEB</h2>
      <p className="music-search-hint">
        Search YouTube; the server downloads audio into the deck. Use only content you have rights to use.
      </p>
      <div className="music-search-row">
        <input
          type="search"
          className="music-search-input"
          placeholder="Artist or title…"
          value={query}
          disabled={disabled || searching}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
        />
        <button
          type="button"
          className="music-search-go"
          disabled={disabled || searching}
          onClick={runSearch}
        >
          {searching ? '…' : 'GO'}
        </button>
      </div>
      {searchError && <p className="music-search-error">{searchError}</p>}
      {results.length > 0 && (
        <ul className="music-results">
          {results.map((hit) => (
            <li key={hit.id} className="music-result">
              <div className="music-result-text">
                <span className="music-result-title">{hit.title}</span>
                {hit.duration != null && (
                  <span className="music-result-dur">{fmtDur(hit.duration)}</span>
                )}
              </div>
              <div className="music-result-actions">
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
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
