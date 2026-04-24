import { forwardRef } from 'react'
import { motion, type HTMLMotionProps } from 'motion/react'
import { springs } from './springs'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import type { VariantProps } from 'class-variance-authority'

type ButtonMotionProps = Omit<HTMLMotionProps<'button'>, 'children'> &
  VariantProps<typeof buttonVariants> & {
    children?: React.ReactNode
  }

/**
 * Drop-in shadcn Button with Motion press/hover physics. Lives alongside
 * `Button` — use `MotionButton` when the interaction deserves a physical tap
 * feel (publish, follow, fork), and plain `Button` for destructive / muted
 * surfaces where a bounce would feel out of place.
 */
export const MotionButton = forwardRef<HTMLButtonElement, ButtonMotionProps>(
  ({ className, variant, size, children, ...props }, ref) => (
    <motion.button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      whileHover={{ y: -1, scale: 1.015 }}
      whileTap={{ scale: 0.97, y: 1 }}
      transition={springs.snappy}
      {...props}
    >
      {children}
    </motion.button>
  ),
)
MotionButton.displayName = 'MotionButton'
