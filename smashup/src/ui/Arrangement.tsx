import { useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Lock, LockOpen, Minus, Plus, Redo2, Shuffle, Sparkles, Trash2, Undo2, Wand2 } from 'lucide-react'
import clsx from 'clsx'
import { activeCrate, brainSongs, useStore } from '@/store'
import { CURVE_LABEL, curveAt, momentDur } from '@/brain/composer'
import { MOVES, MOVE_LIST } from '@/brain/moves'
import type { CurvePreset, Lane, Layer, MoveId } from '@/model/types'
import { LANE_COLOR, LANE_LABEL, fmtTime, songColor } from './colors'

const LANES: Lane[] = ['vox', 'drums', 'bass', 'music', 'full']
const LAYER_LABEL: Record<Layer, string> = { solo: 'Full song', acapellaOver: 'Acapella over beat', tease: 'Acapella tease' }

export function Arrangement() {
  const crate = useStore(activeCrate)
  const st = useStore()
  const { timeline: tl, plan, master, plans, planIndex, reveal, position } = st
  const [pps, setPps] = useState(9)
  const scroller = useRef<HTMLDivElement>(null)
  const songIndex = useMemo(() => new Map(crate?.songs.map((s, i) => [s.id, i]) ?? []), [crate])
  const songs = useMemo(() => brainSongs(crate), [crate])
  const byMoment = useMemo(() => new Map(songs.flatMap((s) => s.moments.map((m) => [m.id, { s, m }] as const))), [songs])
  const usedLanes = useMemo(() => LANES.filter((l) => tl?.clips.some((c) => c.lane === l)), [tl])

  if (!crate) return null
  if (songs.length === 0) {
    return <div className="m-auto p-8 text-center text-mute">Add at least two songs. The arrangement composes itself as soon as they're analysed.</div>
  }

  const width = Math.max(600, (tl?.duration ?? 60) * pps + 40)
  const bar = master ? 240 / master.bpm : 2.5
  const x = (t: number) => 20 + t * pps
  const visibleSection = (i: number) => i < reveal

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <button className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-black" onClick={() => st.composeNow({ keepLocks: true })} data-testid="compose">
          <Sparkles size={14} /> {st.composing ? 'Composing…' : 'Compose'}
        </button>
        <button className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm" onClick={() => st.composeNow({ reroll: true, keepLocks: true })} title="New seed, keep locked sections">
          <Shuffle size={14} /> Re-roll
        </button>
        <div className="flex overflow-hidden rounded-lg border border-line">
          {plans.map((p, i) => (
            <button key={p.id} className={clsx('px-3 py-2 text-xs', i === planIndex ? 'bg-panel2 text-ink' : 'text-mute hover:text-ink')} onClick={() => st.selectPlan(i)} title={`score ${p.score}`}>
              Plan {String.fromCharCode(65 + i)}
            </button>
          ))}
        </div>
        <select className="rounded-lg border border-line bg-panel px-2 py-2 text-xs" value={st.curve} onChange={(e) => st.setCurve(e.target.value as CurvePreset)} aria-label="Energy curve">
          {(Object.keys(CURVE_LABEL) as CurvePreset[]).map((c) => (
            <option key={c} value={c}>
              {CURVE_LABEL[c]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs text-mute">
          Length
          <input type="range" min={60} max={300} step={15} value={st.targetSec} onChange={(e) => st.setTarget(Number(e.target.value))} />
          <span className="w-10 font-mono">{fmtTime(st.targetSec).slice(0, -2)}</span>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-mute" title="Pitch-shift songs up to ±2 semitones into one harmonic neighbourhood">
          <input type="checkbox" checked={st.keyLock} onChange={(e) => st.setKeyLock(e.target.checked)} /> Key match
        </label>
        <div className="ml-auto flex items-center gap-1">
          <IconB label="Undo" onClick={st.undo} disabled={!st.past.length}>
            <Undo2 size={15} />
          </IconB>
          <IconB label="Redo" onClick={st.redo} disabled={!st.future.length}>
            <Redo2 size={15} />
          </IconB>
          <IconB label="Zoom out" onClick={() => setPps((p) => Math.max(3, p / 1.4))}>
            <Minus size={15} />
          </IconB>
          <IconB label="Zoom in" onClick={() => setPps((p) => Math.min(60, p * 1.4))}>
            <Plus size={15} />
          </IconB>
        </div>
      </div>

      {/* Timeline */}
      {tl && plan ? (
        <div ref={scroller} className="overflow-x-auto rounded-xl border border-line bg-panel" data-testid="arrangement">
          <div className="relative" style={{ width }}>
            {/* Ruler */}
            <div
              className="relative h-6 cursor-pointer border-b border-line"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                st.seek((e.clientX - r.left - 20) / pps)
              }}
            >
              {Array.from({ length: Math.ceil(tl.duration / bar) + 1 }, (_, b) => (
                <div key={b} className="absolute top-0 h-full border-l border-line/70" style={{ left: x(b * bar) }}>
                  {b % 4 === 0 && <span className="absolute top-0.5 left-1 font-mono text-[9px] text-dim">{b + 1}</span>}
                </div>
              ))}
            </div>

            {/* Sections + seams */}
            <div className="relative h-16 border-b border-line">
              {tl.sections.map((s) => {
                const info = byMoment.get(s.momentId)
                const color = songColor(songIndex.get(s.songId) ?? 0)
                return (
                  <button
                    key={s.index}
                    className={clsx(
                      'absolute top-1.5 bottom-1.5 overflow-hidden rounded-lg border px-1.5 text-left transition',
                      st.selectedSection === s.index ? 'border-white' : 'border-transparent',
                      visibleSection(s.index) ? 'reveal' : 'opacity-0',
                    )}
                    style={{ left: x(s.at), width: Math.max(8, s.dur * pps - 2), background: `color-mix(in oklab, ${color} 28%, #111118)` }}
                    onClick={() => st.select({ section: s.index, seam: null })}
                    data-testid="section"
                  >
                    <div className="truncate text-[11px] font-semibold" style={{ color }}>
                      {plan.sections[s.index]?.locked && <Lock size={9} className="mr-0.5 inline" />}
                      {info?.s.title}
                    </div>
                    <div className="truncate text-[10px] text-mute">
                      {info?.m.label} · {s.layer === 'solo' ? s.role : LAYER_LABEL[s.layer]}
                    </div>
                  </button>
                )
              })}
              {tl.seams.map((sm) => {
                const mv = MOVES[sm.move]
                return (
                  <button
                    key={`seam-${sm.index}`}
                    className={clsx(
                      'absolute top-1/2 z-10 flex h-6 -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border px-1.5 text-[10px] whitespace-nowrap shadow-lg',
                      st.selectedSeam === sm.index ? 'border-white bg-ink text-black' : 'border-line bg-bg text-ink hover:border-ink/50',
                      visibleSection(sm.index + 1) ? 'reveal' : 'opacity-0',
                    )}
                    style={{ left: x(sm.at + sm.dur / 2) }}
                    onClick={() => st.select({ seam: sm.index, section: null })}
                    title={mv.blurb}
                    data-testid="seam"
                  >
                    <span>{mv.glyph}</span>
                    {pps > 6 && <span>{mv.name}</span>}
                  </button>
                )
              })}
            </div>

            {/* Lanes */}
            {usedLanes.map((lane) => (
              <div key={lane} className="relative h-9 border-b border-line/60">
                <span className="sticky left-0 z-10 ml-1 inline-block rounded bg-bg/80 px-1 text-[9px] font-semibold tracking-wider uppercase" style={{ color: LANE_COLOR[lane] }}>
                  {LANE_LABEL[lane]}
                </span>
                {tl.clips
                  .filter((c) => c.lane === lane)
                  .map((c) => (
                    <div
                      key={c.id}
                      className={clsx('absolute top-1 bottom-1 rounded-[4px]', visibleSection(c.sectionIndex) ? 'reveal' : 'opacity-0')}
                      style={{
                        left: x(c.at),
                        width: Math.max(1.5, c.dur * pps - 1),
                        background: songColor(songIndex.get(c.songId) ?? 0),
                        opacity: c.loop ? 0.55 : 0.85,
                        backgroundImage: c.loop ? 'repeating-linear-gradient(90deg, transparent 0 3px, rgb(0 0 0 / .35) 3px 4px)' : undefined,
                      }}
                      title={`${crate.songs[songIndex.get(c.songId) ?? 0]?.title} · ${c.stem}`}
                    />
                  ))}
                {lane === 'vox' &&
                  tl.keywordTimes.map((k, i) => (
                    <div key={i} className="absolute top-0 h-2 w-[2px] bg-white" style={{ left: x(k.at) }} title={crate.keyword} />
                  ))}
              </div>
            ))}

            {/* Tension */}
            <svg className="block h-14 w-full" viewBox={`0 0 ${width} 56`} preserveAspectRatio="none">
              <polyline
                fill="none"
                stroke="rgb(255 255 255 / .25)"
                strokeDasharray="4 4"
                strokeWidth="1.5"
                points={Array.from({ length: 60 }, (_, i) => {
                  const t = (i / 59) * tl.duration
                  return `${x(t)},${52 - curveAt(plan.curve, t / tl.duration) * 46}`
                }).join(' ')}
              />
              <polyline
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth="2"
                points={tl.sections.flatMap((s) => [`${x(s.at)},${52 - s.tension * 46}`, `${x(s.at + s.dur)},${52 - s.tension * 46}`]).join(' ')}
              />
              <text x="24" y="12" fill="rgb(255 255 255 / .4)" fontSize="9">
                tension · dashed = target curve
              </text>
            </svg>

            {/* Playhead */}
            <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-white" style={{ left: x(position) }} />
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-line p-8 text-center text-mute">Hit Compose to write the first arrangement.</div>
      )}

      {/* Inspector */}
      {plan && master && st.selectedSection != null && plan.sections[st.selectedSection] && <SectionInspector index={st.selectedSection} />}
      {plan && master && st.selectedSeam != null && plan.seams[st.selectedSeam] && <SeamInspector index={st.selectedSeam} />}

      {/* Moment library */}
      <div className="rounded-xl border border-line bg-panel p-3">
        <h3 className="mb-2 text-xs font-semibold tracking-widest text-mute uppercase">Moments · click + to append</h3>
        <div className="flex flex-col gap-2">
          {songs.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-1.5">
              <span className="w-36 truncate text-xs font-medium" style={{ color: songColor(songIndex.get(s.id) ?? 0) }}>
                {s.title}
              </span>
              {s.moments.map((m) => (
                <button
                  key={m.id}
                  className="flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[10px] text-mute hover:border-ink/40 hover:text-ink"
                  onClick={() => st.insertMoment(m.id)}
                  title={`bar ${m.startBar} · ${m.bars} bars · ${master ? momentDur(s, m, master).toFixed(1) : '?'}s`}
                >
                  <Plus size={9} />
                  {m.label} <span className="text-dim">{m.role}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SectionInspector({ index }: { index: number }) {
  const st = useStore()
  const crate = useStore(activeCrate)
  const plan = st.plan!
  const spec = plan.sections[index]
  const songs = brainSongs(crate)
  const cur = songs.find((s) => s.moments.some((m) => m.id === spec.momentId))
  const prevSong = index > 0 ? songs.find((s) => s.moments.some((m) => m.id === plan.sections[index - 1].momentId)) : null
  return (
    <div className="reveal flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel p-3 text-xs" data-testid="section-inspector">
      <span className="font-semibold">Section {index + 1}</span>
      <select
        className="rounded bg-panel2 px-2 py-1"
        value={spec.momentId}
        onChange={(e) => st.editSection(index, { momentId: e.target.value })}
        aria-label="Moment"
      >
        {songs.map((s) => (
          <optgroup key={s.id} label={s.title}>
            {s.moments.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · {m.role} · bar {m.startBar}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <select
        className="rounded bg-panel2 px-2 py-1"
        value={spec.layer}
        onChange={(e) => {
          const layer = e.target.value as Layer
          st.editSection(index, { layer, bedSongId: layer === 'acapellaOver' ? prevSong?.id : undefined })
        }}
        aria-label="Layer"
      >
        <option value="solo">Full song</option>
        <option value="tease" disabled={!cur?.hasStems}>
          Acapella tease (vocal only)
        </option>
        <option value="acapellaOver" disabled={!cur?.hasStems || !prevSong?.hasStems || prevSong?.id === cur?.id}>
          Acapella over previous beat
        </option>
      </select>
      <button className="flex items-center gap-1 rounded bg-panel2 px-2 py-1" onClick={() => st.editSection(index, { locked: !spec.locked })}>
        {spec.locked ? <Lock size={12} /> : <LockOpen size={12} />} {spec.locked ? 'Locked' : 'Lock'}
      </button>
      <IconB label="Move left" onClick={() => st.moveSection(index, -1)}>
        <ArrowLeft size={14} />
      </IconB>
      <IconB label="Move right" onClick={() => st.moveSection(index, 1)}>
        <ArrowRight size={14} />
      </IconB>
      <IconB label="Delete section" onClick={() => st.deleteSection(index)}>
        <Trash2 size={14} />
      </IconB>
      <span className="w-full text-mute">
        <Wand2 size={11} className="mr-1 inline" />
        {spec.reason}
      </span>
    </div>
  )
}

function SeamInspector({ index }: { index: number }) {
  const st = useStore()
  const seam = st.plan!.seams[index]
  const applied = st.timeline?.seams.find((s) => s.index === index)
  return (
    <div className="reveal rounded-xl border border-line bg-panel p-3 text-xs" data-testid="seam-inspector">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-semibold">
          Transition {index + 1} → {index + 2}
        </span>
        <span className="text-mute">{seam.reason}</span>
        {applied && applied.move !== seam.move && <span className="text-pad2">(not enough audio for {MOVES[seam.move].name} here, so it plays as {MOVES[applied.move].name})</span>}
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        {MOVE_LIST.map((m) => (
          <button
            key={m.id}
            className={clsx('rounded-lg border p-2 text-left', seam.move === m.id ? 'border-accent bg-accent/10' : 'border-line hover:border-ink/40')}
            onClick={() => st.setSeam(index, m.id as MoveId)}
          >
            <div className="font-semibold">
              {m.glyph} {m.name}
            </div>
            <div className="text-[10px] text-mute">{m.blurb}</div>
          </button>
        ))}
      </div>
      {MOVES[seam.move].bars > 0 && (
        <label className="mt-2 flex items-center gap-2 text-mute">
          Length
          <select className="rounded bg-panel2 px-2 py-1" value={seam.bars} onChange={(e) => st.setSeam(index, seam.move, Number(e.target.value))}>
            {[0.5, 1, 2, 4, 8].map((b) => (
              <option key={b} value={b}>
                {b} bar{b === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}

function IconB({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button className="rounded-md p-1.5 text-mute hover:bg-panel2 hover:text-ink disabled:opacity-30" onClick={onClick} disabled={disabled} title={label} aria-label={label}>
      {children}
    </button>
  )
}
