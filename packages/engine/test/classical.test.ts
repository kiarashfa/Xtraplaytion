// Classical models: agreement with numpy (fixtures/classical.py), the behaviors the
// lessons rely on, the build-up schedule, and the worker path.
import { readFileSync } from 'node:fs';
import { cos, sin } from '@xtraplaytion/dmath';
import { describe, expect, it } from 'vitest';
import {
  buildDataset,
  BUILD_SHARE,
  createRun,
  gpEvidence,
  makeFitter,
  type ClassicalConfig,
  type GPConfig,
  type KernelPart,
} from '../src/index.ts';
import { createHost } from '../src/worker/host.ts';
import type { FrameMsg, FromWorker } from '../src/worker/protocol.ts';

const fx = JSON.parse(
  readFileSync(new URL('./fixtures/classical.json', import.meta.url), 'utf8'),
) as {
  x: number[];
  y: number[];
  q: number[];
  poly9: number[];
  fourier6: number[];
  gp: { kernel: KernelPart[]; noise: number; mean: number[]; std: number[]; evidence: number };
};
const X = Float64Array.from(fx.x);
const Y = Float64Array.from(fx.y);
const Q = Float64Array.from(fx.q);

function finalPrediction(c: ClassicalConfig, x = X, y = Y, q = Q, seed = 1) {
  const f = makeFitter(c, x, y, seed);
  const st = f.stage(f.stages - 1);
  const out = new Float64Array(q.length);
  st.predict(q, out);
  return { out, st, stages: f.stages };
}

function expectClose(got: ArrayLike<number>, want: ArrayLike<number>, rel: number) {
  let worst = 0;
  for (let i = 0; i < want.length; i++) {
    worst = Math.max(worst, Math.abs(got[i] - want[i]) / Math.max(1, Math.abs(want[i])));
  }
  expect(worst).toBeLessThanOrEqual(rel);
}

const linspace = (a: number, b: number, n: number) =>
  Float64Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

describe('agreement with numpy', () => {
  it('polynomial (degree 9, gapped data, far beyond)', () => {
    expectClose(finalPrediction({ kind: 'poly', degree: 9 }).out, fx.poly9, 1e-7);
  });
  it('Fourier series (6 harmonics)', () => {
    expectClose(
      finalPrediction({ kind: 'fourier', harmonics: 6, period: 0 }).out,
      fx.fourier6,
      1e-6,
    );
  });
  it('Gaussian process posterior and evidence (RBF + periodic, fixed settings)', () => {
    const c: GPConfig = { kind: 'gp', kernel: fx.gp.kernel, noise: fx.gp.noise, tune: false };
    const { st } = finalPrediction(c);
    const mean = new Float64Array(Q.length);
    const std = new Float64Array(Q.length);
    st.predict(Q, mean);
    st.std?.(Q, std);
    expectClose(mean, fx.gp.mean, 1e-9);
    expectClose(std, fx.gp.std, 1e-7);
    expect(gpEvidence(c, X, Y)?.value).toBeCloseTo(fx.gp.evidence, 8);
  });
});

