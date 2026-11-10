// Loss map worker: one slice of the training loss around given weights, then it is
// thrown away. Runs beside the training workers, so training never waits for it.
import {
  lossSlice,
  scaleData,
  unscaleLoss,
  type Dataset,
  type MLPConfig,
} from '@xtraplaytion/engine';

export interface ProbeRequest {
  config: MLPConfig;
  params: Float32Array;
  /** In plot units; scaled here when the network trains on rescaled data. */
  data: Dataset;
  res: number;
  radius: number;
  seed: number;
}

export type ProbeReply =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; values: Float64Array; center: number; res: number; radius: number }
  | { type: 'error'; message: string };

declare const self: {
  postMessage(message: ProbeReply, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ProbeRequest>) => void) | null;
};

self.onmessage = (e) => {
  const { config, params, data, res, radius, seed } = e.data;
  try {
    const d = config.scale ? scaleData(data, config.scale) : data;
    const s = lossSlice(config, params, d, { res, radius, seed }, (done, total) => {
      self.postMessage({ type: 'progress', done, total });
    });
    if (!s) return;
    const back = (v: number) => (config.scale ? unscaleLoss(v, config.scale, config.loss.kind) : v);
    const values = s.values.map(back);
    self.postMessage(
      { type: 'done', values, center: back(s.center), res: s.res, radius: s.radius },
      [values.buffer],
    );
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
