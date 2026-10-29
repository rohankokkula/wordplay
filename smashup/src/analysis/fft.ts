/** Minimal iterative radix-2 FFT with cached tables (real input, magnitude output). */

export class FFT {
  readonly n: number
  private rev: Uint32Array
  private cos: Float32Array
  private sin: Float32Array
  private re: Float32Array
  private im: Float32Array
  readonly window: Float32Array

  constructor(n: number) {
    if ((n & (n - 1)) !== 0) throw new Error('FFT size must be a power of two')
    this.n = n
    this.rev = new Uint32Array(n)
    const bits = Math.log2(n)
    for (let i = 0; i < n; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
      this.rev[i] = r
    }
    this.cos = new Float32Array(n / 2)
    this.sin = new Float32Array(n / 2)
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / n)
      this.sin[i] = Math.sin((-2 * Math.PI * i) / n)
    }
    this.re = new Float32Array(n)
    this.im = new Float32Array(n)
    this.window = new Float32Array(n)
    for (let i = 0; i < n; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
  }

  /** Hann-windowed magnitude spectrum of `input[offset … offset+n)` into `out` (length n/2). */
  magnitudes(input: Float32Array, offset: number, out: Float32Array): void {
    const { n, re, im, rev, window } = this
    for (let i = 0; i < n; i++) {
      const j = offset + i
      re[rev[i]] = (j < input.length ? input[j] : 0) * window[i]
      im[rev[i]] = 0
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1
      const step = n / size
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const tw = k * step
          const wr = this.cos[tw]
          const wi = this.sin[tw]
          const a = start + k
          const b = a + half
          const tr = wr * re[b] - wi * im[b]
          const ti = wr * im[b] + wi * re[b]
          re[b] = re[a] - tr
          im[b] = im[a] - ti
          re[a] += tr
          im[a] += ti
        }
      }
    }
    for (let i = 0; i < n / 2; i++) out[i] = Math.hypot(re[i], im[i])
  }
}
