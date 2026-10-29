import { useEffect, useState } from 'react'
import { Brain, Grid3x3, Mic2, PanelLeft, SlidersHorizontal } from 'lucide-react'
import clsx from 'clsx'
import { activeCrate, useStore, type Mode } from '@/store'
import { CrateSidebar } from '@/ui/CrateSidebar'
import { WordWall } from '@/ui/WordWall'
import { PadGrid } from '@/ui/PadGrid'
import { Arrangement } from '@/ui/Arrangement'
import { BrainPanel } from '@/ui/BrainPanel'
import { Transport } from '@/ui/Transport'

const MODES: { id: Mode; label: string; icon: React.ReactNode }[] = [
  { id: 'discover', label: 'Word Wall', icon: <Mic2 size={14} /> },
  { id: 'perform', label: 'Pads', icon: <Grid3x3 size={14} /> },
  { id: 'produce', label: 'Arrangement', icon: <SlidersHorizontal size={14} /> },
]

export default function App() {
  const init = useStore((s) => s.init)
  const ready = useStore((s) => s.ready)
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const crate = useStore(activeCrate)
  const toast = useStore((s) => s.toast)
  const say = useStore((s) => s.say)
  const [left, setLeft] = useState(() => typeof window === 'undefined' || window.innerWidth >= 768)
  const [right, setRight] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1024)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => say(null), 3500)
    return () => clearTimeout(t)
  }, [toast, say])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-panel px-3 py-2">
        <button className="rounded-md p-1.5 text-mute hover:text-ink" onClick={() => setLeft((v) => !v)} aria-label="Toggle crates">
          <PanelLeft size={16} />
        </button>
        <div className="flex items-center gap-2">
          <Logo />
          <span className="text-lg font-black tracking-tight">Smashup</span>
        </div>
        {crate && (
          <span className="hidden truncate text-sm text-mute md:inline">
            {crate.name} · <span className="text-ink">“{crate.keyword}”</span>
          </span>
        )}
        <nav className="mx-auto flex rounded-lg border border-line p-0.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              className={clsx('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium', mode === m.id ? 'bg-ink text-black' : 'text-mute hover:text-ink')}
              onClick={() => setMode(m.id)}
              data-testid={`mode-${m.id}`}
            >
              {m.icon}
              <span className="hidden sm:inline">{m.label}</span>
            </button>
          ))}
        </nav>
        <button className="rounded-md p-1.5 text-mute hover:text-ink" onClick={() => setRight((v) => !v)} aria-label="Toggle brain panel">
          <Brain size={16} />
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {left && (
          <div className="w-72 shrink-0 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:shadow-2xl">
            <CrateSidebar />
          </div>
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          {!ready ? (
            <div className="m-auto text-mute">Loading…</div>
          ) : mode === 'discover' ? (
            <WordWall />
          ) : mode === 'perform' ? (
            <PadGrid />
          ) : (
            <Arrangement />
          )}
        </main>
        {right && (
          <div className="w-80 shrink-0 max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:max-w-[90vw] max-lg:shadow-2xl">
            <BrainPanel />
          </div>
        )}
      </div>
      <Transport />
      {toast && <div className="reveal fixed bottom-16 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-ink px-3 py-2 text-sm text-black shadow-xl">{toast}</div>}
    </div>
  )
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden>
      <rect x="6" y="6" width="24" height="24" rx="6" fill="var(--color-pad1)" />
      <rect x="34" y="6" width="24" height="24" rx="6" fill="var(--color-pad2)" />
      <rect x="6" y="34" width="24" height="24" rx="6" fill="var(--color-pad3)" />
      <rect x="34" y="34" width="24" height="24" rx="6" fill="var(--color-pad4)" />
    </svg>
  )
}
