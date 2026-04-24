/**
 * Offline render: take a `MixGraph` + decoded stem buffers and bounce the
 * scheduled playback to a single `AudioBuffer`. Used when the user clicks
 * "Publish" — we encode the result to WAV and POST it to
 * /api/community/publish along with `graph_json` so others can fork.
 *
 * We reuse the same clip ordering logic as `MixScheduler` so what you hear
 * during preview is what actually gets rendered.
 */
import type { MixGraph, SplitNode, InstrumentNode as InstrumentNodeT, FXEdge } from './types'
import { getInstrumentBuffer, INSTRUMENT_BEDS } from './instruments'

interface Stem {
  vocals: AudioBuffer
  instruments: AudioBuffer
}

export async function renderMix(
  graph: MixGraph,
  stems: Record<'A' | 'B', Stem>,
  opts: { sampleRate?: number } = {},
): Promise<AudioBuffer> {
  const sampleRate = opts.sampleRate ?? 48000
  const splitNodes = graph.nodes.filter((n): n is SplitNode => n.kind === 'split')
  const instruments = graph.nodes.filter((n): n is InstrumentNodeT => n.kind === 'instrument')
  const activeEdges: FXEdge[] = graph.edges.filter((e) => !e.suggested)

  // Replay the scheduler's traversal for consistency.
  const order: SplitNode[] = []
  if (activeEdges.length === 0) {
    order.push(...splitNodes)
  } else {
    const incoming = new Set(activeEdges.map((e) => e.target))
    const next = new Map(activeEdges.map((e) => [e.source, e.target]))
    const entries = splitNodes.filter((n) => !incoming.has(n.id))
    const visited = new Set<string>()
    for (const start of entries.length ? entries : splitNodes) {
      let cur: SplitNode | undefined = start
      while (cur && !visited.has(cur.id)) {
        visited.add(cur.id)
        order.push(cur)
        const nx = next.get(cur.id)
        cur = nx ? splitNodes.find((s) => s.id === nx) : undefined
      }
    }
  }

  const secPerBeat = 60 / Math.max(1, graph.masterBpm)
  let tCursor = 0.1
  const clips: Array<{ split: SplitNode['split']; startAt: number }> = []
  for (let i = 0; i < order.length; i++) {
    const n = order[i]
    const dur = Math.max(0.05, n.split.end - n.split.start)
    clips.push({ split: n.split, startAt: tCursor })
    const outEdge = activeEdges.find((e) => e.source === n.id)
    const overlap = outEdge ? Math.min(dur * 0.5, secPerBeat * outEdge.blendBeats) : 0
    tCursor += dur - overlap
  }

  const totalDuration = Math.max(1, tCursor + 0.5)
  const offline = new OfflineAudioContext(2, Math.floor(totalDuration * sampleRate), sampleRate)
  const master = offline.createGain()
  master.gain.value = 0.9
  master.connect(offline.destination)

  for (const clip of clips) {
    const bufs = clip.split.stem === 'both'
      ? [stems[clip.split.deck].vocals, stems[clip.split.deck].instruments]
      : clip.split.stem === 'vocals'
        ? [stems[clip.split.deck].vocals]
        : [stems[clip.split.deck].instruments]
    for (const buf of bufs) {
      const src = offline.createBufferSource()
      src.buffer = buf
      src.connect(master)
      const dur = Math.max(0.05, clip.split.end - clip.split.start)
      try {
        src.start(clip.startAt, clip.split.start, dur)
      } catch {
        /* noop */
      }
    }
  }

  if (instruments.length && clips.length) {
    const start = clips[0].startAt
    const end = clips[clips.length - 1].startAt +
      (order[clips.length - 1]?.split.end - order[clips.length - 1]?.split.start || 0.05)
    for (const node of instruments) {
      const bed = INSTRUMENT_BEDS.find((b) => b.id === node.instrument)
      if (!bed) continue
      const bedBuf = await getInstrumentBuffer(node.instrument)
      const src = offline.createBufferSource()
      src.buffer = bedBuf
      src.loop = true
      src.playbackRate.value = graph.masterBpm / bed.nativeBpm
      const g = offline.createGain()
      g.gain.value = node.gain * 0.8
      src.connect(g)
      g.connect(master)
      try {
        src.start(start)
        src.stop(end + 0.25)
      } catch {
        /* noop */
      }
    }
  }

  return await offline.startRendering()
}

/** Encode an AudioBuffer to a 16-bit PCM WAV Blob (mono/stereo). */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const bytesPerSample = 2
  const length = buffer.length
  const dataSize = length * numChannels * bytesPerSample
  const bufferSize = 44 + dataSize
  const ab = new ArrayBuffer(bufferSize)
  const view = new DataView(ab)

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, bufferSize - 8, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true)
  view.setUint16(32, numChannels * bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  const channels: Float32Array[] = []
  for (let ch = 0; ch < numChannels; ch++) channels.push(buffer.getChannelData(ch))

  let offset = 44
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let sample = Math.max(-1, Math.min(1, channels[ch][i]))
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff
      view.setInt16(offset, sample, true)
      offset += 2
    }
  }

  return new Blob([ab], { type: 'audio/wav' })
}

/** Extract a waveform-peaks array suitable for storing in post.waveform_json. */
export function extractPeaks(buffer: AudioBuffer, numPeaks = 256): number[] {
  const channel = buffer.getChannelData(0)
  const bucketSize = Math.max(1, Math.floor(channel.length / numPeaks))
  const peaks: number[] = []
  for (let i = 0; i < numPeaks; i++) {
    let max = 0
    const start = i * bucketSize
    const end = Math.min(channel.length, start + bucketSize)
    for (let j = start; j < end; j++) {
      const v = Math.abs(channel[j])
      if (v > max) max = v
    }
    peaks.push(Math.round(max * 1000) / 1000)
  }
  return peaks
}
