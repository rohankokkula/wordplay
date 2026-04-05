import type { TrackAnalysis } from '../audio/types';
import type { AnalysisResult } from './analyzeCore';
import AnalyzeWorker from './analyzeWorker?worker';

/**
 * Analyze an AudioBuffer in a Web Worker so the UI stays responsive.
 * Falls back to main-thread analysis if workers are unavailable.
 */
export function analyzeTrackAsync(
  buffer: AudioBuffer,
): Promise<TrackAnalysis> {
  return new Promise((resolve, reject) => {
    try {
      const worker = new AnalyzeWorker();
      const channelData = buffer.getChannelData(0);
      // Copy the channel data so we can transfer it
      const copy = new Float32Array(channelData.length);
      copy.set(channelData);

      worker.onmessage = (e: MessageEvent<AnalysisResult>) => {
        worker.terminate();
        resolve(e.data);
      };

      worker.onerror = (err) => {
        worker.terminate();
        reject(err);
      };

      worker.postMessage(
        { channelData: copy, sampleRate: buffer.sampleRate },
        [copy.buffer],
      );
    } catch {
      // Fallback: run on main thread
      import('./analyzeCore').then(({ analyzeTrackRaw }) => {
        resolve(analyzeTrackRaw(buffer.getChannelData(0), buffer.sampleRate));
      });
    }
  });
}
