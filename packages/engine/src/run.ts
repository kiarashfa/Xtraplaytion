// A training run: model + data + optimizer + history. Iterative and (later)
// closed-form models all produce frames through this interface.
import { Rng } from '@xtraplaytion/dmath';
import { makeFitter } from './classical/index.ts';
import { StagedRun, type StageInfo } from './classical/staged.ts';
import type { MLPConfig, ModelConfig } from './config.ts';
import type { Dataset } from './data.ts';
import { lossAndGrad, lossOnly } from './losses.ts';
import { regionMetrics, type RegionMetrics } from './metrics.ts';
import { MLP } from './mlp.ts';
import { lrAt, Optimizer } from './optim.ts';

export interface Frame {
  epoch: number;
  trainLoss: number;
  valLoss: number;
  /** Predictions on the dataset grid (f32 is plenty for drawing). */
  grid: Float32Array;
  metrics: RegionMetrics;
  /** Posterior standard deviation on the grid (Gaussian process). */
  band?: Float32Array;
  /** Build-up of a classical model. */
  stage?: StageInfo;
}

export interface Model {
  readonly paramCount: number;
  readonly epoch: number;
  step(epochs: number): void;
  predict(xs: Float64Array, out: Float64Array): void;
  frame(): Frame;
  dispose(): void;
}

export class MLPRun implements Model {
  readonly net: MLP;
  readonly opt: Optimizer;
  /** Loss per epoch (data term only, before that epoch's update). */
  readonly trainLoss: number[] = [];
  readonly valLoss: number[] = [];
  private ep = 0;
  private readonly order: Int32Array;
  private readonly shuffle: Rng;
  private readonly bx: Float64Array;
  private readonly by: Float64Array;
  private readonly dOut: Float64Array;
  private readonly gridOut: Float64Array;
  private readonly valOut: Float64Array;

  readonly config: MLPConfig;
  readonly data: Dataset;
  readonly seed: number;

  constructor(config: MLPConfig, data: Dataset, seed: number) {
    this.config = config;
    this.data = data;
    this.seed = seed;
    this.net = new MLP(config, seed);
    this.opt = new Optimizer(config.optimizer, this.net.paramCount);
    const n = data.trainY.length;
    this.order = Int32Array.from({ length: n }, (_, i) => i);
    this.shuffle = new Rng(seed, 4);
    this.bx = new Float64Array(n * data.dim);
    this.by = new Float64Array(n);
    this.dOut = new Float64Array(n);
    this.gridOut = new Float64Array(data.gridX.length);
    this.valOut = new Float64Array(data.valY.length);
  }

  get paramCount(): number {
    return this.net.paramCount;
  }

  get epoch(): number {
    return this.ep;
  }

  /** True once the training loss is no longer finite (learning rate too high, for example). */
  get diverged(): boolean {
    const last = this.trainLoss[this.trainLoss.length - 1];
    return last !== undefined && !Number.isFinite(last);
  }

  step(epochs: number): void {
    const { trainX, trainY, dim } = this.data;
    const n = trainY.length;
    if (n === 0) return;
    const c = this.config;
    const lossCfg = c.loss;
    for (let e = 0; e < epochs; e++) {
      const lr = lrAt(c.optimizer.lr, c.schedule, this.ep);
      if (c.batch.kind === 'full') {
        const out = this.net.forward(trainX, n, true);
        this.trainLoss.push(lossAndGrad(lossCfg.kind, out, trainY, n, this.dOut, lossCfg.delta));
        this.net.backward(this.dOut, n);
        this.opt.step(this.net.params, this.net.grads, lr);
      } else {
        const size = Math.max(1, Math.min(n, Math.floor(c.batch.size)));
        if (c.batch.shuffle) {
          for (let i = n - 1; i > 0; i--) {
            const j = this.shuffle.int(i + 1);
            const t = this.order[i];
            this.order[i] = this.order[j];
            this.order[j] = t;
          }
        }
        let weighted = 0;
        for (let s = 0; s < n; s += size) {
          const m = Math.min(size, n - s);
          for (let i = 0; i < m; i++) {
            const src = this.order[s + i];
            for (let d = 0; d < dim; d++) this.bx[i * dim + d] = trainX[src * dim + d];
            this.by[i] = trainY[src];
          }
          const out = this.net.forward(this.bx, m, true);
          weighted += lossAndGrad(lossCfg.kind, out, this.by, m, this.dOut, lossCfg.delta) * m;
          this.net.backward(this.dOut, m);
          this.opt.step(this.net.params, this.net.grads, lr);
        }
        this.trainLoss.push(weighted / n);
      }
      this.valLoss.push(this.validationLoss());
      this.ep++;
      if (this.diverged) break; // nothing more to learn from NaN weights
    }
  }

  validationLoss(): number {
    const { valX, valY } = this.data;
    if (!valY.length) return NaN;
    this.net.predict(valX, valY.length, this.valOut);
    return lossOnly(this.config.loss.kind, this.valOut, valY, valY.length, this.config.loss.delta);
  }

  predict(xs: Float64Array, out: Float64Array): void {
    this.net.predict(xs, xs.length / this.data.dim, out);
  }

  frame(): Frame {
    const { gridX, clean, region } = this.data;
    this.net.predict(gridX, gridX.length, this.gridOut);
    return {
      epoch: this.ep,
      trainLoss: this.trainLoss.length ? this.trainLoss[this.trainLoss.length - 1] : NaN,
      valLoss: this.valLoss.length ? this.valLoss[this.valLoss.length - 1] : NaN,
      grid: Float32Array.from(this.gridOut),
      metrics: regionMetrics(this.gridOut, clean, region),
    };
  }

  /** Continues from a checkpoint (for example one taken on the GPU before it was lost). */
  restore(cp: {
    epoch: number;
    steps: number;
    params: ArrayLike<number>;
    m: ArrayLike<number>;
    v: ArrayLike<number>;
    trainLoss: number[];
    valLoss: number[];
  }): void {
    this.net.params.set(cp.params);
    this.opt.load(cp.m, cp.v, cp.steps);
    this.trainLoss.length = 0;
    this.valLoss.length = 0;
    for (const x of cp.trainLoss) this.trainLoss.push(x);
    for (const x of cp.valLoss) this.valLoss.push(x);
    this.ep = cp.epoch;
  }

  dispose(): void {
    this.trainLoss.length = 0;
    this.valLoss.length = 0;
  }
}

/** A network trains; a classical model builds up over the first quarter of `epochs`. */
export function createRun(config: MLPConfig, data: Dataset, seed: number, epochs?: number): MLPRun;
export function createRun(
  config: ModelConfig,
  data: Dataset,
  seed: number,
  epochs: number,
): MLPRun | StagedRun;
export function createRun(
  config: ModelConfig,
  data: Dataset,
  seed: number,
  epochs = 1,
): MLPRun | StagedRun {
  if (config.kind === 'mlp') return new MLPRun(config, data, seed);
  return new StagedRun(config, data, seed, epochs, makeFitter);
}
