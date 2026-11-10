import { describe, expect, it } from 'vitest';
import {
  buildDataset,
  createRun,
  datasetFromPoints,
  mlp,
  Region,
  scoreGrid,
  type PointsSpec,
} from '../src/index.ts';

const spec: PointsSpec = {
  domain: [0, 10],
  bands: [
    [0, 3],
    [5, 7],
  ],
  valFraction: 0.25,
  seed: 3,
  gridSize: 201,
};
const xs = Array.from({ length: 101 }, (_, i) => i / 10);
const ys = xs.map((x) => 2 * x - 1);

describe('datasets from points', () => {
  const d = datasetFromPoints(xs, ys, spec);

  it('splits points inside the ranges and keeps the rest as test points', () => {
    const inside = xs.filter((x) => (x >= 0 && x <= 3) || (x >= 5 && x <= 7)).length;
    expect(d.trainX.length + d.valX.length).toBe(inside);
    expect(d.valX.length).toBe(Math.round(0.25 * inside));
    expect(d.test?.x.length).toBe(xs.length - inside);
    const t = d.test;
    if (!t) throw new Error('no test points');
    for (let i = 0; i < t.x.length; i++)
      expect(t.region[i]).toBe(t.x[i] < 5 ? Region.Gap : Region.Beyond);
    expect([...d.clean].every((v) => Number.isNaN(v))).toBe(true);
  });

  it('does not depend on row order and drops broken rows', () => {
    const rev = datasetFromPoints([...xs].reverse(), [...ys].reverse(), spec);
    expect([...rev.trainX]).toEqual([...d.trainX]);
    expect([...rev.valY]).toEqual([...d.valY]);
    const broken = datasetFromPoints([...xs, NaN, 4], [...ys, 1, Infinity], spec);
    expect([...broken.trainX]).toEqual([...d.trainX]);
  });

  it('scores the validation and test points through the grid', () => {
    const perfect = Float32Array.from(d.gridX, (x) => 2 * x - 1);
    const m = scoreGrid(perfect, d);
    expect(m.inside).toBeLessThan(1e-5);
    expect(m.gap).toBeLessThan(1e-5);
    expect(m.beyond).toBeLessThan(1e-5);
    const off = Float32Array.from(d.gridX, (x) => 2 * x - 1 + (x > 7 ? 0.5 : 0));
    expect(scoreGrid(off, d).beyond).toBeCloseTo(0.5, 5);
    expect(scoreGrid(off, d).gap).toBeLessThan(1e-5);
  });

  it('trains reproducibly', () => {
    const cfg = mlp({ hidden: [8], activations: ['tanh'] });
    const a = createRun(cfg, d, 1, 50);
    const b = createRun(cfg, d, 1, 50);
    a.step(50);
    b.step(50);
    expect(a.frame().metrics).toEqual(b.frame().metrics);
    expect(Number.isFinite(a.frame().metrics.beyond)).toBe(true);
  });
});

describe('targets with undefined points', () => {
  it('drops samples where the target is undefined, keeping everything else identical', () => {
    const base = {
      domain: [-1, 1] as [number, number],
      n: 50,
      bands: [],
      noise: { kind: 'gaussian', sigma: 0.1 } as const,
      valFraction: 0.2,
      seed: 4,
      gridSize: 64,
    };
    const full = buildDataset((x) => x * x, base);
    const half = buildDataset((x) => (x < 0 ? NaN : x * x), base);
    expect(full.trainX.length + full.valX.length).toBe(50);
    const n = half.trainX.length + half.valX.length;
    expect(n).toBe(25);
    for (const x of [...half.trainX, ...half.valX]) expect(x).toBeGreaterThanOrEqual(0);
  });
});
