import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Pause, Play, X, Heart, Share2 } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { usePlayer } from './playerStore'
import { formatTime } from '@/lib/utils'
import { springs } from '@/motion/springs'
import { cn } from '@/lib/utils'

/**
 * Persistent bottom-bar player mounted once at the app root. Shared
 * layoutId morphs its cover art with whichever MixCard it was launched
 * from, giving the Spotify-style "one track everywhere" feel.
 */
export function BottomPlayerHost() {
  const { current, playing, progress, togglePlay, setProgress, setDuration, close } = usePlayer()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const location = useLocation()

  // Hide on login/landing surfaces to keep them clean.
  const hide = location.pathname === '/' || location.pathname === '/login'

  useEffect(() => {
    if (!audioRef.current || !current) return
    if (audioRef.current.src !== current.audioUrl) {
      audioRef.current.src = current.audioUrl
      audioRef.current.load()
    }
  }, [current])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    if (playing) void el.play().catch(() => {})
    else el.pause()
  }, [playing])

  return (
    <AnimatePresence>
      {current && !hide && (
        <motion.div
          key="bottom-player"
          className="fixed left-0 right-0 bottom-0 z-50 px-2 pb-2 sm:px-4 sm:pb-3 pointer-events-none"
          initial={{ y: 120, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 120, opacity: 0 }}
          transition={springs.silky}
        >
          <div
            className={cn(
              'mx-auto max-w-5xl pointer-events-auto',
              'rounded-2xl border border-[var(--wp-border)] bg-[var(--wp-surface)]/95 backdrop-blur-xl wp-elevated',
              'flex items-center gap-3 p-2 sm:p-3',
            )}
          >
            <motion.div
              layoutId={current.layoutId ?? `cover-${current.postId}`}
              className="relative h-12 w-12 sm:h-14 sm:w-14 shrink-0 overflow-hidden rounded-xl bg-[var(--wp-surface-2)]"
              transition={springs.silky}
            >
              {current.coverUrl ? (
                <img src={current.coverUrl} alt={current.title} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-[var(--wp-muted)]">
                  wp
                </div>
              )}
              {playing && (
                <motion.div
                  className="absolute inset-0 rounded-xl ring-2 ring-[var(--wp-accent-hi)]/70"
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.6, repeat: Infinity }}
                />
              )}
            </motion.div>

            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <Link
                  to={`/m/${current.slug}`}
                  className="truncate font-medium hover:underline text-sm sm:text-base"
                >
                  {current.title}
                </Link>
                <Link
                  to={`/u/${current.handle}`}
                  className="hidden sm:inline truncate text-xs text-[var(--wp-muted)] hover:underline"
                >
                  @{current.handle}
                </Link>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-[10px] tabular-nums text-[var(--wp-muted)] w-10 text-right">
                  {formatTime(progress)}
                </span>
                <div className="relative h-1 flex-1 rounded-full bg-[var(--wp-surface-2)] overflow-hidden">
                  <motion.div
                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[var(--wp-accent)] to-[var(--wp-accent-hi)]"
                    style={{ width: `${current.duration ? (progress / current.duration) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-[10px] tabular-nums text-[var(--wp-muted)] w-10">
                  {formatTime(current.duration)}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => togglePlay()}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--wp-accent)] text-white transition hover:scale-105 active:scale-95"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
            </button>
            <div className="hidden sm:flex items-center gap-1 text-[var(--wp-muted)]">
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-[var(--wp-surface-2)]"
                aria-label="Like"
              >
                <Heart className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-[var(--wp-surface-2)]"
                onClick={() => {
                  const url = `${window.location.origin}/m/${current.slug}`
                  if (navigator.share) void navigator.share({ url, title: current.title })
                  else void navigator.clipboard.writeText(url)
                }}
                aria-label="Share"
              >
                <Share2 className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => close()}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--wp-muted)] hover:bg-[var(--wp-surface-2)]"
              aria-label="Close player"
            >
              <X className="h-4 w-4" />
            </button>
            <audio
              ref={audioRef}
              onTimeUpdate={(e) => setProgress((e.target as HTMLAudioElement).currentTime)}
              onLoadedMetadata={(e) => setDuration((e.target as HTMLAudioElement).duration || current.duration)}
              onEnded={() => usePlayer.setState({ playing: false, progress: 0 })}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
