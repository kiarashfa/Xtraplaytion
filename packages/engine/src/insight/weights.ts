// Weights and gradients per layer: histograms, sizes, and the full-batch gradient
// the optimizer sees at a given moment.
import type { MLPConfig } from '../config.ts';
import type { Dataset } from '../data.ts';
import { lossAndGrad } from '../losses.ts';
import type { MLP } from '../mlp.ts';

export interface Histogram {
  lo: number;
  hi: number;
  counts: Uint32Array;
}

/** Counts of `values` in `bins` equal bins over [lo, hi] (default: their range). */
export function histogram(
  values: ArrayLike<number>,
  bins: number,
  lo?: number,
  hi?: number,
): Histogram {
  let a = lo ?? Infinity;
  let b = hi ?? -Infinity;
  if (lo === undefined || hi === undefined)
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!Number.isFinite(v)) continue;
      if (lo === undefined) a = Math.min(a, v);
      if (hi === undefined) b = Math.max(b, v);
    }
  if (!(a <= b)) [a, b] = [-1, 1];
  if (a === b) [a, b] = [a - 0.5, b + 0.5];
  const counts = new Uint32Array(bins);
  const scale = bins / (b - a);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v) || v < a || v > b) continue;
    counts[Math.min(bins - 1, Math.floor((v - a) * scale))]++;
  }
  return { lo: a, hi: b, counts };
}

export interface LayerStats {
  /** Weights (not biases) of the layer. */
  weights: Float64Array;
  biases: Float64Array;
  /** Root mean square of the weights. */
  weightRms: number;
  /** Length (L2 norm) of the layer's gradient, weights and biases together. */
  gradNorm: number;
}

/**
 * Per-layer weights and the full-batch gradient of the training loss (with penalties) at
 * the network's current parameters. `data` must be in the network's own units (scaled
 * when the run trains on rescaled data).
 */
export function layerStats(net: MLP, config: MLPConfig, data: Dataset): LayerStats[] {
  const n = data.trainY.length;
  if (n > 0) {
    const out = net.forward(data.trainX, n, true);
    const d = new Float64Array(n);
    lossAndGrad(config.loss.kind, out, data.trainY, n, d, config.loss.delta);
    net.backward(d, n);
  } else net.grads.fill(0);
  return net.layers.map(({ inDim, outDim, w, b }) => {
    const weights = net.params.slice(w, w + inDim * outDim);
    const biases = net.params.slice(b, b + outDim);
    let sq = 0;
    for (const v of weights) sq += v * v;
    let g = 0;
    for (let i = w; i < b + outDim; i++) g += net.grads[i] * net.grads[i];
    return {
      weights,
      biases,
      weightRms: Math.sqrt(sq / Math.max(1, weights.length)),
      gradNorm: Math.sqrt(g),
    };
  });
}
