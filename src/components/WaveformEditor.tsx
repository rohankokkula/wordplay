import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { cn } from '../lib/utils'

/**
 * WaveformEditor — matches `Waveform Container.svg` exactly.
 *
 * Layout:
 *   ╔═════════════════════════════════════════════════════╗   ← #1F1F1F rounded container
 *   ║                                                     ║
 *   ║  ░░░░░░░░░░  ██████████  ░░░░░░░░░░                ║   ← bars (half-opacity outside, full inside region)
 *   ║  ░░░░░░░░░░ ▐▌██████████▐▌ ░░░░░░░░░░              ║   ← green pill handles with dark grip
 *   ║                                                     ║
 *   ╚═════════════════════════════════════════════════════╝
 *
 * User interactions:
 *   • Drag the left/right green handles → adjust trim region
 *   • Click or drag inside the body → seek playhead
 *   • Drag the playhead thumb directly → scrubbed seek
 */

export interface TrimRegion {
  /** 0..1 ratio of the track */
  start: number
  /** 0..1 ratio of the track */
  end: number
}

interface Props {
  /** Normalized peak amplitudes 0..1, any length (we downsample). */
  peaks: number[]
  /** Track duration in seconds. */
  duration: number
  /** Current playhead position in seconds. */
  currentTime: number
  /** Trim region (0..1). Pass undefined for "no region" (full track). */
  region?: TrimRegion
  /** Called when the user drags either handle. Ratios clamped to [0, 1]. */
  onRegionChange?: (region: TrimRegion) => void
  /** Called with ratio 0..1 when the user scrubs the playhead. */
  onSeek?: (ratio: number) => void
  /** Visual variant — "a" tints the playhead violet, "b" tints green. */
  deckId?: 'A' | 'B'
  /** Target number of bars. Defaults to 72 (roughly matches the reference). */
  barCount?: number
  /** Disable interaction (while analyzing, empty, etc). */
  disabled?: boolean
  className?: string
}

// Reference dimensions from the SVG so proportions stay identical
const REF_HEIGHT = 152
const HANDLE_WIDTH = 16           // green pill width
const HANDLE_RADIUS = 8
const GRIP_WIDTH = 3
const GRIP_HEIGHT = 28
const CONTAINER_PAD_X = 18        // horizontal breathing room for bars

/** Normalize/downsample peaks to `target` buckets. */
function resamplePeaks(peaks: number[], target: number): number[] {
  if (peaks.length === 0) return Array(target).fill(0)
  if (peaks.length === target) return peaks
  const out: number[] = new Array(target)
  const step = peaks.length / target
  let max = 0
  for (let i = 0; i < target; i++) {
    const s = Math.floor(i * step)
    const e = Math.min(peaks.length, Math.floor((i + 1) * step))
    let peak = 0
    for (let j = s; j < e; j++) {
      const v = Math.abs(peaks[j])
      if (v > peak) peak = v
    }
    out[i] = peak
    if (peak > max) max = peak
  }
  // Normalize so the loudest bar hits full height
  if (max > 0) {
    const inv = 1 / max
    for (let i = 0; i < target; i++) out[i] *= inv
  }
  return out
}

function clamp(n: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, n))
}

