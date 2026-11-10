import { sin } from '@xtraplaytion/dmath';
import { describe, expect, it } from 'vitest';
import {
  buildDataset,
  dimsOf,
  evalKinks,
  histogram,
  inspectNet,
  kinksOf,
  layerStats,
  lossAndGrad,
  lossOnly,
  lossSlice,
  MLP,
  MLPRun,
  mlp,
  neuronParts,
  WaveBasis,
  waveFrequencies,
  waveRange,
  type Activation,
} from '../src/index.ts';

/** The value, or a failed test when it is missing. */
function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('missing value');
  return v;
}

const net = (hidden: number[], acts: Activation[], seed = 3) =>
  new MLP(mlp({ hidden, activations: acts, init: { kind: 'torch_default' } }), seed);

const predict1 = (m: MLP, x: number) => {
  const out = new Float64Array(1);
  m.predict(Float64Array.of(x), 1, out);
  return out[0];
};

describe('kinks', () => {
  it('a single hidden ReLU layer kinks exactly at -b/w of each neuron', () => {
    const m = net([5], ['relu']);
    const k = kinksOf(m.dims, ['relu'], m.layers, m.params);
    expect(k).not.toBeNull();
    const kk = must(k);
    const L = m.layers[0];
    const roots = Array.from({ length: 5 }, (_, j) => -m.params[L.b + j] / m.params[L.w + j]);
    expect(Array.from(kk.xs)).toEqual(roots.sort((a, b) => a - b));
  });

  it.each([
    [[8], ['relu']],
    [
      [16, 16],
      ['relu', 'relu'],
    ],
    [
      [12, 9, 7],
      ['relu', 'abs', 'leaky_relu'],
    ],
    [
      [10, 10],
      ['identity', 'relu'],
    ],
    [[6], ['abs']],
  ] as [number[], Activation[]][])('%j %j: pieces reproduce the network everywhere', (h, a) => {
    for (const seed of [1, 2, 3]) {
      const m = net(h, a, seed);
      const k = must(kinksOf(m.dims, a, m.layers, m.params));
      for (const x of [-1e4, -37.5, -3.2, -1, -0.31, 0, 0.42, 1.7, 5, 81, 1e4]) {
        const y = predict1(m, x);
        expect(Math.abs(evalKinks(k, x) - y)).toBeLessThanOrEqual(1e-9 * (1 + Math.abs(y)));
      }
      // Exactly linear between kinks: the midpoint lies on the chord.
      const xs = [k.xs[0] - 5, ...k.xs, k.xs[k.xs.length - 1] + 5];
      for (let i = 0; i + 1 < xs.length; i++) {
        const [p, q] = [xs[i], xs[i + 1]];
        const mid = predict1(m, (p + q) / 2);
        const chord = (predict1(m, p) + predict1(m, q)) / 2;
        expect(Math.abs(mid - chord)).toBeLessThanOrEqual(1e-9 * (1 + Math.abs(mid)));
      }
      // Every reported kink really bends the output.
      for (let i = 1; i < k.slopes.length; i++)
        expect(Math.abs(k.slopes[i] - k.slopes[i - 1])).toBeGreaterThan(0);
    }
  });

  it('straight beyond the outermost kink, with the reported slope', () => {
    const m = net([20, 20], ['relu', 'relu'], 5);
    const k = must(kinksOf(m.dims, ['relu', 'relu'], m.layers, m.params));
    const right = k.xs[k.xs.length - 1];
    const slope = (predict1(m, right + 200) - predict1(m, right + 100)) / 100;
    expect(slope).toBeCloseTo(k.slopes[k.slopes.length - 1], 9);
  });

  it('a neuron with zero output weight adds no kink', () => {
    const m = net([4], ['relu']);
    m.params[m.layers[1].w + 2] = 0;
    expect(must(kinksOf(m.dims, ['relu'], m.layers, m.params)).xs.length).toBe(3);
  });

  it('is null for smooth activations and over budget', () => {
    const m = net([8], ['tanh']);
    expect(kinksOf(m.dims, ['tanh'], m.layers, m.params)).toBeNull();
    const big = net([64, 64], ['relu', 'relu']);
    expect(
      kinksOf(big.dims, ['relu', 'relu'], big.layers, big.params, { budget: 1000 }),
    ).toBeNull();
  });
});

