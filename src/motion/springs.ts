import type { Transition } from 'motion/react'

/**
 * Shared spring vocabulary — every drag, hover, page-transition, and publish
 * moment pulls from these so the app feels physically coherent. See plan §9.1.
 */
export const springs = {
  /** Buttons, node drop, pointer-synced snaps. */
  snappy: { type: 'spring', stiffness: 520, damping: 38, mass: 0.7 } as Transition,
  /** Cards, panels, sheet transitions. */
  silky: { type: 'spring', stiffness: 260, damping: 28 } as Transition,
  /** Like heart, publish success — a little overshoot. */
  bouncy: { type: 'spring', stiffness: 420, damping: 22, mass: 0.9 } as Transition,
  /** Idle floats and breathing ghost edges. */
  drift: { type: 'spring', stiffness: 80, damping: 20, mass: 1.5 } as Transition,
  /** Dismiss / close. */
  exit: { type: 'spring', stiffness: 380, damping: 42 } as Transition,
} as const

export type SpringId = keyof typeof springs
