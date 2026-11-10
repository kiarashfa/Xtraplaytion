// Training scenarios run identically in Node and in browsers (identical.engines.ts).
// No Node APIs here: browsers load this file.
import { sin } from '@xtraplaytion/dmath';
import {
  buildDataset,
  createRun,
  mlp,
  type ClassicalConfig,
  type MLPConfig,
} from '../src/index.ts';
import type { FrameMsg, FromWorker } from '../src/worker/protocol.ts';

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
export function hash(values: ArrayLike<number>): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x5bd1e995;
  for (let i = 0; i < values.length; i++) {
    // NaN bit patterns are an engine detail (JavaScriptCore differs); treat all NaNs as one.
    f64[0] = Number.isNaN(values[i]) ? NaN : values[i];
    if (Number.isNaN(values[i])) u32[1] = 0x7ff80000;
    for (const w of [u32[0], u32[1]]) {
      h1 = Math.imul(h1 ^ w, 0x01000193);
      h2 = Math.imul(h2 ^ (w >>> 7), 0x01000193);
    }
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export const data = buildDataset((x) => sin(x) + 0.5 * sin(2 * x) + sin(3 * x) / 3, {
  domain: [-10, 10],
  n: 120,
  bands: [
    [-7.5, -2],
    [1.5, 6.5],
  ],
  noise: { kind: 'gaussian', sigma: 0.08 },
  valFraction: 0.2,
  seed: 7,
  gridSize: 401,
});

export const SCENARIOS: Record<string, MLPConfig> = {
  relu_adam: mlp({ hidden: [32, 32] }),
  tanh_sgd: mlp({
    hidden: [16, 16],
    activations: ['tanh', 'tanh'],
    optimizer: { kind: 'sgd', lr: 0.05 },
  }),
  gelu_nesterov: mlp({
    hidden: [16],
    activations: ['gelu'],
    optimizer: { kind: 'nesterov', lr: 1e-4 },
  }),
  silu_rmsprop_cosine: mlp({
    hidden: [16, 8],
    activations: ['silu', 'elu'],
    optimizer: { kind: 'rmsprop', lr: 3e-3 },
    schedule: { kind: 'cosine', minLr: 1e-5, total: 300 },
  }),
  sin_adamw_huber: mlp({
    hidden: [12, 12],
    activations: ['sin', 'softplus'],
    optimizer: { kind: 'adamw', lr: 3e-3, weightDecay: 0.01 },
    loss: { kind: 'huber', delta: 0.5 },
  }),
  sigmoid_mini_dropout: mlp({
    hidden: [24, 24],
    activations: ['sigmoid', 'leaky_relu'],
    batch: { kind: 'mini', size: 16, shuffle: true },
    dropout: 0.1,
    l1: 1e-4,
    l2: 1e-3,
  }),
};

/** Every classical family (uses dmath trig/exp/log, sorting, QR, Cholesky, seeded bootstrap). */
export const CLASSICAL: Record<string, ClassicalConfig> = {
  poly: { kind: 'poly', degree: 13 },
  fourier: { kind: 'fourier', harmonics: 9, period: 0 },
  spline: { kind: 'spline', segments: 24, smoothing: 0.003 },
  knn: { kind: 'knn', k: 6, weights: 'distance' },
  tree: { kind: 'tree', ensemble: 'single', depth: 7, trees: 1, minLeaf: 2, lr: 0.1 },
  forest: { kind: 'tree', ensemble: 'forest', depth: 6, trees: 25, minLeaf: 2, lr: 0.1 },
  boost: { kind: 'tree', ensemble: 'boost', depth: 3, trees: 60, minLeaf: 1, lr: 0.2 },
  gp: {
    kind: 'gp',
    kernel: [
      { kind: 'periodic', scale: 1, length: 1, period: 6 },
      { kind: 'matern32', scale: 0.5, length: 2, period: 1 },
      { kind: 'linear', scale: 0.2, length: 1, period: 1 },
    ],
    noise: 0.1,
    tune: true,
  },
};

export const EPOCHS = 300;

export function runScenarios(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, config] of Object.entries(SCENARIOS)) {
    const r = createRun(config, data, 11);
    r.step(EPOCHS);
    out[name] =
      `${hash(r.trainLoss)}:${hash(r.valLoss)}:${hash(r.net.params)}:${hash(r.frame().grid)}`;
  }
  for (const [name, config] of Object.entries(CLASSICAL)) {
    const r = createRun(config, data, 11, EPOCHS);
    const grids: number[] = [];
    for (let e = 0; e < EPOCHS; e += 15) {
      r.step(15);
      const f = r.frame();
      grids.push(...f.grid, ...(f.band ?? []));
    }
    out[name] = `${hash(r.trainLoss)}:${hash(r.valLoss)}:${hash(grids)}`;
  }
  return out;
}

/** Same scenario through a real Worker (browser only). Returns the hash of all streamed losses and the last grid. */
export function runViaWorker(workerUrl: string, name = 'relu_adam'): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = new Worker(workerUrl, { type: 'module' });
    const losses: number[] = [];
    let last: FrameMsg | null = null;
    w.onerror = (e) => reject(new Error(e.message));
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === 'frame') {
        losses.push(...m.newTrainLoss);
        last = m;
        w.postMessage({ type: 'ack', seq: m.seq });
      } else if (m.type === 'done') {
        w.terminate();
        resolve(`${hash(losses)}:${hash(last ? last.grid : [])}`);
      } else if (m.type === 'error') {
        reject(new Error(m.message));
      }
    };
    w.postMessage({
      type: 'init',
      runId: name,
      config: SCENARIOS[name],
      data,
      seed: 11,
      epochs: EPOCHS,
      epochsPerFrame: 25,
    });
    w.postMessage({ type: 'play' });
  });
}

/** Node-side equivalent of runViaWorker (direct run, frames grid in f32). */
export function expectedWorkerHash(name = 'relu_adam'): string {
  const r = createRun(SCENARIOS[name], data, 11);
  r.step(EPOCHS);
  return `${hash(r.trainLoss)}:${hash(r.frame().grid)}`;
}