describe('neuron parts', () => {
  it('bias plus all contributions equals the prediction, at any depth', () => {
    for (const [h, a] of [
      [[7], ['relu']],
      [
        [9, 5],
        ['tanh', 'sin'],
      ],
      [
        [4, 6, 3],
        ['gelu', 'relu', 'sigmoid'],
      ],
    ] as [number[], Activation[]][]) {
      const m = net(h, a, 4);
      const xs = Float64Array.from({ length: 101 }, (_, i) => -5 + i / 10);
      const parts = neuronParts(m, xs, 2);
      const pred = new Float64Array(xs.length);
      m.predict(xs, xs.length, pred);
      expect(parts.width).toBe(h[h.length - 1]);
      for (let i = 0; i < xs.length; i++) {
        const sum = parts.bias + parts.rest[i] + parts.top.reduce((s, p) => s + p.ys[i], 0);
        expect(Math.abs(sum - pred[i])).toBeLessThan(1e-5 * (1 + Math.abs(pred[i])));
      }
      for (let i = 1; i < parts.top.length; i++)
        expect(parts.top[i - 1].size).toBeGreaterThanOrEqual(parts.top[i].size);
    }
  });

  it('a one-layer ReLU neuron is a hinge at -b/w', () => {
    const m = net([3], ['relu']);
    const xs = Float64Array.from({ length: 2001 }, (_, i) => -10 + i / 100);
    const { top } = neuronParts(m, xs, 3);
    const L = m.layers[0];
    for (const p of top) {
      const hinge = -m.params[L.b + p.index] / m.params[L.w + p.index];
      xs.forEach((x, i) => {
        const on = m.params[L.w + p.index] * x + m.params[L.b + p.index] > 0;
        if (Math.abs(x - hinge) > 1e-6 && !on) expect(Math.abs(p.ys[i])).toBe(0);
      });
    }
  });

  it('counts ReLU neurons that are off at every training point', () => {
    const m = net([6], ['relu']);
    const L = m.layers[0];
    // Neuron 0 and 1 switched off on [-1, 1]; the rest on everywhere there.
    for (let j = 0; j < 6; j++) {
      m.params[L.w + j] = 0;
      m.params[L.b + j] = j < 2 ? -1 : 1;
    }
    const trainX = Float64Array.from({ length: 21 }, (_, i) => -1 + i / 10);
    expect(neuronParts(m, trainX, 1, trainX).dead).toEqual([2]);
    expect(neuronParts(net([5], ['tanh']), trainX, 1, trainX).dead).toEqual([null]);
  });
});

describe('waves', () => {
  const xs = Float64Array.from({ length: 600 }, (_, i) => -7.5 + (14 * i) / 599);
  const f = (x: number) => sin(x) + 0.5 * sin(2 * x) + sin(3 * x) / 3;

  it('finds the amplitudes of a sum of sines over many periods, also with a gap', () => {
    const wide = Float64Array.from({ length: 1600 }, (_, i) => -20 + (40 * i) / 1599);
    for (const pts of [wide, wide.filter((x) => x < -3 || x > 4)]) {
      const ks = Float64Array.of(1, 2, 3, 4.5);
      const amp = new WaveBasis(pts, ks).amplitudes(pts.map(f));
      expect(amp[0]).toBeCloseTo(1, 1);
      expect(amp[1]).toBeCloseTo(0.5, 1);
      expect(amp[2]).toBeCloseTo(1 / 3, 1);
      expect(amp[3]).toBeLessThan(0.05);
    }
  });

  it('separates the waves when the data covers only a few periods', () => {
    const ks = waveFrequencies(14, 5, 8);
    const at = (amp: Float32Array, k: number) => amp[Math.round((k - ks[0]) / (ks[1] - ks[0]))];
    const amp = new WaveBasis(xs, ks).amplitudes(xs.map(f));
    const peaks = Array.from(ks).filter(
      (_, q) => q > 0 && q + 1 < ks.length && amp[q] > amp[q - 1] && amp[q] >= amp[q + 1],
    );
    const strong = peaks.filter((k) => at(amp, k) > 0.15);
    expect(strong.length).toBe(3);
    strong.forEach((k, i) => expect(Math.abs(k - (i + 1))).toBeLessThan(0.2));
    // With a gap, peaks blur (fewer periods inside the data), but the slow wave still leads.
    const gap = xs.filter((x) => x < -2 || x > 1.5);
    const g = new WaveBasis(gap, ks).amplitudes(gap.map(f));
    const best = ks[g.indexOf(Math.max(...g))];
    expect(Math.abs(best - 1)).toBeLessThan(0.2);
  });

  it('residual waves vanish for a perfect fit and ignore undefined points', () => {
    const ys = xs.map(f);
    const ref = Float64Array.from(ys);
    ref[10] = NaN;
    const amp = new WaveBasis(xs, waveFrequencies(14, 6)).amplitudes(ys, ref);
    for (const a of amp) expect(a).toBeLessThan(1e-9);
  });

  it('picks a frequency range that covers the target', () => {
    const top = waveRange(xs, xs.map(f), 40);
    expect(top).toBeGreaterThanOrEqual(4);
    expect(top).toBeLessThan(8);
    const ks = waveFrequencies(14, top);
    expect(ks[0]).toBeCloseTo((2 * Math.PI) / 14, 12);
  });
});

