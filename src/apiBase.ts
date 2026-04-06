/** Set VITE_API_BASE to your API origin (no trailing slash), e.g. https://wordplay-backend.onrender.com. Leave unset in dev to use the Vite proxy to localhost:8000. */
export function apiUrl(path: string): string {
  const raw = import.meta.env.VITE_API_BASE as string | undefined;
  const base = typeof raw === 'string' ? raw.trim().replace(/\/$/, '') : '';
  const p = path.startsWith('/') ? path : `/${path}`;
  if (!base) return p;
  return `${base}${p}`;
}
