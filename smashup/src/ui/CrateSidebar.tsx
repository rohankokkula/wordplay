import { useRef, useState } from 'react'
import { AudioLines, FolderPlus, Layers, Music2, Plus, RefreshCw, Sparkles, Trash2, Upload, X } from 'lucide-react'
import clsx from 'clsx'
import { activeCrate, useStore } from '@/store'
import { keyName } from '@/analysis/music'
import { songColor } from './colors'

export function CrateSidebar() {
  const crates = useStore((s) => s.crates)
  const activeId = useStore((s) => s.activeId)
  const crate = useStore(activeCrate)
  const setActive = useStore((s) => s.setActive)
  const createFromTemplate = useStore((s) => s.createFromTemplate)
  const createDemo = useStore((s) => s.createDemo)
  const deleteCrate = useStore((s) => s.deleteCrate)
  const [creating, setCreating] = useState(false)

  return (
    <aside className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto border-r border-line bg-panel p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-widest text-mute uppercase">Crates</h2>
        <button className="rounded-md p-1 text-mute hover:bg-panel2 hover:text-ink" onClick={() => setCreating((v) => !v)} title="New crate" aria-label="New crate">
          <FolderPlus size={16} />
        </button>
      </div>
      {creating && <NewCrate onDone={() => setCreating(false)} />}

      <div className="flex flex-col gap-1">
        {crates.map((c) => (
          <div
            key={c.id}
            className={clsx(
              'group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm',
              c.id === activeId ? 'bg-panel2 text-ink' : 'text-mute hover:bg-panel2/60',
            )}
            onClick={() => setActive(c.id)}
          >
            <Layers size={14} className="shrink-0" />
            <span className="truncate">{c.name}</span>
            <span className="ml-auto rounded bg-black/30 px-1.5 font-mono text-[10px] text-mute">“{c.keyword}”</span>
            <button
              className="hidden rounded p-0.5 text-dim hover:text-accent group-hover:block"
              onClick={(e) => {
                e.stopPropagation()
                if (confirm(`Delete crate “${c.name}”? Audio stored on this device for it is removed too.`)) deleteCrate(c.id)
              }}
              aria-label="Delete crate"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {crates.length === 0 && <p className="px-2 text-xs text-dim">No crates yet.</p>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button className="flex items-center justify-center gap-1.5 rounded-lg border border-line px-2 py-2 text-xs text-ink hover:bg-panel2" onClick={() => createFromTemplate()}>
          <Music2 size={13} /> Paisa template
        </button>
        <button className="flex items-center justify-center gap-1.5 rounded-lg border border-line px-2 py-2 text-xs text-ink hover:bg-panel2" onClick={() => void createDemo()}>
          <Sparkles size={13} /> Synth demo
        </button>
      </div>

      {crate && <SongList />}
    </aside>
  )
}

function NewCrate({ onDone }: { onDone: () => void }) {
  const createCrate = useStore((s) => s.createCrate)
  const [name, setName] = useState('')
  const [keyword, setKeyword] = useState('')
  const [aliases, setAliases] = useState('')
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-line bg-panel2 p-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!keyword.trim()) return
        createCrate(name.trim(), keyword.trim(), aliases.split(',').map((a) => a.trim()).filter(Boolean))
        onDone()
      }}
    >
      <input className="rounded bg-black/30 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent" placeholder="Crate name (e.g. Paisa)" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="rounded bg-black/30 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent" placeholder="Keyword (e.g. paisa)" value={keyword} onChange={(e) => setKeyword(e.target.value)} required />
      <input className="rounded bg-black/30 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent" placeholder="Aliases, comma separated (paise, पैसा)" value={aliases} onChange={(e) => setAliases(e.target.value)} />
      <div className="flex gap-2">
        <button className="flex-1 rounded bg-accent px-2 py-1.5 text-sm font-semibold text-black" type="submit">
          Create
        </button>
        <button className="rounded px-2 py-1.5 text-sm text-mute hover:text-ink" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function SongList() {
  const crate = useStore(activeCrate)!
  const addFiles = useStore((s) => s.addFiles)
  const removeSong = useStore((s) => s.removeSong)
  const reanalyze = useStore((s) => s.reanalyze)
  const master = useStore((s) => s.master)
  const setMode = useStore((s) => s.setMode)
  const input = useRef<HTMLInputElement>(null)
  const [slot, setSlot] = useState<string | undefined>()
  const [drag, setDrag] = useState(false)

  return (
    <div
      className={clsx('flex flex-col gap-2 rounded-xl border border-dashed p-2 transition', drag ? 'border-accent bg-accent/5' : 'border-line')}
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        void addFiles(Array.from(e.dataTransfer.files))
      }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-widest text-mute uppercase">Songs · {crate.songs.length}</h3>
        <button
          className="flex items-center gap-1 rounded-md bg-panel2 px-2 py-1 text-xs hover:bg-line"
          onClick={() => {
            setSlot(undefined)
            input.current?.click()
          }}
        >
          <Plus size={12} /> Add
        </button>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept="audio/*,.json"
        className="hidden"
        data-testid="file-input"
        onChange={(e) => {
          if (e.target.files) void addFiles(Array.from(e.target.files), slot)
          e.target.value = ''
        }}
      />
      {crate.songs.map((s, i) => {
        const ms = master?.songs[s.id]
        return (
          <div key={s.id} className="group rounded-lg bg-panel2 p-2" data-testid="song-row">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: songColor(i) }} />
              <span className="truncate text-sm font-medium">{s.title}</span>
              <button className="ml-auto hidden text-dim hover:text-accent group-hover:block" onClick={() => removeSong(s.id)} aria-label="Remove song">
                <X size={13} />
              </button>
            </div>
            {s.status === 'empty' ? (
              <button
                className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line py-2 text-xs text-mute hover:border-accent hover:text-ink"
                onClick={() => {
                  setSlot(s.id)
                  input.current?.click()
                }}
              >
                <Upload size={12} /> {s.stage === 'Drop audio' ? 'Drop audio' : s.stage}
              </button>
            ) : s.status === 'ready' && s.analysis ? (
              <div className="mt-1 flex flex-wrap items-center gap-1 font-mono text-[10px] text-mute">
                <span className="rounded bg-black/30 px-1">{Math.round(s.analysis.bpm)} BPM</span>
                <span className="rounded bg-black/30 px-1">
                  {keyName(s.analysis.key)} · {s.analysis.key.camelot}
                </span>
                {s.hits.some((h) => h.accepted) ? (
                  <span className="rounded bg-pad4/15 px-1 text-pad4">{s.hits.filter((h) => h.accepted).length} hits</span>
                ) : (
                  <button className="rounded bg-accent/15 px-1 text-accent hover:bg-accent/25" onClick={() => setMode('discover')} title={s.wordsNote ?? ''}>
                    0 hits · why?
                  </button>
                )}
                {s.hasStems && (
                  <span className="flex items-center gap-0.5 rounded bg-music/15 px-1 text-music">
                    <AudioLines size={9} /> 4 stems
                  </span>
                )}
                {ms && <span className="w-full truncate pt-0.5 text-dim" title={ms.note}>{ms.note}</span>}
              </div>
            ) : (
              <div className="mt-1.5">
                <div className="flex items-center justify-between text-[10px] text-mute">
                  <span className={clsx('truncate', s.status === 'error' && 'text-accent')}>{s.status === 'error' ? s.error : s.stage}</span>
                  {s.status === 'error' ? (
                    <button className="text-mute hover:text-ink" onClick={() => void reanalyze(s.id)} aria-label="Retry">
                      <RefreshCw size={11} />
                    </button>
                  ) : (
                    <span className="font-mono">{Math.round(s.progress)}%</span>
                  )}
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded bg-black/40">
                  <div className="shimmer h-full rounded bg-accent/70 transition-all" style={{ width: `${Math.max(4, s.progress)}%` }} />
                </div>
              </div>
            )}
          </div>
        )
      })}
      <p className="px-1 text-[10px] leading-relaxed text-dim">
        Drop audio files here. Add a <code>song.words.json</code> next to a file to skip transcription. Audio stays on this device.
      </p>
    </div>
  )
}
