// Playground state (Svelte 5 runes). Inputs are plain reactive fields; the parsed
// formula, the dataset and the model config are derived; the run lives in a worker.
import {
  buildDataset,
  mlp,
  paramCountOf,
  type Activation,
  type Dataset,
  type LossKind,
  type MLPConfig,
  type Noise,
  type OptimizerKind,
  type RegionMetrics,
} from '@xtraplaytion/engine';
import { compile, parse, sample } from '@xtraplaytion/expr';
import type { Preset } from './presets.ts';
import { LIMITS, type ExperimentState } from './share.ts';
import { Trainer } from './trainer.ts';

export type Status = 'ready' | 'running' | 'paused' | 'done' | 'diverged' | 'error';
export type NoiseKind = 'none' | 'gaussian' | 'uniform' | 'outliers';

export const ACTIVATIONS: Activation[] = [
  'relu',
  'leaky_relu',
  'elu',
  'gelu',
  'silu',
  'softplus',
  'tanh',
  'sigmoid',
  'sin',
  'abs',
  'identity',
];
export const OPTIMIZERS: OptimizerKind[] = [
  'adam',
  'adamw',
  'sgd',
  'momentum',
  'nesterov',
  'rmsprop',
];
export const LOSSES: LossKind[] = ['mse', 'l1', 'huber'];

export interface Layer {
  width: number;
  act: Activation;
}

export class Playground {
  // ---- target and data
  expr = $state('sin(x) + 0.5 sin(2x) + (1/3) sin(3x)');
  domain = $state<[number, number]>([-10, 10]);
  n = $state(200);
  noiseKind = $state<NoiseKind>('gaussian');
  sigma = $state(0.08);
  seed = $state(7);
  valFraction = $state(0.2);
  bands = $state<[number, number][]>([
    [-7.5, -2],
    [1.5, 6.5],
  ]);
  // ---- model
  layers = $state<Layer[]>([
    { width: 64, act: 'relu' },
    { width: 64, act: 'relu' },
  ]);
  optimizer = $state<OptimizerKind>('adam');
  lr = $state(0.003);
  loss = $state<LossKind>('mse');
  // ---- training
  epochs = $state(1600);
  /** Epochs per frame, a power of two. */
  speed = $state(8);

  // ---- run (written by worker events)
  status = $state<Status>('ready');
  epoch = $state(0);
  grid = $state.raw<Float32Array | null>(null);
  trainLossNow = $state(NaN);
  valLossNow = $state(NaN);
  metrics = $state.raw<RegionMetrics | null>(null);
  epochsPerSec = $state(0);
  lossVersion = $state(0);
  errorMessage = $state('');
  pausedByHiddenTab = $state(false);

  readonly trainer: Trainer;

  parsed = $derived(parse(this.expr));
  fn = $derived(this.parsed.ok ? compile(this.parsed.expr) : null);

  noise = $derived.by((): Noise => {
    switch (this.noiseKind) {
      case 'none':
        return { kind: 'none' };
      case 'uniform':
        return { kind: 'uniform', width: 2 * this.sigma };
      case 'outliers':
        return { kind: 'outliers', sigma: this.sigma, percent: 5, magnitude: 1.5 };
      default:
        return { kind: 'gaussian', sigma: this.sigma };
    }
  });

  data = $derived.by((): Dataset | null => {
    const f = this.fn;
    if (!f) return null;
    const [a, b] = this.domain;
    if (!(b > a)) return null;
    return buildDataset(f, {
      domain: [a, b],
      n: Math.max(2, Math.min(LIMITS.n, Math.round(this.n))),
      bands: $state.snapshot(this.bands) as [number, number][],
      noise: this.noise,
      valFraction: this.valFraction,
      seed: this.seed,
      gridSize: 512,
    });
  });

  /** How many grid points are undefined (NaN, Inf), for the warning under the formula. */
  invalidPoints = $derived(this.fn && this.data ? sample(this.fn, this.data.gridX).invalid : 0);

