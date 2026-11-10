import { createHost } from '../../../../packages/engine/src/worker/host.ts';
import {
  buildDataset,
  datasetFromPoints,
  mlp,
  MLPRun,
  scaleData,
  type FrameMsg,
  type FromWorker,
  type MLPConfig,
} from '@xtraplaytion/engine';
import { sin } from '@xtraplaytion/dmath';
import { describe, expect, it } from 'vitest';
import {
  kinkRegions,
  kinkView,
  lossMapResolution,
  missingWaves,
  neuronView,
  waveSetup,
} from './insight.ts';
import { bootstrapData } from './models.ts';

const formula = buildDataset((x) => sin(x) + 0.5 * sin(2 * x), {
  domain: [-10, 10],
  n: 160,
  bands: [
    [-7.5, -2],
    [1.5, 6.5],
  ],
  noise: { kind: 'none' },
  valFraction: 0.2,
  seed: 3,
  gridSize: 256,
});

// Imported data with large numbers: networks train on rescaled values.
const xs = Float64Array.from({ length: 120 }, (_, i) => 1000 + 2 * i);
const ys = xs.map((x) => 50 + 20 * sin(x / 30));
const points = datasetFromPoints(xs, ys, {
  domain: [990, 1250],
  bands: [[1000, 1170]],
  valFraction: 0.2,
  seed: 1,
  gridSize: 256,
});
const scale = { xShift: 1120, xScale: 2 / 260, yShift: 50, yScale: 1 / 14 };
const scaled: MLPConfig = { ...mlp({ hidden: [12, 9] }), scale };

/** Grid prediction of a scaled network in plot units, through the real worker host. */
function hostFrame(cfg: MLPConfig): FrameMsg {
  const out: FromWorker[] = [];
  const handle = createHost({ post: (m) => out.push(m), schedule: (cb) => cb(), now: () => 0 });
  handle({
    type: 'init',
    runId: 'x',
    config: cfg,
    data: points,
    seed: 4,
    epochs: 40,
    epochsPerFrame: 40,
  });
  handle({ type: 'step', n: 40 });
  const f = out.filter((m): m is FrameMsg => m.type === 'frame').at(-1);
  if (!f) throw new Error('no frame');
  return f;
}

describe('insight views in plot units', () => {
  it('neuron parts add up to the prediction, also for rescaled networks', () => {
    const f = hostFrame(scaled);
    if (!f.params) throw new Error('no weights');
    const nv = neuronView(scaled, f.params, points);
    for (let i = 0; i < f.grid.length; i += 17)
      expect(Math.abs(nv.sum[i] - f.grid[i])).toBeLessThan(1e-3 * (1 + Math.abs(f.grid[i])));
    expect(nv.top.length).toBe(8);
    expect(neuronView(scaled, f.params, points)).toBe(nv); // cached per snapshot
  });

  it('kinks come back in plot units, with slopes in plot units', () => {
    const f = hostFrame(scaled);
    if (!f.params) throw new Error('no weights');
    const k = kinkView(scaled, f.params);
    if (!k) throw new Error('no kinks');
    expect(k.xs.length).toBeGreaterThan(0);
    const right = k.xs[k.xs.length - 1];
    // Beyond the last kink the prediction is a straight line with the reported slope.
    const run = new MLPRun(scaled, scaleData(points, scale), 4);
    run.net.params.set(f.params);
    const at = (x: number) => {
      const o = new Float64Array(1);
      run.net.predict(Float64Array.of((x - scale.xShift) * scale.xScale), 1, o);
      return o[0] / scale.yScale + scale.yShift;
    };
    const slope = (at(right + 200) - at(right + 100)) / 100;
    expect(slope).toBeCloseTo(k.slopeRight, 6);
    const r = kinkRegions(k.xs, [990, 1250], [[1000, 1170]]);
    expect(r.train + r.gap + r.beyond + r.outside).toBe(k.xs.length);
    // Results are cached per snapshot, so a smooth network gets its own copy of the weights.
    const smooth: MLPConfig = { ...scaled, activations: ['tanh', 'relu'] };
    expect(kinkView(smooth, Float32Array.from(f.params))).toBeNull();
  });

  it('waves need a true function; a perfect prediction misses nothing', () => {
    expect(waveSetup(points)).toBeNull();
    const ws = waveSetup(formula);
    if (!ws) throw new Error('no wave setup');
    const perfect = Float32Array.from(formula.clean);
    for (const a of missingWaves(ws, perfect)) expect(a).toBeLessThan(1e-6);
    const flat = new Float32Array(formula.clean.length);
    const miss = missingWaves(ws, flat);
    expect(Math.max(...miss)).toBeGreaterThan(0.5);
  });

  it('loss map size depends on the work', () => {
    expect(lossMapResolution(97, 100)).toBe(41);
    expect(lossMapResolution(4353, 160)).toBe(25);
    expect(lossMapResolution(60_000, 100)).toBeNull();
  });
});

describe('averaged models', () => {
  it('bootstrap samples are seeded, sorted and drawn from the training points', () => {
    const a = bootstrapData(formula, 5);
    const b = bootstrapData(formula, 5);
    expect(Array.from(a.trainX)).toEqual(Array.from(b.trainX));
    expect(Array.from(bootstrapData(formula, 6).trainX)).not.toEqual(Array.from(a.trainX));
    expect(a.trainX.length).toBe(formula.trainX.length);
    const known = new Set(formula.trainX);
    for (let i = 0; i < a.trainX.length; i++) {
      expect(known.has(a.trainX[i])).toBe(true);
      if (i) expect(a.trainX[i]).toBeGreaterThanOrEqual(a.trainX[i - 1]);
    }
    expect(a.valX).toBe(formula.valX);
  });
});
