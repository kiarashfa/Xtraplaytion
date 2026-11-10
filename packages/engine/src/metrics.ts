// Scores per region: against the true function on the grid, or (imported data, no true
// function) against held-out points.
import { Region, type Dataset } from './data.ts';

export interface RegionMetrics {
  /** RMSE inside the training ranges, in gaps between them, and beyond them (NaN if empty). */
  inside: number;
  gap: number;
  beyond: number;
}

export function regionMetrics(
  pred: ArrayLike<number>,
  clean: ArrayLike<number>,
  region: Uint8Array,
): RegionMetrics {
  const sum = [0, 0, 0];
  const cnt = [0, 0, 0];
  for (let i = 0; i < region.length; i++) {
    const c = clean[i];
    if (c !== c) continue; // unknown or undefined
    const r = pred[i] - c;
    sum[region[i]] += r * r;
    cnt[region[i]]++;
  }
  const rmse = (k: number) => (cnt[k] ? Math.sqrt(sum[k] / cnt[k]) : NaN);
  return { inside: rmse(Region.Train), gap: rmse(Region.Gap), beyond: rmse(Region.Beyond) };
}

/** Linear interpolation of grid values at x (grid sorted, evenly spaced or not). */
function interpAt(gridX: ArrayLike<number>, ys: ArrayLike<number>, x: number): number {
  const n = gridX.length;
  if (x <= gridX[0]) return ys[0];
  if (x >= gridX[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (gridX[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - gridX[lo]) / (gridX[hi] - gridX[lo]);
  return ys[lo] + t * (ys[hi] - ys[lo]);
}

/** Scores a prediction on the grid. Without a true function (imported data), the inside
 *  score uses the training points (the validation column has the held-out ones inside) and
 *  the gap/beyond scores the test points, each read off the grid by linear interpolation. */
export function scoreGrid(
  pred: ArrayLike<number>,
  data: Pick<Dataset, 'gridX' | 'clean' | 'region' | 'trainX' | 'trainY' | 'test'>,
): RegionMetrics {
  const test = data.test;
  if (!test) return regionMetrics(pred, data.clean, data.region);
  const sum = [0, 0, 0];
  const cnt = [0, 0, 0];
  const add = (x: number, y: number, r: number) => {
    const d = interpAt(data.gridX, pred, x) - y;
    sum[r] += d * d;
    cnt[r]++;
  };
  for (let i = 0; i < data.trainX.length; i++) add(data.trainX[i], data.trainY[i], Region.Train);
  for (let i = 0; i < test.x.length; i++) add(test.x[i], test.y[i], test.region[i]);
  const rmse = (k: number) => (cnt[k] ? Math.sqrt(sum[k] / cnt[k]) : NaN);
  return { inside: rmse(Region.Train), gap: rmse(Region.Gap), beyond: rmse(Region.Beyond) };
}
