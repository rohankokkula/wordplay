import { useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Play, Plus, Square, X } from 'lucide-react'
import clsx from 'clsx'
import { activeCrate, useStore } from '@/store'
import { session } from '@/engine/session'
import type { Hit, Song } from '@/model/types'
import { Wave } from './Wave'
import { songColor } from './colors'

const PRE = 1.2
const POST = 1.6

/**
 * Discover: every keyword hit across the crate, waveforms aligned on the
 * syllable ("word-lock"). Audition, accept/reject, nudge, or mark new hits.
 */
export function WordWall() {
  const crate = useStore(activeCrate)
  const setHit = useStore((s) => s.setHit)
  const [filter, setFilter] = useState<string | null>(null)
  const [showRejected, setShowRejected] = useState(true)
  const [montage, setMontage] = useState(false)

  const rows = useMemo(() => {
    if (!crate) return []
    return crate.songs.flatMap((s, si) =>
      s.analysis && (!filter || filter === s.id)
        ? s.hits.filter((h) => showRejected || h.accepted).map((h) => ({ song: s, hit: h, color: songColor(si) }))
        : [],
    )
  }, [crate, filter, showRejected])

  if (!crate) return <Empty />
  const ready = crate.songs.filter((s) => s.analysis)

  const playMontage = async () => {
    setMontage(true)
    const accepted = rows.filter((r) => r.hit.accepted)
    for (const r of accepted) {
      await session.auditionRaw(r.song.id, 'full', r.hit.start - 0.35, 1.1)
      await new Promise((res) => setTimeout(res, 900))
      if (!montageRef.current) break
    }
    setMontage(false)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <header className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            Every “<span className="text-accent">{crate.keyword}</span>”, word-locked
          </h1>
          <p className="text-sm text-mute">
            Hits from all songs lined up on the syllable. Accept the good ones; they become the Moments the brain composes with.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-black disabled:opacity-40"
            disabled={!rows.some((r) => r.hit.accepted)}
            onClick={() => {
              if (montage) {
                montageRef.current = false
                session.stopAudition()
                setMontage(false)
              } else {
                montageRef.current = true
                void playMontage()
              }
            }}
          >
            {montage ? <Square size={14} /> : <Play size={14} />} {montage ? 'Stop' : 'Play every hit'}
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5">
        <Chip active={!filter} onClick={() => setFilter(null)}>
          All
        </Chip>
        {crate.songs.map((s, i) => (
          <Chip key={s.id} active={filter === s.id} onClick={() => setFilter(s.id)} color={songColor(i)}>
            {s.title} · {s.hits.filter((h) => h.accepted).length}
          </Chip>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-mute">
          <input type="checkbox" checked={showRejected} onChange={(e) => setShowRejected(e.target.checked)} /> show rejected
        </label>
      </div>

      {ready.length === 0 && <Empty />}

      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }} data-testid="word-wall">
        {rows.map(({ song, hit, color }, i) => (
          <HitCard key={hit.id} song={song} hit={hit} color={color} delay={i} onPatch={(p) => setHit(song.id, hit.id, p)} />
        ))}
      </div>

      {ready.map((s) => (
        <SongStrip key={s.id} song={s} color={songColor(crate.songs.indexOf(s))} />
      ))}
    </div>
  )
}

const montageRef = { current: false }

function HitCard({ song, hit, color, delay, onPatch }: { song: Song; hit: Hit; color: string; delay: number; onPatch: (p: Partial<Hit>) => void }) {
  const a = song.analysis!
  return (
    <div
      className={clsx('reveal rounded-xl border bg-panel p-2', hit.accepted ? 'border-line' : 'border-line/40 opacity-45')}
      style={{ animationDelay: `${Math.min(delay, 30) * 25}ms` }}
      data-testid="hit-card"
    >
      <div className="mb-1 flex items-center gap-2 text-xs">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        <span className="truncate font-medium">{song.title}</span>
        <span className="ml-auto font-mono text-mute">{hit.start.toFixed(2)}s</span>
      </div>
      <Wave peaks={a.peaks} peaksPerSec={a.peaksPerSec} start={hit.start - PRE} end={hit.start + POST} color={color} height={44} center={hit.start} />
      <div className="mt-1.5 flex items-center gap-1">
        <span className="rounded bg-black/30 px-1.5 font-mono text-[11px]">“{hit.text}”</span>
        <span className="font-mono text-[10px] text-dim" title="confidence · source">
          {Math.round(hit.confidence * 100)}% · {hit.source}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <IconBtn label="Nudge earlier" onClick={() => onPatch({ start: hit.start - 0.02, end: hit.end - 0.02 })}>
            <ChevronLeft size={13} />
          </IconBtn>
          <IconBtn label="Nudge later" onClick={() => onPatch({ start: hit.start + 0.02, end: hit.end + 0.02 })}>
            <ChevronRight size={13} />
          </IconBtn>
          <IconBtn label="Audition" onClick={() => void session.auditionRaw(song.id, 'full', hit.start - 0.6, 2)}>
            <Play size={13} />
          </IconBtn>
          <IconBtn label={hit.accepted ? 'Reject' : 'Accept'} onClick={() => onPatch({ accepted: !hit.accepted })} active={hit.accepted}>
            {hit.accepted ? <Check size={13} /> : <X size={13} />}
          </IconBtn>
        </div>
      </div>
    </div>
  )
}

/** Whole-song overview: click to audition, shift-click to mark a missed hit. */
function SongStrip({ song, color }: { song: Song; color: string }) {
  const addManualHit = useStore((s) => s.addManualHit)
  const a = song.analysis!
  const markers = useMemo(() => song.hits.filter((h) => h.accepted).map((h) => ({ t: h.start, color: '#fff' })), [song.hits])
  return (
    <div className="rounded-xl border border-line bg-panel p-3">
      <div className="mb-1 flex items-center gap-2 text-xs">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        <span className="font-medium">{song.title}</span>
        <span className="text-dim">
          · words from {song.wordsSource ?? '—'} · {a.sections.map((s) => s.role).join(' → ')}
        </span>
        <span className="ml-auto flex items-center gap-1 text-dim">
          <Plus size={11} /> shift-click to mark a hit
        </span>
      </div>
      <Wave
        peaks={a.peaks}
        peaksPerSec={a.peaksPerSec}
        start={0}
        end={a.duration}
        color={color}
        height={56}
        markers={markers}
        onPointer={(t, e) => {
          if (e.shiftKey) addManualHit(song.id, t)
          else void session.auditionRaw(song.id, 'full', t, 4)
        }}
      />
    </div>
  )
}

function Chip({ active, onClick, children, color }: { active: boolean; onClick: () => void; children: React.ReactNode; color?: string }) {
  return (
    <button
      className={clsx('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs', active ? 'border-ink/40 bg-panel2 text-ink' : 'border-line text-mute hover:text-ink')}
      onClick={onClick}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {children}
    </button>
  )
}

export function IconBtn({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <button className={clsx('rounded p-1 hover:bg-panel2', active ? 'text-pad4' : 'text-mute hover:text-ink')} onClick={onClick} title={label} aria-label={label}>
      {children}
    </button>
  )
}

function Empty() {
  return (
    <div className="m-auto max-w-md p-8 text-center text-mute">
      <p className="text-lg font-semibold text-ink">Make a crate, drop in songs that share a word.</p>
      <p className="mt-2 text-sm">
        Try the <b>Synth demo</b> for an instant, royalty-free crate, or the <b>Paisa template</b> to drop in your own five tracks.
      </p>
    </div>
  )
}
