import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background,box-shadow,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--wp-accent-hi)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--wp-bg)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:translate-y-[0.5px] select-none",
  {
    variants: {
      variant: {
        default:
          'bg-[var(--wp-accent)] text-white hover:bg-[var(--wp-accent-hi)] shadow-[0_4px_16px_-4px_color-mix(in_oklab,var(--wp-accent)_60%,transparent)]',
        destructive: 'bg-red-600 text-white hover:bg-red-500',
        outline:
          'border border-[var(--wp-border)] bg-transparent text-[var(--wp-text)] hover:bg-[var(--wp-surface-2)]',
        secondary: 'bg-[var(--wp-surface-2)] text-[var(--wp-text)] hover:bg-[var(--wp-border)]',
        ghost: 'text-[var(--wp-text)] hover:bg-[var(--wp-surface-2)]',
        link: 'text-[var(--wp-accent-hi)] underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-lg px-6 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  },
)
Button.displayName = 'Button'

export { buttonVariants }
