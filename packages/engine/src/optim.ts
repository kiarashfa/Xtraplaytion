// Optimizers over one flat parameter vector, written to match torch.optim
// (SGD with momentum/nesterov and dampening 0, RMSprop, Adam, AdamW).
import { cos, pow, PI } from '@xtraplaytion/dmath';
import type { OptimizerConfig, Schedule } from './config.ts';

export class Optimizer {
  private readonly c: Required<OptimizerConfig>;
  private readonly m: Float64Array;
  private readonly v: Float64Array;
  private t = 0;

  constructor(config: OptimizerConfig, size: number) {
    this.c = {
      momentum: 0.9,
      beta1: 0.9,
      beta2: 0.999,
      alpha: 0.99,
      eps: 1e-8,
      weightDecay: 0,
      ...config,
    };
    this.m = new Float64Array(size);
    this.v = new Float64Array(size);
  }

  get steps(): number {
    return this.t;
  }

  /** One update of `p` with gradient `g` at learning rate `lr`. `g` may be modified. */
  step(p: Float64Array, g: Float64Array, lr: number): void {
    const c = this.c;
    const { m, v } = this;
    const n = p.length;
    this.t++;
    const wd = c.weightDecay;
    if (wd !== 0 && c.kind !== 'adamw') {
      for (let i = 0; i < n; i++) g[i] += wd * p[i];
    }
    switch (c.kind) {
      case 'sgd':
        for (let i = 0; i < n; i++) p[i] -= lr * g[i];
        break;
      case 'momentum':
      case 'nesterov': {
        const mu = c.momentum;
        const first = this.t === 1;
        for (let i = 0; i < n; i++) {
          m[i] = first ? g[i] : mu * m[i] + g[i];
          const d = c.kind === 'nesterov' ? g[i] + mu * m[i] : m[i];
          p[i] -= lr * d;
        }
        break;
      }
      case 'rmsprop': {
        const a = c.alpha;
        for (let i = 0; i < n; i++) {
          v[i] = a * v[i] + (1 - a) * g[i] * g[i];
          p[i] -= lr * (g[i] / (Math.sqrt(v[i]) + c.eps));
        }
        break;
      }
      case 'adam':
      case 'adamw': {
        if (c.kind === 'adamw' && wd !== 0) {
          const f = 1 - lr * wd;
          for (let i = 0; i < n; i++) p[i] *= f;
        }
        const b1 = c.beta1;
        const b2 = c.beta2;
        const bc1 = 1 - pow(b1, this.t);
        const bc2Sqrt = Math.sqrt(1 - pow(b2, this.t));
        const stepSize = lr / bc1;
        const w1 = 1 - b1;
        const w2 = 1 - b2;
        for (let i = 0; i < n; i++) {
          // torch: exp_avg.lerp_(grad, 1 - beta1), i.e. m + w (g - m) for w < 0.5
          m[i] = w1 < 0.5 ? m[i] + w1 * (g[i] - m[i]) : g[i] - (g[i] - m[i]) * (1 - w1);
          v[i] = b2 * v[i] + w2 * g[i] * g[i];
          const denom = Math.sqrt(v[i]) / bc2Sqrt + c.eps;
          p[i] -= stepSize * (m[i] / denom);
        }
        break;
      }
    }
  }

  /** Optimizer state, for moving a run between devices. */
  state(): { m: Float64Array; v: Float64Array; steps: number } {
    return { m: this.m.slice(), v: this.v.slice(), steps: this.t };
  }

  load(m: ArrayLike<number>, v: ArrayLike<number>, steps: number): void {
    this.m.set(m);
    this.v.set(v);
    this.t = steps;
  }

  reset(): void {
    this.m.fill(0);
    this.v.fill(0);
    this.t = 0;
  }
}

/** Learning rate for a 0-based epoch. */
export function lrAt(base: number, s: Schedule, epoch: number): number {
  switch (s.kind) {
    case 'constant':
      return base;
    case 'step':
      return base * pow(s.gamma, Math.floor(epoch / s.every));
    case 'cosine': {
      const t = Math.min(epoch, s.total);
      return s.minLr + 0.5 * (base - s.minLr) * (1 + cos((PI * t) / s.total));
    }
  }
}
