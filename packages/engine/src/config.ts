// Model configuration. One plain-data description that the UI, share links,
// saved files, the worker and code export all use.

export type Activation =
  | 'relu'
  | 'leaky_relu'
  | 'elu'
  | 'gelu'
  | 'silu'
  | 'softplus'
  | 'tanh'
  | 'sigmoid'
  | 'sin'
  | 'abs'
  | 'identity';

export type InitKind =
  | 'auto'
  | 'xavier_uniform'
  | 'xavier_normal'
  | 'he_uniform'
  | 'he_normal'
  | 'normal'
  | 'torch_default';

export type OptimizerKind = 'sgd' | 'momentum' | 'nesterov' | 'rmsprop' | 'adam' | 'adamw';
export type LossKind = 'mse' | 'l1' | 'huber';

export type Schedule =
  | { kind: 'constant' }
  | { kind: 'step'; every: number; gamma: number }
  | { kind: 'cosine'; minLr: number; total: number };

export interface OptimizerConfig {
  kind: OptimizerKind;
  lr: number;
  /** momentum / nesterov (default 0.9) */
  momentum?: number;
  /** adam / adamw (defaults 0.9, 0.999) */
  beta1?: number;
  beta2?: number;
  /** rmsprop smoothing (default 0.99) */
  alpha?: number;
  /** default 1e-8 */
  eps?: number;
  /** PyTorch-style weight decay on all parameters (decoupled for adamw). */
  weightDecay?: number;
}

export type BatchConfig = { kind: 'full' } | { kind: 'mini'; size: number; shuffle: boolean };

export interface MLPConfig {
  kind: 'mlp';
  /** Input dimension (1 in v1; kept general). */
  inDim: number;
  /** Hidden layer widths, e.g. [10, 10] for [1, 10, 10, 1]. */
  hidden: number[];
  /** One activation per hidden layer. The output layer is linear. */
  activations: Activation[];
  init: { kind: InitKind; std?: number };
  optimizer: OptimizerConfig;
  schedule: Schedule;
  loss: { kind: LossKind; delta?: number };
  /** Penalties on weights (not biases) added to the loss. */
  l1: number;
  l2: number;
  batch: BatchConfig;
  /** Dropout probability after each hidden activation, training only. */
  dropout: number;
}

// ---- Classical models. They fit in closed form (or by a short inner optimization) and
// still animate: each one grows through stages (see classical/staged.ts).

/** Least-squares polynomial (Legendre basis inside, the same polynomial outside). */
export interface PolyConfig {
  kind: 'poly';
  degree: number;
}

/** Least-squares Fourier series: a constant plus `harmonics` sine/cosine pairs. */
export interface FourierConfig {
  kind: 'fourier';
  harmonics: number;
  /** Length after which the series repeats, in x units. 0 = the span of the training data. */
  period: number;
}

/** Penalized cubic B-spline (P-spline). Continues as a straight line beyond the data. */
export interface SplineConfig {
  kind: 'spline';
  /** Equal pieces between the first and last training point. */
  segments: number;
  /** Penalty on bending, per training point (0 = plain least squares). */
  smoothing: number;
}

export interface KnnConfig {
  kind: 'knn';
  k: number;
  weights: 'uniform' | 'distance';
}

export interface TreeConfig {
  kind: 'tree';
  /** One regression tree, a random forest (bagging) or gradient boosting. */
  ensemble: 'single' | 'forest' | 'boost';
  depth: number;
  /** Trees in a forest, rounds of boosting (ignored for a single tree). */
  trees: number;
  /** Fewest training points in a leaf. */
  minLeaf: number;
  /** Boosting learning rate (shrinkage). */
  lr: number;
}

export type KernelKind = 'rbf' | 'matern12' | 'matern32' | 'matern52' | 'periodic' | 'linear';

/** One term of a sum kernel. Units: `scale` relative to the spread (std) of the training
 *  targets; `length` and `period` in x units (unused by kinds that do not need them). */
export interface KernelPart {
  kind: KernelKind;
  scale: number;
  length: number;
  period: number;
}

/** Gaussian process regression. With `tune` off this is kernel ridge regression (the GP
 *  mean), with ridge strength = noise variance; the band is the GP posterior either way. */
export interface GPConfig {
  kind: 'gp';
  kernel: KernelPart[];
  /** Noise std relative to the spread of the training targets. */
  noise: number;
  /** Maximize the evidence (log marginal likelihood) from the given starting values. */
  tune: boolean;
}

export type ClassicalConfig =
  PolyConfig | FourierConfig | SplineConfig | KnnConfig | TreeConfig | GPConfig;
export type ModelConfig = MLPConfig | ClassicalConfig;
export type ModelKind = ModelConfig['kind'];

export const isMLP = (c: ModelConfig): c is MLPConfig => c.kind === 'mlp';

/** Layer widths including input and output, e.g. [1, 10, 10, 1]. */
export function dimsOf(c: MLPConfig): number[] {
  return [c.inDim, ...c.hidden, 1];
}

export function mlp(partial: Partial<MLPConfig> & Pick<MLPConfig, 'hidden'>): MLPConfig {
  const hidden = partial.hidden;
  return {
    kind: 'mlp',
    inDim: 1,
    activations: hidden.map(() => 'relu'),
    // PyTorch nn.Linear default: weights and biases U(-1/sqrt(fan_in), +). Measured to fit
    // 1-D targets far better than zero biases, which put every first-layer ReLU kink at x = 0.
    init: { kind: 'torch_default' },
    optimizer: { kind: 'adam', lr: 1e-3 },
    schedule: { kind: 'constant' },
    loss: { kind: 'mse' },
    l1: 0,
    l2: 0,
    batch: { kind: 'full' },
    dropout: 0,
    ...partial,
  };
}

export function paramCountOf(c: MLPConfig): number {
  const d = dimsOf(c);
  let s = 0;
  for (let l = 0; l + 1 < d.length; l++) s += d[l] * d[l + 1] + d[l + 1];
  return s;
}
