import { ExternalLink, Clock, Video } from 'lucide-react'
import { PlaylistPanel } from './PlaylistPanel'
import type { GenreId } from '../genre/genrePresets'

export interface SidebarQuota {
  isPremium: boolean
  remainingMinutes: number
  usedSeconds: number
}

interface Props {
  token: string | null
  quota: SidebarQuota
  /** Kept for backwards-compat; unused after genre cleanup. */
  genreStyle?: GenreId
  isMixing: boolean
  onLoadPlaylistFile: (file: File) => void
  /** Kept for backwards-compat; genre grid removed in v1.1. */
  onSelectGenre?: (id: GenreId) => void
}

export function AppSidebarLeft({
  token,
  quota,
  isMixing,
  onLoadPlaylistFile,
}: Props) {
  const quotaPct = Math.min(100, (quota.usedSeconds / 1200) * 100)
  const showQuota = !quota.isPremium

  return (
    <div
      className="flex flex-col h-full min-h-0 gap-4 p-4"
      aria-label="Wordplaylist, mix controls"
    >
      {showQuota && (
        <section className="rounded-xl border border-[var(--wp-border)] bg-[var(--wp-surface-2)]/60 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-[var(--wp-accent-hi)]" />
              <span className="wp-label">Free play</span>
            </div>
            <span className="wp-mono text-[var(--wp-text)]">
              {quota.remainingMinutes} min left
            </span>
          </div>
          <div
            className="h-1.5 rounded-full bg-[var(--wp-surface-3)] overflow-hidden"
            role="progressbar"
            aria-valuenow={Math.round(quotaPct)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full bg-gradient-to-r from-[var(--wp-accent)] to-[var(--wp-accent-hi)] transition-[width] duration-300"
              style={{ width: `${quotaPct}%` }}
            />
          </div>
        </section>
      )}

      {/* y2mate external link */}
      <a
        href="https://y2mate.sc/"
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-center gap-2 rounded-lg border border-[var(--wp-border)] bg-[var(--wp-surface-2)]/40 hover:bg-[var(--wp-surface-2)] px-3 py-2 transition-colors"
      >
        <Video className="h-4 w-4 text-[var(--wp-danger)] shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="wp-title text-[13px]">YouTube → MP3</div>
          <div className="wp-caption text-[11px] truncate">y2mate.sc · new tab</div>
        </div>
        <ExternalLink className="h-3.5 w-3.5 text-[var(--wp-muted)] group-hover:text-[var(--wp-text)] transition-colors" />
      </a>

      {/* Wordplaylist */}
      <section className="flex flex-col gap-3 min-h-0 flex-1 rounded-xl border border-[var(--wp-border)] bg-[var(--wp-surface-2)]/60 p-3">
        <div>
          <h3 className="wp-h3 text-[0.9375rem]">Wordplaylist</h3>
          <p className="wp-caption">Cloud library · drag rows to a deck</p>
        </div>
        <div className="flex-1 min-h-0">
          <PlaylistPanel token={token} onLoadFile={onLoadPlaylistFile} embedded />
        </div>
      </section>
    </div>
  )
}
