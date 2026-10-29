import { Brain } from 'lucide-react'
import { activeCrate, brainSongs, useStore } from '@/store'
import { MOVES } from '@/brain/moves'
import { keyName } from '@/analysis/music'
import { songColor } from './colors'

/** The "why" behind the arrangement. Trust comes from showing the reasoning. */
export function BrainPanel() {
  const crate = useStore(activeCrate)
  const master = useStore((s) => s.master)
  const plan = useStore((s) => s.plan)
  const timeline = useStore((s) => s.timeline)
  const service = useStore((s) => s.service)
  const serviceChecked = useStore((s) => s.serviceChecked)
  const select = useStore((s) => s.select)
  const songs = brainSongs(crate)
  const idx = new Map(crate?.songs.map((s, i) => [s.id, i]) ?? [])
  const byMoment = new Map(songs.flatMap((s) => s.moments.map((m) => [m.id, { s, m }] as const)))

  return (
    <aside className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto border-l border-line bg-panel p-3 text-xs" data-testid="brain">
      <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-widest text-mute uppercase">
        <Brain size={14} /> Brain
      </h2>

      <div className="rounded-lg bg-panel2 p-2 leading-relaxed">
        <div className="mb-1 font-semibold text-ink">Analysis</div>
        {!serviceChecked ? (
          <span className="text-mute">Checking analysis service…</span>
        ) : service ? (
          <span className="text-pad4">
            Service online: {service.demucs ? '4-stem Demucs' : 'no stems'} · Whisper {service.whisper_model} {service.align ? '· MMS alignment' : ''}
          </span>
        ) : (
          <span className="text-pad2">On-device mode. Beat/key run locally; words come from in-browser Whisper (model downloads once), synced lyrics, or one hit you mark + Find all. Deploy the backend for stems + syllable-exact alignment.</span>
        )}
      </div>

      {master && (
        <div className="rounded-lg bg-panel2 p-2">
          <div className="mb-1 font-semibold text-ink">
            Master · {master.bpm} BPM · {keyName(master.key)} ({master.key.camelot})
          </div>
          <ul className="space-y-1">
            {songs.map((s) => (
              <li key={s.id} className="flex gap-1.5">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: songColor(idx.get(s.id) ?? 0) }} />
                <span>
                  <b className="text-ink">{s.title}</b> <span className="text-mute">{master.songs[s.id]?.note}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan && (
        <div className="rounded-lg bg-panel2 p-2">
          <div className="mb-1 font-semibold text-ink">Plan</div>
          <ul className="space-y-0.5 text-mute">
            {plan.summary.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      )}

      {plan && timeline && (
        <ol className="space-y-1.5">
          {plan.sections.map((sec, i) => {
            const info = byMoment.get(sec.momentId)
            const seam = plan.seams[i]
            return (
              <li key={i}>
                <button className="w-full rounded-lg border border-line p-2 text-left hover:border-ink/40" onClick={() => select({ section: i, seam: null })}>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-dim">{i + 1}</span>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: songColor(idx.get(info?.s.id ?? '') ?? 0) }} />
                    <b className="truncate text-ink">{info?.s.title}</b>
                    <span className="ml-auto text-dim">{info?.m.label}</span>
                  </div>
                  <div className="mt-0.5 text-mute">{sec.reason}</div>
                </button>
                {seam && (
                  <button className="mt-1 ml-4 flex w-[calc(100%-1rem)] items-start gap-1.5 text-left text-mute hover:text-ink" onClick={() => select({ seam: i, section: null })}>
                    <span>{MOVES[seam.move].glyph}</span>
                    <span>
                      <b className="text-ink">{MOVES[seam.move].name}</b>: {seam.reason}
                    </span>
                  </button>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </aside>
  )
}
