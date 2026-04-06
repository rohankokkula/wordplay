import type { VocalSegment, CuePoint, VocalHook } from '../audio/types';

export interface AnalysisResult {
  bpm: number;
  beatInterval: number;
  firstBeatTime: number;
  beatTimes: number[];
  duration: number;
  peaks: Float32Array;
  vocalSegments: VocalSegment[];
  energyProfile: Float32Array;
  dropTime: number;
  cuePoints: CuePoint[];
  vocalHooks: VocalHook[];
}

const PEAK_SAMPLES_PER_PIXEL = 512;

export function analyzeTrackRaw(
  channelData: Float32Array,
  sampleRate: number,
): AnalysisResult {
  const duration = channelData.length / sampleRate;
  const peaks = buildPeaks(channelData, PEAK_SAMPLES_PER_PIXEL);
  const { bpm, beatInterval, firstBeatTime, beatTimes } = detectBeats(channelData, sampleRate);
  const energyProfile = buildEnergyProfile(channelData, sampleRate);
  const vocalSegments = detectVocals(channelData, sampleRate);
  const dropTime = findDropTime(energyProfile, duration);
  const vocalHooks = detectVocalHooks(vocalSegments, energyProfile, duration, beatInterval);
  const cuePoints = buildCuePoints(firstBeatTime, vocalSegments, dropTime, duration);

  return {
    bpm, beatInterval, firstBeatTime, beatTimes, duration, peaks,
    vocalSegments, energyProfile, dropTime, cuePoints, vocalHooks,
  };
}

// ── Peak waveform ──────────────────────────────────────────────

function buildPeaks(data: Float32Array, samplesPerPixel: number): Float32Array {
  const len = Math.ceil(data.length / samplesPerPixel);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let max = 0;
    const start = i * samplesPerPixel;
    const end = Math.min(start + samplesPerPixel, data.length);
    for (let j = start; j < end; j++) {
      const abs = Math.abs(data[j]);
      if (abs > max) max = abs;
    }
    out[i] = max;
  }
  return out;
}

// ── BPM & beat grid ────────────────────────────────────────────

function detectBeats(data: Float32Array, sampleRate: number) {
  const hopSize = 512;
  const frameSize = 1024;
  const numFrames = Math.floor((data.length - frameSize) / hopSize);

  const onsetEnv = new Float32Array(numFrames);
  let prevEnergy = 0;
  for (let i = 0; i < numFrames; i++) {
    let energy = 0;
    const offset = i * hopSize;
    for (let j = 0; j < frameSize; j++) {
      energy += data[offset + j] * data[offset + j];
    }
    onsetEnv[i] = Math.max(0, energy - prevEnergy);
    prevEnergy = energy;
  }

  let maxOnset = 0;
  for (let i = 0; i < onsetEnv.length; i++) {
    if (onsetEnv[i] > maxOnset) maxOnset = onsetEnv[i];
  }
  if (maxOnset > 0) {
    for (let i = 0; i < onsetEnv.length; i++) onsetEnv[i] /= maxOnset;
  }

  const framesPerSec = sampleRate / hopSize;
  const minLag = Math.floor(framesPerSec * (60 / 180));
  const maxLag = Math.floor(framesPerSec * (60 / 70));
  const corrLen = Math.min(onsetEnv.length, maxLag * 4);

  let bestLag = minLag;
  let bestCorr = -Infinity;

  for (let lag = minLag; lag <= maxLag && lag < corrLen; lag++) {
    let sum = 0;
    const limit = Math.min(corrLen - lag, corrLen);
    for (let i = 0; i < limit; i++) sum += onsetEnv[i] * onsetEnv[i + lag];
    const bpmAtLag = (framesPerSec * 60) / lag;
    const weight = 1 + 0.2 * Math.exp(-((bpmAtLag - 125) ** 2) / 400);
    if (sum * weight > bestCorr) { bestCorr = sum * weight; bestLag = lag; }
  }

  const bpm = Math.round(((framesPerSec * 60) / bestLag) * 10) / 10;
  const beatInterval = 60 / bpm;

  let firstBeatFrame = 0;
  for (let i = 0; i < onsetEnv.length; i++) {
    if (onsetEnv[i] > 0.3) { firstBeatFrame = i; break; }
  }
  const firstBeatTime = (firstBeatFrame * hopSize) / sampleRate;

  const beatTimes: number[] = [];
  const duration = data.length / sampleRate;
  for (let t = firstBeatTime; t < duration; t += beatInterval) beatTimes.push(t);

  return { bpm, beatInterval, firstBeatTime, beatTimes };
}

