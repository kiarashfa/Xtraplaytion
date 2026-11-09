// Scores against the true function on the grid, split by region.
import { Region } from './data.ts';

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
