// Gaussian process regression with sum kernels. Targets are standardized (the prior
// mean is the mean of the training targets, so far from the data the fit returns to
// it and the band widens to the prior spread).
//
// Tune on: the hyperparameters climb the evidence (log marginal likelihood) with Adam
// on their logarithms; stages are snapshots of that climb. Tune off: kernel ridge
// regression with fixed settings (ridge strength = noise variance); stages lower the
// noise from a heavy smoothing to the chosen value. The posterior band is shown in
// both modes.
import { cos, exp, log, PI, Rng, sin, sqrt } from '@xtraplaytion/dmath';
import type { GPConfig, KernelPart } from '../config.ts';
import { backward, cholesky, cholInverse, forward } from './linalg.ts';
import { constantStage, span, type Fitter, type Stage } from './staged.ts';

/** The final fit uses at most this many training points (a seeded subset beyond). */
export const GP_MAX_POINTS = 1000;
/** Tuning steps and intermediate stages use at most this many. */
export const GP_TUNE_POINTS = 250;
const TUNE_STEPS = 120;
const FRAME_EVERY = 3;
const FIXED_STAGES = 25;
const ADAM_LR = 0.08;

const SQRT3 = sqrt(3);
const SQRT5 = sqrt(5);

export const usesLength = (k: KernelPart['kind']) => k !== 'linear';
export const usesPeriod = (k: KernelPart['kind']) => k === 'periodic';

/** A tunable hyperparameter: which part (or -1 for noise) and field, with bounds. */
interface Param {
  part: number;
  field: 'scale' | 'length' | 'period' | 'noise';
  lo: number;
  hi: number;
}

function paramsOf(parts: KernelPart[], width: number): Param[] {
  const out: Param[] = [];
  parts.forEach((p, i) => {
    out.push({ part: i, field: 'scale', lo: 1e-2, hi: 1e2 });
    if (usesLength(p.kind))
      out.push({ part: i, field: 'length', lo: width * 1e-3, hi: width * 1e2 });
    if (usesPeriod(p.kind))
      out.push({ part: i, field: 'period', lo: width * 1e-2, hi: width * 1e2 });
  });
  out.push({ part: -1, field: 'noise', lo: 1e-3, hi: 10 });
  return out;
}

const clamp = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

/** Kernel with concrete values (in standardized target units). */
class Kernel {
  readonly kinds: KernelPart['kind'][];
  readonly s2: Float64Array;
  readonly len: Float64Array;
  readonly per: Float64Array;
  noise2 = 0;
  private readonly center: number;
  private readonly half: number;

  constructor(parts: KernelPart[], center: number, half: number) {
    this.kinds = parts.map((p) => p.kind);
    this.s2 = new Float64Array(parts.length);
    this.len = new Float64Array(parts.length);
    this.per = new Float64Array(parts.length);
    this.center = center;
    this.half = half;
  }

  clone(): Kernel {
    const k = new Kernel([], this.center, this.half);
    Object.assign(k, {
      kinds: this.kinds,
      s2: this.s2.slice(),
      len: this.len.slice(),
      per: this.per.slice(),
      noise2: this.noise2,
    });
    return k;
  }

  /** Sets values from log-parameters. */
  set(params: Param[], theta: Float64Array) {
    params.forEach((p, j) => {
      const v = exp(theta[j]);
      if (p.field === 'noise') this.noise2 = v * v;
      else if (p.field === 'scale') this.s2[p.part] = v * v;
      else if (p.field === 'length') this.len[p.part] = v;
      else this.per[p.part] = v;
    });
  }

  k(a: number, b: number): number {
    let s = 0;
    for (let i = 0; i < this.kinds.length; i++) s += this.part(i, a, b);
    return s;
  }

  part(i: number, a: number, b: number): number {
    const s2 = this.s2[i];
    const r = Math.abs(a - b);
    const l = this.len[i];
    switch (this.kinds[i]) {
      case 'rbf':
        return s2 * exp((-r * r) / (2 * l * l));
      case 'matern12':
        return s2 * exp(-r / l);
      case 'matern32': {
        const q = (SQRT3 * r) / l;
        return s2 * (1 + q) * exp(-q);
      }
      case 'matern52': {
        const q = (SQRT5 * r) / l;
        return s2 * (1 + q + (q * q) / 3) * exp(-q);
      }
      case 'periodic': {
        const sn = sin((PI * r) / this.per[i]);
        return s2 * exp((-2 * sn * sn) / (l * l));
      }
      case 'linear':
        return (s2 * (a - this.center) * (b - this.center)) / (this.half * this.half);
    }
  }

