/**
 * Production: set VITE_API_BASE to your API origin (no trailing slash), e.g. your Railway public URL.
 * Vercel: add the same variable under Project → Settings → Environment Variables (Production).
 * Dev: leave unset to use the Vite proxy (`/api` → http://localhost:8000).
 */
export function apiUrl(path: string): string {
  const raw = import.meta.env.VITE_API_BASE as string | undefined;
  const base = typeof raw === 'string' ? raw.trim().replace(/\/$/, '') : '';
  const p = path.startsWith('/') ? path : `/${path}`;
  if (!base) return p;
  return `${base}${p}`;
}