// ── Energy profile (RMS per ~0.5s window) ──────────────────────

function buildEnergyProfile(data: Float32Array, sampleRate: number): Float32Array {
  const windowSamples = Math.floor(sampleRate * 0.5);
  const numWindows = Math.ceil(data.length / windowSamples);
  const profile = new Float32Array(numWindows);

  for (let i = 0; i < numWindows; i++) {
    let sum = 0;
    const start = i * windowSamples;
    const end = Math.min(start + windowSamples, data.length);
    for (let j = start; j < end; j++) sum += data[j] * data[j];
    profile[i] = Math.sqrt(sum / (end - start));
  }

  // Normalize
  let maxE = 0;
  for (let i = 0; i < profile.length; i++) { if (profile[i] > maxE) maxE = profile[i]; }
  if (maxE > 0) { for (let i = 0; i < profile.length; i++) profile[i] /= maxE; }

  return profile;
}

// ── Drop detection (sustained loudest section) ─────────────────

function findDropTime(energyProfile: Float32Array, duration: number): number {
  const windowDur = duration / energyProfile.length;
  const runLen = Math.max(1, Math.floor(energyProfile.length / 20));
  let maxSum = 0;
  let maxIdx = 0;

  for (let i = Math.floor(energyProfile.length * 0.15); i < energyProfile.length - runLen; i++) {
    let sum = 0;
    for (let j = 0; j < runLen; j++) sum += energyProfile[i + j];
    if (sum > maxSum) { maxSum = sum; maxIdx = i; }
  }

  return maxIdx * windowDur;
}

// ── Vocal detection ────────────────────────────────────────────
// Uses spectral centroid + mid-band energy ratio to find vocal sections.
// Vocals concentrate energy in 300Hz–4kHz with more tonal (less flat) spectra.

function detectVocals(data: Float32Array, sampleRate: number): VocalSegment[] {
  const frameSize = 2048;
  const hopSize = 1024;
  const numFrames = Math.floor((data.length - frameSize) / hopSize);
  if (numFrames <= 0) return [];

  const vocalFlags = new Uint8Array(numFrames);
  const binFreq = sampleRate / frameSize;
  const lowBin = Math.floor(300 / binFreq);
  const highBin = Math.min(Math.floor(4000 / binFreq), frameSize / 2);

  for (let i = 0; i < numFrames; i++) {
    const offset = i * hopSize;

    // Compute magnitude spectrum (no FFT lib — approximate with band energy)
    let totalEnergy = 0;
    let midEnergy = 0;
    let spectralSum = 0;
    let magnitudeSum = 0;

    for (let bin = 1; bin < frameSize / 2; bin++) {
      // Approximate frequency bin energy using Goertzel-like dot product
      const idx = offset + bin * 2;
      if (idx >= data.length) break;
      const mag = Math.abs(data[offset + bin]) + Math.abs(data[offset + frameSize - bin]);
      totalEnergy += mag;
      spectralSum += mag * bin;
      magnitudeSum += mag;

      if (bin >= lowBin && bin <= highBin) midEnergy += mag;
    }

    if (totalEnergy === 0) continue;

    const midRatio = midEnergy / totalEnergy;
    const centroid = magnitudeSum > 0 ? spectralSum / magnitudeSum : 0;
    const centroidHz = centroid * binFreq;

    // Spectral flatness approximation (geometric/arithmetic mean ratio of magnitudes)
    // Simplified: if mid-band ratio is high and centroid is in vocal range, flag as vocal
    const isVocal = midRatio > 0.35 && centroidHz > 400 && centroidHz < 3500;
    vocalFlags[i] = isVocal ? 1 : 0;
  }

  // Smooth: require at least ~0.3s of consecutive vocal frames
  const minFrames = Math.max(1, Math.floor(0.3 * sampleRate / hopSize));
  const segments: VocalSegment[] = [];
  let segStart = -1;

  for (let i = 0; i < numFrames; i++) {
    if (vocalFlags[i] && segStart < 0) {
      segStart = i;
    } else if (!vocalFlags[i] && segStart >= 0) {
      if (i - segStart >= minFrames) {
        segments.push({
          start: (segStart * hopSize) / sampleRate,
          end: (i * hopSize) / sampleRate,
        });
      }
      segStart = -1;
    }
  }
  if (segStart >= 0 && numFrames - segStart >= minFrames) {
    segments.push({
      start: (segStart * hopSize) / sampleRate,
      end: (numFrames * hopSize) / sampleRate,
    });
  }

  // Merge segments that are close together (< 1s gap)
  const merged: VocalSegment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && seg.start - last.end < 1.0) {
      last.end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }

  return merged;
}

