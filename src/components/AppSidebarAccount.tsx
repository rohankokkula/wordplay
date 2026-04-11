import { useState, useEffect } from 'react';
import type { AuthUser } from '../auth/AuthContext';

interface Props {
  user: AuthUser | null;
  onLogout: () => void;
}

/** Account strip for the bottom of the right sidebar (desktop + mobile bottom bar). */
export function AppSidebarAccount({ user, onLogout }: Props) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => {
    setAvatarFailed(false);
  }, [user?.picture]);

  return (
    <div className="app-sidebar-account">
      {user ? (
        <div className="app-sidebar-account__row app-sidebar-account__row--signed-in">
          <div className="app-sidebar-account__identity">
            {user.picture && !avatarFailed ? (
              <img
                src={user.picture}
                alt=""
                className="app-sidebar-account__avatar"
                width={36}
                height={36}
                referrerPolicy="no-referrer"
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <div className="app-sidebar-account__avatar app-sidebar-account__avatar--placeholder" aria-hidden>
                {(user.name || user.email || '?').slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="app-sidebar-account__text">
              <span className="app-sidebar-account__label">Account</span>
              <span className="app-sidebar-account__name" title={user.name || user.email}>
                {user.name || user.email}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="app-sidebar-account__sign-out"
            onClick={onLogout}
            aria-label="Sign out of Wordplay"
            title="Sign out"
          >
            <svg
              className="app-sidebar-account__sign-out-icon"
              viewBox="0 0 24 24"
              width={18}
              height={18}
              aria-hidden
            >
              <path
                fill="currentColor"
                d="M12 4l8 9H4l8-9zm-7 14h14v2H5z"
              />
            </svg>
          </button>
        </div>
      ) : (
        <div className="app-sidebar-account__row app-sidebar-account__row--guest">
          <span className="app-sidebar-account__guest-icon" aria-hidden>
            ◇
          </span>
          <div className="app-sidebar-account__text">
            <span className="app-sidebar-account__label">Session</span>
            <span className="app-sidebar-account__name">Guest · local mixing</span>
          </div>
        </div>
      )}
    </div>
  );
}
