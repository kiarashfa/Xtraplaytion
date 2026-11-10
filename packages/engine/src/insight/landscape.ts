// A 2-D slice of the loss around the current weights (Li et al. 2018, "Visualizing
// the loss landscape of neural nets"): two seeded random directions, each rescaled
// neuron by neuron ("filter normalization": every row of a weight matrix gets the
// length of the same row of the network's weights; biases stay put), then the
// training loss at w + a d1 + b d2 on a square grid of (a, b).
import { Rng } from '@xtraplaytion/dmath';
import type { MLPConfig } from '../config.ts';
import type { Dataset } from '../data.ts';
import { lossOnly } from '../losses.ts';
import { inspectNet } from './neurons.ts';

export interface SliceOptions {
  /** Grid points per side (odd keeps the current weights on a grid point). Default 25. */
  res?: number;
  /** a and b run over [-radius, radius]. Default 1. */
  radius?: number;
  /** Seed of the directions. */
  seed?: number;
}

export interface LossSlice {
  res: number;
  radius: number;
  /** Training loss, row-major: values[j * res + i] at a = steps[i], b = steps[j]. */
  values: Float64Array;
  steps: Float64Array;
  /** Loss at the current weights. */
  center: number;
}

/** Multiply-adds of one slice (to check it against a budget before starting). */
export function sliceCost(paramCount: number, points: number, res = 25): number {
  return res * res * points * paramCount;
}

export function filterDirection(
  config: MLPConfig,
  params: ArrayLike<number>,
  rng: Rng,
): Float64Array {
  const net = inspectNet(config, params);
  const d = new Float64Array(net.paramCount);
  for (const { inDim, outDim, w } of net.layers) {
    for (let j = 0; j < outDim; j++) {
      const row = w + j * inDim;
      let dn = 0;
      let wn = 0;
      for (let k = 0; k < inDim; k++) {
        const v = rng.normal(0, 1);
        d[row + k] = v;
        dn += v * v;
        wn += params[row + k] * params[row + k];
      }
      const f = dn > 0 ? Math.sqrt(wn / dn) : 0;
      for (let k = 0; k < inDim; k++) d[row + k] *= f;
    }
  }
  return d;
}

/**
 * Loss slice around `params`. `data` must be in the network's own units. `onRow` reports
 * progress after each row (rows done, total); returning false stops early (null result).
 */
export function lossSlice(
  config: MLPConfig,
  params: ArrayLike<number>,
  data: Dataset,
  opts: SliceOptions = {},
  onRow?: (done: number, total: number) => unknown,
): LossSlice | null {
  const res = Math.max(3, Math.floor(opts.res ?? 25));
  const radius = opts.radius ?? 1;
  const rng = new Rng(opts.seed ?? 1, 8);
  const d1 = filterDirection(config, params, rng);
  const d2 = filterDirection(config, params, rng);
  const net = inspectNet(config, params);
  const base = Float64Array.from(params);
  const n = data.trainY.length;
  const out = new Float64Array(n);
  const steps = Float64Array.from(
    { length: res },
    (_, i) => -radius + (2 * radius * i) / (res - 1),
  );
  const values = new Float64Array(res * res);
  const loss = () => {
    if (!n) return NaN;
    net.predict(data.trainX, n, out);
    return lossOnly(config.loss.kind, out, data.trainY, n, config.loss.delta);
  };
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const a = steps[i];
      const b = steps[j];
      for (let q = 0; q < base.length; q++) net.params[q] = base[q] + a * d1[q] + b * d2[q];
      values[j * res + i] = loss();
    }
    if (onRow && onRow(j + 1, res) === false) return null;
  }
  net.params.set(base);
  return { res, radius, values, steps, center: loss() };
}
