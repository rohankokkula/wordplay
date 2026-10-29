import { useEffect } from 'react'
import { Download, Loader2, Pause, Play, SkipBack } from 'lucide-react'
import { useStore } from '@/store'
import { fmtTime } from './colors'

export function Transport() {
  const { playing, position, timeline, preparing, exporting, play, pause, seek, tick, exportMix, master } = useStore()

  useEffect(() => {
    if (!playing) return
    let raf = 0
    const loop = () => {
      tick()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing, tick])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement) return
      if (useStore.getState().mode === 'perform') return
      e.preventDefault()
      if (useStore.getState().playing) pause()
      else void play()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [play, pause])

  const dur = timeline?.duration ?? 0
  return (
    <footer className="flex items-center gap-3 border-t border-line bg-panel px-4 py-2">
      <button className="rounded-md p-1.5 text-mute hover:text-ink" onClick={() => seek(0)} aria-label="Back to start" disabled={!timeline}>
        <SkipBack size={16} />
      </button>
      <button
        className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-black disabled:opacity-30"
        onClick={() => (playing ? pause() : void play())}
        disabled={!timeline || !!preparing}
        aria-label={playing ? 'Pause' : 'Play'}
        data-testid="play"
      >
        {preparing && !exporting ? <Loader2 size={16} className="animate-spin" /> : playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </button>
      <span className="font-mono text-xs text-mute">
        {fmtTime(position)} / {fmtTime(dur)}
      </span>
      <input
        type="range"
        className="min-w-0 flex-1"
        min={0}
        max={Math.max(1, dur)}
        step={0.1}
        value={Math.min(position, dur)}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label="Position"
        disabled={!timeline}
      />
      {preparing && <span className="hidden text-xs text-mute md:inline">{preparing}</span>}
      {master && <span className="hidden font-mono text-xs text-dim sm:inline">{master.bpm} BPM · {master.key.camelot}</span>}
      <button
        className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-panel2 disabled:opacity-30"
        onClick={() => void exportMix()}
        disabled={!timeline || exporting}
        data-testid="export"
      >
        {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} WAV
      </button>
    </footer>
  )
}
