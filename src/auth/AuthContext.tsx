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
  loginWithGoogle: (idToken: string, inviteCode: string) => Promise<void>;
  continueAnonymous: () => void;
  logout: () => void;
}

const AuthCtx = createContext<AuthState | null>(null);

const TOKEN_KEY = 'wordplay_jwt';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = sessionStorage.getItem(TOKEN_KEY);
    if (!saved) {
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
        sessionStorage.removeItem(TOKEN_KEY);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const loginWithGoogle = useCallback(async (idToken: string, inviteCode: string) => {
    const res = await fetch(apiUrl('/api/auth/google'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: idToken, invite_code: inviteCode }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ detail: 'Login failed' }));
      throw new Error(body.detail || 'Login failed');
    }
    const data = await res.json();
    setToken(data.access_token);
    setUser(data.user);
    setMode('premium');
    sessionStorage.setItem(TOKEN_KEY, data.access_token);
  }, []);

  const continueAnonymous = useCallback(() => {
    setMode('anonymous');
    setUser(null);
    setToken(null);
    sessionStorage.removeItem(TOKEN_KEY);
  }, []);

  const logout = useCallback(() => {
    setMode(null);
    setUser(null);
    setToken(null);
    sessionStorage.removeItem(TOKEN_KEY);
  }, []);

  if (loading) {
    return null;
  }

  return (
    <AuthCtx.Provider
      value={{
        mode: mode ?? 'anonymous',
        user,
        token,
        loading,
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
