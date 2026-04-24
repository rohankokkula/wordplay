import { Handle, Position, useUpdateNodeInternals } from 'reactflow'
import { useEffect, useState } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'motion/react'
import { Scissors, Trash2 } from 'lucide-react'
import { useMixStore } from '../store'
import type { SplitNode as SplitNodeT } from '../types'
import { springs } from '@/motion/springs'
import { cn, formatTime } from '@/lib/utils'

export function SplitNode({ id, data, selected }: { id: string; data: SplitNodeT; selected?: boolean }) {
  const updateSplit = useMixStore((s) => s.updateSplit)
  const removeNode = useMixStore((s) => s.removeNode)
  const updater = useUpdateNodeInternals()
  const [tilt, setTilt] = useState({ x: 0, y: 0 })

  const glow = useMotionValue(0)
  const shadow = useTransform(
    glow,
    (v) => `0 ${8 + v * 14}px ${22 + v * 30}px rgba(110, 93, 187, ${0.3 + v * 0.35})`,
  )
  useEffect(() => {
    animate(glow, selected ? 1 : 0, { type: 'spring', stiffness: 220, damping: 22 })
  }, [selected, glow])

  useEffect(() => {
    updater(id)
  }, [data.split.start, data.split.end, id, updater])

  const dur = Math.max(0.05, data.split.end - data.split.start)
  const deckColor =
    data.split.deck === 'A'
      ? 'from-[#a78bfa] to-[#6d28d9]'
      : 'from-[#22d3ee] to-[#1d4ed8]'
  const stemLabel =
    data.split.stem === 'vocals'
      ? 'vox'
      : data.split.stem === 'instruments'
        ? 'inst'
        : 'both'

  return (
    <motion.div
      onPan={(_, info) => setTilt({ x: info.delta.x * 0.5, y: info.delta.y * 0.5 })}
      onPanEnd={() => setTilt({ x: 0, y: 0 })}
      animate={{ rotateX: -tilt.y, rotateY: tilt.x }}
      transition={springs.snappy}
      whileHover={{ scale: 1.015 }}
      style={{ boxShadow: shadow, transformPerspective: 600 }}
      className={cn(
        'w-52 rounded-2xl border bg-[var(--wp-surface)] overflow-hidden',
        selected ? 'border-[var(--wp-accent)]' : 'border-[var(--wp-border)]',
      )}
    >
      <div className={cn('bg-gradient-to-r px-3 py-1.5 text-white text-[11px] uppercase tracking-wider flex items-center justify-between', deckColor)}>
        <span>Deck {data.split.deck} · {stemLabel}</span>
        <span className="tabular-nums opacity-80">{formatTime(dur)}</span>
      </div>
      <div className="p-3">
        <div className="flex items-center gap-1.5 text-[var(--wp-muted)] text-xs">
          <Scissors className="h-3 w-3" />
          <span className="tabular-nums">{formatTime(data.split.start)} → {formatTime(data.split.end)}</span>
        </div>
        <div className="mt-2 h-10 rounded-lg bg-[var(--wp-surface-2)] overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-[var(--wp-accent)]/60 to-[var(--wp-accent-hi)]/80"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            style={{ originX: 0 }}
            transition={{ duration: 0.45, ...springs.silky }}
          />
        </div>
        <div className="mt-3 flex items-center gap-1">
          <input
            type="range"
            min={0}
            max={Math.max(0.1, data.split.end)}
            step={0.1}
            value={data.split.start}
            onChange={(e) =>
              updateSplit(id, { start: Math.min(parseFloat(e.target.value), data.split.end - 0.1) })
            }
            className="flex-1 accent-[var(--wp-accent)]"
            aria-label="Start"
          />
          <input
            type="range"
            min={data.split.start + 0.1}
            max={data.split.end + 60}
            step={0.1}
            value={data.split.end}
            onChange={(e) => updateSplit(id, { end: parseFloat(e.target.value) })}
            className="flex-1 accent-[var(--wp-accent-hi)]"
            aria-label="End"
          />
          <button
            type="button"
            onClick={() => removeNode(id)}
            className="p-1 text-[var(--wp-muted)] hover:text-rose-400"
            aria-label="Delete split"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-[var(--wp-accent-hi)] !border-white/60" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-[var(--wp-accent-hi)] !border-white/60" />
    </motion.div>
  )
}
