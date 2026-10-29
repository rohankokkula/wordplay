declare module 'signalsmith-stretch' {
  export interface StretchNode extends AudioWorkletNode {
    inputTime: number
    schedule(opts: {
      output?: number
      active?: boolean
      input?: number
      rate?: number
      semitones?: number
      tonalityHz?: number
      formantCompensation?: boolean
      loopStart?: number
      loopEnd?: number
    }): Promise<void>
    start(when?: number, offset?: number, duration?: number, rate?: number, semitones?: number): Promise<void>
    stop(when?: number): Promise<void>
    addBuffers(buffers: Float32Array[]): Promise<number>
    dropBuffers(toSeconds?: number): Promise<unknown>
    latency(): number
    configure(opts: { blockMs?: number | null; intervalMs?: number; splitComputation?: boolean; preset?: string }): Promise<void>
  }
  export default function SignalsmithStretch(ctx: BaseAudioContext, options?: AudioWorkletNodeOptions): Promise<StretchNode>
}
