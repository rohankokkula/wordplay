import { Handle, Position } from 'reactflow'
import { motion } from 'motion/react'
import { Sparkle, Check, X } from 'lucide-react'
import { useMixStore } from '../store'
import type { LyricGhostNode as LyricGhostNodeT } from '../types'

export function LyricGhostNode({ id, data }: { id: string; data: LyricGhostNodeT }) {
  const accept = useMixStore((s) => s.acceptGhostEdge)
  const dismiss = useMixStore((s) => s.dismissGhostEdge)
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: [0.55, 1, 0.55] }}
      transition={{ duration: 2.4, repeat: Infinity }}
      className="w-60 rounded-2xl border border-dashed border-[var(--wp-accent-hi)]/60 bg-[var(--wp-surface)]/75 backdrop-blur px-3 py-2.5"
    >
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--wp-accent-hi)]">
        <Sparkle className="h-3 w-3" />
        Suggested wordplay
      </div>
      <div className="mt-1 text-sm italic">"{data.phrase}"</div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-[var(--wp-muted)]">{Math.round(data.confidence * 100)}% match</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => accept(id)}
            className="rounded-full bg-[var(--wp-accent-hi)]/20 text-[var(--wp-accent-hi)] p-1"
            aria-label="Accept"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => dismiss(id)}
            className="rounded-full bg-[var(--wp-surface-2)] text-[var(--wp-muted)] p-1"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <Handle type="target" position={Position.Left} className="!opacity-50 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!opacity-50 !w-2 !h-2" />
    </motion.div>
  )
}
