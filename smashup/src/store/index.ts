/**
 * App state (zustand). Crates + songs are persisted; plans keep an undo
 * history; the master tempo/key, timeline and moments are derived and rebuilt
 * whenever their inputs change.
 */

import { create } from 'zustand'
import type { Crate, CurvePreset, Hit, Layer, Master, MoveId, Plan, SectionSpec, Song, Timeline } from '@/model/types'
import { solveMaster } from '@/brain/compat'
import { type BrainSong, chooseMove, compose } from '@/brain/composer'
import { MOVES } from '@/brain/moves'
import { buildTimeline } from '@/engine/timeline'
import { session } from '@/engine/session'
import { analyzeSong, rebuildMoments, type SongSource } from '@/analysis/pipeline'
import { crateAliases, hitId } from '@/analysis/keywordMatch'
import { checkService, type ServiceHealth } from '@/api/service'
import { DEMO_SONGS, demoHash, renderDemoSource } from '@/demo'
import { deleteBlobs, getBlob, loadCrates, putBlob, saveCrates, sha256 } from './persist'
import { PAISA_TEMPLATE, type CrateTemplate } from './presets'

export type Mode = 'discover' | 'perform' | 'produce'

interface State {
  ready: boolean
  crates: Crate[]
  activeId: string | null
  mode: Mode
  service: ServiceHealth | null
  serviceChecked: boolean

  curve: CurvePreset
  targetSec: number
  seed: number
  keyLock: boolean

  master: Master | null
  plans: Plan[]
  planIndex: number
  plan: Plan | null
  past: Plan[]
  future: Plan[]
  timeline: Timeline | null
  /** Number of sections revealed by the build animation. */
  reveal: number
  composing: boolean
  autoCompose: boolean

  selectedSection: number | null
  selectedSeam: number | null

  playing: boolean
  position: number
  preparing: string | null
  exporting: boolean
  toast: string | null

  init: () => Promise<void>
  setMode: (m: Mode) => void
  setActive: (id: string) => void
  createCrate: (name: string, keyword: string, aliases: string[]) => string
  createFromTemplate: (t?: CrateTemplate) => string
  createDemo: () => Promise<void>
  deleteCrate: (id: string) => void
  updateCrate: (id: string, patch: Partial<Pick<Crate, 'name' | 'keyword' | 'aliases'>>) => void
  addFiles: (files: File[], slotSongId?: string) => Promise<void>
  removeSong: (songId: string) => void
  reanalyze: (songId: string) => Promise<void>
  setHit: (songId: string, hitId: string, patch: Partial<Hit>) => void
  addManualHit: (songId: string, time: number) => void
  setPad: (songId: string, pad: number, momentId: string | null) => void

  setCurve: (c: CurvePreset) => void
  setTarget: (s: number) => void
  setKeyLock: (v: boolean) => void
  composeNow: (opts?: { reroll?: boolean; keepLocks?: boolean }) => void
  selectPlan: (i: number) => void
  applyPlan: (p: Plan, record?: boolean) => void
  editSection: (i: number, patch: Partial<SectionSpec>) => void
  moveSection: (i: number, dir: -1 | 1) => void
  deleteSection: (i: number) => void
  insertMoment: (momentId: string, at?: number) => void
  planFromMoments: (momentIds: string[], label: string) => void
  setSeam: (i: number, move: MoveId, bars?: number) => void
  undo: () => void
  redo: () => void
  select: (sel: { section?: number | null; seam?: number | null }) => void

  play: (from?: number) => Promise<void>
  pause: () => void
  seek: (t: number) => void
  tick: () => void
  exportMix: () => Promise<void>
  say: (msg: string | null) => void
}

const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

function emptySong(title: string, extra: Partial<Song> = {}): Song {
  return {
    id: uid('song'),
    title,
    hash: null,
    fileName: null,
    status: 'empty',
    progress: 0,
    stage: 'Drop audio',
    error: null,
    analysis: null,
    words: null,
    wordsSource: null,
    hits: [],
    moments: [],
    pads: [],
    hasStems: false,
    ...extra,
  }
}

