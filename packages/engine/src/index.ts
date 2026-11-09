/** Training engine: CPU (f64, deterministic) and WebGPU (f32, approximate). No DOM. */
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
export { GpuRun, gpuUnsupported, requestDevice, type Checkpoint } from './gpu/run.ts';
export type {
  Backend,
  BackendChoice,
  FallbackReason,
  FrameMsg,
  FromWorker,
  ReadyMsg,
  ToWorker,
} from './worker/protocol.ts';
export { MAX_IN_FLIGHT } from './worker/protocol.ts';
