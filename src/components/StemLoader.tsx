import { useEffect } from 'react'
import { motion, useSpring, useTransform } from 'motion/react'
import { Loader2, AudioWaveform } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

interface Props {
  label?: string
  progress: number
  phase?: 'queued' | 'running' | 'done' | 'error'
  error?: string | null
  className?: string
}

/**
 * Spring-smoothed stem separation loader. Fed by the Demucs job poll loop
 * in `src/api/stems.ts`. The percent number counts up silky-smooth rather
 * than jumping on every 1500ms tick.
 */
export function StemLoader({ label = 'Separating stems', progress, phase = 'running', error, className }: Props) {
  const spring = useSpring(0, { stiffness: 80, damping: 20 })
  const rounded = useTransform(spring, (v) => `${Math.round(v)}%`)

  useEffect(() => {
    spring.set(Math.max(0, Math.min(100, progress)))
  }, [progress, spring])

  const isError = phase === 'error'
  const isDone = phase === 'done'

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border border-[var(--wp-border)] bg-[var(--wp-surface)] px-4 py-3 text-sm wp-elevated',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <motion.span
        className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--wp-surface-2)]"
        animate={isDone ? { scale: [1, 1.1, 1] } : {}}
        transition={{ duration: 0.5 }}
      >
        {isError ? (
          <span className="text-red-400">!</span>
        ) : isDone ? (
          <AudioWaveform className="h-4 w-4 text-[var(--wp-accent-hi)]" />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-[var(--wp-accent-hi)]" />
        )}
      </motion.span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2 mb-1.5">
          <span className="truncate font-medium">
            {isError ? 'Separation failed' : isDone ? 'Stems ready' : label}
          </span>
          {!isError && (
            <motion.span className="tabular-nums text-xs text-[var(--wp-muted)]">
              {rounded}
            </motion.span>
          )}
        </div>
        {isError ? (
          <p className="text-xs text-red-400">{error ?? 'Something went wrong'}</p>
        ) : (
          <Progress value={progress} />
        )}
      </div>
    </div>
  )
}
