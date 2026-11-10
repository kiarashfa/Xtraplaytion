// Penalized cubic B-splines (P-splines, Eilers and Marx 1996): equally spaced knots
// over the training range, a penalty on second differences of the coefficients, and
// straight-line continuation beyond the first and last training point. Stages lower
// the penalty from "almost a straight line" to the chosen smoothing.
import { exp, log } from '@xtraplaytion/dmath';
import type { SplineConfig } from '../config.ts';
import { leastSquares } from './linalg.ts';
import { clampInt, constantStage, span, type Fitter, type Stage } from './staged.ts';

export const MAX_SEGMENTS = 100;
const STAGES = 25;
const START_PENALTY = 1e6;
/** Keeps the solve defined where no data constrains a coefficient. */
const FLOOR = 1e-9;

/** Uniform cubic B-spline weights of the four basis functions active at u in [0, 1]. */
function weights(u: number, out: Float64Array) {
  const v = 1 - u;
  const u2 = u * u;
  const u3 = u2 * u;
  out[0] = (v * v * v) / 6;
  out[1] = (3 * u3 - 6 * u2 + 4) / 6;
  out[2] = (-3 * u3 + 3 * u2 + 3 * u + 1) / 6;
  out[3] = u3 / 6;
}

/** Their derivatives with respect to u. */
function slopes(u: number, out: Float64Array) {
  const v = 1 - u;
  out[0] = (-v * v) / 2;
  out[1] = (3 * u * u - 4 * u) / 2;
  out[2] = (-3 * u * u + 2 * u + 1) / 2;
  out[3] = (u * u) / 2;
}

export function splineFitter(c: SplineConfig, x: Float64Array, y: Float64Array): Fitter {
  const m = clampInt(c.segments, 1, MAX_SEGMENTS);
  const p = m + 3;
  const { lo, hi } = span(x);
  const h = hi > lo ? (hi - lo) / m : 1 / m;
  const n = y.length;
  const final = Math.max(0, Number.isFinite(c.smoothing) ? c.smoothing : 0);
  const w = new Float64Array(4);

  const segment = (t: number): [number, number] => {
    const s = Math.min(m - 1, Math.max(0, Math.floor((t - lo) / h)));
    return [s, (t - lo) / h - s];
  };

  // Design matrix (dense; each row has four non-zeros).
  const A = new Float64Array(n * p);
  for (let i = 0; i < n; i++) {
    const [s, u] = segment(x[i]);
    weights(u, w);
    for (let k = 0; k < 4; k++) A[i * p + s + k] = w[k];
  }

  const penaltyAt = (st: number) => {
    if (st === STAGES - 1) return final;
    const a = log(START_PENALTY);
    const b = log(Math.max(final, 1e-6));
    return exp(a + ((b - a) * st) / (STAGES - 1));
  };

  return {
    stages: STAGES,
    stage(st: number): Stage {
      const lambda = penaltyAt(st);
      if (!n) return constantStage(lambda, 0, p);
      // Rows: sqrt(lambda n) times second differences, then a floor ridge.
      const r = p - 2 + p;
      const P = new Float64Array(r * p);
      const sw = Math.sqrt(lambda * n);
      for (let i = 0; i < p - 2; i++) {
        P[i * p + i] = sw;
        P[i * p + i + 1] = -2 * sw;
        P[i * p + i + 2] = sw;
      }
      const fl = Math.sqrt(FLOOR * n);
      for (let i = 0; i < p; i++) P[(p - 2 + i) * p + i] = fl;
      const coef = leastSquares(A, n, p, y, P, r);
      const at = (t: number): number => {
        const [s, u] = segment(t);
        weights(u, w);
        return coef[s] * w[0] + coef[s + 1] * w[1] + coef[s + 2] * w[2] + coef[s + 3] * w[3];
      };
      const slopeAt = (t: number): number => {
        const [s, u] = segment(t);
        slopes(u, w);
        return (coef[s] * w[0] + coef[s + 1] * w[1] + coef[s + 2] * w[2] + coef[s + 3] * w[3]) / h;
      };
      const yLo = at(lo);
      const yHi = at(hi);
      const dLo = slopeAt(lo);
      const dHi = slopeAt(hi);
      return {
        value: lambda,
        params: p,
        predict(xs, out) {
          for (let i = 0; i < xs.length; i++) {
            const t = xs[i];
            out[i] = t < lo ? yLo + dLo * (t - lo) : t > hi ? yHi + dHi * (t - hi) : at(t);
          }
        },
      };
    },
  };
}
