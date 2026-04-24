import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { motion, type HTMLMotionProps } from 'motion/react'
import { springs } from './springs'
import { cn } from '@/lib/utils'

export interface MotionCardProps extends HTMLMotionProps<'div'> {
  /** Apply subtle hover + press feedback (default: true). */
  interactive?: boolean
  /** Spring preset (default: 'silky'). */
  spring?: keyof typeof springs
}

/**
 * Drop-in replacement for a shadcn Card with Motion hover / press physics.
 * Used across feed cards, settings tiles, and the mix canvas overlay panels.
 */
export const MotionCard = forwardRef<HTMLDivElement, MotionCardProps>(
  ({ className, interactive = true, spring = 'silky', children, ...props }, ref) => (
    <motion.div
      ref={ref}
      className={cn(
        'rounded-[var(--wp-radius-xl)] border border-[var(--wp-border)] bg-[var(--wp-surface)] wp-elevated',
        className,
      )}
      whileHover={interactive ? { y: -2, scale: 1.008 } : undefined}
      whileTap={interactive ? { scale: 0.988 } : undefined}
      transition={springs[spring]}
      {...props}
    >
      {children}
    </motion.div>
  ),
)
MotionCard.displayName = 'MotionCard'

export type { ComponentPropsWithoutRef }