export function activeCrate(s: Pick<State, 'crates' | 'activeId'>): Crate | null {
  return s.crates.find((c) => c.id === s.activeId) ?? null
}

export function brainSongs(crate: Crate | null): BrainSong[] {
  if (!crate) return []
  return crate.songs
    .filter((s) => s.status === 'ready' && s.analysis && s.moments.length)
    .map((s) => ({ id: s.id, title: s.title, analysis: s.analysis!, moments: s.moments, hasStems: s.hasStems }))
}

function titleFromFile(name: string): string {
  return name
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s*\((official|lyric|audio|video)[^)]*\)/gi, '')
    .trim()
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let composeTimer: ReturnType<typeof setTimeout> | null = null
let revealTimer: ReturnType<typeof setInterval> | null = null
let warmTimer: ReturnType<typeof setTimeout> | null = null

export const useStore = create<State>((set, get) => {
  const persist = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void saveCrates(get().crates), 400)
  }

  const patchSong = (songId: string, patch: Partial<Song> | ((s: Song) => Partial<Song>)) => {
    set((st) => ({
      crates: st.crates.map((c) => ({
        ...c,
        songs: c.songs.map((s) => (s.id === songId ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s)),
      })),
    }))
    persist()
  }

  const crateOfSong = (songId: string) => get().crates.find((c) => c.songs.some((s) => s.id === songId)) ?? null

  /** Recompute master + timeline for the current plan. */
  const rebuild = (plan: Plan | null) => {
    const crate = activeCrate(get())
    const songs = brainSongs(crate)
    const master = songs.length ? solveMaster(songs.map((s) => ({ id: s.id, title: s.title, bpm: s.analysis.bpm, key: s.analysis.key })), { keyLock: get().keyLock }) : null
    const timeline = plan && master ? buildTimeline(plan, songs, master) : null
    if (get().playing) session.stop()
    set({ master, timeline, playing: false })
    // Pre-warp in the background so Play is instant (prepare dedupes in-flight work).
    if (warmTimer) clearTimeout(warmTimer)
    if (timeline && master) warmTimer = setTimeout(() => void session.prepare(timeline, master).catch(() => {}), 700)
  }

  const scheduleAutoCompose = () => {
    if (!get().autoCompose) return
    if (composeTimer) clearTimeout(composeTimer)
    composeTimer = setTimeout(() => {
      const crate = activeCrate(get())
      if (brainSongs(crate).length >= 2 && !get().plan?.sections.some((s) => s.locked)) get().composeNow()
    }, 600)
  }

  const startReveal = (n: number) => {
    if (revealTimer) clearInterval(revealTimer)
    set({ reveal: 0 })
    revealTimer = setInterval(() => {
      const r = get().reveal + 1
      set({ reveal: r })
      if (r >= n && revealTimer) {
        clearInterval(revealTimer)
        revealTimer = null
      }
    }, 260)
  }

  const runPipeline = async (song: Song, src: SongSource) => {
    const crate = crateOfSong(song.id)
    if (!crate) return
    await analyzeSong(song, src, {
      aliases: crateAliases(crate.keyword, crate.aliases),
      service: get().service,
      query: song.title,
      update: (patch) => {
        patchSong(song.id, patch)
        if (patch.status === 'ready') {
          if (crate.id === get().activeId) {
            rebuild(get().plan)
            scheduleAutoCompose()
          }
        }
      },
    })
  }

  const recordPlan = (p: Plan) => {
    const cur = get().plan
    set({ past: cur ? [...get().past.slice(-49), cur] : get().past, future: [], plan: p })
    rebuild(p)
  }

  /** Re-pick seams after a structural edit (keeping user-chosen moves where still legal). */
  const reseam = (sections: SectionSpec[], old: Plan): Plan => {
    const crate = activeCrate(get())
    const songs = brainSongs(crate)
    const master = get().master
    const byMoment = new Map(songs.flatMap((s) => s.moments.map((m) => [m.id, { s, m }] as const)))
    const seams = sections.slice(1).map((spec, i) => {
      const a = byMoment.get(sections[i].momentId)
      const b = byMoment.get(spec.momentId)
      const prevSeam = old.seams.find((_, j) => old.sections[j]?.momentId === sections[i].momentId && old.sections[j + 1]?.momentId === spec.momentId)
      if (prevSeam) return prevSeam
      if (!a || !b || !master) return { move: 'wordCut' as MoveId, bars: 0, reason: 'cut' }
      const ch = chooseMove({ spec: sections[i], song: a.s, moment: a.m }, { spec, song: b.s, moment: b.m }, master, null, {}, Math.random, 0)
      return { move: ch.move.id, bars: ch.move.bars, reason: ch.reason }
    })
    return { ...old, id: uid('plan'), sections, seams }
  }

  return {
    ready: false,
    crates: [],
    activeId: null,
    mode: 'discover',
    service: null,
    serviceChecked: false,
    curve: 'wave',
    targetSec: 150,
    seed: 0,
    keyLock: true,
    master: null,
    plans: [],
    planIndex: 0,
    plan: null,
    past: [],
    future: [],
    timeline: null,
    reveal: 0,
    composing: false,
    autoCompose: true,
    selectedSection: null,
    selectedSeam: null,
    playing: false,
    position: 0,
    preparing: null,
    exporting: false,
    toast: null,

    init: async () => {
      session.setResolver((songId) => crateOfSong(songId)?.songs.find((s) => s.id === songId)?.hash ?? null)
      const crates = await loadCrates()
      // Interrupted analyses restart from the stored blob.
      set({ crates, activeId: crates[0]?.id ?? null, ready: true })
      checkService().then((service) => set({ service, serviceChecked: true }))
      for (const c of crates) {
        for (const s of c.songs) {
          if (s.hash && s.status !== 'ready' && s.status !== 'error' && s.status !== 'empty') void get().reanalyze(s.id)
        }
      }
      if (crates.length) rebuild(null)
      scheduleAutoCompose()
    },

    setMode: (mode) => set({ mode }),
    setActive: (id) => {
      session.stop()
      set({ activeId: id, plan: null, plans: [], past: [], future: [], selectedSection: null, selectedSeam: null, playing: false, position: 0 })
      rebuild(null)
      scheduleAutoCompose()
    },

    createCrate: (name, keyword, aliases) => {
      const crate: Crate = { id: uid('crate'), name: name || keyword, keyword: keyword.trim().toLowerCase(), aliases, songs: [], createdAt: Date.now() }
      set((st) => ({ crates: [crate, ...st.crates] }))
      get().setActive(crate.id)
      persist()
      return crate.id
    },

    createFromTemplate: (t = PAISA_TEMPLATE) => {
      const crate: Crate = {
        id: uid('crate'),
        name: t.name,
        keyword: t.keyword,
        aliases: t.aliases,
        template: t.id,
        createdAt: Date.now(),
        songs: t.songs.map((s) => emptySong(s.title, { padLabels: [...s.padLabels], preloadSlug: s.slug })),
      }
      set((st) => ({ crates: [crate, ...st.crates] }))
      get().setActive(crate.id)
      persist()
      // Auto-fill from /preloads/<template>/<slug>.mp3 when the user has dropped files there.
      for (const song of crate.songs) {
        void (async () => {
          try {
            const r = await fetch(`${import.meta.env.BASE_URL}preloads/${t.id}/${song.preloadSlug}.mp3`)
            if (!r.ok || !(r.headers.get('content-type') ?? '').includes('audio')) return
            const blob = await r.blob()
            let sidecar = null
            try {
              const w = await fetch(`${import.meta.env.BASE_URL}preloads/${t.id}/${song.preloadSlug}.words.json`)
              if (w.ok && (w.headers.get('content-type') ?? '').includes('json')) sidecar = (await w.json()).words ?? null
            } catch {
              /* optional */
            }
            const hash = await sha256(await blob.arrayBuffer())
            await putBlob(`${hash}:full`, blob)
            patchSong(song.id, { hash, fileName: `${song.preloadSlug}.mp3`, status: 'queued' })
            await runPipeline(song, { blob, fileName: `${song.preloadSlug}.mp3`, hash, sidecarWords: sidecar })
          } catch {
            /* no preload */
          }
        })()
      }
      return crate.id
    },

    createDemo: async () => {
      const crate: Crate = {
        id: uid('crate'),
        name: 'Paisa (synthetic demo)',
        keyword: 'paisa',
        aliases: ['paise', 'pesa'],
        template: 'demo',
        createdAt: Date.now(),
        songs: DEMO_SONGS.map((d) => emptySong(d.title, { status: 'queued', stage: 'Synthesising', hash: demoHash(d.slug) })),
      }
      set((st) => ({ crates: [crate, ...st.crates] }))
      get().setActive(crate.id)
      persist()
      for (let i = 0; i < DEMO_SONGS.length; i++) {
        const song = crate.songs[i]
        patchSong(song.id, { stage: 'Synthesising audio + stems', progress: 2 })
        const src = await renderDemoSource(DEMO_SONGS[i], i)
        await runPipeline(song, src)
      }
    },

    deleteCrate: (id) => {
      const c = get().crates.find((x) => x.id === id)
      set((st) => ({ crates: st.crates.filter((x) => x.id !== id) }))
      if (get().activeId === id) get().setActive(get().crates[0]?.id ?? '')
      for (const s of c?.songs ?? []) {
        const stillUsed = get().crates.some((x) => x.songs.some((y) => y.hash === s.hash))
        if (s.hash && !stillUsed) void deleteBlobs(`${s.hash}:`)
        session.bank.forget(s.id)
      }
      persist()
    },

    updateCrate: (id, patch) => {
      set((st) => ({ crates: st.crates.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
      persist()
    },

    addFiles: async (files, slotSongId) => {
      const crate = activeCrate(get())
      if (!crate) return
      const audio = files.filter((f) => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|flac|ogg|aac)$/i.test(f.name))
      const sidecars = new Map<string, File>(files.filter((f) => f.name.endsWith('.words.json')).map((f) => [f.name.replace(/\.words\.json$/, ''), f]))
      for (const [i, file] of audio.entries()) {
        let song = i === 0 && slotSongId ? crate.songs.find((s) => s.id === slotSongId) : undefined
        if (!song) {
          const emptySlot = activeCrate(get())?.songs.find((s) => s.status === 'empty')
          song = emptySlot ?? emptySong(titleFromFile(file.name))
          if (!emptySlot) set((st) => ({ crates: st.crates.map((c) => (c.id === crate.id ? { ...c, songs: [...c.songs, song!] } : c)) }))
        }
        const buf = await file.arrayBuffer()
        const hash = await sha256(buf)
        const blob = new Blob([buf], { type: file.type || 'audio/mpeg' })
        await putBlob(`${hash}:full`, blob)
        session.bank.forget(song.id)
        patchSong(song.id, { hash, fileName: file.name, status: 'queued', stage: 'Queued', progress: 1 })
        let sidecarWords = null
        const sc = sidecars.get(file.name.replace(/\.[a-z0-9]+$/i, ''))
        if (sc) {
          try {
            sidecarWords = JSON.parse(await sc.text()).words ?? null
          } catch {
            /* ignore bad sidecar */
          }
        }
        void runPipeline({ ...song, hash }, { blob, fileName: file.name, hash, sidecarWords })
      }
    },

    removeSong: (songId) => {
      session.bank.forget(songId)
      set((st) => ({ crates: st.crates.map((c) => ({ ...c, songs: c.songs.filter((s) => s.id !== songId) })) }))
      persist()
      rebuild(get().plan?.sections.some((s) => s.momentId.startsWith(songId)) ? null : get().plan)
      if (!get().timeline) set({ plan: null })
      scheduleAutoCompose()
    },

    reanalyze: async (songId) => {
      const song = crateOfSong(songId)?.songs.find((s) => s.id === songId)
      if (!song?.hash) return
      if (song.hash.startsWith('demo-')) {
        const idx = DEMO_SONGS.findIndex((d) => demoHash(d.slug) === song.hash)
        if (idx >= 0) await runPipeline(song, await renderDemoSource(DEMO_SONGS[idx], idx))
        return
      }
      const blob = await getBlob(`${song.hash}:full`)
      if (!blob) {
        patchSong(songId, { status: 'empty', stage: 'Audio missing on this device — drop it again', hash: null })
        return
      }
      await runPipeline(song, { blob, fileName: song.fileName ?? 'audio', hash: song.hash })
    },

    setHit: (songId, id, patch) => {
      patchSong(songId, (s) => {
        const hits = s.hits.map((h) => (h.id === id ? { ...h, ...patch, source: patch.start !== undefined ? 'manual' : h.source } : h))
        return { hits, ...rebuildMoments({ ...s, hits }) }
      })
      rebuild(get().plan)
    },

    addManualHit: (songId, time) => {
      patchSong(songId, (s) => {
        const crate = crateOfSong(songId)
        const hits = [
          ...s.hits,
          { id: hitId(songId), songId, text: crate?.keyword ?? 'hit', start: time, end: time + 0.4, confidence: 1, source: 'manual' as const, accepted: true, cluster: 0, iconic: 0 },
        ].sort((a, b) => a.start - b.start)
        return { hits, ...rebuildMoments({ ...s, hits }) }
      })
      rebuild(get().plan)
    },

    setPad: (songId, pad, momentId) => {
      patchSong(songId, (s) => ({ pads: s.pads.map((p, i) => (i === pad ? { ...p, momentId } : p)) }))
    },

    setCurve: (curve) => {
      set({ curve })
      get().composeNow({ keepLocks: true })
    },
    setTarget: (targetSec) => {
      set({ targetSec })
      get().composeNow({ keepLocks: true })
    },
    setKeyLock: (keyLock) => {
      set({ keyLock })
      session.bank.clearSlices()
      get().composeNow({ keepLocks: true })
    },

    composeNow: (opts = {}) => {
      const crate = activeCrate(get())
      const songs = brainSongs(crate)
      if (songs.length < 1) return
      set({ composing: true })
      const master = solveMaster(songs.map((s) => ({ id: s.id, title: s.title, bpm: s.analysis.bpm, key: s.analysis.key })), { keyLock: get().keyLock })
      const seed = opts.reroll ? Math.floor(Math.random() * 1e9) : get().seed
      const cur = get().plan
      const locks = opts.keepLocks && cur ? cur.sections.map((s) => (s.locked ? s : null)) : undefined
      const plans = compose(songs, master, { targetSec: get().targetSec, curve: get().curve, seed, locks })
      set({ composing: false, seed, plans, planIndex: 0, master })
      if (plans[0]) {
        get().applyPlan(plans[0])
        startReveal(plans[0].sections.length)
      }
    },

    selectPlan: (i) => {
      const p = get().plans[i]
      if (!p) return
      set({ planIndex: i })
      get().applyPlan(p)
      startReveal(p.sections.length)
    },

    applyPlan: (p, record = true) => {
      if (record) recordPlan(p)
      else {
        set({ plan: p })
        rebuild(p)
      }
      set({ selectedSection: null, selectedSeam: null })
    },

    editSection: (i, patch) => {
      const p = get().plan
      if (!p) return
      const sections = p.sections.map((s, j) => (j === i ? { ...s, ...patch } : s))
      const structural = patch.momentId !== undefined || patch.layer !== undefined
      recordPlan(structural ? reseam(sections, p) : { ...p, id: uid('plan'), sections })
    },

    moveSection: (i, dir) => {
      const p = get().plan
      if (!p) return
      const j = i + dir
      if (j < 0 || j >= p.sections.length) return
      const sections = [...p.sections]
      ;[sections[i], sections[j]] = [sections[j], sections[i]]
      for (const k of [i, j]) if (k === 0 && sections[k].layer === 'acapellaOver') sections[k] = { ...sections[k], layer: 'solo' as Layer }
      recordPlan(reseam(sections, p))
      set({ selectedSection: j })
    },

    deleteSection: (i) => {
      const p = get().plan
      if (!p || p.sections.length <= 1) return
      const sections = p.sections.filter((_, j) => j !== i)
      if (sections[0]?.layer === 'acapellaOver') sections[0] = { ...sections[0], layer: 'solo' }
      recordPlan(reseam(sections, p))
      set({ selectedSection: null })
    },

    insertMoment: (momentId, at) => {
      const p = get().plan ?? { id: uid('plan'), seed: 0, curve: get().curve, sections: [], seams: [], score: 0, summary: ['Hand-built'] }
      const idx = at ?? p.sections.length
      const sections = [...p.sections]
      sections.splice(idx, 0, { momentId, layer: 'solo', reason: 'placed by you' })
      recordPlan(reseam(sections, p))
    },

    planFromMoments: (momentIds, label) => {
      if (!momentIds.length) return
      const base: Plan = { id: uid('plan'), seed: 0, curve: get().curve, sections: [], seams: [], score: 0, summary: [label] }
      const sections = momentIds.map((momentId) => ({ momentId, layer: 'solo' as Layer, reason: label }))
      recordPlan(reseam(sections, base))
      startReveal(sections.length)
    },

    setSeam: (i, move, bars) => {
      const p = get().plan
      if (!p) return
      const seams = p.seams.map((s, j) => (j === i ? { move, bars: bars ?? MOVES[move].bars, reason: 'chosen by you' } : s))
      recordPlan({ ...p, id: uid('plan'), seams })
    },

    undo: () => {
      const { past, plan, future } = get()
      const prev = past[past.length - 1]
      if (!prev) return
      set({ past: past.slice(0, -1), future: plan ? [plan, ...future] : future, plan: prev })
      rebuild(prev)
    },
    redo: () => {
      const { past, plan, future } = get()
      const next = future[0]
      if (!next) return
      set({ future: future.slice(1), past: plan ? [...past, plan] : past, plan: next })
      rebuild(next)
    },

    select: ({ section, seam }) =>
      set({ selectedSection: section === undefined ? get().selectedSection : section, selectedSeam: seam === undefined ? get().selectedSeam : seam }),

    play: async (from) => {
      const { timeline, master } = get()
      if (!timeline || !master) return
      const start = from ?? (get().position >= timeline.duration - 0.05 ? 0 : get().position)
      set({ preparing: 'Warping stems to the master grid…' })
      try {
        await session.prepare(timeline, master, (d, t) => t && set({ preparing: `Warping stems to ${master.bpm} BPM… ${d}/${t}` }))
        await session.play(timeline, master, start)
        set({ playing: true, position: start, preparing: null })
      } catch (e) {
        set({ preparing: null, toast: `Playback failed: ${e instanceof Error ? e.message : e}` })
      }
    },
    pause: () => {
      const pos = session.stop()
      set({ playing: false, position: pos })
    },
    seek: (t) => {
      const tl = get().timeline
      const pos = Math.max(0, Math.min(t, tl?.duration ?? 0))
      if (get().playing) void get().play(pos)
      else set({ position: pos })
    },
    tick: () => {
      if (!get().playing) return
      const pos = session.position()
      const dur = get().timeline?.duration ?? 0
      if (pos >= dur + 1.5) {
        session.stop()
        set({ playing: false, position: 0 })
      } else set({ position: pos })
    },

    exportMix: async () => {
      const { timeline, master } = get()
      const crate = activeCrate(get())
      if (!timeline || !master) return
      set({ exporting: true, preparing: 'Rendering mixdown…' })
      try {
        const blob = await session.exportWav(timeline, master)
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `smashup-${(crate?.name ?? 'mix').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.wav`
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 30000)
        set({ toast: 'Exported WAV' })
      } catch (e) {
        set({ toast: `Export failed: ${e instanceof Error ? e.message : e}` })
      } finally {
        set({ exporting: false, preparing: null })
      }
    },

    say: (toast) => set({ toast }),
  }
})

// Test/automation hook — lets e2e drive the store without UI flakiness.
if (typeof window !== 'undefined') Object.assign(window, { __smashup: useStore, __smashupSession: session })
