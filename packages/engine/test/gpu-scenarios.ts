// GPU vs CPU parity scenarios (browser only; loaded by gpu.engines.ts).
// No Node APIs here.
import { createRun, GpuRun, mlp, requestDevice, type MLPConfig } from '../src/index.ts';
import type { FromWorker } from '../src/worker/protocol.ts';
import { data } from './scenarios.ts';

/** Every activation, optimizer, loss, schedule and penalty the GPU supports. */
export const GPU_SCENARIOS: Record<string, MLPConfig> = {
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
  silu_elu_rmsprop_cosine: mlp({
    hidden: [16, 8],
    activations: ['silu', 'elu'],
    optimizer: { kind: 'rmsprop', lr: 3e-3 },
    schedule: { kind: 'cosine', minLr: 1e-5, total: 60 },
  }),
  sin_softplus_adamw_huber: mlp({
    hidden: [12, 12],
    activations: ['sin', 'softplus'],
    optimizer: { kind: 'adamw', lr: 3e-3, weightDecay: 0.01 },
    loss: { kind: 'huber', delta: 0.5 },
  }),
  sigmoid_leaky_momentum_step_penalties: mlp({
    hidden: [24, 24],
    activations: ['sigmoid', 'leaky_relu'],
    optimizer: { kind: 'momentum', lr: 0.02, weightDecay: 1e-3 },
    schedule: { kind: 'step', every: 20, gamma: 0.5 },
    l1: 1e-4,
    l2: 1e-3,
  }),
  abs_identity_l1: mlp({
    hidden: [20, 20],
    activations: ['abs', 'identity'],
    loss: { kind: 'l1' },
    optimizer: { kind: 'adam', lr: 3e-3 },
  }),
  wide_relu: mlp({ hidden: [300, 300], optimizer: { kind: 'adam', lr: 1e-3 } }),
};

export const PARITY_EPOCHS = 60;

export interface Parity {
  /** Largest relative difference of the training loss over all epochs. */
  loss: number;
  /** Largest relative difference of the validation loss. */
  val: number;
  /** Largest |gpu - cpu| on the grid after training, relative to the CPU prediction range. */
  grid: number;
  epochs: number;
}

export async function hasGpu(): Promise<string | null> {
  try {
    const { device, adapter } = await requestDevice();
    device.destroy();
    return adapter;
  } catch {
    return null;
  }
}

export async function parity(): Promise<Record<string, Parity>> {
  const out: Record<string, Parity> = {};
  for (const [name, config] of Object.entries(GPU_SCENARIOS)) {
    const cpu = createRun(config, data, 11);
    cpu.step(PARITY_EPOCHS);
    const cf = cpu.frame();
    const { device } = await requestDevice();
    const gpu = await GpuRun.create(device, config, data, 11);
    // Uneven chunks exercise the step counter across submissions.
    await gpu.step(7);
    await gpu.step(PARITY_EPOCHS - 7);
    const gf = await gpu.frame();
    gpu.dispose();
    device.destroy();
    const rel = (a: number[], b: number[]) =>
      Math.max(0, ...a.map((x, i) => Math.abs(b[i] - x) / Math.max(Math.abs(x), 1e-12)));
    let lo = Infinity;
    let hi = -Infinity;
    let diff = 0;
    for (let i = 0; i < cf.grid.length; i++) {
      lo = Math.min(lo, cf.grid[i]);
      hi = Math.max(hi, cf.grid[i]);
      diff = Math.max(diff, Math.abs(gf.grid[i] - cf.grid[i]));
    }
    out[name] = {
      loss: rel(cpu.trainLoss, gpu.trainLoss),
      val: rel(cpu.valLoss, gpu.valLoss),
      grid: diff / Math.max(hi - lo, 1e-12),
      epochs: gpu.epoch,
    };
  }
  return out;
}

/** Throughput of [1, w, w, 1] on 200 points (epochs per second). */
export async function throughput(width: number, epochs: number): Promise<number> {
  const config = mlp({ hidden: [width, width] });
  const { device } = await requestDevice();
  const gpu = await GpuRun.create(device, config, data, 1);
  await gpu.step(10); // warm-up: pipelines, clocks
  const t0 = performance.now();
  await gpu.step(epochs);
  const ms = performance.now() - t0;
  gpu.dispose();
  device.destroy();
  return (epochs / ms) * 1000;
}

/** GPU vs CPU epochs per second for [1, w, w, 1] on the shared dataset. */
export async function speedTable(): Promise<Record<string, { gpu: number; cpu: number }>> {
  const out: Record<string, { gpu: number; cpu: number }> = {};
  for (const w of [10, 32, 100, 300, 1000]) {
    const gpu = await throughput(w, w >= 1000 ? 100 : 400);
    const cpuRun = createRun(mlp({ hidden: [w, w] }), data, 1);
    const epochs = w >= 1000 ? 2 : w >= 300 ? 20 : 200;
    cpuRun.step(2);
    const t0 = performance.now();
    cpuRun.step(epochs);
    const cpu = (epochs / (performance.now() - t0)) * 1000;
    out[w] = { gpu: Math.round(gpu), cpu: Math.round(cpu) };
  }
  return out;
}

export interface WorkerReport {
  ready: Extract<FromWorker, { type: 'ready' }> | null;
  recovered: Extract<FromWorker, { type: 'recovered' }>[];
  backends: string[];
  /** Training losses reassembled the way the page does it (truncate, then append). */
  losses: number;
  epoch: number;
  done: string;
}

/** Trains through the real worker on the GPU and simulates a device loss halfway. */
export function viaWorker(workerUrl: string, epochs = 120): Promise<WorkerReport> {
  return new Promise((resolve, reject) => {
    const w = new Worker(workerUrl, { type: 'module' });
    const report: WorkerReport = {
      ready: null,
      recovered: [],
      backends: [],
      losses: 0,
      epoch: 0,
      done: '',
    };
    let lost = false;
    const series: number[] = [];
    w.onerror = (e) => reject(new Error(e.message));
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === 'ready') report.ready = m;
      else if (m.type === 'recovered') report.recovered.push(m);
      else if (m.type === 'frame') {
        series.length = m.epoch - m.newTrainLoss.length;
        series.push(...m.newTrainLoss);
        report.losses = series.filter(Number.isFinite).length;
        report.epoch = m.epoch;
        if (!report.backends.includes(m.backend)) report.backends.push(m.backend);
        w.postMessage({ type: 'ack', seq: m.seq });
        if (!lost && m.epoch >= epochs / 2) {
          lost = true;
          w.postMessage({ type: 'simulateDeviceLoss' });
        }
      } else if (m.type === 'done') {
        report.done = m.reason;
        w.terminate();
        resolve(report);
      } else if (m.type === 'error') {
        w.terminate();
        reject(new Error(m.message));
      }
    };
    w.postMessage({
      type: 'init',
      runId: 'gpu',
      config: GPU_SCENARIOS.relu_adam,
      data,
      seed: 11,
      epochs,
      epochsPerFrame: 10,
      backend: 'gpu',
    });
    w.postMessage({ type: 'play' });
  });
}
