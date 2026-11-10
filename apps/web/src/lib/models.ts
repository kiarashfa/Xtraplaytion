// Model families as the playground sees them: names, defaults, validation of
// configurations from links and files, and rough fitting-time estimates for the
// classical models. Pure (no Svelte, no DOM).
import { Rng } from '@xtraplaytion/dmath';
import {
  MAX_DEGREE,
  MAX_DEPTH,
  MAX_HARMONICS,
  MAX_K,
  MAX_SEGMENTS,
  MAX_TREES,
  GP_MAX_POINTS,
  GP_TUNE_POINTS,
  type ClassicalConfig,
  type Dataset,
  type KernelKind,
  type KernelPart,
} from '@xtraplaytion/engine';

export type Family = 'mlp' | ClassicalConfig['kind'];
export const FAMILIES: Family[] = ['mlp', 'poly', 'fourier', 'spline', 'knn', 'tree', 'gp'];
export const CLASSICAL_FAMILIES = FAMILIES.filter((f) => f !== 'mlp') as ClassicalConfig['kind'][];

/** First letter of a model's name (N1, P3, G5...). The number is its color slot. */
export const LETTER: Record<Family, string> = {
  mlp: 'N',
  poly: 'P',
  fourier: 'F',
  spline: 'S',
  knn: 'K',
  tree: 'T',
  gp: 'G',
};

/** Kernel choices offered in the editor (sums of the engine's parts). */
export const KERNELS = [
  'rbf',
  'matern52',
  'matern32',
  'matern12',
  'periodic',
  'linear',
  'rbf+linear',
  'periodic+rbf',
] as const;
export type KernelChoice = (typeof KERNELS)[number];

export function kernelChoice(parts: KernelPart[]): KernelChoice {
  const name = parts.map((p) => p.kind).join('+');
  return (KERNELS as readonly string[]).includes(name) ? (name as KernelChoice) : 'rbf';
}

/** Kernel parts for a choice, keeping the current length and period where they apply. */
export function kernelParts(choice: KernelChoice, width: number, old?: KernelPart[]): KernelPart[] {
  const length = old?.find((p) => p.kind !== 'linear')?.length ?? width / 10;
  const period = old?.find((p) => p.kind === 'periodic')?.period ?? width / 4;
  return choice.split('+').map((kind, i) => ({
    kind: kind as KernelKind,
    scale: i === 0 ? 1 : 0.3,
    length: i === 0 ? length : length * 3,
    period,
  }));
}

/** Default configuration of a classical family for a domain of this width. */
export function defaultClassical(kind: ClassicalConfig['kind'], width: number): ClassicalConfig {
  const w = width > 0 ? width : 1;
  switch (kind) {
    case 'poly':
      return { kind, degree: 7 };
    case 'fourier':
      return { kind, harmonics: 8, period: 0 };
    case 'spline':
      return { kind, segments: 20, smoothing: 0.01 };
    case 'knn':
      return { kind, k: 5, weights: 'uniform' };
    case 'tree':
      return { kind, ensemble: 'single', depth: 5, trees: 50, minLeaf: 2, lr: 0.1 };
    case 'gp':
      return { kind, kernel: kernelParts('rbf', round3(w)), noise: 0.1, tune: true };
  }
}

const round3 = (v: number) => +v.toPrecision(3);

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const int = (v: unknown, lo: number, hi: number) =>
  isNum(v) ? Math.round(clamp(v, lo, hi)) : null;
const num = (v: unknown, lo: number, hi: number) => (isNum(v) ? clamp(v, lo, hi) : null);
const KERNEL_KINDS: KernelKind[] = [
  'rbf',
  'matern12',
  'matern32',
  'matern52',
  'periodic',
  'linear',
];

