import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import { apiUrl } from '../apiBase';

export type AuthMode = 'anonymous' | 'premium';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture: string;
  tier: string;
}

interface AuthState {
  mode: AuthMode;
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  /** True once a Google user is signed in (token + user). Anonymous users are false. */
  isAuthenticated: boolean;
  /** True if the user has explicitly opted into anonymous studio access. */
  hasStarted: boolean;
  loginWithGoogle: (idToken: string) => Promise<void>;
  continueAnonymous: () => void;
  logout: () => void;
}

const AuthCtx = createContext<AuthState | null>(null);

const TOKEN_KEY = 'wordplay_jwt';
const MODE_KEY = 'wordplay_mode';

/**
 * Centralized session storage helpers. Uses localStorage so sessions survive a
 * tab reload while still allowing clean logout via `clearSession`. Kept in one
 * place so protected routes, the /login redirect, and the feed loader all
 * read/write consistently.
 */
function readSavedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function persistSession(token: string, mode: AuthMode) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(MODE_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedMode = (() => {
      try { return localStorage.getItem(MODE_KEY) as AuthMode | null; } catch { return null; }
    })();
    const saved = readSavedToken();
    if (!saved) {
      if (savedMode === 'anonymous') setMode('anonymous');
      setLoading(false);
      return;
    }
    setToken(saved);
    fetch(apiUrl('/api/auth/me'), {
      headers: { Authorization: `Bearer ${saved}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error('expired');
        return r.json();
      })
      .then((u) => {
        setUser(u);
        setMode('premium');
      })
      .catch(() => {
        clearSession();
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const loginWithGoogle = useCallback(async (idToken: string) => {
    const url = apiUrl('/api/auth/google');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: idToken }),
    });
    if (!res.ok) {
      let message = 'Login failed';
      try {
        const body = await res.json();
        const d = body?.detail;
        if (typeof d === 'string') message = d;
        else if (Array.isArray(d) && d[0]?.msg) message = d.map((x: { msg: string }) => x.msg).join('; ');
      } catch {
        /* ignore */
      }
      // 404: either the SPA called same-origin /api (missing VITE_API_BASE) or Railway serves the wrong/old build.
      if (res.status === 404 || message === 'Not Found') {
        const callingRailway = /^https?:\/\//i.test(url);
        if (!callingRailway) {
          throw new Error(
            'API returned 404 — requests are going to this site, not Railway. In Vercel → Environment Variables set VITE_API_BASE to your API origin (no trailing slash), then Redeploy so the build picks it up.',
          );
        }
        throw new Error(
          'Backend returned 404 — Railway is running, but POST /api/auth/google is missing (stale deploy or wrong repo/root). Open your API /api/ping and /docs in the browser; push latest backend to GitHub, set Railway root to backend, redeploy.',
        );
      }
      throw new Error(message);
    }
    const data = await res.json();
    setToken(data.access_token);
    setUser(data.user);
    setMode('premium');
    persistSession(data.access_token, 'premium');
  }, []);

  const continueAnonymous = useCallback(() => {
    setMode('anonymous');
    setUser(null);
    setToken(null);
    clearSession();
    try { localStorage.setItem(MODE_KEY, 'anonymous'); } catch { /* ignore */ }
  }, []);

  const logout = useCallback(() => {
    setMode(null);
    setUser(null);
    setToken(null);
    clearSession();
  }, []);

  return (
    <AuthCtx.Provider
      value={{
        mode: mode ?? 'anonymous',
        user,
        token,
        loading,
        isAuthenticated: !!user && !!token,
        hasStarted: mode !== null,
        loginWithGoogle,
        continueAnonymous,
        logout,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
