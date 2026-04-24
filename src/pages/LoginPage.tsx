import { useCallback, useEffect, useState } from 'react'
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google'
import { motion, AnimatePresence } from 'motion/react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, AudioWaveform, Music4, Share2, Workflow } from 'lucide-react'
import { WordplayLogo } from '../components/WordplayLogo'
import { googleLoginUiProps, googleSignInIdProps } from '../auth/googleSignInConfig'
import { useAuth } from '../auth/AuthContext'
import { springs } from '../motion/springs'

/**
 * /login — default entry. Same content band + padding as the studio shell.
 */
export default function LoginPage() {
  const { isAuthenticated, loginWithGoogle, continueAnonymous, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)

  const state = (location.state ?? {}) as { from?: string; needsGoogle?: boolean }
  const from = state.from && state.from !== '/login' ? state.from : '/studio'
  const needsGoogle = !!state.needsGoogle

  // Only Google-signed-in users skip the hero — anonymous "continue free" is optional and must not hide /login.
  // Wait for auth bootstrap so a restored session can bounce once, without a flash of login for them.
  useEffect(() => {
    if (loading) return
    if (isAuthenticated) navigate(from, { replace: true })
  }, [loading, isAuthenticated, from, navigate])

  const handleGoogleSuccess = useCallback(
    async (response: CredentialResponse) => {
      if (!response.credential) {
        setError('Google sign-in failed — no credential returned')
        return
      }
      setLoggingIn(true)
      setError('')
      try {
        await loginWithGoogle(response.credential)
        navigate(from, { replace: true })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Login failed')
      } finally {
        setLoggingIn(false)
      }
    },
    [loginWithGoogle, navigate, from],
  )

  const handleContinueFree = useCallback(() => {
    continueAnonymous()
    navigate(from, { replace: true })
  }, [continueAnonymous, navigate, from])

  return (
    <div className="app-page">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-[0.035] [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:24px_24px]"
      />

      <header className="app-page__header">
        <div className="app-page__header-inner app-page__header-inner--split">
          <WordplayLogo className="h-7 sm:h-8" title="Wordplay" />
          <span className="wp-label">v{__APP_VERSION__}</span>
        </div>
      </header>

      <main className="app-page__main app-page__main--login-hero">
        <div className="app-page__container app-page__grid app-page__grid--login w-full max-w-6xl">
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springs.silky}
            className="w-full min-w-0 max-w-[34rem] lg:max-w-none lg:pr-2"
          >
            <div className="inline-flex max-w-full">
              <span className="inline-flex items-center gap-2 rounded-full border border-[var(--wp-border)] bg-[var(--wp-surface)] px-3 py-1.5 text-[0.65rem] uppercase tracking-[0.14em] text-[var(--wp-muted)] sm:px-3.5 sm:py-2 sm:text-xs">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--wp-ready)]" /> Wordplay studio · v1.1
              </span>
            </div>

            <h1 className="mt-3 font-display text-3xl font-semibold leading-[1.12] tracking-tight text-[var(--wp-text)] sm:mt-4 sm:text-4xl sm:leading-[1.1] md:text-5xl md:mt-5 lg:mt-6 lg:text-6xl">
              Mix songs by meaning.
              <br />
              <span className="text-[var(--wp-accent-hi)]">Publish wordplays.</span>
            </h1>

            <p className="mt-8 max-w-lg text-base leading-[1.65] text-[var(--wp-muted)] sm:mt-10 sm:max-w-xl sm:text-lg sm:leading-relaxed">
              Drop two tracks, pull stems apart, and drag the best seconds onto one master timeline.
              Publish as a <span className="font-medium text-[var(--wp-text)]">wordplay</span> and remix
              from the feed.
            </p>

            <ul className="mt-8 space-y-4 sm:mt-10 sm:space-y-[1.125rem]">
              <Bullet icon={<AudioWaveform className="h-4 w-4 sm:h-5 sm:w-5" />}>Auto stem split after upload</Bullet>
              <Bullet icon={<Workflow className="h-4 w-4 sm:h-5 sm:w-5" />}>Drag snippets into one master deck</Bullet>
              <Bullet icon={<Share2 className="h-4 w-4 sm:h-5 sm:w-5" />}>Share and remix on the feed</Bullet>
            </ul>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.silky, delay: 0.06 }}
            className="w-full min-w-0 lg:max-w-[22rem] xl:max-w-md lg:justify-self-end"
          >
            <div className="app-page__card flex flex-col rounded-2xl p-6 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.65)] ring-1 ring-[var(--wp-border)] sm:p-7 md:p-8">
              <div className="flex items-start gap-3.5 sm:gap-4">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--wp-border)] bg-[var(--wp-surface-2)] text-[var(--wp-accent-hi)] sm:h-11 sm:w-11">
                  <Music4 className="h-4 w-4 sm:h-5 sm:w-5" />
                </span>
                <div className="min-w-0 pt-0.5">
                  <h2 className="text-lg font-semibold leading-snug text-[var(--wp-text)] sm:text-xl">Sign in to Wordplay</h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--wp-muted)] sm:text-[0.95rem]">
                    Google · session saved in this browser
                  </p>
                </div>
              </div>

              {needsGoogle && (
                <div className="mt-5 rounded-md border border-[var(--wp-accent)]/35 bg-[var(--wp-accent)]/8 px-3 py-2.5 text-sm text-[var(--wp-accent-hi)] sm:mt-6 sm:px-3.5 sm:text-base">
                  That page needs a Google account — sign in below.
                </div>
              )}

              <div className="mt-6 flex flex-col sm:mt-7">
                <div className="flex justify-center rounded-xl border border-[var(--wp-border)] bg-[var(--wp-bg)] px-2 py-2.5 sm:px-2.5 sm:py-3">
                  <GoogleLogin
                    {...googleSignInIdProps}
                    {...googleLoginUiProps}
                    onSuccess={handleGoogleSuccess}
                    onError={() => setError('Google sign-in was cancelled')}
                  />
                </div>

                {!needsGoogle && (
                  <>
                    <div className="my-1 flex min-h-9 items-center gap-2.5 text-[var(--wp-muted-2)] sm:my-0.5">
                      <span className="h-px min-w-0 flex-1 bg-[var(--wp-border)]" />
                      <span className="shrink-0 px-0.5 text-[11px] font-medium uppercase tracking-wider sm:text-xs">or</span>
                      <span className="h-px min-w-0 flex-1 bg-[var(--wp-border)]" />
                    </div>

                    <button
                      type="button"
                      className="app-page__btn min-h-11 text-sm sm:min-h-12 sm:text-base"
                      onClick={handleContinueFree}
                    >
                      Continue free · 20 min studio
                      <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" />
                    </button>
                  </>
                )}

                <AnimatePresence>
                  {(loggingIn || error) && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mt-3 text-center text-sm text-[var(--wp-muted)] sm:mt-3.5 sm:text-base"
                    >
                      {loggingIn && <span>Signing you in…</span>}
                      {error && <span className="text-red-300">{error}</span>}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <p className="mt-8 border-t border-[var(--wp-border)] pt-5 text-center text-[11px] leading-relaxed text-[var(--wp-muted-2)] sm:mt-9 sm:pt-6 sm:text-xs">
                MIT license · no ads
              </p>
            </div>
          </motion.section>
        </div>
      </main>
    </div>
  )
}

function Bullet({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 sm:gap-3.5">
      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--wp-border)] bg-[var(--wp-surface)] text-[var(--wp-accent-hi)] sm:h-9 sm:w-9">
        {icon}
      </span>
      <span className="pt-0.5 text-sm leading-relaxed text-[var(--wp-text)] sm:pt-1 sm:text-base">{children}</span>
    </li>
  )
}