/** Accepts a well-formed classical configuration (from a link or file), clamped to the limits. */
export function validClassical(o: unknown): ClassicalConfig | null {
  if (!o || typeof o !== 'object') return null;
  const m = o as Record<string, unknown>;
  switch (m['kind']) {
    case 'poly': {
      const degree = int(m['degree'], 0, MAX_DEGREE);
      return degree === null ? null : { kind: 'poly', degree };
    }
    case 'fourier': {
      const harmonics = int(m['harmonics'], 0, MAX_HARMONICS);
      const period = num(m['period'], 0, 1e6);
      return harmonics === null || period === null ? null : { kind: 'fourier', harmonics, period };
    }
    case 'spline': {
      const segments = int(m['segments'], 1, MAX_SEGMENTS);
      const smoothing = num(m['smoothing'], 0, 1e6);
      return segments === null || smoothing === null
        ? null
        : { kind: 'spline', segments, smoothing };
    }
    case 'knn': {
      const k = int(m['k'], 1, MAX_K);
      const weights = m['weights'] === 'distance' ? 'distance' : 'uniform';
      return k === null ? null : { kind: 'knn', k, weights };
    }
    case 'tree': {
      const e = m['ensemble'];
      if (e !== 'single' && e !== 'forest' && e !== 'boost') return null;
      const depth = int(m['depth'], 1, MAX_DEPTH);
      const trees = int(m['trees'], 1, MAX_TREES);
      const minLeaf = int(m['minLeaf'], 1, 1000);
      const lr = num(m['lr'], 1e-4, 1);
      if (depth === null || trees === null || minLeaf === null || lr === null) return null;
      return { kind: 'tree', ensemble: e, depth, trees, minLeaf, lr };
    }
    case 'gp': {
      const parts = m['kernel'];
      if (!Array.isArray(parts) || parts.length < 1 || parts.length > 3) return null;
      const kernel: KernelPart[] = [];
      for (const p of parts) {
        if (!p || typeof p !== 'object') return null;
        const r = p as Record<string, unknown>;
        if (!KERNEL_KINDS.includes(r['kind'] as KernelKind)) return null;
        const scale = num(r['scale'], 1e-3, 1e3);
        const length = num(r['length'], 1e-6, 1e6);
        const period = num(r['period'], 1e-6, 1e6);
        if (scale === null || length === null || period === null) return null;
        kernel.push({ kind: r['kind'] as KernelKind, scale, length, period });
      }
      const noise = num(m['noise'], 1e-4, 100);
      if (noise === null) return null;
      return { kind: 'gp', kernel, noise, tune: m['tune'] !== false };
    }
    default:
      return null;
  }
}

/** Rough seconds to fit on a mid laptop (measured: GP tuning on 160 points ~0.5 s). The
 *  device speed factor is the benchmark relative to that laptop. */
export function classicalSeconds(c: ClassicalConfig, points: number, slowdown = 1): number {
  if (c.kind === 'gp') {
    const t = Math.min(points, GP_TUNE_POINTS);
    const f = Math.min(points, GP_MAX_POINTS);
    const parts = c.kernel.length;
    const tune = c.tune ? 1.2e-7 * t * t * t * (0.6 + 0.4 * parts) : 1.4e-8 * t * t * t;
    return (tune + 5e-9 * f * f * f) * slowdown;
  }
  if (c.kind === 'tree' && c.ensemble !== 'single') return 2e-4 * c.trees * slowdown;
  return 0.02 * slowdown;
}

/** Training points a Gaussian process uses for its final fit. */
export const gpPointsUsed = (points: number) => Math.min(points, GP_MAX_POINTS);

/** Weight seed of copy i of an averaged model (copy 0 is the model itself). */
export const copySeed = (seed: number, i: number) => seed + 7919 * i;

/** Training points drawn with replacement (seeded), sorted by x: what one copy of an
 *  averaged classical model learns from. */
export function bootstrapData(data: Dataset, seed: number): Dataset {
  const n = data.trainY.length;
  const rng = new Rng(seed, 9);
  const idx = Array.from({ length: n }, () => rng.int(n)).sort(
    (a, b) => data.trainX[a] - data.trainX[b] || a - b,
  );
  return {
    ...data,
    trainX: Float64Array.from(idx, (i) => data.trainX[i]),
    trainY: Float64Array.from(idx, (i) => data.trainY[i]),
  };
}
