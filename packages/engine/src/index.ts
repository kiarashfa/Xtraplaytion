/** Training engine (CPU, f64, deterministic). No DOM: runs in workers, Node and tests. */
export { ACTIVATIONS, RELU_LIKE } from './activations.ts';
export * from './config.ts';
export {
  buildDataset,
  regionOf,
  spreadPoints,
  Region,
  type DataSpec,
  type Dataset,
  type Noise,
} from './data.ts';
export { lossAndGrad, lossOnly } from './losses.ts';
export { regionMetrics, type RegionMetrics } from './metrics.ts';
export { MLP, type LayerView } from './mlp.ts';
export { lrAt, Optimizer } from './optim.ts';
export { createRun, MLPRun, type Frame, type Model } from './run.ts';
export type { FrameMsg, FromWorker, ToWorker } from './worker/protocol.ts';
export { MAX_IN_FLIGHT } from './worker/protocol.ts';
