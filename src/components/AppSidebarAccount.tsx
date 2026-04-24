import { useState, useEffect } from 'react'
import { LogOut, User as UserIcon } from 'lucide-react'
import type { AuthUser } from '../auth/AuthContext'
import { VersionBadge } from './VersionBadge'
import { Button } from './ui/button'

interface Props {
  user: AuthUser | null
  onLogout: () => void
}

/** Account strip for the bottom of the right sidebar (desktop + mobile bottom bar). */
export function AppSidebarAccount({ user, onLogout }: Props) {
  const [avatarFailed, setAvatarFailed] = useState(false)
  useEffect(() => {
    setAvatarFailed(false)
  }, [user?.picture])

  return (
    <div className="flex flex-col gap-2 p-3 bg-[var(--wp-surface-2)]/60">
      <div className="flex justify-end">
        <VersionBadge className="wp-caption wp-mono text-[10px] text-[var(--wp-muted-2)]" />
      </div>
      {user ? (
        <div className="flex items-center gap-2.5 rounded-lg bg-[var(--wp-surface)]/60 border border-[var(--wp-border)] p-2">
          {user.picture && !avatarFailed ? (
            <img
              src={user.picture}
              alt=""
              className="h-9 w-9 rounded-full object-cover ring-1 ring-[var(--wp-border-hi)]"
              width={36}
              height={36}
              referrerPolicy="no-referrer"
              onError={() => setAvatarFailed(true)}
            />
          ) : (
            <div
              aria-hidden
              className="h-9 w-9 rounded-full bg-gradient-to-br from-[var(--wp-accent)] to-[var(--wp-accent-hi)] text-white font-semibold grid place-items-center text-sm"
            >
              {(user.name || user.email || '?').slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="wp-label text-[10px]">Account</div>
            <div className="wp-title text-[12px] truncate" title={user.name || user.email}>
              {user.name || user.email}
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={onLogout}
            aria-label="Sign out of Wordplay"
            title="Sign out"
            className="h-8 w-8 text-[var(--wp-muted)] hover:text-[var(--wp-danger)] hover:bg-[var(--wp-danger)]/10"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 rounded-lg bg-[var(--wp-surface)]/60 border border-[var(--wp-border)] p-2">
          <div aria-hidden className="h-9 w-9 rounded-full bg-[var(--wp-surface-3)] grid place-items-center">
            <UserIcon className="h-4 w-4 text-[var(--wp-muted)]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="wp-label text-[10px]">Session</div>
            <div className="wp-title text-[12px]">Guest · local mixing</div>
          </div>
        </div>
      )}
    </div>
  )
}