describe('weights and gradients', () => {
  it('histogram counts every finite value once', () => {
    const h = histogram([-1, -0.5, 0, 0.5, 1, NaN], 4);
    expect(Array.from(h.counts)).toEqual([1, 1, 1, 2]);
    expect(h.lo).toBe(-1);
    expect(h.hi).toBe(1);
  });

  const spec = {
    domain: [-4, 4] as [number, number],
    n: 60,
    bands: [] as [number, number][],
    noise: { kind: 'none' } as const,
    valFraction: 0,
    seed: 1,
    gridSize: 101,
  };
  const data = buildDataset((x) => sin(x), spec);

  it('layer gradients match the training step and the norm sums them', () => {
    const cfg = mlp({ hidden: [8, 8], activations: ['tanh', 'relu'], l2: 1e-3 });
    const run = new MLPRun(cfg, data, 2);
    run.step(5);
    const m = inspectNet(cfg, run.net.params);
    const stats = layerStats(m, cfg, data);
    expect(stats.map((s) => s.weights.length)).toEqual([8, 64, 8]);
    // The same gradient as a training step (MLPRun.step uses forward + backward).
    run.net.forward(data.trainX, data.trainY.length, true);
    const d = new Float64Array(data.trainY.length);
    lossAndGrad('mse', run.net.layerOutput(3), data.trainY, data.trainY.length, d);
    run.net.backward(d, data.trainY.length);
    let total = 0;
    for (const g of run.net.grads) total += g * g;
    const sum = stats.reduce((s, l) => s + l.gradNorm ** 2, 0);
    expect(Math.sqrt(sum)).toBeCloseTo(Math.sqrt(total), 12);
  });

  it('loss slice: centre equals the training loss, and the minimum sits at the centre', () => {
    const cfg = mlp({ hidden: [6], activations: ['tanh'], optimizer: { kind: 'adam', lr: 0.02 } });
    const run = new MLPRun(cfg, data, 3);
    run.step(1500);
    const s = must(lossSlice(cfg, run.net.params, data, { res: 9, radius: 0.5, seed: 4 }));
    const out = new Float64Array(data.trainY.length);
    run.net.predict(data.trainX, data.trainY.length, out);
    expect(s.center).toBe(lossOnly('mse', out, data.trainY, data.trainY.length));
    expect(s.values[4 * 9 + 4]).toBe(s.center);
    const min = Math.min(...s.values);
    expect(min).toBeGreaterThan(s.center * 0.5); // trained: nothing much lower nearby
    // Seeded: same directions every time; a different seed gives a different slice.
    const again = must(lossSlice(cfg, run.net.params, data, { res: 9, radius: 0.5, seed: 4 }));
    expect(Array.from(again.values)).toEqual(Array.from(s.values));
    const other = must(lossSlice(cfg, run.net.params, data, { res: 9, radius: 0.5, seed: 5 }));
    expect(Array.from(other.values)).not.toEqual(Array.from(s.values));
    expect(dimsOf(cfg)).toEqual([1, 6, 1]);
  });

  it('loss slice stops when asked', () => {
    const cfg = mlp({ hidden: [4], activations: ['relu'] });
    const m = new MLP(cfg, 1);
    let rows = 0;
    expect(lossSlice(cfg, m.params, data, { res: 7 }, () => ++rows < 3)).toBeNull();
    expect(rows).toBe(3);
  });
});
