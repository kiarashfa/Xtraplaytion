import { sin } from '@xtraplaytion/dmath';
import { describe, expect, it } from 'vitest';
import {
  buildDataset,
  createRun,
  lrAt,
  mlp,
  paramCountOf,
  Region,
  spreadPoints,
  type DataSpec,
} from '../src/index.ts';

const f1 = (x: number) => sin(x) + 0.5 * sin(2 * x) + sin(3 * x) / 3;
const spec: DataSpec = {
  domain: [-10, 10],
  n: 120,
  bands: [
    [-7.5, -2],
    [1.5, 6.5],
  ],
  noise: { kind: 'gaussian', sigma: 0.08 },
  valFraction: 0.2,
  seed: 7,
  gridSize: 401,
};

const bits = (a: ArrayLike<number>) =>
  Array.from(Float64Array.from(a, (v) => v)).map((v) => v.toString(36));

describe('dataset', () => {
  const d = buildDataset(f1, spec);

  it('places points only in the training ranges and splits validation by seed', () => {
    expect(d.trainY.length + d.valY.length).toBe(120);
    expect(d.valY.length).toBe(24);
    for (const x of [...d.trainX, ...d.valX])
      expect((x >= -7.5 && x <= -2) || (x >= 1.5 && x <= 6.5)).toBe(true);
    expect(bits(buildDataset(f1, spec).trainY)).toEqual(bits(d.trainY));
    expect(bits(buildDataset(f1, { ...spec, seed: 8 }).trainY)).not.toEqual(bits(d.trainY));
  });

  it('labels grid regions', () => {
    const at = (x: number) => d.region[d.gridX.findIndex((g) => g >= x)];
    expect(at(-9)).toBe(Region.Beyond);
    expect(at(-5)).toBe(Region.Train);
    expect(at(0)).toBe(Region.Gap);
    expect(at(9)).toBe(Region.Beyond);
  });

  it('spreads points over ranges in proportion to their length', () => {
    const xs = spreadPoints(
      [
        [0, 1],
        [2, 5],
      ],
      9,
    );
    expect(xs[0]).toBe(0);
    expect(xs[8]).toBe(5);
    expect(xs.filter((x) => x <= 1).length).toBeLessThan(xs.filter((x) => x >= 2).length);
  });

  it('supports every noise model', () => {
    for (const noise of [
      { kind: 'none' },
      { kind: 'uniform', width: 0.2 },
      { kind: 'hetero', sigma: 0.1, by: 'x' },
      { kind: 'outliers', sigma: 0.05, percent: 10, magnitude: 2 },
    ] as const) {
      const ds = buildDataset(f1, { ...spec, noise });
      expect(ds.trainY.every(Number.isFinite)).toBe(true);
    }
  });
});

describe('training runs', () => {
  const data = buildDataset(f1, spec);
  const config = mlp({
    hidden: [16, 16],
    activations: ['tanh', 'tanh'],
    optimizer: { kind: 'adam', lr: 3e-3 },
  });

  it('is bit-for-bit reproducible from the seed', () => {
    const a = createRun(config, data, 3);
    const b = createRun(config, data, 3);
    a.step(200);
    b.step(100);
    b.step(100); // pausing and resuming changes nothing
    expect(bits(a.net.params)).toEqual(bits(b.net.params));
    expect(bits(a.trainLoss)).toEqual(bits(b.trainLoss));
    const c = createRun(config, data, 4);
    c.step(200);
    expect(bits(c.net.params)).not.toEqual(bits(a.net.params));
  });

  it('learns: loss drops and the frame reports region metrics', () => {
    const r = createRun(config, data, 1);
    r.step(600);
    expect(r.trainLoss[599]).toBeLessThan(r.trainLoss[0] / 4);
    const fr = r.frame();
    expect(fr.epoch).toBe(600);
    expect(fr.grid).toHaveLength(401);
    expect(fr.metrics.inside).toBeLessThan(fr.metrics.beyond);
    expect(Number.isFinite(fr.valLoss)).toBe(true);
  });

  it('runs every optimizer, schedule, batch mode and dropout without blowing up', () => {
    const variants = [
      { optimizer: { kind: 'sgd', lr: 0.05 } },
      { optimizer: { kind: 'momentum', lr: 0.02 } },
      { optimizer: { kind: 'nesterov', lr: 0.02 } },
      { optimizer: { kind: 'rmsprop', lr: 3e-3 } },
      { optimizer: { kind: 'adamw', lr: 3e-3, weightDecay: 0.01 } },
      { schedule: { kind: 'step', every: 50, gamma: 0.5 } },
      { schedule: { kind: 'cosine', minLr: 1e-5, total: 200 } },
      { batch: { kind: 'mini', size: 16, shuffle: true } },
      { dropout: 0.1 },
      { loss: { kind: 'huber', delta: 0.5 } },
      { l2: 1e-3, l1: 1e-4 },
    ] as const;
    for (const v of variants) {
      const r = createRun({ ...config, ...v } as typeof config, data, 2);
      r.step(200);
      expect(Number.isFinite(r.trainLoss[199]), JSON.stringify(v)).toBe(true);
      expect(r.trainLoss[199], JSON.stringify(v)).toBeLessThan(r.trainLoss[0]);
    }
  });

  it('counts parameters like PyTorch', () => {
    expect(paramCountOf(mlp({ hidden: [10, 10] }))).toBe(141);
    expect(paramCountOf(mlp({ hidden: [1000, 1000] }))).toBe(1_004_001);
    expect(createRun(mlp({ hidden: [64, 64] }), data, 1).paramCount).toBe(4353);
  });

  it('computes learning-rate schedules', () => {
    expect(lrAt(0.1, { kind: 'constant' }, 99)).toBe(0.1);
    expect(lrAt(0.1, { kind: 'step', every: 10, gamma: 0.5 }, 25)).toBe(0.025);
    expect(lrAt(0.1, { kind: 'cosine', minLr: 0, total: 100 }, 0)).toBe(0.1);
    expect(lrAt(0.1, { kind: 'cosine', minLr: 0, total: 100 }, 100)).toBeCloseTo(0, 15);
  });
});
