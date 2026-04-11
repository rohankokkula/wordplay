import { useRef, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

const STORAGE_KEY = 'wordplay_anon_playback_used';
const MAX_SECONDS = 1200; // 20 minutes

function readStored(): number {
  try {
    return parseFloat(sessionStorage.getItem(STORAGE_KEY) || '0') || 0;
  } catch {
    return 0;
  }
}

/**
 * Tracks cumulative playback time for anonymous users.
 * Premium users bypass the quota entirely.
 *
 * Call `tick(isPlaying)` on every animation frame or 1s interval.
 */
export function usePlaybackQuota() {
  const { mode } = useAuth();
  const [usedSeconds, setUsedSeconds] = useState(readStored);
  const [exceeded, setExceeded] = useState(() => mode === 'anonymous' && readStored() >= MAX_SECONDS);
  const lastTickRef = useRef<number>(0);
  const isPremium = mode === 'premium';

  const tick = useCallback(
    (isPlaying: boolean) => {
      if (isPremium) return;
      const now = performance.now();
      if (isPlaying && lastTickRef.current > 0) {
        const delta = (now - lastTickRef.current) / 1000;
        if (delta > 0 && delta < 2) {
          setUsedSeconds((prev) => {
            const next = prev + delta;
            try {
              sessionStorage.setItem(STORAGE_KEY, String(next));
            } catch { /* quota full */ }
            if (next >= MAX_SECONDS) setExceeded(true);
            return next;
          });
        }
      }
      lastTickRef.current = now;
    },
    [isPremium],
  );

  useEffect(() => {
    if (isPremium) {
      setExceeded(false);
    }
  }, [isPremium]);

  const remainingSeconds = Math.max(0, MAX_SECONDS - usedSeconds);
  const remainingMinutes = Math.ceil(remainingSeconds / 60);

  return { usedSeconds, remainingSeconds, remainingMinutes, exceeded, tick, isPremium };
}
