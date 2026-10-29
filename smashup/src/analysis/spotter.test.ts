import { beforeAll, describe, expect, it } from 'vitest'
import { DEMO_SONGS, renderDemoSong, type DemoSong } from '@/demo/synth'
import { AUTO_ACCEPT, spot } from './spotter'

describe('mark one, find all', () => {
  let songs: DemoSong[] = []
  let truth: number[][] = []
  beforeAll(async () => {
    songs = await Promise.all(DEMO_SONGS.map((s, i) => renderDemoSong(s, 1000 + i * 17)))
    truth = songs.map((s) => s.words.filter((w) => w.w === 'paisa').map((w) => w.start))
  }, 60000)

  const score = (res: { time: number; score: number }[][], minScore = 0) => {
    let tp = 0
    let fp = 0
    let total = 0
    res.forEach((cands, i) => {
      const kept = cands.filter((c) => c.score >= minScore)
      total += truth[i].length
      tp += truth[i].filter((t) => kept.some((c) => Math.abs(c.time - t) < 0.06)).length
      fp += kept.filter((c) => !truth[i].some((t) => Math.abs(c.time - t) < 0.06)).length
    })
    return { recall: tp / total, precision: tp / Math.max(1, tp + fp) }
  }

  it('finds the word across every song from one marked example (vocal stems)', () => {
    const seed = truth[0][0]
    const res = spot(songs.map((s) => ({ pcm: s.stems.vocals, sr: s.sampleRate })), [{ songIndex: 0, start: seed, end: seed + 0.5 }])
    const r = score(res)
    expect(r.recall).toBeGreaterThan(0.75)
    expect(r.precision).toBeGreaterThan(0.95)
  }, 60000)

  it('works on full mixes; auto-accepted matches stay precise', () => {
    const seed = truth[0][0]
    const res = spot(songs.map((s) => ({ pcm: s.full, sr: s.sampleRate })), [{ songIndex: 0, start: seed, end: seed + 0.5 }])
    expect(score(res).recall).toBeGreaterThan(0.8)
    const accepted = score(res, AUTO_ACCEPT)
    expect(accepted.precision).toBeGreaterThan(0.9)
    expect(accepted.recall).toBeGreaterThan(0.55)
  }, 60000)
})
