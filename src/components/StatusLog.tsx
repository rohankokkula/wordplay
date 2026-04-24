import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import type { LogEntry } from '../audio/types'
import { cn } from '../lib/utils'

interface StatusLogProps {
  entries: LogEntry[]
  /** e.g. mobile strip below transport — one line per row, scroll */
  variant?: 'default' | 'below-play'
}

function fmtTimestamp(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const SOURCE_COLORS: Record<LogEntry['source'], string> = {
  system: 'var(--wp-muted)',
  a: 'var(--wp-accent-hi)',
  b: 'var(--wp-ready)',
}

export function StatusLog({ entries, variant = 'default' }: StatusLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries.length])

  return (
    <div
      className={cn(
        'flex flex-col min-h-0',
        variant === 'below-play' ? 'max-h-[160px]' : 'h-full',
      )}
    >
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="wp-label">Live log</span>
        {entries.length > 0 && (
          <span className="wp-caption wp-mono text-[10px]">{entries.length}</span>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto wp-scroll pr-1 flex flex-col gap-1.5">
        {entries.length === 0 && (
          <div className="rounded-lg bg-[var(--wp-surface-2)]/50 border border-dashed border-[var(--wp-border)] px-3 py-2 wp-caption text-center">
            Load two tracks and press MIX
          </div>
        )}
        <AnimatePresence initial={false}>
          {entries.map((entry) => (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="rounded-lg bg-[var(--wp-surface-2)]/40 border border-[var(--wp-border)]/50 px-2.5 py-1.5 flex items-start gap-2"
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full mt-1.5 shrink-0"
                style={{ background: SOURCE_COLORS[entry.source] }}
              />
              <span className="wp-mono text-[10px] text-[var(--wp-muted-2)] mt-0.5 shrink-0">
                {fmtTimestamp(entry.time)}
              </span>
              <span className="wp-body text-[12px] leading-[1.4] min-w-0 flex-1 break-words">
                {entry.text}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
