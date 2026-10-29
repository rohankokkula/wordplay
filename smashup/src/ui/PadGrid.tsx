import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Circle, Headphones, Loader2, Power, Radio } from 'lucide-react'
import clsx from 'clsx'
import { activeCrate, brainSongs, useStore } from '@/store'
import { session } from '@/engine/session'
import { buildTimeline } from '@/engine/timeline'
import type { ScheduleHandle } from '@/engine/graph'
import type { Moment, Plan, Song } from '@/model/types'
import { PAD_COLORS } from '@/model/types'
import { keyName } from '@/analysis/music'
import { songColor } from './colors'

const KEY_ROWS = ['1234', 'qwer', 'asdf', 'zxcv', 'uiop', 'jkl;', 'm,./']

/** Extend a pad's moment so a triggered pad keeps the song rolling, like a hot cue. */
function rollingMoment(song: Song, m: Moment): Moment {
  const n = song.analysis?.bars.length ?? m.startBar + m.bars
  return { ...m, bars: Math.max(m.bars, Math.min(n - m.startBar, m.bars + 8)) }
}

function padPlan(m: Moment): Plan {
  return { id: 'pad', seed: 0, curve: 'wave', sections: [{ momentId: m.id, layer: 'solo', reason: 'pad' }], seams: [], score: 0, summary: [] }
}

/**
 * Perform: Track × 4 hot-cue pads. Off = audition the raw cue. Live = every
 * pad is warped to the master grid and fires on the next bar; Record turns
 * your performance into an editable arrangement.
 */
