// k nearest neighbours in one dimension. Stages shrink k from every point (a flat
// mean) to the chosen k.
import type { KnnConfig } from '../config.ts';
import {
  clampInt,
  constantStage,
  sortedByX,
  spreadInts,
  type Fitter,
  type Stage,
} from './staged.ts';

export const MAX_K = 100;
const STAGES = 25;

export function knnFitter(c: KnnConfig, x0: Float64Array, y0: Float64Array): Fitter {
  const { x, y } = sortedByX(x0, y0);
  const n = y.length;
  const kFinal = clampInt(c.k, 1, Math.max(1, Math.min(MAX_K, n)));
  const ks = n ? spreadInts(n, kFinal, STAGES) : [kFinal];
  const distance = c.weights === 'distance';

  /** Index of the first training x >= t. */
  const lower = (t: number) => {
    let a = 0;
    let b = n;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (x[mid] < t) a = mid + 1;
      else b = mid;
    }
    return a;
  };

  return {
    stages: ks.length,
    stage(s: number): Stage {
      const k = ks[s];
      if (!n) return constantStage(k, 0, 0);
      return {
        value: k,
        params: n,
        predict(xs, out) {
          for (let i = 0; i < xs.length; i++) {
            const t = xs[i];
            // Grow a window [l, r) around t, taking the nearer side (left on ties).
            let r = lower(t);
            let l = r;
            let sum = 0;
            let wsum = 0;
            let exact = 0;
            let exactSum = 0;
            for (let j = 0; j < k; j++) {
              let idx: number;
              if (l > 0 && (r >= n || t - x[l - 1] <= x[r] - t)) idx = --l;
              else idx = r++;
              const d = Math.abs(t - x[idx]);
              if (distance) {
                if (d === 0) {
                  exact++;
                  exactSum += y[idx];
                } else {
                  sum += y[idx] / d;
                  wsum += 1 / d;
                }
              } else sum += y[idx];
            }
            out[i] = distance ? (exact ? exactSum / exact : sum / wsum) : sum / k;
          }
        },
      };
    },
  };
}
