// What each neuron adds. The output layer is linear, so for any depth the
// prediction is exactly bias + sum_j w_j h_j(x), where h_j are the neurons of
// the last hidden layer. Each term w_j h_j(x) is that neuron's contribution.
import type { MLPConfig } from '../config.ts';
import { MLP } from '../mlp.ts';

export interface NeuronPart {
  /** Neuron index in the last hidden layer. */
  index: number;
  /** w_j h_j(x) on the given points. */
  ys: Float32Array;
  /** Root mean square of the contribution over the points (how much it matters). */
  size: number;
}

export interface NeuronParts {
  /** The largest contributions, biggest first. */
  top: NeuronPart[];
  /** Sum of all other contributions. */
  rest: Float32Array;
  /** Output bias. */
  bias: number;
  /** Width of the last hidden layer. */
  width: number;
  /** Per hidden layer: neurons that are off (exactly 0) at every training point, or null
   *  when the layer's activation cannot switch off (only relu can). */
  dead: (number | null)[];
}

/** A network to look inside (no dropout), loaded with `params`. */
export function inspectNet(config: MLPConfig, params: ArrayLike<number>): MLP {
  const net = new MLP({ ...config, dropout: 0, init: { kind: 'normal', std: 0 } }, 0);
  net.params.set(params);
  return net;
}

/**
 * Contributions of the last hidden layer's neurons at `xs` (in the network's own input
 * units), the `k` largest separately. `trainX` (optional) counts dead neurons.
 */
export function neuronParts(net: MLP, xs: Float64Array, k = 8, trainX?: Float64Array): NeuronParts {
  const L = net.layers.length;
  const last = net.layers[L - 1];
  const width = last.inDim;
  const n = xs.length / net.dims[0];
  const contrib = Array.from({ length: width }, () => new Float32Array(n));
  const chunk = 1024;
  for (let s = 0; s < n; s += chunk) {
    const m = Math.min(chunk, n - s);
    net.forward(xs.subarray(s * net.dims[0], (s + m) * net.dims[0]), m, false);
    const h = net.layerOutput(L - 1);
    for (let i = 0; i < m; i++)
      for (let j = 0; j < width; j++) contrib[j][s + i] = net.params[last.w + j] * h[i * width + j];
  }
  const parts = contrib.map((ys, index) => {
    let sq = 0;
    for (const v of ys) sq += v * v;
    return { index, ys, size: n ? Math.sqrt(sq / n) : 0 };
  });
  parts.sort((a, b) => b.size - a.size || a.index - b.index);
  const top = parts.slice(0, Math.max(0, k));
  const rest = new Float32Array(n);
  for (const p of parts.slice(top.length)) for (let i = 0; i < n; i++) rest[i] += p.ys[i];
  const dead: (number | null)[] = net.config.activations.map(() => null);
  if (trainX && trainX.length) {
    const m = trainX.length / net.dims[0];
    net.forward(trainX, m, false);
    net.config.activations.forEach((a, l) => {
      if (a !== 'relu') return;
      const wl = net.dims[l + 1];
      const z = net.layerInput(l + 1);
      let count = 0;
      for (let j = 0; j < wl; j++) {
        let on = false;
        for (let i = 0; i < m && !on; i++) on = z[i * wl + j] > 0;
        if (!on) count++;
      }
      dead[l] = count;
    });
  }
  return { top, rest, bias: net.params[last.b], width, dead };
}
