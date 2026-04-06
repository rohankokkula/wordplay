import { getAudioContext, getSfxInput, ensureResumed } from './mixer';

import discSfxUrl from '../assets/soundreality-re-verse-dj-fx-344132.mp3?url';

let cachedBuffer: AudioBuffer | null = null;
let loadPromise: Promise<AudioBuffer> | null = null;

async function getDiscSfxBuffer(): Promise<AudioBuffer> {
  if (cachedBuffer) return cachedBuffer;
  if (!loadPromise) {
    loadPromise = (async () => {
      const ctx = getAudioContext();
      const res = await fetch(discSfxUrl);
      const raw = await res.arrayBuffer();
      const copy = raw.slice(0);
      cachedBuffer = await ctx.decodeAudioData(copy);
      return cachedBuffer;
    })();
  }
  return loadPromise;
}

/** Same disc FX one-shot for start and stop (tap disc). */
export async function playDiscSfx(): Promise<void> {
  await ensureResumed();
  const ctx = getAudioContext();
  let buf: AudioBuffer;
  try {
    buf = await getDiscSfxBuffer();
  } catch {
    return;
  }

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = 0.82;
  const t0 = ctx.currentTime;
  src.connect(g);
  g.connect(getSfxInput());
  src.start(t0);
}
