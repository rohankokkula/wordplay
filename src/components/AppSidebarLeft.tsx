import { PlaylistPanel } from './PlaylistPanel';
import { GENRE_PRESETS, GENRE_LIST, type GenreId } from '../genre/genrePresets';
import './AppSidebarLeft.css';

const BLEND_BEAT_OPTIONS = [8, 16, 32, 64, 128] as const;

export interface SidebarQuota {
  isPremium: boolean;
  remainingMinutes: number;
  usedSeconds: number;
}

interface Props {
  token: string | null;
  quota: SidebarQuota;
  genreStyle: GenreId;
  blendBeats: number;
  beatPreview: { avgInterval: number; bpmA: number; bpmB: number } | null;
  isMixing: boolean;
  onLoadPlaylistFile: (file: File) => void;
  onSelectGenre: (id: GenreId) => void;
  onSelectBlendBeats: (n: number) => void;
}

export function AppSidebarLeft({
  token,
  quota,
  genreStyle,
  blendBeats,
  beatPreview,
  isMixing,
  onLoadPlaylistFile,
  onSelectGenre,
  onSelectBlendBeats,
}: Props) {
  const quotaPct = Math.min(100, (quota.usedSeconds / 1200) * 100);
  const showQuota = !quota.isPremium;

  return (
    <aside className="app-sidebar-left sidebar-left" aria-label="Wordplaylist, mix controls">
      <div className="sidebar-left__accent" aria-hidden />

      {showQuota && (
        <div className="sidebar-left__top">
          <div className="sidebar-left__quota">
            <div className="sidebar-left__quota-head">
              <span className="sidebar-left__quota-title">Free play</span>
              <span className="sidebar-left__quota-mins">{quota.remainingMinutes} min left</span>
            </div>
            <div
              className="sidebar-left__quota-bar"
              role="progressbar"
              aria-valuenow={Math.round(quotaPct)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="sidebar-left__quota-fill" style={{ width: `${quotaPct}%` }} />
            </div>
          </div>
        </div>
      )}

      <div className="sidebar-left__middle">
        <section className="sidebar-card">
          <div className="sidebar-card__head">
            <span className="sidebar-card__icon sidebar-card__icon--genre" aria-hidden />
            <div>
              <h2 className="sidebar-card__title">Genre</h2>
              <p className="sidebar-card__sub">Rhythm, transitions & feel</p>
            </div>
          </div>
          <div className="sidebar-card__body sidebar-card__body--flush">
            <div className="sidebar-genre-grid" role="group" aria-label="Genre style">
              {GENRE_LIST.map((gid) => {
                const preset = GENRE_PRESETS[gid];
                return (
                  <button
                    key={gid}
                    type="button"
                    className={`sidebar-genre-chip${genreStyle === gid ? ' sidebar-genre-chip--active' : ''}`}
                    disabled={isMixing}
                    onClick={() => onSelectGenre(gid)}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="sidebar-card sidebar-card--blend">
          <div className="sidebar-card__head">
            <span className="sidebar-card__icon sidebar-card__icon--blend" aria-hidden />
            <div>
              <h2 className="sidebar-card__title">Blend length</h2>
              <p className="sidebar-card__sub">Crossfade window in beats (4/4)</p>
            </div>
          </div>
          {beatPreview && (
            <div className="sidebar-bpm-pill">
              <span className="sidebar-bpm-pill__deck sidebar-bpm-pill__deck--a">A</span>
              <span className="sidebar-bpm-pill__val">{Math.round(beatPreview.bpmA)}</span>
              <span className="sidebar-bpm-pill__sep">·</span>
              <span className="sidebar-bpm-pill__deck sidebar-bpm-pill__deck--b">B</span>
              <span className="sidebar-bpm-pill__val">{Math.round(beatPreview.bpmB)}</span>
              <span className="sidebar-bpm-pill__unit">BPM</span>
            </div>
          )}
          <div className="sidebar-card__body sidebar-card__body--flush">
            <div className="sidebar-blend-list" role="group" aria-label="Blend length in beats">
              {BLEND_BEAT_OPTIONS.map((n) => {
                const approxSec = beatPreview != null ? n * beatPreview.avgInterval : null;
                return (
                  <button
                    key={n}
                    type="button"
                    className={`sidebar-blend-row${blendBeats === n ? ' sidebar-blend-row--active' : ''}`}
                    disabled={isMixing}
                    onClick={() => onSelectBlendBeats(n)}
                  >
                    <span className="sidebar-blend-row__beats">{n}</span>
                    <span className="sidebar-blend-row__label">beats</span>
                    {approxSec != null && (
                      <span className="sidebar-blend-row__time">~{approxSec.toFixed(1)}s</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      <div className="sidebar-left__wordplaylist">
        <div className="sidebar-left__y2mate">
          <a
            href="https://y2mate.sc/"
            target="_blank"
            rel="noopener noreferrer"
            className="sidebar-y2mate-link"
          >
            <span className="sidebar-y2mate-link__title">YouTube → MP3</span>
            <span className="sidebar-y2mate-link__meta">
              y2mate.sc · external · opens in new tab
            </span>
          </a>
        </div>
        <section className="sidebar-card sidebar-card--wordplaylist">
          <div className="sidebar-card__head">
            <span className="sidebar-card__icon sidebar-card__icon--wave" aria-hidden />
            <div>
              <h2 className="sidebar-card__title">Wordplaylist</h2>
              <p className="sidebar-card__sub">Cloud library · drag rows to a deck</p>
            </div>
          </div>
          <div className="sidebar-card__body">
            <PlaylistPanel token={token} onLoadFile={onLoadPlaylistFile} embedded />
          </div>
        </section>
      </div>
    </aside>
  );
}
