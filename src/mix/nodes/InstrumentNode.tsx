import { Handle, Position } from 'reactflow'
import { motion } from 'motion/react'
import { Music, Trash2 } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { useMixStore } from '../store'
import { INSTRUMENT_BEDS } from '../instruments'
import type { InstrumentNode as InstrumentNodeT } from '../types'
import { springs } from '@/motion/springs'

export function InstrumentNode({ id, data }: { id: string; data: InstrumentNodeT }) {
  const setInstrumentGain = useMixStore((s) => s.setInstrumentGain)
  const removeNode = useMixStore((s) => s.removeNode)
  const bed = INSTRUMENT_BEDS.find((b) => b.id === data.instrument)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={springs.snappy}
      className="w-56 rounded-2xl border border-[var(--wp-border)] bg-[var(--wp-surface)] wp-elevated overflow-hidden"
    >
      <div className={`bg-gradient-to-br ${bed?.swatch ?? 'from-amber-500 to-rose-500'} px-3 py-2 text-white text-xs font-medium flex items-center gap-2`}>
        <Music className="h-3.5 w-3.5" />
        <span>{bed?.name ?? data.instrument}</span>
        <span className="ml-auto opacity-70 tabular-nums">{bed?.nativeBpm ?? '?'} bpm</span>
      </div>
      <div className="p-3">
        <div className="text-[11px] text-[var(--wp-muted)] line-clamp-2">{bed?.description}</div>
        <label className="block mt-3 text-[11px] text-[var(--wp-muted)]">
          Gain · {Math.round(data.gain * 100)}%
        </label>
        <Slider
          value={[data.gain * 100]}
          onValueChange={(v) => setInstrumentGain(id, (v[0] ?? 0) / 100)}
          max={120}
          className="mt-1"
        />
        <button
          type="button"
          onClick={() => removeNode(id)}
          className="mt-3 text-[11px] text-[var(--wp-muted)] hover:text-rose-400 flex items-center gap-1"
        >
          <Trash2 className="h-3 w-3" /> Remove
        </button>
      </div>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-amber-400 !border-white/60" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-amber-400 !border-white/60" />
    </motion.div>
  )
}
