/**
 * API origin for `/api/...` calls.
 *
 * - **Local dev:** leave `VITE_API_BASE` unset → `/api/...` is proxied by Vite to localhost:8000.
 * - **Vercel multi-service** (see `vercel.json` `routePrefix: /_/backend`): in production builds,
 *   if `VITE_API_BASE` is unset, we default to `/_/backend` so `fetch` hits FastAPI instead of the
 *   SPA shell (which would return HTML and cause `JSON.parse` errors on `Unexpected token '<'`).
 * - **Other hosts:** set `VITE_API_BASE` to your API origin (no trailing slash), e.g.
 *   `https://wordplay-backend.up.railway.app`.
 */
export function apiUrl(path: string): string {
  const raw = (import.meta.env.VITE_API_BASE as string | undefined)?.trim();
  const fromEnv = raw ? raw.replace(/\/$/, '') : '';
  const fallbackProd =
    import.meta.env.PROD && !fromEnv ? '/_/backend' : '';
  const base = fromEnv || fallbackProd;
  const p = path.startsWith('/') ? path : `/${path}`;
  if (!base) return p;
  return `${base}${p}`;
}
