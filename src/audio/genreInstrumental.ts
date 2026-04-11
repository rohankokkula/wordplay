import { getAudioContext, ensureResumed } from './mixer';
import { getFXChain } from './effects';
import { apiUrl } from '../apiBase';
import type { GenreId } from '../genre/genrePresets';
import { GENRE_PRESETS } from '../genre/genrePresets';

/**
 * Plays a real genre instrumental bed track.
 * Routes directly into the FX chain input (same bus as music + beat layer)
 * so it gets filter sweeps and EQ, but has its own independent gain control.
 */
export class GenreInstrumentalPlayer {
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gainNode: GainNode;
  private _playing = false;
  private _startedAt = 0;
  private _offset = 0;
  private _rate = 1;
  private _loaded = false;
  private _loading = false;
  private _genreId: GenreId = 'neutral';

  constructor() {
    const ac = getAudioContext();
    this.gainNode = ac.createGain();
    this.gainNode.gain.value = 0;
    this.gainNode.connect(getFXChain().input);
  }

  get loaded() { return this._loaded; }
  get loading() { return this._loading; }
  get playing() { return this._playing; }

  get currentTime(): number {
    if (!this._playing) return this._offset;
    const ac = getAudioContext();
    return this._offset + (ac.currentTime - this._startedAt) * this._rate;
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  async loadForGenre(genreId: GenreId): Promise<boolean> {
    const preset = GENRE_PRESETS[genreId];
    if (!preset.instrumentalUrl && !preset.instrumentalPlaylistUrl) {
      this._loaded = false;
      this._genreId = genreId;
      return false;
    }

    if (this._genreId === genreId && this._loaded) return true;

    this.stop();
    this._genreId = genreId;
    this._loading = true;

    try {
      const payload: Record<string, string> = { genre_id: genreId };
      if (preset.instrumentalPlaylistUrl) {
        payload.playlist_url = preset.instrumentalPlaylistUrl;
      }
      if (preset.instrumentalUrl) {
        payload.url = preset.instrumentalUrl;
      }

      const res = await fetch(apiUrl('/api/genre/instrumental'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.warn(`[genreInstrumental] Failed to load ${genreId}: ${res.status}`);
        this._loading = false;
        return false;
      }

      const ab = await res.arrayBuffer();
      const ac = getAudioContext();
      this.buffer = await ac.decodeAudioData(ab);
      this._loaded = true;
      this._offset = 0;
      console.log(`[genreInstrumental] Loaded ${genreId} instrumental: ${this.buffer.duration.toFixed(1)}s`);
      return true;
    } catch (e) {
      console.warn(`[genreInstrumental] Error loading ${genreId}:`, e);
      this._loaded = false;
      return false;
    } finally {
      this._loading = false;
    }
  }

  async play(startOffset = 0) {
    if (!this.buffer || this._playing) return;
    await ensureResumed();
    const ac = getAudioContext();
    this.source = ac.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.playbackRate.value = this._rate;
    this.source.loop = true;
    this.source.connect(this.gainNode);
    this._offset = Math.max(0, Math.min(startOffset, this.buffer.duration - 0.1));
    this.source.start(0, this._offset);
    this._startedAt = ac.currentTime;
    this._playing = true;
  }

  stop() {
    if (!this._playing || !this.source) {
      this._playing = false;
      return;
    }
    this._offset = this.currentTime % (this.buffer?.duration ?? 1);
    this._playing = false;
    try {
      this.source.stop();
    } catch { /* already stopped */ }
    this.source.disconnect();
    this.source = null;
  }

  setVolume(v: number, rampSec = 0.05) {
    const now = getAudioContext().currentTime;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
    this.gainNode.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, v)), now + rampSec);
  }

  setPlaybackRate(rate: number) {
    this._rate = rate;
    if (this.source) {
      this.source.playbackRate.value = rate;
    }
  }

  rampVolume(target: number, durationSec: number) {
    const now = getAudioContext().currentTime;
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
    this.gainNode.gain.linearRampToValueAtTime(target, now + durationSec);
  }

  disconnect() {
    this.stop();
    try { this.gainNode.disconnect(); } catch { /* ok */ }
  }
}