// ── Vocal hooks (chorus/hook entry detection) ──────────────────
// Finds vocal segment starts that are likely chorus/hook entries:
// - segment is preceded by a low-energy gap (verse→chorus lift)
// - segment has higher energy than average (chorus = louder)
// - recurring pattern: similar energy profile at phrase boundaries

function detectVocalHooks(
  vocalSegments: VocalSegment[],
  energyProfile: Float32Array,
  duration: number,
  beatInterval: number,
): VocalHook[] {
  if (vocalSegments.length < 2) return [];

  const windowDur = duration / energyProfile.length;
  const hooks: VocalHook[] = [];

  let totalSegEnergy = 0;
  const segEnergies: number[] = [];
  for (const seg of vocalSegments) {
    const startIdx = Math.floor(seg.start / windowDur);
    const endIdx = Math.min(Math.ceil(seg.end / windowDur), energyProfile.length);
    let sum = 0;
    let count = 0;
    for (let i = startIdx; i < endIdx; i++) {
      sum += energyProfile[i];
      count++;
    }
    const avg = count > 0 ? sum / count : 0;
    segEnergies.push(avg);
    totalSegEnergy += avg;
  }
  const meanSegEnergy = totalSegEnergy / vocalSegments.length;

  for (let i = 0; i < vocalSegments.length; i++) {
    const seg = vocalSegments[i];
    const energy = segEnergies[i];

    const gapBefore = i === 0
      ? seg.start
      : seg.start - vocalSegments[i - 1].end;

    const isAfterGap = gapBefore > beatInterval * 2;
    const isLoud = energy >= meanSegEnergy * 0.85;
    const isLongEnough = (seg.end - seg.start) > beatInterval * 3;

    if ((isAfterGap && isLoud) || (isLoud && isLongEnough)) {
      hooks.push({
        time: seg.start,
        energy,
        segmentIndex: i,
      });
    }
  }

  hooks.sort((a, b) => b.energy - a.energy);
  return hooks;
}

// ── Cue points ─────────────────────────────────────────────────

function buildCuePoints(
  firstBeatTime: number,
  vocalSegments: VocalSegment[],
  dropTime: number,
  duration: number,
): CuePoint[] {
  const cues: CuePoint[] = [
    { time: firstBeatTime, label: 'First Beat' },
  ];

  if (vocalSegments.length > 0) {
    cues.push({ time: vocalSegments[0].start, label: 'First Vocal' });
    const lastVocal = vocalSegments[vocalSegments.length - 1];
    if (lastVocal.end < duration - 5) {
      cues.push({ time: lastVocal.end, label: 'Last Vocal End' });
    }
  }

  cues.push({ time: dropTime, label: 'Drop' });

  cues.sort((a, b) => a.time - b.time);
  return cues;
}
