import { analyzeTrackRaw } from './analyzeCore';

declare const self: Worker;

self.onmessage = (e: MessageEvent) => {
  const { channelData, sampleRate } = e.data as {
    channelData: Float32Array;
    sampleRate: number;
  };

  const result = analyzeTrackRaw(channelData, sampleRate);

  self.postMessage(
    result,
    [result.peaks.buffer, result.energyProfile.buffer] as unknown as StructuredSerializeOptions[],
  );
};
