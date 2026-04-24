import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { Headphones, UserPlus, UserCheck } from 'lucide-react'
import { fetchProfile, followUser, unfollowUser, coverUrl, type Profile } from '@/api/social'
import { useAuth } from '@/auth/AuthContext'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatCompact, formatTime } from '@/lib/utils'

export default function ProfilePage() {
  const { handle } = useParams<{ handle: string }>()
  const { token } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [tab, setTab] = useState<'mixes' | 'remixes'>('mixes')

  const load = useCallback(() => {
    if (!handle) return
    fetchProfile(handle, tab, token)
      .then(setProfile)
      .catch(() => setProfile(null))
  }, [handle, tab, token])

  useEffect(() => {
    load()
  }, [load])

  if (!profile) {
    return <div className="mx-auto max-w-3xl p-10 text-center text-[var(--wp-muted)]">Loading profile…</div>
  }

  const u = profile.user

  const toggleFollow = async () => {
    if (!token) return
    try {
      if (u.following_by_me) await unfollowUser(u.id, token)
      else await followUser(u.id, token)
      load()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--wp-bg)] text-[var(--wp-fg)] pb-36">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 pt-6">
        <Link to="/feed" className="text-sm text-[var(--wp-muted)] hover:underline">← Feed</Link>

        <div className="mt-4 flex flex-col sm:flex-row gap-5 sm:items-end">
          <Avatar className="h-24 w-24 ring-4 ring-[var(--wp-accent)]/30">
            <AvatarImage src={u.picture} />
            <AvatarFallback>{u.name[0]}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <h1 className="font-display text-2xl sm:text-3xl tracking-tight">{u.name}</h1>
            <div className="text-[var(--wp-muted)]">@{u.handle}</div>
            {u.bio && <p className="mt-2 text-sm">{u.bio}</p>}
            <div className="mt-3 flex gap-5 text-sm">
              <Stat label="Followers" value={u.followers_count} />
              <Stat label="Following" value={u.following_count} />
              <Stat label="Plays" value={u.plays_total} icon={<Headphones className="h-3.5 w-3.5" />} />
            </div>
          </div>
          {!u.is_me && token && (
            <Button onClick={toggleFollow} variant={u.following_by_me ? 'outline' : 'default'} className="gap-2 self-start sm:self-end">
              {u.following_by_me ? <UserCheck className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
              {u.following_by_me ? 'Following' : 'Follow'}
            </Button>
          )}
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mt-6">
          <TabsList>
            <TabsTrigger value="mixes">Mixes</TabsTrigger>
            <TabsTrigger value="remixes">Remixes</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {profile.posts.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-[var(--wp-border)] p-8 text-center text-[var(--wp-muted)]">
              Nothing here yet.
            </div>
          )}
          {profile.posts.map((p, idx) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(idx * 0.04, 0.2) }}
            >
              <Link
                to={`/m/${p.slug}`}
                className="group block rounded-xl overflow-hidden border border-[var(--wp-border)] bg-[var(--wp-surface)]"
              >
                <div className="relative aspect-square bg-gradient-to-br from-[var(--wp-accent)]/30 to-[var(--wp-accent-hi)]/20">
                  {p.has_cover && (
                    <img src={coverUrl(p.id)} alt={p.title} className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="p-2">
                  <div className="text-sm font-medium truncate">{p.title}</div>
                  <div className="text-xs text-[var(--wp-muted)] tabular-nums">
                    {formatCompact(p.plays_count)} plays · {formatCompact(p.likes_count)} ♥
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start">
      <span className="font-semibold tabular-nums flex items-center gap-1">
        {icon}
        {formatCompact(value)}
      </span>
      <span className="text-[var(--wp-muted)] text-xs">{label}</span>
    </div>
  )
}
