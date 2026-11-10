// Polynomials and Fourier series by least squares. Stages add one degree (or one
// harmonic) at a time.
import { cos, PI, sin } from '@xtraplaytion/dmath';
import type { FourierConfig, PolyConfig } from '../config.ts';
import { leastSquares, ridgeRows } from './linalg.ts';
import { clampInt, constantStage, meanOf, span, type Fitter, type Stage } from './staged.ts';

export const MAX_DEGREE = 30;
export const MAX_HARMONICS = 50;

/** Legendre polynomials P_0..P_d at t, written to out[0..d]. */
function legendre(t: number, d: number, out: Float64Array, at = 0) {
  out[at] = 1;
  if (d >= 1) out[at + 1] = t;
  for (let k = 1; k < d; k++) {
    out[at + k + 1] = ((2 * k + 1) * t * out[at + k] - k * out[at + k - 1]) / (k + 1);
  }
}

/**
 * Fitted in the Legendre basis on x mapped to [-1, 1] over the training range (well
 * conditioned), which is still exactly a polynomial of that degree: outside the data it
 * behaves like any polynomial does.
 */
export function polyFitter(c: PolyConfig, x: Float64Array, y: Float64Array): Fitter {
  const D = clampInt(c.degree, 0, MAX_DEGREE);
  const { lo, hi } = span(x);
  const mid = (lo + hi) / 2;
  const half = hi > lo ? (hi - lo) / 2 : 1;
  const n = y.length;
  return {
    stages: D + 1,
    stage(d: number): Stage {
      if (!n) return constantStage(d, 0, d + 1);
      const p = d + 1;
      const A = new Float64Array(n * p);
      for (let i = 0; i < n; i++) legendre((x[i] - mid) / half, d, A, i * p);
      // A whisper of ridge keeps the solve defined when the degree exceeds the data.
      const coef = leastSquares(A, n, p, y, ridgeRows(p, 1e-10 * n), p);
      const row = new Float64Array(p);
      return {
        value: d,
        params: p,
        predict(xs, out) {
          for (let i = 0; i < xs.length; i++) {
            legendre((xs[i] - mid) / half, d, row);
            let s = 0;
            for (let k = 0; k < p; k++) s += coef[k] * row[k];
            out[i] = s;
          }
        },
      };
    },
  };
}

/** Basis 1, cos(w t), sin(w t), ..., cos(K w t), sin(K w t) at t = x - origin. */
function fourierRow(t: number, w: number, K: number, out: Float64Array, at = 0) {
  out[at] = 1;
  for (let k = 1; k <= K; k++) {
    const a = k * w * t;
    out[at + 2 * k - 1] = cos(a);
    out[at + 2 * k] = sin(a);
  }
}

export function fourierPeriod(c: FourierConfig, x: Float64Array): number {
  return c.period > 0 ? c.period : span(x).width;
}

export function fourierFitter(c: FourierConfig, x: Float64Array, y: Float64Array): Fitter {
  const K = clampInt(c.harmonics, 0, MAX_HARMONICS);
  const { lo } = span(x);
  const w = (2 * PI) / fourierPeriod(c, x);
  const n = y.length;
  const pMax = 2 * K + 1;
  // Basis of every training point for the largest K; stage k uses the first 2k + 1 columns.
  const full = new Float64Array(n * pMax);
  for (let i = 0; i < n; i++) fourierRow(x[i] - lo, w, K, full, i * pMax);
  return {
    stages: K + 1,
    stage(k: number): Stage {
      if (!n) return constantStage(k, 0, 2 * k + 1);
      if (k === 0) return constantStage(0, meanOf(y));
      const p = 2 * k + 1;
      const A = new Float64Array(n * p);
      for (let i = 0; i < n; i++) A.set(full.subarray(i * pMax, i * pMax + p), i * p);
      // Gaps in the data leave high harmonics undetermined; a tiny ridge picks the smallest.
      const coef = leastSquares(A, n, p, y, ridgeRows(p, 1e-10 * n, 1), p);
      const row = new Float64Array(p);
      return {
        value: k,
        params: p,
        predict(xs, out) {
          for (let i = 0; i < xs.length; i++) {
            fourierRow(xs[i] - lo, w, k, row);
            let s = 0;
            for (let j = 0; j < p; j++) s += coef[j] * row[j];
            out[i] = s;
          }
        },
      };
    },
  };
}
