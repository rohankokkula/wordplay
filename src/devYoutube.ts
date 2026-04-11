/**
 * YouTube search/download UI is dev-only (localhost + Vite dev server).
 * Production builds must not call `/api/music/*` — we do not support YouTube on prod.
 */
export const DEV_YOUTUBE_UI_ENABLED =
  import.meta.env.VITE_ENABLE_YOUTUBE === 'true' &&
  (import.meta.env.DEV || globalThis.location?.hostname === 'localhost');
