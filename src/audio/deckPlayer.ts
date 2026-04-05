import { getAudioContext, getGainNode, ensureResumed } from './mixer';

/**
 * Manages playback of a single deck using AudioBufferSourceNode.
 * Supports play, pause (via stop + resume offset), seek, volume, and playback rate.
 */
export class DeckPlayer {
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private volumeNode: GainNode;
  private _startedAt = 0; // audioContext.currentTime when playback started
  private _offset = 0; // where in the buffer we are
  private _playing = false;
  private _rate = 1;
  private _onEnded: (() => void) | null = null;

  constructor(deckId: 'A' | 'B') {
    const ac = getAudioContext();
    this.volumeNode = ac.createGain();
    this.volumeNode.connect(getGainNode(deckId));
  }

  setBuffer(buf: AudioBuffer) {
    this.stop();
    this.buffer = buf;
    this._offset = 0;
  }

  get playing() {
    return this._playing;
  }

  get currentTime(): number {
    if (!this._playing) return this._offset;
    const ac = getAudioContext();
    return this._offset + (ac.currentTime - this._startedAt) * this._rate;
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  set onEnded(fn: (() => void) | null) {
    this._onEnded = fn;
  }

  async play() {
    if (!this.buffer || this._playing) return;
    await ensureResumed();
    const ac = getAudioContext();
    this.source = ac.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.playbackRate.value = this._rate;
    this.source.connect(this.volumeNode);
    this.source.onended = () => {
      if (this._playing) {
        this._playing = false;
        this._offset = 0;
        this._onEnded?.();
      }
    };
    this.source.start(0, this._offset);
    this._startedAt = ac.currentTime;
    this._playing = true;
  }

  stop() {
    if (!this._playing || !this.source) {
      this._playing = false;
      return;
    }
    this._offset = this.currentTime;
    this._playing = false;
    try {
      this.source.onended = null;
      this.source.stop();
    } catch {
      // already stopped
    }
    this.source.disconnect();
    this.source = null;
  }

  /** Seek to a position in seconds */
  seek(time: number) {
    const wasPlaying = this._playing;
    this.stop();
    this._offset = Math.max(0, Math.min(time, this.duration));
    if (wasPlaying) this.play();
  }

  setVolume(v: number) {
    const now = getAudioContext().currentTime;
    this.volumeNode.gain.setTargetAtTime(v, now, 0.02);
  }

  setPlaybackRate(rate: number) {
    this._rate = rate;
    if (this.source) {
      this.source.playbackRate.value = rate;
    }
  }

  /** Schedule a gain ramp (for automix crossfade) */
  rampVolume(target: number, durationSec: number) {
    const now = getAudioContext().currentTime;
    this.volumeNode.gain.setValueAtTime(this.volumeNode.gain.value, now);
    this.volumeNode.gain.linearRampToValueAtTime(target, now + durationSec);
  }
}
