import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { Bell, Compass, Home, Menu, Plus, Search, Settings as SettingsIcon, Sparkles, User as UserIcon } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MixCard } from './MixCard'
import { fetchFeed, type FeedPost, type FeedTab, fetchNotifications } from '@/api/social'
import { useAuth } from '@/auth/AuthContext'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const TABS: Array<{ id: FeedTab; label: string; icon: React.ReactNode }> = [
  { id: 'foryou', label: 'For You', icon: <Sparkles className="h-4 w-4" /> },
  { id: 'following', label: 'Following', icon: <UserIcon className="h-4 w-4" /> },
  { id: 'trending', label: 'Trending', icon: <Compass className="h-4 w-4" /> },
]

export default function FeedPage() {
  const { user, token, mode } = useAuth()
  const [tab, setTab] = useState<FeedTab>('foryou')
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [unread, setUnread] = useState(0)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setPosts([])
    setCursor(null)
    setDone(false)
  }, [tab])

  const loadMore = useCallback(async () => {
    if (loading || done) return
    setLoading(true)
    try {
      const res = await fetchFeed(tab, token, cursor)
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id))
        return [...prev, ...res.posts.filter((p) => !seen.has(p.id))]
      })
      setCursor(res.next_cursor)
      if (!res.next_cursor || !res.posts.length) setDone(true)
    } catch {
      setDone(true)
    } finally {
      setLoading(false)
    }
  }, [tab, token, cursor, loading, done])

  useEffect(() => {
    void loadMore()
  }, [tab])

  useEffect(() => {
    if (!token) return
    void fetchNotifications(token, true)
      .then((r) => setUnread(r.unread_count))
      .catch(() => {})
  }, [token])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore()
      },
      { rootMargin: '400px 0px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [loadMore])

  const tabTitle = useMemo(() => TABS.find((t) => t.id === tab)?.label ?? 'Feed', [tab])

  return (
    <div className="min-h-screen bg-[var(--wp-bg)] text-[var(--wp-fg)] pb-36">
      <header className="sticky top-0 z-30 border-b border-[var(--wp-border)] bg-[var(--wp-bg)]/80 backdrop-blur-xl">
        <div className="mx-auto max-w-3xl h-14 px-4 sm:px-6 flex items-center gap-2">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="sm:hidden" aria-label="Menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72">
              <SheetHeader>
                <SheetTitle>Wordplay</SheetTitle>
              </SheetHeader>
              <nav className="mt-6 flex flex-col gap-1 text-sm">
                <NavLink to="/feed" icon={<Home className="h-4 w-4" />}>Feed</NavLink>
                <NavLink to={user ? `/u/${(user as any).handle ?? 'me'}` : '/login'} icon={<UserIcon className="h-4 w-4" />}>Profile</NavLink>
                <NavLink to="/settings" icon={<SettingsIcon className="h-4 w-4" />}>Settings</NavLink>
                <NavLink to="/studio" icon={<Plus className="h-4 w-4" />}>New mix</NavLink>
              </nav>
            </SheetContent>
          </Sheet>
          <Link to="/feed" className="font-display text-xl tracking-tight">
            wordplay
          </Link>
          <nav className="hidden sm:flex items-center gap-1 ml-4">
            <NavLink to="/feed" icon={<Home className="h-4 w-4" />}>Feed</NavLink>
            <NavLink to="/studio" icon={<Plus className="h-4 w-4" />}>Create</NavLink>
          </nav>
          <div className="flex-1" />
          <Button variant="ghost" size="icon" aria-label="Search">
            <Search className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
            <Bell className="h-5 w-5" />
            {unread > 0 && (
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-rose-500" />
            )}
          </Button>
          <Link
            to={user ? `/u/${(user as any).handle ?? 'me'}` : '/login'}
            className="rounded-full overflow-hidden"
          >
            <Avatar className="h-8 w-8">
              <AvatarImage src={user?.picture} />
              <AvatarFallback>{user?.name?.[0] ?? 'W'}</AvatarFallback>
            </Avatar>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 sm:px-6 pt-6">
        <div className="flex items-center justify-between mb-3">
          <h1 className="font-display text-2xl sm:text-3xl tracking-tight">{tabTitle}</h1>
          {mode === 'anonymous' && (
            <Link to="/login">
              <Button size="sm">Sign in</Button>
            </Link>
          )}
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as FeedTab)} className="mb-4">
          <TabsList className="w-full grid grid-cols-3">
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="gap-1.5">
                {t.icon}
                <span className="hidden xs:inline sm:inline">{t.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          {TABS.map((t) => (
            <TabsContent key={t.id} value={t.id} className="mt-4">
              <AnimatePresence mode="popLayout">
                {posts.length === 0 && loading && (
                  <div className="flex flex-col gap-4">
                    <Skeleton className="h-80 w-full rounded-2xl" />
                    <Skeleton className="h-80 w-full rounded-2xl" />
                  </div>
                )}
                {posts.length === 0 && !loading && done && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="rounded-2xl border border-dashed border-[var(--wp-border)] p-10 text-center text-[var(--wp-muted)]"
                  >
                    <Compass className="mx-auto mb-3 h-8 w-8" />
                    <div className="font-medium text-[var(--wp-fg)] mb-1">No mixes here yet</div>
                    <p className="text-sm">Follow a few creators or drop your first mix.</p>
                    <Link to="/studio" className="inline-block mt-3">
                      <Button size="sm">Create a mix</Button>
                    </Link>
                  </motion.div>
                )}
                {posts.map((p, idx) => (
                  <motion.div
                    key={p.id}
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(0.04 * idx, 0.2) }}
                    className="mb-4"
                  >
                    <MixCard post={p} onChanged={(next) =>
                      setPosts((prev) => prev.map((q) => (q.id === next.id ? next : q)))
                    } />
                  </motion.div>
                ))}
              </AnimatePresence>
              <div ref={sentinelRef} className="h-12" />
              {loading && posts.length > 0 && (
                <div className="flex justify-center text-sm text-[var(--wp-muted)]">Loading…</div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </main>
    </div>
  )
}

function NavLink({ to, icon, children }: { to: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
        'text-[var(--wp-fg)]/80 hover:text-[var(--wp-fg)] hover:bg-[var(--wp-surface-2)]',
      )}
    >
      {icon}
      {children}
    </Link>
  )
}
