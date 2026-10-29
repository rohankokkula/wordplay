/** Demo crate sources: render synthetic songs to WAV blobs (memory only, regenerable). */

import type { StemName } from '@/model/types'
import { STEM_NAMES } from '@/model/types'
import { encodeWav } from '@/engine/wav'
import { putMemBlob } from '@/store/persist'
import type { SongSource } from '@/analysis/pipeline'
import { DEMO_SONGS, renderDemoSong, type DemoSpec } from './synth'

export { DEMO_SONGS }

export const demoHash = (slug: string) => `demo-${slug}-v1`

export async function renderDemoSource(spec: DemoSpec, index: number): Promise<SongSource> {
  const song = await renderDemoSong(spec, 1000 + index * 17)
  const hash = demoHash(spec.slug)
  const stems: Partial<Record<StemName, Blob>> = {}
  for (const s of STEM_NAMES) stems[s] = encodeWav([song.stems[s]], song.sampleRate)
  const blob = encodeWav([song.full], song.sampleRate)
  putMemBlob(`${hash}:full`, blob)
  for (const s of STEM_NAMES) putMemBlob(`${hash}:${s}`, stems[s]!)
  return { blob, fileName: `${spec.slug}.wav`, hash, sidecarWords: song.words, stems }
}

/** Regenerate a demo song's blobs after a reload (they are not persisted). */
export async function ensureDemoBlobs(hash: string): Promise<boolean> {
  const idx = DEMO_SONGS.findIndex((s) => demoHash(s.slug) === hash)
  if (idx < 0) return false
  await renderDemoSource(DEMO_SONGS[idx], idx)
  return true
}
