import * as React from 'react'
import { cn } from '@/lib/utils'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-10 min-h-[2.75rem] w-full rounded-md border border-[var(--wp-border)] bg-[var(--wp-surface-2)] px-3 py-2 text-base text-[var(--wp-text)] transition-colors placeholder:text-[var(--wp-muted)] focus-visible:outline-none focus-visible:border-[var(--wp-accent-hi)] focus-visible:ring-2 focus-visible:ring-[var(--wp-accent-hi)]/30 disabled:cursor-not-allowed disabled:opacity-50 md:h-9 md:min-h-0 md:text-sm',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-[80px] w-full rounded-md border border-[var(--wp-border)] bg-[var(--wp-surface-2)] px-3 py-2 text-sm text-[var(--wp-text)] placeholder:text-[var(--wp-muted)] focus-visible:outline-none focus-visible:border-[var(--wp-accent-hi)] focus-visible:ring-2 focus-visible:ring-[var(--wp-accent-hi)]/30 disabled:cursor-not-allowed disabled:opacity-50 resize-none',
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'
