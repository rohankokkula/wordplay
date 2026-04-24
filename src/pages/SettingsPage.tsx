import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { ArrowLeft, Keyboard, LogOut } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { useTheme, THEME_PALETTES, type ThemeId } from '@/theme/ThemeContext'
import { useAuth } from '@/auth/AuthContext'
import { useReducedMotionContext } from '@/motion/reducedMotion'
import { api } from '@/api/client'
import { cn } from '@/lib/utils'

const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: 'Space', action: 'Play or pause the deck preview' },
  { keys: 'Double-click', action: 'Append a snippet to the master timeline' },
  { keys: 'Drag', action: 'Move snippets between lanes and the master deck' },
  { keys: 'Esc', action: 'Close library or live log' },
]

export default function SettingsPage() {
  const { themeId, setTheme } = useTheme()
  const { user, token, logout } = useAuth()
  const { reduce: reducedMotion, setOverride } = useReducedMotionContext()
  const [masterVolume, setMasterVolume] = useState(() => Number(localStorage.getItem('wp:vol') ?? 0.9))
  const [crossfader, setCrossfader] = useState(() => Number(localStorage.getItem('wp:xfader') ?? 0.5))
  const [autoPublish, setAutoPublish] = useState(() => localStorage.getItem('wp:auto-public') === '1')
  const [appVersion, setAppVersion] = useState<{ frontend: string; backend?: string }>({ frontend: __APP_VERSION__ })
  const [handle, setHandle] = useState('')
  const [bio, setBio] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  useEffect(() => {
    api<{ version: string }>('/api/version')
      .then((v) => setAppVersion((prev) => ({ ...prev, backend: v.version })))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!token) return
    api<{ handle: string; bio: string }>('/api/social/me', { token })
      .then((me) => {
        setHandle(me.handle ?? '')
        setBio(me.bio ?? '')
      })
      .catch(() => {})
  }, [token])

  useEffect(() => {
    localStorage.setItem('wp:vol', String(masterVolume))
  }, [masterVolume])
  useEffect(() => {
    localStorage.setItem('wp:xfader', String(crossfader))
  }, [crossfader])
  useEffect(() => {
    localStorage.setItem('wp:auto-public', autoPublish ? '1' : '0')
  }, [autoPublish])

  const saveProfile = async () => {
    if (!token) return
    setSavingProfile(true)
    try {
      await api('/api/social/me', {
        method: 'PATCH',
        body: JSON.stringify({ handle, bio }),
        token,
      })
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setSavingProfile(false)
    }
  }

  return (
    <div className="app-page text-[var(--wp-text)]">
      <header className="app-page__header sticky top-0 z-30">
        <div className="app-page__header-inner gap-4">
          <Link to="/studio" className="app-page__link-icon" aria-label="Back to studio" title="Back to studio">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="app-page__title">Settings</h1>
        </div>
      </header>

      <main className="app-page__main app-page__main--settings">
        <div className="app-page__container app-page__container--readable min-w-0">
          <Tabs defaultValue="audio" className="w-full min-w-0">
            <div className="app-page__tabs -mx-1 px-1 sm:mx-0 sm:px-0">
              <TabsList className="inline-flex h-auto w-max min-w-full flex-wrap justify-start gap-1 rounded-lg border border-[var(--wp-border)] bg-[var(--wp-surface-2)] p-1.5 sm:grid sm:h-11 sm:w-full sm:grid-cols-4 sm:gap-1 sm:p-1.5">
                <TabsTrigger value="audio" className="flex-1 min-w-[5.5rem]">
                  Audio
                </TabsTrigger>
                <TabsTrigger value="appearance" className="flex-1 min-w-[5.5rem]">
                  Appearance
                </TabsTrigger>
                <TabsTrigger value="account" className="flex-1 min-w-[5.5rem]">
                  Account
                </TabsTrigger>
                <TabsTrigger value="about" className="flex-1 min-w-[5.5rem]">
                  About
                </TabsTrigger>
              </TabsList>
            </div>

          <TabsContent value="audio" className="mt-8 space-y-5">
            <Row label="Master volume" description="Applied to the live preview engine.">
              <Slider
                value={[masterVolume * 100]}
                onValueChange={(v) => setMasterVolume((v[0] ?? 0) / 100)}
                max={100}
              />
            </Row>
            <Row label="Default crossfader" description="Starting position when you open the canvas.">
              <Slider
                value={[crossfader * 100]}
                onValueChange={(v) => setCrossfader((v[0] ?? 0) / 100)}
                max={100}
              />
            </Row>
            <Row label="Reduce motion" description="Respects your OS preference but you can force it on here.">
              <Switch
                checked={reducedMotion}
                onCheckedChange={(v) => setOverride(v ? 'on' : 'off')}
              />
            </Row>
          </TabsContent>

          <TabsContent value="appearance" className="mt-8 space-y-5">
            <div className="w-full min-w-0 space-y-4 rounded-lg border border-[var(--wp-border)] bg-[var(--wp-surface)] p-4 sm:space-y-4 sm:p-5">
              <div className="min-w-0">
                <div className="text-sm font-medium text-[var(--wp-text)] sm:text-base">Theme</div>
                <p className="mt-1 text-sm leading-relaxed text-[var(--wp-muted)] sm:text-base">
                  4 curated palettes. Your choice is saved locally.
                </p>
              </div>
              <div className="grid w-full min-w-0 grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-3.5">
                {THEME_PALETTES.map((p) => (
                  <motion.button
                    key={p.id}
                    type="button"
                    whileTap={reducedMotion ? undefined : { scale: 0.98 }}
                    onClick={() => setTheme(p.id as ThemeId)}
                    className={cn(
                      'isolate flex min-h-0 w-full min-w-0 flex-col items-stretch rounded-xl border p-2.5 text-left sm:p-3',
                      themeId === p.id
                        ? 'border-[var(--wp-accent)] ring-2 ring-[var(--wp-accent)]/40'
                        : 'border-[var(--wp-border)] hover:border-[var(--wp-accent-hi)]/50',
                    )}
                  >
                    <div
                      className="h-14 w-full shrink-0 overflow-hidden rounded-lg sm:h-16"
                      style={{
                        background: `linear-gradient(135deg, ${p.vars['--wp-accent']}, ${p.vars['--wp-accent-hi']})`,
                      }}
                    />
                    <div className="mt-2 truncate text-xs font-medium text-[var(--wp-text)] sm:text-sm">
                      {p.label}
                    </div>
                  </motion.button>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="account" className="mt-8 space-y-5">
            {user ? (
              <>
                <div className="flex items-center gap-3 sm:gap-4">
                  <Avatar className="h-12 w-12 sm:h-14 sm:w-14">
                    <AvatarImage src={user.picture} />
                    <AvatarFallback>{user.name?.[0]}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="truncate text-base font-medium sm:text-lg">{user.name}</div>
                    <div className="truncate text-xs text-[var(--wp-muted)] sm:text-sm">{user.email}</div>
                  </div>
                </div>
                <Row label="Handle" description="Your @name across the community.">
                  <div className="flex gap-2 w-full">
                    <Input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="dj_max" maxLength={40} />
                  </div>
                </Row>
                <Row label="Bio" description="A short description on your profile.">
                  <Input value={bio} onChange={(e) => setBio(e.target.value)} maxLength={280} />
                </Row>
                <Row label="Auto-publish as public" description="Default visibility for new mixes.">
                  <Switch checked={autoPublish} onCheckedChange={setAutoPublish} />
                </Row>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Button
                    onClick={saveProfile}
                    disabled={savingProfile}
                    className="min-h-11 w-full text-sm sm:min-h-10 sm:w-auto sm:text-base"
                  >
                    {savingProfile ? 'Saving…' : 'Save profile'}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={logout}
                    className="min-h-11 w-full gap-2 text-rose-400 text-sm sm:min-h-10 sm:w-auto sm:text-base"
                  >
                    <LogOut className="h-4 w-4 shrink-0" /> Sign out
                  </Button>
                </div>
              </>
            ) : (
              <div className="text-[var(--wp-muted)]">
                <Link to="/login" className="underline">Sign in</Link> to manage your profile.
              </div>
            )}
          </TabsContent>

          <TabsContent value="about" className="mt-8">
            <div className="settings-about rounded-xl border border-[var(--wp-border)] bg-[var(--wp-surface)] p-5 sm:p-6">
              <h2 className="text-sm font-semibold text-[var(--wp-text)]">Build</h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--wp-muted)]">
                Frontend <span className="font-mono text-[13px] tabular-nums text-[var(--wp-text)]">v{appVersion.frontend}</span>
                {appVersion.backend && (
                  <>
                    {' '}
                    · backend <span className="font-mono text-[13px] tabular-nums text-[var(--wp-text)]">v{appVersion.backend}</span>
                  </>
                )}
              </p>

              <div className="my-6 h-px w-full bg-[var(--wp-border)]" />

              <div className="flex items-center gap-2.5 text-[var(--wp-text)]">
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--wp-surface-2)] text-[var(--wp-accent-hi)]">
                  <Keyboard className="h-4 w-4" strokeWidth={2} />
                </span>
                <h2 className="text-sm font-semibold">Shortcuts</h2>
              </div>
              <p className="mt-1 text-xs text-[var(--wp-muted)]">Studio and navigation</p>

              <ul className="mt-4 divide-y divide-[var(--wp-border)] rounded-md border border-[var(--wp-border)] bg-[var(--wp-bg)]">
                {SHORTCUTS.map((s) => (
                  <li
                    key={s.keys + s.action}
                    className="flex flex-col gap-1.5 py-3.5 pl-4 pr-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <span className="text-sm leading-snug text-[var(--wp-text)]">{s.action}</span>
                    <kbd className="w-fit shrink-0 rounded border border-[var(--wp-border-hi)] bg-[var(--wp-surface-2)] px-2 py-1 text-center text-xs font-medium text-[var(--wp-text)] not-italic shadow-sm sm:min-w-[5.5rem]">
                      {s.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          </TabsContent>
        </Tabs>
        </div>
      </main>
    </div>
  )
}

function Row({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-4 rounded-lg border border-[var(--wp-border)] bg-[var(--wp-surface)] p-4 sm:grid-cols-[1fr_min(16rem,100%)] sm:items-center sm:gap-5 sm:px-5 sm:py-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-[var(--wp-text)] sm:text-base">{label}</div>
        {description && (
          <div className="mt-1 text-sm leading-relaxed text-[var(--wp-muted)] sm:text-base">{description}</div>
        )}
      </div>
      <div className="w-full min-w-0 sm:justify-self-end">{children}</div>
    </div>
  )
}
