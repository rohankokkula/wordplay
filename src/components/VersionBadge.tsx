import { useEffect, useState } from 'react';
import { apiUrl } from '../apiBase';

/**
 * Small version badge for the footer / settings. Shows frontend version from
 * Vite `define` at build time (always available), and best-effort backend
 * version from `/api/version` when reachable.
 */
export function VersionBadge({ className }: { className?: string }) {
  const [backendVersion, setBackendVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl('/api/version'))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.version) setBackendVersion(j.version as string);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const front = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
  const sameVersion = backendVersion && backendVersion === front;
  return (
    <span
      className={className ?? 'wordplay-version-badge'}
      title={
        backendVersion
          ? `Frontend v${front} · Backend v${backendVersion}`
          : `Frontend v${front}`
      }
    >
      v{front}
      {backendVersion && !sameVersion ? ` · api v${backendVersion}` : null}
    </span>
  );
}
