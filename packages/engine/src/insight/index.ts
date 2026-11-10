// Insight views: what is going on inside a model (pure functions, no DOM).
export {
  evalKinks,
  hasKinks,
  kinksOf,
  PIECEWISE_LINEAR,
  type KinkOptions,
  type Kinks,
} from './kinks.ts';
export {
  filterDirection,
  lossSlice,
  sliceCost,
  type LossSlice,
  type SliceOptions,
} from './landscape.ts';
export { inspectNet, neuronParts, type NeuronPart, type NeuronParts } from './neurons.ts';
export { WaveBasis, waveFrequencies, waveRange } from './waves.ts';
export { histogram, layerStats, type Histogram, type LayerStats } from './weights.ts';
