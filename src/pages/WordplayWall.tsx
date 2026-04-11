import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiUrl } from '../apiBase';
import { useAuth } from '../auth/AuthContext';
import { WordplayLogo } from '../components/WordplayLogo';
import './wall.css';

interface WallPost {
  id: string;
  title: string;
  description: string;
  has_cover: boolean;
  author_name: string;
  author_picture: string;
  created_at: string | null;
}

export default function WordplayWall() {
  const { postId } = useParams<{ postId?: string }>();
  const { token, user } = useAuth();
  const [posts, setPosts] = useState<WallPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Publish form state
  const [showPublish, setShowPublish] = useState(false);
  const [pubTitle, setPubTitle] = useState('');
  const [pubAudio, setPubAudio] = useState<File | null>(null);
  const [pubCover, setPubCover] = useState<File | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [pubError, setPubError] = useState('');

  const fetchFeed = useCallback(async () => {
    setLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(apiUrl('/api/community/feed'), { headers });
      if (res.ok) setPosts(await res.json());
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  const togglePlay = useCallback(
    (id: string) => {
      if (playingId === id) {
        audioRef.current?.pause();
        setPlayingId(null);
        return;
      }
      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(apiUrl(`/api/community/${id}/audio`));
      audio.onended = () => setPlayingId(null);
      audio.play();
      audioRef.current = audio;
      setPlayingId(id);
    },
    [playingId],
  );

  const handlePublish = useCallback(async () => {
    if (!token || !pubAudio || !pubTitle.trim()) return;
    setPublishing(true);
    setPubError('');
    try {
      const form = new FormData();
      form.append('title', pubTitle.trim());
      form.append('audio', pubAudio);
      if (pubCover) form.append('cover', pubCover);
      const res = await fetch(apiUrl('/api/community/publish'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: 'Publish failed' }));
        throw new Error(body.detail || 'Publish failed');
      }
      setPubTitle('');
      setPubAudio(null);
      setPubCover(null);
      setShowPublish(false);
      await fetchFeed();
    } catch (e) {
      setPubError(e instanceof Error ? e.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  }, [token, pubTitle, pubAudio, pubCover, fetchFeed]);

  // If a specific post is linked, scroll/highlight it
  const highlightId = postId || null;

  return (
    <div className="wall-page">
      <header className="wall-header">
        <Link to="/" className="wall-back">
          <WordplayLogo className="wall-logo" title="Wordplay" />
        </Link>
        <h1 className="wall-title">Wordplay Wall</h1>
        {user && (
          <button
            type="button"
            className="wall-publish-toggle"
            onClick={() => setShowPublish(!showPublish)}
          >
            {showPublish ? 'Cancel' : '+ Publish'}
          </button>
        )}
      </header>

      {showPublish && (
        <div className="wall-publish-form">
          <input
            type="text"
            className="wall-pub-input"
            placeholder="Title for your mix"
            value={pubTitle}
            onChange={(e) => setPubTitle(e.target.value)}
          />
          <label className="wall-pub-file-label">
            Audio file
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => setPubAudio(e.target.files?.[0] || null)}
            />
          </label>
          <label className="wall-pub-file-label">
            Cover image (optional)
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setPubCover(e.target.files?.[0] || null)}
            />
          </label>
          <button
            type="button"
            className="wall-pub-submit"
            disabled={publishing || !pubTitle.trim() || !pubAudio}
            onClick={handlePublish}
          >
            {publishing ? 'Publishing…' : 'Publish to wall'}
          </button>
          {pubError && <p className="wall-pub-error">{pubError}</p>}
        </div>
      )}

      {loading ? (
        <p className="wall-loading">Loading…</p>
      ) : posts.length === 0 ? (
        <p className="wall-empty">No wordplays published yet. Be the first!</p>
      ) : (
        <div className="wall-grid">
          {posts.map((post) => (
            <div
              key={post.id}
              className={`wall-card ${highlightId === post.id ? 'wall-card--highlight' : ''}`}
            >
              <div className="wall-card-cover">
                {post.has_cover ? (
                  <img
                    src={apiUrl(`/api/community/${post.id}/cover`)}
                    alt={post.title}
                    className="wall-card-cover-img"
                    loading="lazy"
                  />
                ) : (
                  <div className="wall-card-cover-placeholder">♪</div>
                )}
                <button
                  type="button"
                  className={`wall-play-btn ${playingId === post.id ? 'wall-play-btn--playing' : ''}`}
                  onClick={() => togglePlay(post.id)}
                >
                  {playingId === post.id ? '⏸' : '▶'}
                </button>
              </div>
              <div className="wall-card-info">
                <h3 className="wall-card-title">{post.title}</h3>
                <div className="wall-card-author">
                  {post.author_picture && (
                    <img src={post.author_picture} alt="" className="wall-card-avatar" />
                  )}
                  <span>{post.author_name}</span>
                </div>
              </div>
              <Link to={`/wall/${post.id}`} className="wall-card-share" title="Shareable link">
                🔗
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
