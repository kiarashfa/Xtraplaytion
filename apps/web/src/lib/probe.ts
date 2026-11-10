// Page side of the loss map worker.
import type { Dataset, MLPConfig } from '@xtraplaytion/engine';
import type { ProbeReply } from '../workers/probe.ts';

export interface LossMap {
  values: Float64Array;
  center: number;
  res: number;
  radius: number;
  /** Epoch of the weights it was made at. */
  epoch: number;
  seed: number;
  seconds: number;
}

export interface MapJob {
  promise: Promise<LossMap>;
  cancel(): void;
}

export function mapLoss(
  opts: {
    config: MLPConfig;
    params: Float32Array;
    data: Dataset;
    res: number;
    epoch: number;
    seed: number;
  },
  onProgress: (share: number) => void,
): MapJob {
  const w = new Worker(new URL('../workers/probe.ts', import.meta.url), { type: 'module' });
  const t0 = performance.now();
  let settle: ((e: Error) => void) | null = null;
  const promise = new Promise<LossMap>((resolve, reject) => {
    settle = reject;
    w.onmessage = (e: MessageEvent<ProbeReply>) => {
      const m = e.data;
      if (m.type === 'progress') onProgress(m.done / m.total);
      else if (m.type === 'error') {
        w.terminate();
        reject(new Error(m.message));
      } else {
        w.terminate();
        resolve({
          values: m.values,
          center: m.center,
          res: m.res,
          radius: m.radius,
          epoch: opts.epoch,
          seed: opts.seed,
          seconds: (performance.now() - t0) / 1000,
        });
      }
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message || 'worker error'));
    };
  });
  w.postMessage({
    config: opts.config,
    params: opts.params,
    data: opts.data,
    res: opts.res,
    radius: 1,
    seed: opts.seed,
  });
  return {
    promise,
    cancel: () => {
      w.terminate();
      settle?.(new Error('cancelled'));
    },
  };
}
