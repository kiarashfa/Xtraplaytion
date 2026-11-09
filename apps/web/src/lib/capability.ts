// First-run speed check: how much training work this device does per second.
// One unit = one parameter x one training point x one epoch. Cached per browser
// (a convenience only: without storage it is simply measured again). With WebGPU
// the graphics card is measured too: a fixed cost per epoch plus work units.
import {
  buildDataset,
  mlp,
  paramCountOf,
  type Activation,
  type MLPConfig,
} from '@xtraplaytion/engine';
import { Trainer } from './trainer.ts';

const KEY = 'xp-speed-v1';
const GPU_KEY = 'xp-gpu-v1';
const TRANSCENDENTAL: ReadonlySet<Activation> = new Set([
  'tanh',
  'sigmoid',
  'sin',
  'gelu',
  'silu',
  'softplus',
  'elu',
]);

/** A conservative fallback (a mid-range phone) used until the measurement is in. */
export const FALLBACK_SPEED = 2e8;

export function cachedSpeed(): number | null {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

const benchData = buildDataset((x) => Math.sin(x), {
  domain: [-3, 3],
  n: 200,
  bands: [],
  noise: { kind: 'none' },
  valFraction: 0,
  seed: 1,
  gridSize: 2,
});

/** Seconds to train `epochs` epochs in a worker (timed from the untrained frame), or null. */
function timeRun(
  config: MLPConfig,
  epochs: number,
  backend: 'cpu' | 'gpu',
): Promise<number | null> {
  return new Promise((resolve) => {
    let t0 = 0;
    const finish = (sec: number | null) => {
      clearTimeout(timer);
      tr.dispose();
      resolve(sec);
    };
    const tr = new Trainer({
      ready: (m) => {
        if (backend === 'gpu' && m.backend !== 'webgpu') finish(null);
      },
      frame: (f) => {
        if (f.epoch === 0) {
          t0 = performance.now(); // worker (and GPU pipelines) ready; start timing now
          tr.play();
        }
      },
      done: () => finish(Math.max(1e-3, (performance.now() - t0) / 1000)),
      error: () => finish(null),
    });
    const timer = setTimeout(() => finish(null), 15000);
    tr.start({ config, data: benchData, seed: 1, epochs, epochsPerFrame: epochs, backend });
  });
}

export async function measureSpeed(): Promise<number> {
  const cached = cachedSpeed();
  if (cached) return cached;
  const config = mlp({ hidden: [64, 64] });
  const epochs = 400;
  const sec = await timeRun(config, epochs, 'cpu');
  const speed = sec ? (paramCountOf(config) * benchData.trainY.length * epochs) / sec : 0;
  if (!speed) return FALLBACK_SPEED;
  try {
    localStorage.setItem(KEY, String(Math.round(speed)));
  } catch {
    // storage unavailable: measure again next time
  }
  return speed;
}

/** GPU cost model: seconds per epoch = overhead + units / speed. */
export interface GpuSpeed {
  overhead: number;
  speed: number;
}
/** A modest integrated GPU, used until the measurement is in. */
export const FALLBACK_GPU: GpuSpeed = { overhead: 4e-4, speed: 1e10 };

export const webgpuPresent = () =>
  typeof (globalThis.navigator as { gpu?: unknown } | undefined)?.gpu === 'object';

export function cachedGpu(): GpuSpeed | null {
  try {
    const v = JSON.parse(localStorage.getItem(GPU_KEY) ?? 'null') as GpuSpeed | null;
    return v && v.overhead > 0 && v.speed > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Measures the GPU (two small runs). Null when this browser has no usable WebGPU. */
export async function measureGpu(): Promise<GpuSpeed | null> {
  const cached = cachedGpu();
  if (cached) return cached;
  if (!webgpuPresent()) return null;
  const small = await timeRun(mlp({ hidden: [8, 8] }), 300, 'gpu');
  if (small === null) return null;
  const bigConfig = mlp({ hidden: [384, 384] });
  const bigEpochs = 60;
  const big = await timeRun(bigConfig, bigEpochs, 'gpu');
  if (big === null) return null;
  const overhead = small / 300;
  const units = paramCountOf(bigConfig) * benchData.trainY.length;
  const perEpoch = Math.max(big / bigEpochs - overhead, overhead * 0.1);
  const result = { overhead, speed: units / perEpoch };
  try {
    localStorage.setItem(GPU_KEY, JSON.stringify(result));
  } catch {
    // measure again next time
  }
  return result;
}

/** Estimated seconds to train a model on the GPU. */
export function estimateGpuSeconds(
  params: number,
  points: number,
  epochs: number,
  gpu: GpuSpeed,
): number {
  return epochs * (gpu.overhead + (params * Math.max(1, points)) / gpu.speed);
}

/** Estimated seconds to train a model on this device. */
export function estimateSeconds(
  params: number,
  points: number,
  epochs: number,
  acts: Activation[],
  speed: number,
): number {
  const slow = acts.some((a) => TRANSCENDENTAL.has(a)) ? 1.9 : 1;
  return ((params * Math.max(1, points) * epochs) / speed) * slow;
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec)) return '-';
  if (sec < 1) return '< 1 s';
  if (sec < 90) return `${Math.round(sec)} s`;
  if (sec < 5400) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toFixed(1)} h`;
}
