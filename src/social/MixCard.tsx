import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Heart, MessageCircle, Play, Pause, Repeat2, Share2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  audioUrl,
  coverUrl,
  likePost,
  unlikePost,
  type FeedPost,
} from '@/api/social'
import { useAuth } from '@/auth/AuthContext'
import { usePlayer } from './playerStore'
import { cn, formatCompact, formatRelative, formatTime } from '@/lib/utils'
import { springs } from '@/motion/springs'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'

interface Props {
  post: FeedPost
  onChanged?: (p: FeedPost) => void
}

export function MixCard({ post, onChanged }: Props) {
  const { token } = useAuth()
  const { play, current, playing, togglePlay } = usePlayer()
  const [liked, setLiked] = useState(post.liked_by_me)
  const [likes, setLikes] = useState(post.likes_count)
  const [burst, setBurst] = useState(0)

  const isCurrent = current?.postId === post.id
  const isPlaying = isCurrent && playing

  const handlePlay = () => {
    if (isCurrent) {
      togglePlay()
      return
    }
    play({
      postId: post.id,
      slug: post.slug,
      title: post.title,
      author: post.author.name,
      handle: post.author.handle,
      coverUrl: post.has_cover ? coverUrl(post.id) : null,
      audioUrl: audioUrl(post.id),
      duration: post.duration_sec,
      layoutId: `cover-${post.id}`,
    })
  }

  const handleLike = async () => {
    if (!token) return
    const prev = { liked, likes }
    setLiked((v) => !v)
    setLikes((n) => n + (liked ? -1 : 1))
    setBurst(Date.now())
    try {
      const res = liked ? await unlikePost(post.id, token) : await likePost(post.id, token)
      setLiked(res.liked)
      setLikes(res.likes_count)
      onChanged?.({ ...post, liked_by_me: res.liked, likes_count: res.likes_count })
    } catch {
      setLiked(prev.liked)
      setLikes(prev.likes)
    }
  }

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={springs.silky}
      className={cn(
        'rounded-2xl border border-[var(--wp-border)] bg-[var(--wp-surface)] overflow-hidden wp-elevated',
        'hover:border-[var(--wp-accent)]/40 transition-colors',
      )}
    >
      <div className="flex items-center gap-3 px-4 pt-4">
        <Link to={`/u/${post.author.handle}`} className="flex items-center gap-3 min-w-0">
          <Avatar className="h-9 w-9">
            <AvatarImage src={post.author.picture} alt={post.author.name} />
            <AvatarFallback>{post.author.name[0]}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="font-medium truncate">{post.author.name}</div>
            <div className="text-xs text-[var(--wp-muted)] truncate">
              @{post.author.handle} · {formatRelative(post.created_at ?? '')}
            </div>
          </div>
        </Link>
      </div>

      <div className="relative mt-3 mx-4 aspect-[16/10] rounded-xl overflow-hidden bg-gradient-to-br from-[var(--wp-accent)]/30 via-[var(--wp-surface-2)] to-[var(--wp-accent-hi)]/20">
        <motion.div
          layoutId={`cover-${post.id}`}
          className="absolute inset-0"
          transition={springs.silky}
        >
          {post.has_cover ? (
            <img src={coverUrl(post.id)} alt={post.title} className="h-full w-full object-cover" />
          ) : (
            <WaveformPreview peaks={post.waveform?.peaks ?? []} />
          )}
        </motion.div>

        <motion.button
          type="button"
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          onClick={handlePlay}
          className="absolute inset-0 flex items-center justify-center group"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/50 backdrop-blur-md text-white ring-1 ring-white/20 group-hover:bg-black/65 transition-colors">
            {isPlaying ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7 ml-0.5" />}
          </span>
        </motion.button>
        <div className="absolute left-3 top-3 flex gap-1">
          {post.hashtags.slice(0, 3).map((h) => (
            <span
              key={h}
              className="rounded-full bg-black/50 text-white text-[10px] px-2 py-0.5 backdrop-blur"
            >
              #{h}
            </span>
          ))}
        </div>
        <div className="absolute right-3 bottom-3 rounded bg-black/55 text-white text-[10px] px-2 py-0.5 tabular-nums">
          {formatTime(post.duration_sec)}
        </div>
      </div>

      <div className="px-4 pt-3 pb-4">
        <Link to={`/m/${post.slug}`} className="block">
          <h3 className="font-display text-lg leading-tight hover:underline">{post.title}</h3>
        </Link>
        {post.description && (
          <p className="mt-1 text-sm text-[var(--wp-muted)] line-clamp-2">{post.description}</p>
        )}
        <div className="mt-3 flex items-center gap-1 sm:gap-3 text-sm">
          <button
            type="button"
            onClick={handleLike}
            className={cn(
              'group relative flex items-center gap-1.5 rounded-full px-2 py-1 hover:bg-[var(--wp-surface-2)]',
              liked && 'text-rose-400',
            )}
            aria-label="Like"
            aria-pressed={liked}
          >
            <motion.span
              animate={liked ? { scale: [1, 1.4, 1] } : {}}
              transition={{ duration: 0.5 }}
            >
              <Heart className={cn('h-4 w-4', liked && 'fill-current')} />
            </motion.span>
            <span className="tabular-nums text-xs">{formatCompact(likes)}</span>
            <AnimatePresence>
              {burst > 0 && liked && (
                <motion.span
                  key={burst}
                  className="absolute inset-0 rounded-full"
                  initial={{ scale: 0.4, opacity: 0.9 }}
                  animate={{ scale: 1.8, opacity: 0 }}
                  transition={{ duration: 0.5 }}
                  style={{ boxShadow: '0 0 0 2px rgba(244, 63, 94, 0.5)' }}
                />
              )}
            </AnimatePresence>
          </button>
          <Link
            to={`/m/${post.slug}#comments`}
            className="flex items-center gap-1.5 rounded-full px-2 py-1 hover:bg-[var(--wp-surface-2)]"
          >
            <MessageCircle className="h-4 w-4" />
            <span className="text-xs tabular-nums">{formatCompact(post.comments_count)}</span>
          </Link>
          <Link
            to={`/m/${post.slug}?fork=1`}
            className="flex items-center gap-1.5 rounded-full px-2 py-1 hover:bg-[var(--wp-surface-2)]"
          >
            <Repeat2 className="h-4 w-4" />
            <span className="text-xs tabular-nums">{formatCompact(post.remixes_count)}</span>
          </Link>
          <button
            type="button"
            onClick={() => {
              const url = `${window.location.origin}/m/${post.slug}`
              if (navigator.share) void navigator.share({ url, title: post.title })
              else void navigator.clipboard.writeText(url)
            }}
            className="flex items-center gap-1.5 rounded-full px-2 py-1 hover:bg-[var(--wp-surface-2)] ml-auto"
            aria-label="Share"
          >
            <Share2 className="h-4 w-4" />
          </button>
          <span className="hidden sm:inline text-xs text-[var(--wp-muted)] tabular-nums">
            {formatCompact(post.plays_count)} plays
          </span>
        </div>
      </div>
    </motion.article>
  )
}

function WaveformPreview({ peaks }: { peaks: number[] }) {
  const bars = peaks.length ? peaks : Array.from({ length: 64 }, (_, i) => 0.3 + Math.sin(i) * 0.3 + 0.2)
  return (
    <div className="flex h-full w-full items-center justify-center gap-[2px] px-6">
      {bars.map((v, i) => (
        <motion.span
          key={i}
          className="w-[3px] rounded-full bg-[var(--wp-accent-hi)]/80"
          initial={{ scaleY: 0 }}
          animate={{ scaleY: Math.max(0.08, v) }}
          transition={{ delay: i * 0.003, ...springs.silky }}
          style={{ height: '60%' }}
        />
      ))}
    </div>
  )
}
