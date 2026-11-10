// Which waves a model has learned: a tapered Fourier amplitude per frequency k (the
// k of sin(kx), so sin(x) + 0.5 sin(2x) peaks at 1 for k = 1 and 0.5 for k = 2).
// The points may have gaps (only the parts inside the data are used for a model's
// error); a Tukey taper over the whole stretch (cosine edges over the outer quarter
// on each side) keeps neighbouring waves apart when there are only a few periods.
// Applied to the residual (prediction - target) inside the data, it shows which
// waves are still missing; networks usually get the slow ones first.
import { cos, PI, sin } from '@xtraplaytion/dmath';

/** Tukey window with alpha 0.5 on t in [0, 1]. */
function taper(t: number): number {
  const e = Math.min(t, 1 - t);
  if (e <= 0) return 0;
  return e >= 0.25 ? 1 : 0.5 - 0.5 * cos(4 * PI * e);
}

export class WaveBasis {
  readonly ks: Float64Array;
  readonly xs: Float64Array;
  private readonly c: Float64Array; // ks x n, already multiplied by the taper
  private readonly s: Float64Array;
  private readonly w: Float64Array;

  /** `xs` sorted; the taper spans `range` (default: from the first to the last point). */
  constructor(xs: Float64Array, ks: Float64Array, range?: [number, number]) {
    this.xs = xs;
    this.ks = ks;
    const n = xs.length;
    const m = ks.length;
    const lo = range ? range[0] : n ? xs[0] : 0;
    const span = (range ? range[1] : n ? xs[n - 1] : 0) - lo;
    this.w = Float64Array.from(xs, (x) => (span > 0 ? taper((x - lo) / span) : 1));
    this.c = new Float64Array(m * n);
    this.s = new Float64Array(m * n);
    for (let q = 0; q < m; q++)
      for (let i = 0; i < n; i++) {
        this.c[q * n + i] = this.w[i] * cos(ks[q] * xs[i]);
        this.s[q * n + i] = this.w[i] * sin(ks[q] * xs[i]);
      }
  }

  /** Amplitude per k of `ys - ref` (ref optional) at the basis points. Values that are
   *  not finite are left out. The (tapered) mean is removed first. */
  amplitudes(ys: ArrayLike<number>, ref?: ArrayLike<number>, out?: Float32Array): Float32Array {
    const n = this.xs.length;
    const m = this.ks.length;
    const res = out ?? new Float32Array(m);
    const r = new Float64Array(n);
    let mean = 0;
    let wsum = 0;
    for (let i = 0; i < n; i++) {
      const v = ys[i] - (ref ? ref[i] : 0);
      if (!Number.isFinite(v)) {
        r[i] = NaN;
        continue;
      }
      r[i] = v;
      mean += this.w[i] * v;
      wsum += this.w[i];
    }
    if (!(wsum > 0)) return res.fill(0);
    mean /= wsum;
    for (let i = 0; i < n; i++) r[i] = Number.isNaN(r[i]) ? 0 : r[i] - mean;
    const g = 2 / wsum;
    for (let q = 0; q < m; q++) {
      let a = 0;
      let b = 0;
      const o = q * n;
      for (let i = 0; i < n; i++) {
        a += r[i] * this.c[o + i];
        b += r[i] * this.s[o + i];
      }
      res[q] = g * Math.sqrt(a * a + b * b);
    }
    return res;
  }
}

/**
 * Frequencies for points spread over `span` (the width of the data): from one wave across
 * the span up to `kmax`, `perWave` steps per 2 pi / span.
 */
export function waveFrequencies(span: number, kmax: number, perWave = 4): Float64Array {
  const k0 = (2 * PI) / span;
  const step = k0 / perWave;
  const count = Math.max(1, Math.floor((kmax - k0) / step) + 1);
  return Float64Array.from({ length: count }, (_, i) => k0 + i * step);
}

/**
 * Frequency range that shows a target: up to 1.5x the highest k where it still has 6% of
 * its strongest wave (at least 4, at most `limit`, e.g. half the sampling limit).
 */
export function waveRange(xs: Float64Array, truth: ArrayLike<number>, limit: number): number {
  const span = xs.length ? xs[xs.length - 1] - xs[0] : 1;
  if (!(span > 0)) return 4;
  const probe = new WaveBasis(xs, waveFrequencies(span, limit, 2));
  const amp = probe.amplitudes(truth);
  let peak = 0;
  for (const a of amp) peak = Math.max(peak, a);
  let top = 0;
  amp.forEach((a, q) => {
    if (a >= 0.06 * peak) top = probe.ks[q];
  });
  return Math.min(limit, Math.max(4, 1.5 * top));
}
