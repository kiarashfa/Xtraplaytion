// Classical models as runs. A model fits in closed form, so instead of training it
// grows through stages (polynomial degree, harmonics, smoothing, k, tree depth,
// boosting rounds, GP tuning steps...). Stages are spread over the first quarter of
// the race's epochs, then the final fit holds while neural networks keep learning.
// Every epoch still reports losses, so the history, loss plot and replay work as for
// networks.
import type { ClassicalConfig } from '../config.ts';
import type { Dataset } from '../data.ts';
import { scoreGrid } from '../metrics.ts';
import type { Frame } from '../run.ts';

/** One fitted stage. */
export interface Stage {
  /** What has grown so far: degree, harmonics, k, depth, trees, rounds, step... */
  value: number;
  /** Numbers the fitted model stores (coefficients, leaves, points...). */
  params: number;
  predict(xs: Float64Array, out: Float64Array): void;
  /** Posterior standard deviation of the function (Gaussian process only). */
  std?(xs: Float64Array, out: Float64Array): void;
}

export interface Fitter {
  readonly stages: number;
  /** Called with increasing (possibly skipping) s, each at most once. */
  stage(s: number): Stage;
}

/** Where a classical model is in its build-up. */
export interface StageInfo {
  /** 0-based stage index and stage count (finished when at = of - 1). */
  at: number;
  of: number;
  value: number;
  params: number;
}

/** Share of the race over which classical models build up. */
export const BUILD_SHARE = 0.25;

export type FitterFactory = (
  c: ClassicalConfig,
  x: Float64Array,
  y: Float64Array,
  seed: number,
) => Fitter;

function mse(pred: Float64Array, y: Float64Array): number {
  if (!y.length) return NaN;
  let s = 0;
  for (let i = 0; i < y.length; i++) {
    const r = pred[i] - y[i];
    s += r * r;
  }
  return s / y.length;
}

export class StagedRun {
  readonly config: ClassicalConfig;
  readonly data: Dataset;
  readonly seed: number;
  /** Mean squared error per epoch on the training and validation points. */
  readonly trainLoss: number[] = [];
  readonly valLoss: number[] = [];
  readonly diverged = false;
  private readonly fitter: Fitter;
  private readonly build: number;
  private ep = 0;
  private cur = -1;
  private st: Stage | null = null;
  private losses: [number, number] = [NaN, NaN];
  private gridAt = -1;
  private readonly gridOut: Float64Array;
  private readonly stdOut: Float64Array;
  private readonly trainOut: Float64Array;
  private readonly valOut: Float64Array;

  constructor(
    config: ClassicalConfig,
    data: Dataset,
    seed: number,
    epochs: number,
    factory: FitterFactory,
  ) {
    if (data.dim !== 1) throw new Error('Classical models support one input dimension');
    this.config = config;
    this.data = data;
    this.seed = seed;
    this.fitter = factory(config, data.trainX, data.trainY, seed);
    this.build = Math.max(1, Math.floor(epochs * BUILD_SHARE));
    this.gridOut = new Float64Array(data.gridX.length);
    this.stdOut = new Float64Array(data.gridX.length);
    this.trainOut = new Float64Array(data.trainY.length);
    this.valOut = new Float64Array(data.valY.length);
  }

  get epoch(): number {
    return this.ep;
  }

  get paramCount(): number {
    return this.st?.params ?? 0;
  }

  get stages(): number {
    return this.fitter.stages;
  }

  /** Stage shown at epoch e: the last one from the end of the build-up on. */
  stageAt(e: number): number {
    const last = this.fitter.stages - 1;
    if (last <= 0) return 0;
    return e >= this.build ? last : Math.floor((e * last) / this.build);
  }

  private ensure(s: number): Stage {
    if (s !== this.cur || !this.st) {
      const st = this.fitter.stage(s);
      this.cur = s;
      this.st = st;
      st.predict(this.data.trainX, this.trainOut);
      if (this.valOut.length) st.predict(this.data.valX, this.valOut);
      this.losses = [mse(this.trainOut, this.data.trainY), mse(this.valOut, this.data.valY)];
    }
    return this.st;
  }

  step(epochs: number): void {
    for (let e = 0; e < epochs; e++) {
      this.ensure(this.stageAt(this.ep));
      this.trainLoss.push(this.losses[0]);
      this.valLoss.push(this.losses[1]);
      this.ep++;
    }
  }

  predict(xs: Float64Array, out: Float64Array): void {
    this.ensure(this.stageAt(this.ep)).predict(xs, out);
  }

  frame(): Frame {
    const s = this.stageAt(this.ep);
    const st = this.ensure(s);
    const { gridX } = this.data;
    if (this.gridAt !== s) {
      st.predict(gridX, this.gridOut);
      if (st.std) st.std(gridX, this.stdOut);
      this.gridAt = s;
    }
    const n = this.trainLoss.length;
    return {
      epoch: this.ep,
      trainLoss: n ? this.trainLoss[n - 1] : NaN,
      valLoss: n ? this.valLoss[n - 1] : NaN,
      grid: Float32Array.from(this.gridOut),
      metrics: scoreGrid(this.gridOut, this.data),
      ...(st.std ? { band: Float32Array.from(this.stdOut) } : {}),
      stage: { at: s, of: this.fitter.stages, value: st.value, params: st.params },
    };
  }

  dispose(): void {
    this.trainLoss.length = 0;
    this.valLoss.length = 0;
  }
}

// ---- helpers shared by the families

/** Smallest and largest training x (0..1 when there are none). */
export function span(x: Float64Array): { lo: number; hi: number; width: number } {
  if (!x.length) return { lo: 0, hi: 1, width: 1 };
  let lo = x[0];
  let hi = x[0];
  for (let i = 1; i < x.length; i++) {
    if (x[i] < lo) lo = x[i];
    if (x[i] > hi) hi = x[i];
  }
  const width = hi - lo;
  return { lo, hi, width: width > 0 ? width : 1 };
}

export const clampInt = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : lo)));

/** A stage that predicts one constant (no data, or the simplest stage). */
export function constantStage(value: number, c: number, params = 1): Stage {
  return {
    value,
    params,
    predict: (_xs, out) => out.fill(c),
  };
}

export function meanOf(y: ArrayLike<number>): number {
  if (!y.length) return 0;
  let s = 0;
  for (let i = 0; i < y.length; i++) s += y[i];
  return s / y.length;
}

/** Training points sorted by x (ties keep their order), as parallel arrays. */
export function sortedByX(x: Float64Array, y: Float64Array): { x: Float64Array; y: Float64Array } {
  const idx = Array.from({ length: x.length }, (_, i) => i).sort((a, b) => x[a] - x[b] || a - b);
  return { x: Float64Array.from(idx, (i) => x[i]), y: Float64Array.from(idx, (i) => y[i]) };
}

/** Distinct integers from `from` to `to` (inclusive, at most `count` + 1), evenly spaced in
 *  square root, so they crowd towards the small end (k = 160, 130, ..., 7, 5). */
export function spreadInts(from: number, to: number, count: number): number[] {
  const out: number[] = [];
  if (from === to || count <= 1) return [to];
  const a = Math.sqrt(from);
  const b = Math.sqrt(to);
  for (let i = 0; i < count; i++) {
    const r = a + ((b - a) * i) / (count - 1);
    const v = Math.round(r * r);
    if (!out.length || out[out.length - 1] !== v) out.push(v);
  }
  if (out[out.length - 1] !== to) out.push(to);
  return out;
}
