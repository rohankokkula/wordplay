import { useEffect, useRef } from 'react'

interface Props {
  peaks: number[]
  peaksPerSec: number
  start: number
  end: number
  color: string
  height?: number
  markers?: { t: number; color: string }[]
  center?: number | null
  playhead?: number | null
  className?: string
  onPointer?: (t: number, e: React.MouseEvent) => void
}

/** Peak-envelope waveform for a time window; draws hit markers and an optional word-lock centre line. */
export function Wave({ peaks, peaksPerSec, start, end, color, height = 48, markers, center, playhead, className, onPointer }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const w = cv.clientWidth
      const h = height
      cv.width = Math.max(1, Math.floor(w * dpr))
      cv.height = Math.floor(h * dpr)
      const g = cv.getContext('2d')
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      const span = Math.max(0.01, end - start)
      const mid = h / 2
      g.fillStyle = color
      for (let x = 0; x < w; x++) {
        const t0 = start + (x / w) * span
        const t1 = start + ((x + 1) / w) * span
        let m = 0
        for (let i = Math.floor(t0 * peaksPerSec); i <= Math.floor(t1 * peaksPerSec); i++) m = Math.max(m, peaks[i] ?? 0)
        const bar = Math.max(0.5, m * (h * 0.48))
        g.fillRect(x, mid - bar, 1, bar * 2)
      }
      for (const mk of markers ?? []) {
        if (mk.t < start || mk.t > end) continue
        const x = ((mk.t - start) / span) * w
        g.fillStyle = mk.color
        g.fillRect(x - 1, 0, 2, h)
        g.beginPath()
        g.moveTo(x - 4, 0)
        g.lineTo(x + 4, 0)
        g.lineTo(x, 6)
        g.fill()
      }
      if (center != null) {
        const x = ((center - start) / span) * w
        g.strokeStyle = 'rgba(255,255,255,0.85)'
        g.setLineDash([3, 3])
        g.beginPath()
        g.moveTo(x, 0)
        g.lineTo(x, h)
        g.stroke()
        g.setLineDash([])
      }
      if (playhead != null && playhead >= start && playhead <= end) {
        const x = ((playhead - start) / span) * w
        g.fillStyle = '#fff'
        g.fillRect(x, 0, 1.5, h)
      }
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(cv)
    return () => ro.disconnect()
  }, [peaks, peaksPerSec, start, end, color, height, markers, center, playhead])

  return (
    <canvas
      ref={ref}
      className={className}
      style={{ width: '100%', height, display: 'block', cursor: onPointer ? 'pointer' : undefined }}
      onClick={(e) => {
        if (!onPointer) return
        const r = (e.target as HTMLCanvasElement).getBoundingClientRect()
        onPointer(start + ((e.clientX - r.left) / r.width) * (end - start), e)
      }}
    />
  )
}
