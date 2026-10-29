import type { Lane } from '@/model/types'

const SONG_HUES = ['#ff5c8a', '#ffb020', '#22d3ee', '#8b5cf6', '#2ee59d', '#f97316', '#60a5fa', '#e879f9']

export function songColor(index: number): string {
  return SONG_HUES[((index % SONG_HUES.length) + SONG_HUES.length) % SONG_HUES.length]
}

export const LANE_COLOR: Record<Lane, string> = {
  vox: 'var(--color-vox)',
  drums: 'var(--color-drums)',
  bass: 'var(--color-bass)',
  music: 'var(--color-music)',
  full: '#9ca3af',
}

export const LANE_LABEL: Record<Lane, string> = { vox: 'Vox', drums: 'Drums', bass: 'Bass', music: 'Music', full: 'Mix' }

export function fmtTime(sec: number): string {
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  const r = s - m * 60
  return `${m}:${r.toFixed(1).padStart(4, '0')}`
}
