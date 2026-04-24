import { getAudioContext, getStemBus } from '../../audio/mixer'
import { useSnippetStore } from './snippetStore'
import type { Snippet } from './types'
import type { DeckSource } from './masterScheduler'

type Active = { src: AudioBufferSourceNode; gain: GainNode }

let active: Active | null = null
let endTimer: number | null = null
let progressRaf: number | null = null

function setPreviewingId(id: string | null): void {
  useSnippetStore.getState().setPreviewingSnippetId(id)
}

function stopProgressRaf() {
  if (progressRaf != null) {
    cancelAnimationFrame(progressRaf)
    progressRaf = null
  }
}

function startPreviewProgressRaf(tAudioStart: number, playLenSec: number) {
  stopProgressRaf()
  const tick = () => {
    const ac = getAudioContext()
    const elapsed = ac.currentTime - tAudioStart
    const p = Math.min(1, Math.max(0, elapsed / playLenSec))
    useSnippetStore.getState().setPreviewProgress01(p)
    if (p >= 0.999) {
      stopProgressRaf()
      return
    }
    progressRaf = requestAnimationFrame(tick)
  }
  progressRaf = requestAnimationFrame(tick)
}

/**
 * Stops the current snippet-only preview (single BufferSource to stem bus).
 */
export function stopSnippetPreview(): void {
  if (endTimer != null) {
    clearTimeout(endTimer)
    endTimer = null
  }
  if (!active) {
    stopProgressRaf()
    setPreviewingId(null)
    return
  }
  const { src, gain } = active
  const ac = getAudioContext()
  try {
    gain.gain.cancelScheduledValues(ac.currentTime)
    gain.gain.setValueAtTime(0, ac.currentTime)
    src.stop()
  } catch {
    /* already stopped */
  }
  active = null
  stopProgressRaf()
  setPreviewingId(null)
}

/**
 * Plays a snippet time window through the same stem bus as the master chain.
 * Uses separated stem if available, else the full-mix buffer (see `DeckSource`).
 */
export function playSnippetPreview(
  snippet: Snippet,
  source: DeckSource | null | undefined,
  onEnd?: () => void,
): void {
  stopSnippetPreview()
  if (!source) return
  const ac = getAudioContext()
  if (ac.state === 'suspended') void ac.resume()
  const stemBuf = snippet.stem === 'vocals' ? source.stems?.vocals : source.stems?.instruments
  const buffer = stemBuf ?? source.full ?? null
  if (!buffer) return

  const length = Math.max(0.1, snippet.endSec - snippet.startSec)
  const offset = Math.max(0, Math.min(snippet.startSec, buffer.duration - 0.05))
  const playLen = Math.max(0.1, Math.min(length, buffer.duration - offset))

  setPreviewingId(snippet.id)

  const srcNode = ac.createBufferSource()
  srcNode.buffer = buffer
  const gain = ac.createGain()
  const t0 = ac.currentTime + 0.02
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(1, t0 + 0.04)
  gain.gain.setValueAtTime(1, t0 + playLen - 0.04)
  gain.gain.linearRampToValueAtTime(0, t0 + playLen)

  const busKey: 'vocalsA' | 'instrumentsA' | 'vocalsB' | 'instrumentsB' =
    `${snippet.stem}${snippet.deck}` as 'vocalsA' | 'instrumentsA' | 'vocalsB' | 'instrumentsB'
  const bus = getStemBus(busKey)
  srcNode.connect(gain).connect(bus)

  let done = false
  const onFinish = () => {
    if (done) return
    done = true
    if (endTimer != null) {
      clearTimeout(endTimer)
      endTimer = null
    }
    stopProgressRaf()
    if (active?.src === srcNode) {
      active = null
    }
    setPreviewingId(null)
    onEnd?.()
  }
  srcNode.onended = onFinish
  // Fallback in case onended is flaky in some browsers
  endTimer = window.setTimeout(onFinish, (playLen + 0.2) * 1000)

  srcNode.start(t0, offset, playLen)
  active = { src: srcNode, gain }
  startPreviewProgressRaf(t0, playLen)
}
