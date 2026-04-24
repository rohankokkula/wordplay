import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'

type Gate =
  /** Any session — anonymous "started" OR logged in Google user — may enter. */
  | 'any-session'
  /** Requires a verified Google session (anonymous users are redirected). */
  | 'google'

interface Props {
  children: ReactNode
  /**
   * Which gate the route uses.
   *  - `any-session` → studio + settings: allow anonymous play, but still redirect
   *    a fresh visitor (no mode selected yet) to /login.
   *  - `google` → social feed, profile, publish, post write-actions.
   */
  gate?: Gate
}

/**
 * Wraps a route and redirects unauthenticated visitors to `/login`, preserving
 * the intended destination in `state.from` so the login screen can bounce
 * them back after sign-in / "continue free".
 */
export function ProtectedRoute({ children, gate = 'any-session' }: Props) {
  const { isAuthenticated, hasStarted, loading } = useAuth()
  const location = useLocation()

  if (loading) return null

  const allowed = gate === 'google' ? isAuthenticated : (isAuthenticated || hasStarted)

  if (!allowed) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search, needsGoogle: gate === 'google' }}
      />
    )
  }

  return <>{children}</>
}