export function WaveformEditor({
  peaks,
  duration,
  currentTime,
  region,
  onRegionChange,
  onSeek,
  deckId = 'A',
  barCount = 72,
  disabled = false,
  className,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<'start' | 'end' | 'seek' | null>(null)

  const bars = useMemo(() => resamplePeaks(peaks, barCount), [peaks, barCount])

  const effectiveRegion: TrimRegion = region ?? { start: 0, end: 1 }
  const progress = duration > 0 ? clamp(currentTime / duration) : 0

  const deckTint = deckId === 'A' ? 'var(--wp-accent-hi)' : 'var(--wp-ready-hi)'

  const ratioFromClientX = useCallback((clientX: number): number => {
    const svg = svgRef.current
    if (!svg) return 0
    const rect = svg.getBoundingClientRect()
    const innerLeft = rect.left + (CONTAINER_PAD_X / 890) * rect.width
    const innerWidth = rect.width - (2 * CONTAINER_PAD_X / 890) * rect.width
    return clamp((clientX - innerLeft) / innerWidth)
  }, [])

  const handlePointerDown = useCallback(
    (mode: 'start' | 'end' | 'seek') => (e: React.PointerEvent) => {
      if (disabled) return
      e.preventDefault()
      e.stopPropagation()
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      setDrag(mode)
      if (mode === 'seek') {
        const r = ratioFromClientX(e.clientX)
        onSeek?.(r)
      }
    },
    [disabled, ratioFromClientX, onSeek],
  )

  useEffect(() => {
    if (!drag) return
    const handleMove = (e: PointerEvent) => {
      const r = ratioFromClientX(e.clientX)
      if (drag === 'start') {
        const next = Math.min(r, effectiveRegion.end - 0.01)
        onRegionChange?.({ start: clamp(next), end: effectiveRegion.end })
      } else if (drag === 'end') {
        const next = Math.max(r, effectiveRegion.start + 0.01)
        onRegionChange?.({ start: effectiveRegion.start, end: clamp(next) })
      } else if (drag === 'seek') {
        onSeek?.(r)
      }
    }
    const handleUp = () => setDrag(null)
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
    }
  }, [drag, effectiveRegion.start, effectiveRegion.end, onRegionChange, onSeek, ratioFromClientX])

  // Derived SVG coordinate positions (viewBox is 890 wide to match reference)
  const innerLeft = CONTAINER_PAD_X
  const innerRight = 890 - CONTAINER_PAD_X
  const innerWidth = innerRight - innerLeft
  const regionStartX = innerLeft + effectiveRegion.start * innerWidth
  const regionEndX = innerLeft + effectiveRegion.end * innerWidth
  const playheadX = innerLeft + progress * innerWidth

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 890 ${REF_HEIGHT}`}
      preserveAspectRatio="none"
      className={cn(
        'block w-full h-[120px] sm:h-[140px] select-none',
        disabled && 'opacity-60 pointer-events-none',
        className,
      )}
      role="slider"
      aria-label="Track scrubber and trim region"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentTime)}
    >
      {/* Rounded dark container — matches SVG path exactly */}
      <path
        d="M0 8.91248C0 3.99026 3.99025 0 8.91248 0H880.498C885.42 0 889.411 3.99025 889.411 8.91248V142.306C889.411 147.229 885.42 151.219 880.498 151.219H8.91249C3.99027 151.219 0 147.229 0 142.306V8.91248Z"
        fill="var(--wp-waveform-bg)"
      />

      {/* Bars — each one is a rounded vertical line centered at mid-height */}
      <g>
        {bars.map((amp, i) => {
          const xCenter = innerLeft + ((i + 0.5) / barCount) * innerWidth
          const w = Math.max(2, Math.min(6, (innerWidth / barCount) * 0.5))
          const h = Math.max(4, amp * 70 + 6)
          const y = REF_HEIGHT / 2 - h / 2
          const ratio = i / barCount
          const inRegion = ratio >= effectiveRegion.start && ratio <= effectiveRegion.end
          const played = progress > 0 && ratio <= progress && inRegion
          return (
            <rect
              key={i}
              x={xCenter - w / 2}
              y={y}
              width={w}
              height={h}
              rx={w / 2}
              fill={played ? deckTint : 'white'}
              opacity={inRegion ? 1 : 0.5}
            />
          )
        })}
      </g>

      {/* Invisible seek hit-target covers the whole body */}
      <rect
        x={0}
        y={0}
        width={890}
        height={REF_HEIGHT}
        fill="transparent"
        cursor={disabled ? 'default' : 'pointer'}
        onPointerDown={handlePointerDown('seek')}
      />

      {/* Region frame — green outline matches SVG */}
      {onRegionChange && (
        <motion.rect
          initial={false}
          animate={{ x: regionStartX, width: regionEndX - regionStartX }}
          transition={{ type: 'spring', stiffness: 420, damping: 40 }}
          y={2}
          height={REF_HEIGHT - 4}
          rx={12}
          ry={12}
          fill="none"
          stroke="var(--wp-ready)"
          strokeWidth={4}
          pointerEvents="none"
        />
      )}

      {/* Left handle (pill) */}
      {onRegionChange && (
        <HandlePill
          x={regionStartX}
          side="left"
          onPointerDown={handlePointerDown('start')}
          dragging={drag === 'start'}
        />
      )}

      {/* Right handle (pill) */}
      {onRegionChange && (
        <HandlePill
          x={regionEndX}
          side="right"
          onPointerDown={handlePointerDown('end')}
          dragging={drag === 'end'}
        />
      )}

      {/* Playhead line + thumb */}
      <g pointerEvents="none">
        <line
          x1={playheadX}
          x2={playheadX}
          y1={8}
          y2={REF_HEIGHT - 8}
          stroke={deckTint}
          strokeWidth={2}
          opacity={0.9}
        />
        <circle
          cx={playheadX}
          cy={REF_HEIGHT / 2}
          r={6}
          fill={deckTint}
          stroke="var(--wp-waveform-bg)"
          strokeWidth={2}
        />
      </g>
    </svg>
  )
}

function HandlePill({
  x,
  side,
  onPointerDown,
  dragging,
}: {
  x: number
  side: 'left' | 'right'
  onPointerDown: (e: React.PointerEvent) => void
  dragging: boolean
}) {
  const left = side === 'left' ? x - HANDLE_WIDTH : x
  return (
    <g
      style={{ cursor: 'ew-resize', transformBox: 'fill-box' }}
      onPointerDown={onPointerDown}
    >
      {/* outer pill */}
      <motion.rect
        initial={false}
        animate={{
          x: left,
          scaleY: dragging ? 1.04 : 1,
        }}
        transition={{ type: 'spring', stiffness: 480, damping: 34 }}
        y={0}
        width={HANDLE_WIDTH}
        height={REF_HEIGHT}
        rx={HANDLE_RADIUS}
        ry={HANDLE_RADIUS}
        fill="var(--wp-ready)"
        style={{
          filter: dragging
            ? 'drop-shadow(0 0 12px rgba(30,215,96,0.55))'
            : 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
          transformOrigin: `${x}px ${REF_HEIGHT / 2}px`,
        }}
      />
      {/* dark grip */}
      <rect
        x={left + HANDLE_WIDTH / 2 - GRIP_WIDTH / 2}
        y={REF_HEIGHT / 2 - GRIP_HEIGHT / 2}
        width={GRIP_WIDTH}
        height={GRIP_HEIGHT}
        rx={GRIP_WIDTH / 2}
        fill="var(--wp-waveform-bg)"
      />
    </g>
  )
}
