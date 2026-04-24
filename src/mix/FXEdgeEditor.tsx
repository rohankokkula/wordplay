import { motion } from 'motion/react'
import { Droplets, Radio, Sliders, Volume2, Waves, Zap } from 'lucide-react'
import { FX_META, type FXEdge, type FXKind } from './types'
import { Slider } from '@/components/ui/slider'
import { useMixStore } from './store'
import { springs } from '@/motion/springs'
import { cn } from '@/lib/utils'

const ICONS: Record<FXKind, React.ReactNode> = {
  none: <Volume2 className="h-3.5 w-3.5" />,
  reverb: <Waves className="h-3.5 w-3.5" />,
  echo: <Radio className="h-3.5 w-3.5" />,
  lowpass: <Droplets className="h-3.5 w-3.5" />,
  'filter-sweep': <Sliders className="h-3.5 w-3.5" />,
  stutter: <Zap className="h-3.5 w-3.5" />,
}

const ORDER: FXKind[] = ['none', 'reverb', 'echo', 'lowpass', 'filter-sweep', 'stutter']
const BLEND_OPTIONS: Array<1 | 2 | 4 | 8> = [1, 2, 4, 8]

/**
 * Floating editor for the currently selected FX edge. Lives over the
 * ReactFlow canvas and slides up from the bottom-right with spring physics.
 */
export function FXEdgeEditor({ edge }: { edge: FXEdge }) {
  const updateEdge = useMixStore((s) => s.updateEdge)
  const removeEdge = useMixStore((s) => s.removeEdge)

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 24, scale: 0.96 }}
      transition={springs.snappy}
      className="absolute right-3 bottom-3 z-20 w-[300px] rounded-2xl border border-[var(--wp-border)] bg-[var(--wp-surface)]/95 backdrop-blur-xl wp-elevated p-4"
    >
      <div className="flex items-center justify-between">
        <div className="font-display text-sm tracking-tight">Transition FX</div>
        <button
          type="button"
          onClick={() => removeEdge(edge.id)}
          className="text-xs text-rose-400 hover:underline"
        >
          Remove
        </button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {ORDER.map((fx) => (
          <motion.button
            key={fx}
            type="button"
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => updateEdge(edge.id, { fx })}
            className={cn(
              'flex flex-col items-start gap-1 rounded-xl border px-2.5 py-2 text-left text-[11px]',
              edge.fx === fx
                ? 'border-current text-white'
                : 'border-[var(--wp-border)] text-[var(--wp-muted)] hover:text-white',
            )}
            style={{
              background:
                edge.fx === fx
                  ? `linear-gradient(135deg, ${FX_META[fx].color}55, ${FX_META[fx].color}22)`
                  : 'transparent',
              borderColor: edge.fx === fx ? FX_META[fx].color : undefined,
            }}
          >
            <span className="flex items-center gap-1.5" style={{ color: FX_META[fx].color }}>
              {ICONS[fx]}
              <span className="font-medium text-[12px]">{FX_META[fx].label}</span>
            </span>
          </motion.button>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-[var(--wp-muted)] leading-snug">
        {FX_META[edge.fx].description}
      </p>

      <div className="mt-3">
        <label className="block text-[11px] text-[var(--wp-muted)] mb-1">
          Blend · {edge.blendBeats} beat{edge.blendBeats === 1 ? '' : 's'}
        </label>
        <div className="flex gap-1">
          {BLEND_OPTIONS.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => updateEdge(edge.id, { blendBeats: b })}
              className={cn(
                'flex-1 rounded-lg border px-2 py-1 text-xs',
                edge.blendBeats === b
                  ? 'border-[var(--wp-accent-hi)] bg-[var(--wp-accent)]/20 text-white'
                  : 'border-[var(--wp-border)] text-[var(--wp-muted)] hover:text-white',
              )}
            >
              {b}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <label className="block text-[11px] text-[var(--wp-muted)] mb-1">
          Wet · {Math.round(edge.wet * 100)}%
        </label>
        <Slider
          value={[edge.wet * 100]}
          onValueChange={(v) => updateEdge(edge.id, { wet: (v[0] ?? 0) / 100 })}
          max={100}
        />
      </div>
    </motion.div>
  )
}