  config = $derived.by((): MLPConfig =>
    mlp({
      hidden: this.layers.map((l) => l.width),
      activations: this.layers.map((l) => l.act),
      optimizer: {
        kind: this.optimizer,
        lr: this.lr,
        ...(this.optimizer === 'adamw' ? { weightDecay: 0.01 } : {}),
      },
      loss: { kind: this.loss, ...(this.loss === 'huber' ? { delta: 0.5 } : {}) },
    }),
  );

  paramCount = $derived(paramCountOf(this.config));

  constructor() {
    this.trainer = new Trainer({
      ready: () => {},
      frame: (f) => {
        this.epoch = f.epoch;
        this.grid = f.grid;
        this.trainLossNow = f.trainLoss;
        this.valLossNow = f.valLoss;
        this.metrics = f.metrics;
        if (f.epochsPerSec) this.epochsPerSec = f.epochsPerSec;
        this.lossVersion++;
      },
      done: (reason) => {
        this.status = reason === 'diverged' ? 'diverged' : 'done';
      },
      error: (message) => {
        this.status = 'error';
        this.errorMessage = message;
      },
    });
  }

  /** Start over from epoch 0 with the current settings (paused). */
  restart() {
    const data = this.data;
    if (!data) {
      this.trainer.dispose();
      this.grid = null;
      this.metrics = null;
      this.epoch = 0;
      this.status = 'ready';
      return;
    }
    this.status = 'ready';
    this.epoch = 0;
    this.epochsPerSec = 0;
    this.grid = null;
    this.trainer.start({
      config: $state.snapshot(this.config) as MLPConfig,
      data,
      seed: this.seed,
      epochs: this.epochs,
      epochsPerFrame: this.speed,
    });
  }

  play() {
    if (this.status === 'done' || this.status === 'diverged') this.restart();
    this.pausedByHiddenTab = false;
    this.trainer.play();
    this.status = 'running';
  }

  pause() {
    this.trainer.pause();
    if (this.status === 'running') this.status = 'paused';
  }

  toggle() {
    if (this.status === 'running') this.pause();
    else this.play();
  }

  step() {
    if (this.status === 'running') this.pause();
    this.trainer.step(1);
    if (this.status === 'ready') this.status = 'paused';
  }

  setSpeed(epochsPerFrame: number) {
    this.speed = epochsPerFrame;
    this.trainer.setSpeed(epochsPerFrame);
  }

  applyPreset(p: Preset) {
    this.expr = p.expr;
    this.domain = [...p.domain];
    this.n = p.n;
    this.noiseKind = p.sigma > 0 ? 'gaussian' : 'none';
    if (p.sigma > 0) this.sigma = p.sigma;
    this.bands = p.bands.map((b) => [...b] as [number, number]);
    this.layers = p.hidden.map((width) => ({ width, act: p.act }));
    this.optimizer = 'adam';
    this.lr = p.lr;
    this.loss = 'mse';
    this.epochs = p.epochs;
  }

  snapshotState(): ExperimentState {
    return {
      v: 1,
      expr: this.expr,
      domain: [...this.domain],
      n: this.n,
      noise: $state.snapshot(this.noise) as Noise,
      seed: this.seed,
      valFraction: this.valFraction,
      bands: $state.snapshot(this.bands) as [number, number][],
      model: $state.snapshot(this.config) as MLPConfig,
      epochs: this.epochs,
    };
  }

  loadState(s: ExperimentState) {
    this.expr = s.expr;
    this.domain = s.domain;
    this.n = s.n;
    this.seed = s.seed;
    this.valFraction = s.valFraction;
    this.bands = s.bands;
    const nz = s.noise;
    this.noiseKind = nz.kind === 'hetero' ? 'gaussian' : nz.kind;
    if (nz.kind === 'gaussian' || nz.kind === 'outliers' || nz.kind === 'hetero')
      this.sigma = nz.sigma;
    if (nz.kind === 'uniform') this.sigma = nz.width / 2;
    this.layers = s.model.hidden.map((width, i) => ({ width, act: s.model.activations[i] }));
    this.optimizer = s.model.optimizer.kind;
    this.lr = s.model.optimizer.lr;
    this.loss = s.model.loss.kind;
    this.epochs = s.epochs;
  }
}