describe('behaviour out of range', () => {
  it('a polynomial is exactly a polynomial (recovers a cubic, also far outside)', () => {
    const x = linspace(-1, 1, 30);
    const y = x.map((t) => t * t * t - 2 * t + 0.5);
    const q = linspace(-6, 6, 25);
    expectClose(
      finalPrediction({ kind: 'poly', degree: 3 }, x, y, q).out,
      q.map((t) => t * t * t - 2 * t + 0.5),
      1e-8,
    );
  });
  it('a Fourier series repeats with its period', () => {
    const c = { kind: 'fourier', harmonics: 5, period: 0 } as const;
    const P = X[X.length - 1] - X[0];
    const a = finalPrediction(c, X, Y, Q).out;
    const b = finalPrediction(
      c,
      X,
      Y,
      Q.map((t) => t + P),
    ).out;
    expectClose(a, b, 1e-9);
  });
  it('a Fourier series recovers a trigonometric target', () => {
    const x = linspace(0, 10, 80);
    const w = (2 * Math.PI) / 10;
    const f = (t: number) => 1 + 2 * cos(w * t) - sin(3 * w * t);
    const q = linspace(-5, 25, 40);
    expectClose(
      finalPrediction({ kind: 'fourier', harmonics: 4, period: 10 }, x, x.map(f), q).out,
      q.map(f),
      1e-6,
    );
  });
  it('a spline continues as a straight line, and a stiff spline is the least-squares line', () => {
    const q = linspace(3, 9, 7); // all beyond the last point (2.5)
    const { out } = finalPrediction({ kind: 'spline', segments: 12, smoothing: 0.01 }, X, Y, q);
    for (let i = 2; i < q.length; i++) {
      expect(Math.abs(out[i] - 2 * out[i - 1] + out[i - 2])).toBeLessThan(1e-9);
    }
    // Stage 0 has a huge bending penalty: the fit is (almost) the regression line.
    const f = makeFitter({ kind: 'spline', segments: 12, smoothing: 0.01 }, X, Y, 1);
    const line = new Float64Array(Q.length);
    f.stage(0).predict(Q, line);
    const n = X.length;
    const mx = X.reduce((s, v) => s + v, 0) / n;
    const my = Y.reduce((s, v) => s + v, 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < n; i++) {
      sxy += (X[i] - mx) * (Y[i] - my);
      sxx += (X[i] - mx) * (X[i] - mx);
    }
    const b = sxy / sxx;
    expectClose(
      line,
      Q.map((t) => my + b * (t - mx)),
      1e-3,
    );
  });
  it('kNN and trees are flat beyond the data', () => {
    const q = Float64Array.from([5, 50, 500]);
    const families: ClassicalConfig[] = [
      { kind: 'knn', k: 4, weights: 'uniform' },
      { kind: 'tree', ensemble: 'single', depth: 6, trees: 1, minLeaf: 2, lr: 0.1 },
      { kind: 'tree', ensemble: 'forest', depth: 6, trees: 20, minLeaf: 2, lr: 0.1 },
      { kind: 'tree', ensemble: 'boost', depth: 3, trees: 40, minLeaf: 2, lr: 0.1 },
    ];
    for (const c of families) {
      const { out } = finalPrediction(c, X, Y, q);
      expect(out[1]).toBe(out[0]);
      expect(out[2]).toBe(out[0]);
    }
  });
  it('distance-weighted kNN levels off beyond the data', () => {
    const { out } = finalPrediction(
      { kind: 'knn', k: 4, weights: 'distance' },
      X,
      Y,
      Float64Array.from([500, 5000]),
    );
    expect(Math.abs(out[1] - out[0])).toBeLessThan(1e-3);
  });
  it('kNN: k = 1 copies the nearest point, the first stage is the mean', () => {
    const { out } = finalPrediction({ kind: 'knn', k: 1, weights: 'uniform' }, X, Y, X);
    expectClose(out, Y, 0);
    const f = makeFitter({ kind: 'knn', k: 3, weights: 'uniform' }, X, Y, 1);
    const flat = new Float64Array(3);
    f.stage(0).predict(Float64Array.from([-9, 0, 9]), flat);
    const mean = Y.reduce((s, v) => s + v, 0) / Y.length;
    for (const v of flat) expect(v).toBeCloseTo(mean, 12);
  });
  it('a depth-1 tree makes the best single split', () => {
    const x = Float64Array.from([0, 1, 2, 3, 4, 5]);
    const y = Float64Array.from([1, 1, 1, 5, 5, 6]);
    const { out } = finalPrediction(
      { kind: 'tree', ensemble: 'single', depth: 1, trees: 1, minLeaf: 1, lr: 0.1 },
      x,
      y,
      Float64Array.from([2.4, 2.6]),
    );
    expect(Array.from(out)).toEqual([1, 16 / 3]);
  });
  it('boosting lowers the training error round after round; forests depend on the seed', () => {
    const c: ClassicalConfig = {
      kind: 'tree',
      ensemble: 'boost',
      depth: 2,
      trees: 30,
      minLeaf: 1,
      lr: 0.3,
    };
    const f = makeFitter(c, X, Y, 1);
    let prev = Infinity;
    const out = new Float64Array(X.length);
    for (let m = 0; m < f.stages; m++) {
      f.stage(m).predict(X, out);
      const e = out.reduce((s, v, i) => s + (v - Y[i]) ** 2, 0);
      expect(e).toBeLessThanOrEqual(prev + 1e-12);
      prev = e;
    }
    const forest: ClassicalConfig = { ...c, ensemble: 'forest', depth: 5 };
    const a = finalPrediction(forest, X, Y, Q, 1).out;
    expect(finalPrediction(forest, X, Y, Q, 1).out).toEqual(a);
    expect(finalPrediction(forest, X, Y, Q, 2).out).not.toEqual(a);
  });
  it('a Gaussian process returns to the mean far away, with the prior spread', () => {
    const c: GPConfig = {
      kind: 'gp',
      kernel: [{ kind: 'rbf', scale: 1.3, length: 0.6, period: 1 }],
      noise: 0.1,
      tune: false,
    };
    const { st } = finalPrediction(c);
    const far = Float64Array.from([60, -80]);
    const m = new Float64Array(2);
    const s = new Float64Array(2);
    st.predict(far, m);
    st.std?.(far, s);
    const mu = Y.reduce((a, v) => a + v, 0) / Y.length;
    const sd = Math.sqrt(Y.reduce((a, v) => a + (v - mu) ** 2, 0) / Y.length);
    expect(m[0]).toBeCloseTo(mu, 12);
    expect(s[1]).toBeCloseTo(1.3 * sd, 10);
    // The band is narrow where data is and wide in the gap.
    const near = new Float64Array(2);
    st.std?.(Float64Array.from([-2, -0.1]), near);
    expect(near[1]).toBeGreaterThan(3 * near[0]);
  });
});