export function PadGrid() {
  const crate = useStore(activeCrate)
  const master = useStore((s) => s.master)
  const setPad = useStore((s) => s.setPad)
  const planFromMoments = useStore((s) => s.planFromMoments)
  const setMode = useStore((s) => s.setMode)
  const [live, setLive] = useState(false)
  const [arming, setArming] = useState(false)
  const [recording, setRecording] = useState(false)
  const [lit, setLit] = useState<string | null>(null)
  const [queued, setQueued] = useState<string | null>(null)
  const [beat, setBeat] = useState(0)
  const clock = useRef(0)
  const current = useRef<ScheduleHandle | null>(null)
  const rec = useRef<string[]>([])

  const songs = useMemo(() => crate?.songs.filter((s) => s.analysis && s.pads.length) ?? [], [crate])
  const bSongs = useMemo(() => brainSongs(crate), [crate])
  const bar = master ? 240 / master.bpm : 2.5

  const arm = async () => {
    if (!master) return
    setArming(true)
    try {
      // Live pads play the originals at the master rate (vinyl-style) — instant, no pre-render.
      await session.bank.prepareRaw(songs.map((s) => s.id), 'full')
      clock.current = session.context().currentTime + 0.1
      setLive(true)
    } finally {
      setArming(false)
    }
  }

  const disarm = useCallback(() => {
    current.current?.stop()
    current.current = null
    setLive(false)
    setLit(null)
    setQueued(null)
  }, [])

  useEffect(() => () => current.current?.stop(), [])

  useEffect(() => {
    if (!live) return
    let raf = 0
    const loop = () => {
      const ctx = session.context()
      setBeat(Math.floor(((ctx.currentTime - clock.current) / (bar / 4)) % 4))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [live, bar])

  const trigger = useCallback(
    async (song: Song, padIdx: number) => {
      const pad = song.pads[padIdx]
      const m = song.moments.find((x) => x.id === pad?.momentId)
      if (!m || !song.analysis) return
      const key = `${song.id}:${padIdx}`
      if (!live || !master) {
        const t0 = song.analysis.bars[m.startBar]
        const t1 = song.analysis.bars[m.startBar + m.bars] ?? song.analysis.duration
        setLit(key)
        await session.auditionRaw(song.id, 'full', t0, t1 - t0)
        return
      }
      const ctx = session.context()
      const now = ctx.currentTime
      const nextBar = clock.current + Math.ceil((now - clock.current + 0.03) / bar) * bar
      const rm = rollingMoment(song, m)
      const fakeSongs = bSongs.map((b) => ({ ...b, hasStems: false, moments: b.id === song.id ? [...b.moments, rm] : b.moments }))
      const tl = buildTimeline(padPlan(rm), fakeSongs, master)
      setQueued(key)
      const handle = session.schedulePad(tl, master, nextBar)
      current.current?.stopAt(nextBar)
      current.current = handle
      if (recording) rec.current.push(m.id)
      setTimeout(() => {
        setLit(key)
        setQueued((q) => (q === key ? null : q))
      }, Math.max(0, (nextBar - ctx.currentTime) * 1000))
    },
    [live, master, bar, bSongs, recording],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey) return
      const k = e.key.toLowerCase()
      KEY_ROWS.forEach((row, r) => {
        const c = row.indexOf(k)
        if (c >= 0 && songs[r]) {
          e.preventDefault()
          void trigger(songs[r], c)
        }
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [songs, trigger])

  if (!crate || songs.length === 0) {
    return <div className="m-auto p-8 text-center text-mute">Pads appear here as soon as a song is analysed.</div>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <header className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Pads</h1>
          <p className="text-sm text-mute">
            Four hot cues per song: Call · Build · Chant · Drop. Keys <kbd className="font-mono">1–4 · Q–R · A–F · Z–V · U–P</kbd>.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {live && (
            <div className="flex items-center gap-1" aria-label="Beat">
              {[0, 1, 2, 3].map((b) => (
                <span key={b} className={clsx('h-2.5 w-2.5 rounded-full', b === beat ? 'bg-accent' : 'bg-line')} />
              ))}
              <span className="ml-1 font-mono text-xs text-mute">{master?.bpm} BPM</span>
            </div>
          )}
          {live && (
            <button
              className={clsx('flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold', recording ? 'bg-accent text-black' : 'border border-line text-ink')}
              onClick={() => {
                if (recording) {
                  setRecording(false)
                  if (rec.current.length) {
                    planFromMoments(rec.current, 'Recorded live from the pads')
                    setMode('produce')
                  }
                } else {
                  rec.current = []
                  setRecording(true)
                }
              }}
            >
              <Circle size={12} fill={recording ? 'black' : 'none'} /> {recording ? 'Stop → arrangement' : 'Record'}
            </button>
          )}
          <button
            className={clsx('flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold', live ? 'bg-pad4 text-black' : 'bg-panel2 text-ink')}
            onClick={() => (live ? disarm() : void arm())}
            disabled={arming || !master}
          >
            {arming ? <Loader2 size={14} className="animate-spin" /> : live ? <Radio size={14} /> : <Power size={14} />}
            {arming ? 'Loading…' : live ? 'Live · quantized' : 'Go live'}
          </button>
        </div>
      </header>

      {!live && (
        <p className="flex items-center gap-1.5 text-xs text-dim">
          <Headphones size={12} /> Preview mode plays each cue raw. Go live to lock every pad to {master?.bpm ?? '—'} BPM (vinyl-style rate) and fire on the next bar.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-2" data-testid="pad-grid">
          <thead>
            <tr className="text-left text-xs text-mute">
              <th className="font-medium">Track</th>
              {['🔴 Pad 1', '🟠 Pad 2', '🟡 Pad 3', '🟢 Pad 4'].map((h) => (
                <th key={h} className="font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {songs.map((s, r) => (
              <tr key={s.id}>
                <td className="w-44 align-middle">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: songColor(crate.songs.indexOf(s)) }} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{s.title}</div>
                      <div className="font-mono text-[10px] text-dim">
                        {Math.round(s.analysis!.bpm)} · {keyName(s.analysis!.key)} · {s.analysis!.key.camelot}
                      </div>
                    </div>
                  </div>
                </td>
                {s.pads.map((p, i) => {
                  const m = s.moments.find((x) => x.id === p.momentId)
                  const key = `${s.id}:${i}`
                  return (
                    <td key={i} className="align-top">
                      <button
                        className="pad relative flex h-24 w-full flex-col justify-between rounded-xl p-2 text-left text-black"
                        style={{ background: PAD_COLORS[i], ['--pad-glow' as string]: PAD_COLORS[i], opacity: m ? 1 : 0.3 }}
                        data-hit={lit === key}
                        onClick={() => void trigger(s, i)}
                        disabled={!m}
                      >
                        <span className="text-sm leading-tight font-bold">{p.label}</span>
                        <span className="flex items-center justify-between font-mono text-[10px] opacity-75">
                          <span>{m ? `${m.role} · ${m.bars} bars · ${m.hitTimes.length}×` : 'empty'}</span>
                          <kbd className="rounded bg-black/15 px-1 uppercase">{KEY_ROWS[r]?.[i]}</kbd>
                        </span>
                        {queued === key && <span className="absolute inset-0 animate-pulse rounded-xl ring-4 ring-white/70" />}
                        {lit === key && live && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-black" />}
                      </button>
                      <select
                        className="mt-1 w-full rounded bg-panel2 px-1 py-0.5 text-[10px] text-mute"
                        value={p.momentId ?? ''}
                        onChange={(e) => setPad(s.id, i, e.target.value || null)}
                        aria-label={`Pad ${i + 1} cue`}
                      >
                        {s.moments.map((mm) => (
                          <option key={mm.id} value={mm.id}>
                            {mm.label} · bar {mm.startBar} · {mm.role}
                          </option>
                        ))}
                      </select>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
