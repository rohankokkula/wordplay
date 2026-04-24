import { Handle, Position } from 'reactflow'
import { motion } from 'motion/react'
import { AudioWaveform, Mic2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMixStore } from '../store'
import type { TrackStemNode as TrackStemNodeT } from '../types'
import { springs } from '@/motion/springs'
import { cn, formatTime } from '@/lib/utils'

export function TrackStemNode({ data }: { data: TrackStemNodeT }) {
  const addSplit = useMixStore((s) => s.addSplit)
  const isVocals = data.stem === 'vocals'
  const Icon = isVocals ? Mic2 : AudioWaveform
  const accent = data.deck === 'A' ? 'from-[#8b7fd6] to-[#4f46e5]' : 'from-[#22d3ee] to-[#1d4ed8]'

  const makeSplit = () => {
    const quarter = Math.max(2, data.duration / 8)
    const start = Math.random() * Math.max(0, data.duration - quarter)
    addSplit(data.deck, data.stem, start, start + quarter, `${data.deck}·${isVocals ? 'vox' : 'inst'}`)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.silky}
      className="w-64 rounded-2xl border border-[var(--wp-border)] bg-[var(--wp-surface)] wp-elevated overflow-hidden"
    >
      <div className={cn('bg-gradient-to-br px-3 py-2 text-white text-xs font-medium flex items-center gap-2', accent)}>
        <Icon className="h-3.5 w-3.5" />
        Deck {data.deck} · {isVocals ? 'Vocals' : 'Instruments'}
      </div>
      <div className="p-3">
        <div className="text-sm font-medium truncate" title={data.title}>{data.title}</div>
        <div className="text-xs text-[var(--wp-muted)] tabular-nums mt-0.5">{formatTime(data.duration)}</div>
        <div className="mt-3 h-12 rounded-lg bg-[var(--wp-surface-2)] overflow-hidden flex items-center justify-center">
          <WaveformPreview deck={data.deck} peaks={data.waveform} />
        </div>
        <Button size="sm" variant="outline" className="mt-3 w-full gap-1.5" onClick={makeSplit}>
          <Plus className="h-3.5 w-3.5" /> Drop a split
        </Button>
      </div>
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-[var(--wp-accent-hi)] !border-white/60" />
    </motion.div>
  )
}

function WaveformPreview({ deck, peaks }: { deck: 'A' | 'B'; peaks?: number[] }) {
  const bars = peaks && peaks.length
    ? peaks
    : Array.from({ length: 48 }, (_, i) => 0.3 + Math.sin(i * 0.6) * 0.3 + (deck === 'A' ? 0.2 : 0.1))
  return (
    <div className="flex items-center gap-[2px] h-full w-full px-2">
      {bars.map((v, i) => (
        <span
          key={i}
          className="flex-1 rounded-full bg-[var(--wp-accent-hi)]/70"
          style={{ height: `${Math.max(8, v * 100)}%` }}
        />
      ))}
    </div>
  )
}
