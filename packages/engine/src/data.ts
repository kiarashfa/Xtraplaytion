// Datasets: samples of a target function inside the training ranges, with
// seeded noise and a seeded validation split, plus an evaluation grid.
import { Rng } from '@xtraplaytion/dmath';

export type Noise =
  | { kind: 'none' }
  | { kind: 'gaussian'; sigma: number }
  | { kind: 'uniform'; width: number }
  | { kind: 'hetero'; sigma: number; by: 'f' | 'x' }
  | { kind: 'outliers'; sigma: number; percent: number; magnitude: number };

export interface DataSpec {
  domain: [number, number];
  /** Number of data points (inside the training ranges). */
  n: number;
  /** Training ranges; empty means the whole domain. */
  bands: [number, number][];
  noise: Noise;
  /** Share of points held out for validation, 0..0.9. */
  valFraction: number;
  seed: number;
  /** Points on the evaluation grid (400-800 recommended). */
  gridSize: number;
}

/** Region of each grid point. */
export const Region = { Train: 0, Gap: 1, Beyond: 2 } as const;
export type Region = (typeof Region)[keyof typeof Region];

export interface Dataset {
  dim: number;
  trainX: Float64Array;
  trainY: Float64Array;
  valX: Float64Array;
  valY: Float64Array;
  gridX: Float64Array;
  /** Target on the grid without noise (NaN where undefined or unknown). */
  clean: Float64Array;
  region: Uint8Array;
  /** Held-out points outside the training ranges, used for scoring when there is no
   *  true function (imported data). Region per point as for the grid. */
  test?: { x: Float64Array; y: Float64Array; region: Uint8Array };
}

export function regionOf(x: number, bands: [number, number][]): Region {
  if (!bands.length) return Region.Train;
  if (bands.some(([a, b]) => x >= a && x <= b)) return Region.Train;
  const lo = Math.min(...bands.map((b) => b[0]));
  const hi = Math.max(...bands.map((b) => b[1]));
  return x < lo || x > hi ? Region.Beyond : Region.Gap;
}

/** Evenly spaced points over the union of ranges, in proportion to their lengths. */
export function spreadPoints(ranges: [number, number][], n: number): number[] {
  const total = ranges.reduce((s, [a, b]) => s + (b - a), 0);
  if (n <= 0 || total <= 0) return [];
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    let t = n === 1 ? total / 2 : (total * i) / (n - 1);
    for (let r = 0; r < ranges.length; r++) {
      const [a, b] = ranges[r];
      const len = b - a;
      if (t <= len || r === ranges.length - 1) {
        xs.push(a + Math.min(t, len));
        break;
      }
      t -= len;
    }
  }
  return xs;
}

export function buildDataset(target: (x: number) => number, spec: DataSpec): Dataset {
  const bands = (spec.bands.length ? spec.bands : [spec.domain])
    .map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number])
    .sort((p, q) => p[0] - q[0]);
  const xs = spreadPoints(bands, spec.n);
  const noise = new Rng(spec.seed, 2);
  const ys = xs.map((x) => {
    const f = target(x);
    const nz = spec.noise;
    switch (nz.kind) {
      case 'none':
        return f;
      case 'gaussian':
        return f + noise.normal(0, nz.sigma);
      case 'uniform':
        return f + noise.uniform(-nz.width / 2, nz.width / 2);
      case 'hetero':
        return f + noise.normal(0, nz.sigma * Math.abs(nz.by === 'f' ? f : x));
      case 'outliers': {
        const base = f + noise.normal(0, nz.sigma);
        return noise.next() < nz.percent / 100
          ? base + (noise.next() < 0.5 ? -1 : 1) * nz.magnitude
          : base;
      }
    }
  });
  // Points where the target is undefined (or unknown, outside a drawing) are dropped.
  // Noise was drawn for every point, so valid targets keep exactly the same data.
  const keep = ys.map((y) => Number.isFinite(y));
  const fx = xs.filter((_, i) => keep[i]);
  const fy = ys.filter((_, i) => keep[i]);
  const { isVal } = splitValidation(fx.length, spec.valFraction, spec.seed);
  const pick = (want: number, arr: number[]) =>
    Float64Array.from(arr.filter((_, i) => isVal[i] === want));

  const gridX = gridOf(spec.domain, spec.gridSize);
  const clean = gridX.map((x) => {
    const v = target(x);
    return Number.isFinite(v) ? v : NaN;
  });
  const region = Uint8Array.from(gridX, (x) => regionOf(x, spec.bands.length ? bands : []));
  return {
    dim: 1,
    trainX: pick(0, fx),
    trainY: pick(0, fy),
    valX: pick(1, fx),
    valY: pick(1, fy),
    gridX,
    clean,
    region,
  };
}

/** Seeded validation split: shuffle indices, the first k go to validation. */
function splitValidation(n: number, valFraction: number, seed: number) {
  const split = new Rng(seed, 3);
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = split.int(i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const k = Math.round(Math.min(0.9, Math.max(0, valFraction)) * n);
  const isVal = new Uint8Array(n);
  for (let i = 0; i < k; i++) isVal[idx[i]] = 1;
  return { isVal };
}

function gridOf([d0, d1]: [number, number], size: number): Float64Array {
  const g = Math.max(2, size);
  return Float64Array.from({ length: g }, (_, i) => d0 + ((d1 - d0) * i) / (g - 1));
}

export interface PointsSpec {
  domain: [number, number];
  /** Training ranges; empty means everything is training data. */
  bands: [number, number][];
  /** Share of the points inside the ranges held out for validation, 0..0.9. */
  valFraction: number;
  seed: number;
  gridSize: number;
}

/** A dataset from given points (no true function). Points inside the training ranges are
 *  split into training and validation; points outside them (within the domain) are kept
 *  as test points for the gap and beyond scores. Order of the input does not matter. */
export function datasetFromPoints(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  spec: PointsSpec,
): Dataset {
  const bands = spec.bands
    .map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number])
    .sort((p, q) => p[0] - q[0]);
  const order = Array.from({ length: Math.min(xs.length, ys.length) }, (_, i) => i).filter(
    (i) => Number.isFinite(xs[i]) && Number.isFinite(ys[i]),
  );
  // Sorted by x (stable), so the result does not depend on the row order of a file.
  order.sort((a, b) => xs[a] - xs[b] || a - b);
  const [d0, d1] = spec.domain;
  const inX: number[] = [];
  const inY: number[] = [];
  const tX: number[] = [];
  const tY: number[] = [];
  const tR: number[] = [];
  for (const i of order) {
    const x = xs[i];
    if (x < d0 || x > d1) continue;
    const r = regionOf(x, bands);
    if (r === Region.Train) {
      inX.push(x);
      inY.push(ys[i]);
    } else {
      tX.push(x);
      tY.push(ys[i]);
      tR.push(r);
    }
  }
  const { isVal } = splitValidation(inX.length, spec.valFraction, spec.seed);
  const pick = (want: number, arr: number[]) =>
    Float64Array.from(arr.filter((_, i) => isVal[i] === want));
  const gridX = gridOf(spec.domain, spec.gridSize);
  return {
    dim: 1,
    trainX: pick(0, inX),
    trainY: pick(0, inY),
    valX: pick(1, inX),
    valY: pick(1, inY),
    gridX,
    clean: new Float64Array(gridX.length).fill(NaN),
    region: Uint8Array.from(gridX, (x) => regionOf(x, bands)),
    test: { x: Float64Array.from(tX), y: Float64Array.from(tY), region: Uint8Array.from(tR) },
  };
}
