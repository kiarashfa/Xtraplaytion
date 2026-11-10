// Insight views on the page: what a model looks like inside at one moment, in the
// plot's own units (networks on imported data train on rescaled values; everything
// here is mapped back). Results are cached per weight snapshot or per grid, so
// replaying never recomputes what was already shown.
import {
  hasKinks,
  inspectNet,
  kinksOf,
  layerStats,
  neuronParts,
  Region,
  regionOf,
  scaleData,
  sliceCost,
  WaveBasis,
  waveFrequencies,
  waveRange,
  type Dataset,
  type LayerStats,
  type MLPConfig,
} from '@xtraplaytion/engine';

const memo = <K extends object, V>(fn: (k: K) => V) => {
  const cache = new WeakMap<K, V>();
  return (k: K): V => {
    if (cache.has(k)) return cache.get(k) as V;
    const v = fn(k);
    cache.set(k, v);
    return v;
  };
};

/** The data in the network's own units. */
const scaledOf = new WeakMap<Dataset, Dataset>();
export function netData(cfg: MLPConfig, data: Dataset): Dataset {
  if (!cfg.scale) return data;
  let d = scaledOf.get(data);
  if (!d) {
    d = scaleData(data, cfg.scale);
    scaledOf.set(data, d);
  }
  return d;
}

export interface NeuronView {
  top: { index: number; ys: Float32Array; size: number }[];
  rest: Float32Array;
  /** Bias plus every contribution: the prediction itself. */
  sum: Float32Array;
  width: number;
  dead: (number | null)[];
}

const neuronCache = new WeakMap<ArrayLike<number>, NeuronView>();
/** Contributions of the last hidden layer's neurons on the grid, the 8 largest apart. */
export function neuronView(cfg: MLPConfig, params: Float32Array, data: Dataset): NeuronView {
  const hit = neuronCache.get(params);
  if (hit) return hit;
  const d = netData(cfg, data);
  const p = neuronParts(inspectNet(cfg, params), d.gridX, 8, d.trainX);
  const ys = cfg.scale?.yScale ?? 1;
  const shift = cfg.scale?.yShift ?? 0;
  const top = p.top.map((t) => ({
    index: t.index,
    ys: t.ys.map((v) => v / ys),
    size: t.size / ys,
  }));
  const rest = p.rest.map((v) => v / ys);
  const sum = rest.map((v, i) => p.bias / ys + shift + v + top.reduce((s, t) => s + t.ys[i], 0));
  const out = { top, rest, sum, width: p.width, dead: p.dead };
  neuronCache.set(params, out);
  return out;
}

export interface KinkView {
  /** Kink positions in plot units, increasing. */
  xs: Float64Array;
  /** Slopes before the first and after the last kink (straight lines forever). */
  slopeLeft: number;
  slopeRight: number;
}

export const canKink = (cfg: MLPConfig) => hasKinks([cfg.inDim, ...cfg.hidden, 1], cfg.activations);

const kinkCache = new WeakMap<ArrayLike<number>, KinkView | null>();
/** Exact kinks of a piecewise-linear network (null for smooth activations or too much work). */
export function kinkView(cfg: MLPConfig, params: Float32Array): KinkView | null {
  if (kinkCache.has(params)) return kinkCache.get(params) ?? null;
  let out: KinkView | null = null;
  if (canKink(cfg)) {
    const net = inspectNet(cfg, params);
    const k = kinksOf(net.dims, cfg.activations, net.layers, net.params);
    if (k) {
      const sc = cfg.scale;
      const fx = (x: number) => (sc ? x / sc.xScale + sc.xShift : x);
      const fs = (s: number) => (sc ? (s * sc.xScale) / sc.yScale : s);
      out = {
        xs: k.xs.map(fx),
        slopeLeft: fs(k.slopes[0]),
        slopeRight: fs(k.slopes[k.slopes.length - 1]),
      };
    }
  }
  kinkCache.set(params, out);
  return out;
}

/** Kinks per region of the plot, plus those outside it. */
export function kinkRegions(
  xs: ArrayLike<number>,
  domain: [number, number],
  bands: [number, number][],
) {
  const out = { train: 0, gap: 0, beyond: 0, outside: 0 };
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (x < domain[0] || x > domain[1]) out.outside++;
    else {
      const r = regionOf(x, bands);
      if (r === Region.Train) out.train++;
      else if (r === Region.Gap) out.gap++;
      else out.beyond++;
    }
  }
  return out;
}

const statsCache = new WeakMap<ArrayLike<number>, LayerStats[]>();
/** Weights and the full-batch gradient per layer (in the network's own units). */
export function weightStats(cfg: MLPConfig, params: Float32Array, data: Dataset): LayerStats[] {
  const hit = statsCache.get(params);
  if (hit) return hit;
  const out = layerStats(inspectNet(cfg, params), cfg, netData(cfg, data));
  statsCache.set(params, out);
  return out;
}

export interface WaveSetup {
  ks: Float64Array;
  /** Waves of the target over the whole stretch of data. */
  truth: Float32Array;
  /** Grid indices inside the training ranges (where a model's error is measured). */
  inside: number[];
  basis: WaveBasis;
  truthInside: Float64Array;
}

/** Wave analysis for a dataset with a known true function (null otherwise). */
export const waveSetup = memo((data: Dataset): WaveSetup | null => {
  const g = data.gridX;
  const inside: number[] = [];
  for (let i = 0; i < g.length; i++) if (data.region[i] === Region.Train) inside.push(i);
  if (inside.length < 8 || inside.some((i) => !Number.isFinite(data.clean[i]))) return null;
  const lo = g[inside[0]];
  const hi = g[inside[inside.length - 1]];
  const hull: number[] = [];
  for (let i = inside[0]; i <= inside[inside.length - 1]; i++)
    if (Number.isFinite(data.clean[i])) hull.push(i);
  const hx = Float64Array.from(hull, (i) => g[i]);
  const ht = Float64Array.from(hull, (i) => data.clean[i]);
  const dx = (g[g.length - 1] - g[0]) / Math.max(1, g.length - 1);
  const limit = Math.min(40, (0.5 * Math.PI) / dx);
  const ks = waveFrequencies(hi - lo, waveRange(hx, ht, limit), 4);
  const truth = new WaveBasis(hx, ks).amplitudes(ht);
  const truthInside = Float64Array.from(inside, (i) => data.clean[i]);
  const basis = new WaveBasis(
    Float64Array.from(inside, (i) => g[i]),
    ks,
    [lo, hi],
  );
  return { ks, truth, inside, basis, truthInside };
});

const waveCache = new WeakMap<Float32Array, Float32Array>();
/** What a prediction still misses of each wave, inside the data. */
export function missingWaves(setup: WaveSetup, grid: Float32Array): Float32Array {
  let out = waveCache.get(grid);
  if (!out) {
    out = setup.basis.amplitudes(
      Float64Array.from(setup.inside, (i) => grid[i]),
      setup.truthInside,
    );
    waveCache.set(grid, out);
  }
  return out;
}

/** Largest network the loss map takes. */
export const LOSS_MAP_PARAMS = 50_000;
/** Grid side of a loss map within the work budget (multiply-adds), or null. */
export function lossMapResolution(paramCount: number, points: number, budget = 6e8): number | null {
  if (paramCount > LOSS_MAP_PARAMS || points < 1) return null;
  for (const res of [41, 31, 25, 21, 15])
    if (sliceCost(paramCount, points, res) <= budget) return res;
  return null;
}