  /** dk(a, b)/d(log param j) for every parameter except noise, into out. */
  grads(params: Param[], a: number, b: number, out: Float64Array) {
    const r = Math.abs(a - b);
    for (let j = 0; j < params.length; j++) {
      const p = params[j];
      if (p.field === 'noise') {
        out[j] = 0;
        continue;
      }
      const i = p.part;
      if (p.field === 'scale') {
        out[j] = 2 * this.part(i, a, b);
        continue;
      }
      const s2 = this.s2[i];
      const l = this.len[i];
      switch (this.kinds[i]) {
        case 'rbf':
          out[j] = (this.part(i, a, b) * r * r) / (l * l);
          break;
        case 'matern12':
          out[j] = (this.part(i, a, b) * r) / l;
          break;
        case 'matern32': {
          const q = (SQRT3 * r) / l;
          out[j] = s2 * q * q * exp(-q);
          break;
        }
        case 'matern52': {
          const q = (SQRT5 * r) / l;
          out[j] = ((s2 * q * q) / 3) * (1 + q) * exp(-q);
          break;
        }
        case 'periodic': {
          const u = (PI * r) / this.per[i];
          const sn = sin(u);
          const kv = this.part(i, a, b);
          out[j] =
            p.field === 'length'
              ? (kv * 4 * sn * sn) / (l * l)
              : (kv * 2 * u * 2 * sn * cos(u)) / (l * l);
          break;
        }
        case 'linear':
          out[j] = 0;
      }
    }
  }
}

/** Seeded subset of k indices out of n, in increasing order. */
function subset(n: number, k: number, rng: Rng): Int32Array {
  if (k >= n) return Int32Array.from({ length: n }, (_, i) => i);
  const idx = Int32Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < k; i++) {
    const j = i + rng.int(n - i);
    const t = idx[i];
    idx[i] = idx[j];
    idx[j] = t;
  }
  return idx.slice(0, k).sort();
}

interface Posterior {
  xs: Float64Array;
  alpha: Float64Array;
  L: Float64Array;
}

/** Factorizes K + noise I (adding jitter if needed). Null if it cannot be done. */
function factor(ker: Kernel, xs: Float64Array): Float64Array | null {
  const n = xs.length;
  for (const jitter of [0, 1e-10, 1e-8, 1e-6, 1e-4]) {
    const K = new Float64Array(n * n);
    for (let a = 0; a < n; a++) {
      for (let b = 0; b <= a; b++) {
        const v = ker.k(xs[a], xs[b]);
        K[a * n + b] = v;
        K[b * n + a] = v;
      }
      K[a * n + a] += ker.noise2 + jitter;
    }
    if (cholesky(K, n)) return K;
  }
  return null;
}

function posterior(ker: Kernel, xs: Float64Array, z: Float64Array): Posterior | null {
  const L = factor(ker, xs);
  if (!L) return null;
  const n = xs.length;
  const t = new Float64Array(n);
  const alpha = new Float64Array(n);
  forward(L, n, z, t);
  backward(L, n, t, alpha);
  return { xs, alpha, L };
}

/** Log evidence and its gradient with respect to the log-parameters. */
function evidence(
  ker: Kernel,
  params: Param[],
  xs: Float64Array,
  z: Float64Array,
): { value: number; grad: Float64Array } | null {
  const post = posterior(ker, xs, z);
  if (!post) return null;
  const n = xs.length;
  const { L, alpha } = post;
  let fit = 0;
  let logdet = 0;
  for (let i = 0; i < n; i++) {
    fit += z[i] * alpha[i];
    logdet += log(L[i * n + i]);
  }
  const value = -0.5 * fit - logdet - 0.5 * n * log(2 * PI);
  const Kinv = cholInverse(L, n);
  const grad = new Float64Array(params.length);
  const g = new Float64Array(params.length);
  const noiseIdx = params.length - 1;
  for (let a = 0; a < n; a++) {
    for (let b = 0; b <= a; b++) {
      const w = alpha[a] * alpha[b] - Kinv[a * n + b];
      const mult = a === b ? 0.5 : 1; // symmetric: off-diagonal pairs count twice
      ker.grads(params, xs[a], xs[b], g);
      for (let j = 0; j < noiseIdx; j++) grad[j] += mult * w * g[j];
      if (a === b) grad[noiseIdx] += 0.5 * w * 2 * ker.noise2;
    }
  }
  return { value, grad };
}