describe('Gaussian process tuning', () => {
  const base: GPConfig = {
    kind: 'gp',
    kernel: [
      { kind: 'matern52', scale: 0.8, length: 0.9, period: 1 },
      { kind: 'periodic', scale: 0.5, length: 1.2, period: 2.1 },
      { kind: 'linear', scale: 0.3, length: 1, period: 1 },
    ],
    noise: 0.2,
    tune: true,
  };
  it('evidence gradient matches finite differences (log parameters)', () => {
    const e = gpEvidence(base, X, Y);
    if (!e) throw new Error('no evidence');
    // Parameter order: per part scale, length (if used), period (if used); then noise.
    const fields: [number, keyof KernelPart][] = [
      [0, 'scale'],
      [0, 'length'],
      [1, 'scale'],
      [1, 'length'],
      [1, 'period'],
      [2, 'scale'],
    ];
    const h = 1e-5;
    const at = (j: number, d: number) => {
      const c = structuredClone(base);
      if (j < fields.length) {
        const [p, f] = fields[j];
        (c.kernel[p][f] as number) *= Math.exp(d);
      } else c.noise *= Math.exp(d);
      return gpEvidence(c, X, Y)?.value ?? NaN;
    };
    for (let j = 0; j <= fields.length; j++) {
      const numeric = (at(j, h) - at(j, -h)) / (2 * h);
      expect(Math.abs(e.grad[j] - numeric)).toBeLessThan(1e-5 + 1e-5 * Math.abs(numeric));
    }
  });
  it('tuning raises the evidence', () => {
    const c: GPConfig = {
      kind: 'gp',
      kernel: [{ kind: 'rbf', scale: 1, length: 3, period: 1 }],
      noise: 0.5,
      tune: true,
    };
    const before = gpEvidence(c, X, Y)?.value ?? NaN;
    const f = makeFitter(c, X, Y, 1);
    const fit = new Float64Array(X.length);
    f.stage(f.stages - 1).predict(X, fit);
    const rmse = Math.sqrt(fit.reduce((s, v, i) => s + (v - Y[i]) ** 2, 0) / X.length);
    expect(before).toBeLessThan(0);
    expect(rmse).toBeLessThan(0.05); // the untuned smooth fit is far worse
  });
});

describe('build-up, then hold', () => {
  const data = buildDataset((x) => sin(2 * x), {
    domain: [-3, 3],
    n: 80,
    bands: [[-2, 2]],
    noise: { kind: 'gaussian', sigma: 0.05 },
    valFraction: 0.2,
    seed: 3,
    gridSize: 101,
  });
  it('reaches the final stage at a quarter of the epochs and holds it', () => {
    const epochs = 400;
    const run = createRun({ kind: 'poly', degree: 7 }, data, 1, epochs);
    const build = epochs * BUILD_SHARE;
    expect(run.frame().stage).toMatchObject({ at: 0, of: 8, value: 0 });
    run.step(build - 1);
    expect(run.frame().stage?.at).toBeLessThan(7);
    run.step(1);
    const held = run.frame();
    expect(held.stage).toMatchObject({ at: 7, value: 7, params: 8 });
    run.step(epochs - build);
    const end = run.frame();
    expect(end.grid).toEqual(held.grid);
    expect(run.trainLoss).toHaveLength(epochs);
    expect(run.trainLoss[epochs - 1]).toBe(run.trainLoss[build]);
    expect(run.trainLoss[0]).toBeGreaterThan(run.trainLoss[epochs - 1]);
  });
  it('trains through the worker host on the CPU, even when the GPU is asked for', () => {
    const out: FromWorker[] = [];
    const queue: (() => void)[] = [];
    let t = 0;
    const handle = createHost({
      post: (m) => out.push(m),
      schedule: (cb) => queue.push(cb),
      now: () => (t += 1),
      gpu: () => Promise.reject(new Error('should not be called')),
    });
    const config: GPConfig = {
      kind: 'gp',
      kernel: [{ kind: 'rbf', scale: 1, length: 0.5, period: 1 }],
      noise: 0.1,
      tune: true,
    };
    handle({
      type: 'init',
      runId: 'g',
      config,
      data,
      seed: 1,
      epochs: 80,
      epochsPerFrame: 8,
      backend: 'gpu',
    });
    handle({ type: 'play' });
    for (let i = 0; i < 100 && queue.length; i++) {
      queue.shift()?.();
      const f = out.filter((m): m is FrameMsg => m.type === 'frame').at(-1);
      if (f) handle({ type: 'ack', seq: f.seq });
    }
    const ready = out.find((m) => m.type === 'ready');
    expect(ready).toMatchObject({ backend: 'cpu-f64' });
    expect(ready).not.toHaveProperty('fallback');
    const frames = out.filter((m): m is FrameMsg => m.type === 'frame');
    const last = frames.at(-1);
    expect(last?.epoch).toBe(80);
    expect(last?.band).toHaveLength(101);
    expect(last?.stage?.at).toBe((last?.stage?.of ?? 0) - 1);
    expect(out.at(-1)).toMatchObject({ type: 'done', reason: 'finished' });
  });
});
