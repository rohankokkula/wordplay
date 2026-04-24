import { LayoutGroup } from 'motion/react'
import type { ReactNode } from 'react'

/**
 * Wraps the entire app so shared-element transitions work across routes — e.g.
 * the MixCard cover morphs into the persistent bottom-player avatar via the
 * shared `layoutId="mixCover-{slug}"`.
 */
export function MotionLayoutRoot({ children }: { children: ReactNode }) {
  return <LayoutGroup>{children}</LayoutGroup>
}
