import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { Flag, Heart, MessageCircle, Repeat2, Share2 } from 'lucide-react'
import {
  audioUrl,
  coverUrl,
  createComment,
  fetchComments,
  fetchForkGraph,
  fetchPost,
  likePost,
  recordPlay,
  reportPost,
  unlikePost,
  type Comment,
  type FeedPost,
} from '@/api/social'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { cn, formatCompact, formatRelative, formatTime } from '@/lib/utils'
import { usePlayer } from './playerStore'
import { useMixStore } from '@/mix/store'
import type { MixGraph } from '@/mix/types'

function setMeta(property: string, content: string) {
  let el = document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement | null
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('property', property)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

export default function PostPage() {
  const { slug } = useParams<{ slug: string }>()
  const [params] = useSearchParams()
  const { token, user } = useAuth()
  const [post, setPost] = useState<FeedPost | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { play } = usePlayer()
  const loadGraph = useMixStore((s) => s.loadGraph)
  const shouldFork = params.get('fork') === '1'

  useEffect(() => {
    if (!slug) return
    setError(null)
    fetchPost(slug, token)
      .then((p) => {
        setPost(p)
        document.title = `${p.title} — wordplay`
        setMeta('og:title', `${p.title} — wordplay`)
        setMeta('og:description', p.description || `A wordplay by @${p.author.handle}`)
        if (p.has_cover) setMeta('og:image', coverUrl(p.id))
        setMeta('og:url', `${window.location.origin}/m/${p.slug}`)
        setMeta('og:type', 'music.song')
      })
      .catch((e) => setError((e as Error).message))
  }, [slug, token])

  useEffect(() => {
    if (!post) return
    fetchComments(post.id)
      .then((r) => setComments(r.comments))
      .catch(() => {})
  }, [post])

  useEffect(() => {
    if (!shouldFork || !post || !slug) return
    void fetchForkGraph(slug, token)
      .then((res) => {
        if (res.graph_json) loadGraph(res.graph_json as MixGraph)
      })
      .catch(() => {})
  }, [shouldFork, post, slug, token, loadGraph])

  if (error) {
    return (
      <div className="mx-auto max-w-xl p-8 text-center text-[var(--wp-muted)]">
        <h1 className="text-xl font-medium mb-2">Couldn't load that mix</h1>
        <p>{error}</p>
        <Link to="/feed"><Button variant="outline" className="mt-4">Back to feed</Button></Link>
      </div>
    )
  }
  if (!post) {
    return <div className="mx-auto max-w-xl p-10 text-center text-[var(--wp-muted)]">Loading…</div>
  }

  const handlePlay = () => {
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
    const sid = sessionStorage.getItem('wp_play_session') ?? crypto.randomUUID()
    sessionStorage.setItem('wp_play_session', sid)
    void recordPlay(post.id, sid, Math.floor(post.duration_sec * 1000 * 0.4), token)
  }

  const toggleLike = async () => {
    if (!token || !post) return
    try {
      const res = post.liked_by_me
        ? await unlikePost(post.id, token)
        : await likePost(post.id, token)
      setPost({ ...post, liked_by_me: res.liked, likes_count: res.likes_count })
    } catch {
      /* noop */
    }
  }

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !draft.trim()) return
    try {
      await createComment(post.id, draft.trim(), token)
      setDraft('')
      const r = await fetchComments(post.id)
      setComments(r.comments)
      setPost({ ...post, comments_count: post.comments_count + 1 })
    } catch (err) {
      alert((err as Error).message)
    }
  }

  const report = async () => {
    const reason = prompt('Why are you reporting this mix?')
    if (!reason || !token) return
    try {
      await reportPost(post.id, reason, token)
      alert('Thanks — our moderators will review it.')
    } catch (err) {
      alert((err as Error).message)
    }
  }

  const share = () => {
    const url = `${window.location.origin}/m/${post.slug}`
    if (navigator.share) void navigator.share({ url, title: post.title })
    else void navigator.clipboard.writeText(url)
  }

  return (
    <div className="min-h-screen bg-[var(--wp-bg)] text-[var(--wp-fg)] pb-36">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 pt-6">
        <Link to="/feed" className="text-sm text-[var(--wp-muted)] hover:underline">← Back to feed</Link>

        <motion.div
          layoutId={`cover-${post.id}`}
          className="mt-4 relative aspect-[16/9] rounded-2xl overflow-hidden bg-gradient-to-br from-[var(--wp-accent)]/30 via-[var(--wp-surface-2)] to-[var(--wp-accent-hi)]/20"
        >
          {post.has_cover ? (
            <img src={coverUrl(post.id)} alt={post.title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[var(--wp-muted)]">
              waveform preview
            </div>
          )}
          <button
            type="button"
            onClick={handlePlay}
            className="absolute inset-0 grid place-items-center bg-black/30 hover:bg-black/40 transition-colors"
            aria-label="Play"
          >
            <span className="rounded-full bg-white/10 backdrop-blur px-6 py-3 text-white">Play mix</span>
          </button>
          <div className="absolute right-3 bottom-3 rounded bg-black/55 text-white text-xs px-2 py-1 tabular-nums">
            {formatTime(post.duration_sec)}
          </div>
        </motion.div>

        <header className="mt-6 flex items-start gap-4">
          <Link to={`/u/${post.author.handle}`}>
            <Avatar className="h-12 w-12">
              <AvatarImage src={post.author.picture} />
              <AvatarFallback>{post.author.name[0]}</AvatarFallback>
            </Avatar>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-2xl sm:text-3xl tracking-tight">{post.title}</h1>
            <div className="text-sm text-[var(--wp-muted)]">
              by <Link to={`/u/${post.author.handle}`} className="hover:underline">@{post.author.handle}</Link>
              {' · '}
              {formatRelative(post.created_at ?? '')}
              {' · '}
              {formatCompact(post.plays_count)} plays
            </div>
            {post.description && <p className="mt-3 text-[var(--wp-fg)]/90">{post.description}</p>}
            {post.hashtags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {post.hashtags.map((h) => (
                  <span key={h} className="rounded-full bg-[var(--wp-surface-2)] text-xs px-2 py-0.5">
                    #{h}
                  </span>
                ))}
              </div>
            )}
          </div>
        </header>

        <div className="mt-5 flex items-center gap-2">
          <Button onClick={toggleLike} variant={post.liked_by_me ? 'default' : 'outline'} className="gap-2">
            <Heart className={cn('h-4 w-4', post.liked_by_me && 'fill-current')} />
            {formatCompact(post.likes_count)}
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => document.getElementById('comments')?.scrollIntoView({ behavior: 'smooth' })}>
            <MessageCircle className="h-4 w-4" />
            {formatCompact(post.comments_count)}
          </Button>
          <Link to={`/studio?fork=${post.slug}`}>
            <Button variant="outline" className="gap-2">
              <Repeat2 className="h-4 w-4" /> Fork
            </Button>
          </Link>
          <Button variant="ghost" size="icon" onClick={share} aria-label="Share"><Share2 className="h-4 w-4" /></Button>
          {token && (
            <Button variant="ghost" size="icon" onClick={report} aria-label="Report"><Flag className="h-4 w-4" /></Button>
          )}
        </div>

        <Separator className="my-6" />

        <section id="comments">
          <h2 className="font-display text-xl mb-3">Comments</h2>
          {token ? (
            <form onSubmit={submitComment} className="flex gap-2 mb-5">
              <Avatar className="h-9 w-9">
                <AvatarImage src={user?.picture} />
                <AvatarFallback>{user?.name?.[0] ?? 'U'}</AvatarFallback>
              </Avatar>
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Say something kind…"
                maxLength={1000}
              />
              <Button type="submit" disabled={!draft.trim()}>Post</Button>
            </form>
          ) : (
            <div className="mb-5 text-sm text-[var(--wp-muted)]">
              <Link to="/login" className="underline">Sign in</Link> to join the conversation.
            </div>
          )}

          <ul className="flex flex-col gap-4">
            {comments.length === 0 && (
              <li className="text-sm text-[var(--wp-muted)]">Be the first to comment.</li>
            )}
            {comments.map((c) => (
              <li key={c.id} className="flex gap-3">
                <Link to={`/u/${c.author.handle}`}>
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={c.author.picture} />
                    <AvatarFallback>{c.author.name[0]}</AvatarFallback>
                  </Avatar>
                </Link>
                <div className="flex-1">
                  <div className="flex items-baseline gap-2">
                    <Link to={`/u/${c.author.handle}`} className="font-medium hover:underline">
                      {c.author.name}
                    </Link>
                    <span className="text-xs text-[var(--wp-muted)]">@{c.author.handle}</span>
                    <span className="text-xs text-[var(--wp-muted)]">· {formatRelative(c.created_at ?? '')}</span>
                  </div>
                  <p className="mt-0.5 text-sm whitespace-pre-wrap">{c.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