function setup(c: GPConfig, x: Float64Array, y: Float64Array) {
  const n = y.length;
  let mu = 0;
  for (let i = 0; i < n; i++) mu += y[i];
  mu = n ? mu / n : 0;
  let v = 0;
  for (let i = 0; i < n; i++) v += (y[i] - mu) * (y[i] - mu);
  const sd = n > 1 && v > 0 ? sqrt(v / n) : 1;
  const z = Float64Array.from(y, (t) => (t - mu) / sd);
  const { lo, hi, width } = span(x);
  const parts = c.kernel.length
    ? c.kernel
    : [{ kind: 'rbf', scale: 1, length: width / 10, period: width }];
  const params = paramsOf(parts as KernelPart[], width);
  const theta = new Float64Array(params.length);
  params.forEach((p, j) => {
    const raw = p.field === 'noise' ? c.noise : (parts[p.part] as KernelPart)[p.field];
    theta[j] = log(clamp(raw, p.lo, p.hi));
  });
  const ker = new Kernel(parts as KernelPart[], (lo + hi) / 2, hi > lo ? (hi - lo) / 2 : 1);
  ker.set(params, theta);
  return { n, mu, sd, z, params, theta, ker };
}

/** Evidence and gradient at the configuration's values (tests and diagnostics). */
export function gpEvidence(c: GPConfig, x: Float64Array, y: Float64Array) {
  const s = setup(c, x, y);
  const e = evidence(s.ker, s.params, x, s.z);
  return e && { value: e.value, grad: Array.from(e.grad) };
}

export function gpFitter(c: GPConfig, x: Float64Array, y: Float64Array, seed: number): Fitter {
  const { n, mu, sd, z, params, theta, ker } = setup(c, x, y);
  const rng = new Rng(seed, 6);
  const fullIdx = subset(n, GP_MAX_POINTS, rng);
  const tuneIdx =
    fullIdx.length > GP_TUNE_POINTS
      ? fullIdx.filter((_, i) => i % Math.ceil(fullIdx.length / GP_TUNE_POINTS) === 0)
      : fullIdx;
  const pick = (idx: Int32Array, arr: Float64Array) => Float64Array.from(idx, (i) => arr[i]);
  const fullX = pick(fullIdx, x);
  const fullZ = pick(fullIdx, z);
  const tuneX = pick(tuneIdx, x);
  const tuneZ = pick(tuneIdx, z);
  const stages = c.tune ? TUNE_STEPS / FRAME_EVERY + 1 : FIXED_STAGES;
  const noiseJ = params.length - 1;
  const finalNoise = theta[noiseJ];

  // Adam state (ascent on the evidence).
  const m = new Float64Array(params.length);
  const v = new Float64Array(params.length);
  let steps = 0;
  let p1 = 1; // beta1^steps and beta2^steps, for bias correction
  let p2 = 1;
  const climb = (to: number) => {
    while (steps < to) {
      const e = evidence(ker, params, tuneX, tuneZ);
      if (!e) break;
      steps++;
      p1 *= 0.9;
      p2 *= 0.999;
      for (let j = 0; j < params.length; j++) {
        const g = e.grad[j];
        m[j] = 0.9 * m[j] + 0.1 * g;
        v[j] = 0.999 * v[j] + 0.001 * g * g;
        const step = (ADAM_LR * (m[j] / (1 - p1))) / (sqrt(v[j] / (1 - p2)) + 1e-8);
        theta[j] = Math.min(log(params[j].hi), Math.max(log(params[j].lo), theta[j] + step));
      }
      ker.set(params, theta);
    }
  };

  const hp = params.length;
  return {
    stages,
    stage(s: number): Stage {
      const last = s === stages - 1;
      let value: number;
      if (c.tune) {
        climb(s * FRAME_EVERY);
        value = steps;
      } else {
        // Noise from heavy (almost the flat mean) down to the chosen value.
        const big = log(Math.max(2, 10 * exp(finalNoise)));
        theta[noiseJ] = last ? finalNoise : big + ((finalNoise - big) * s) / (stages - 1);
        ker.set(params, theta);
        value = exp(theta[noiseJ]);
      }
      const xs = last ? fullX : tuneX;
      const post = n ? posterior(ker, xs, last ? fullZ : tuneZ) : null;
      if (!post) return constantStage(value, mu, hp);
      const frozen = ker.clone(); // later stages keep tuning the live kernel
      const np = post.xs.length;
      const ks = new Float64Array(np);
      const tmp = new Float64Array(np);
      const fill = (t: number) => {
        for (let j = 0; j < np; j++) ks[j] = frozen.k(t, post.xs[j]);
      };
      return {
        value,
        params: np + hp,
        predict(qs, out) {
          for (let i = 0; i < qs.length; i++) {
            fill(qs[i]);
            let s2 = 0;
            for (let j = 0; j < np; j++) s2 += ks[j] * post.alpha[j];
            out[i] = mu + sd * s2;
          }
        },
        std(qs, out) {
          for (let i = 0; i < qs.length; i++) {
            fill(qs[i]);
            forward(post.L, np, ks, tmp);
            let q = 0;
            for (let j = 0; j < np; j++) q += tmp[j] * tmp[j];
            const varf = frozen.k(qs[i], qs[i]) - q;
            out[i] = sd * sqrt(varf > 0 ? varf : 0);
          }
        },
      };
    },
  };
}
