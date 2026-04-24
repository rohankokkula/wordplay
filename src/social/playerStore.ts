/**
 * Global player store for the persistent bottom-bar. When a user hits play
 * on a MixCard, we set the current track here; BottomPlayer renders a single
 * <audio> element so navigating between Feed / Profile / Post pages never
 * interrupts playback.
 */
import { create } from 'zustand'

export interface NowPlaying {
  postId: string
  slug: string
  title: string
  author: string
  handle: string
  coverUrl: string | null
  audioUrl: string
  duration: number
  /** layoutId used by motion shared-element morph. */
  layoutId?: string
}

interface PlayerState {
  current: NowPlaying | null
  playing: boolean
  progress: number
  duration: number
  play: (track: NowPlaying) => void
  togglePlay: () => void
  setProgress: (sec: number) => void
  setDuration: (sec: number) => void
  close: () => void
}

export const usePlayer = create<PlayerState>((set) => ({
  current: null,
  playing: false,
  progress: 0,
  duration: 0,
  play: (track) => set({ current: track, playing: true, progress: 0 }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  setProgress: (sec) => set({ progress: sec }),
  setDuration: (sec) => set({ duration: sec }),
  close: () => set({ current: null, playing: false, progress: 0 }),
}))
