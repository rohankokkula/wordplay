import type { ReactNode } from 'react';

/** Bottom transport area — same card treatment as sidebars. */
export function AutomixBottomBar({ children }: { children: ReactNode }) {
  return (
    <div className="app-bottom-dock">
      <div className="app-bottom-dock-inner">{children}</div>
    </div>
  );
}
