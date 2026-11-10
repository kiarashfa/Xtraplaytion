import { describe, expect, it } from 'vitest';
import { createRun, datasetFromPoints, mlp, scaleData, scoreGrid } from '../src/index.ts';
import { createHost } from '../src/worker/host.ts';
import type { FrameMsg, FromWorker } from '../src/worker/protocol.ts';

// Large x and y (think: days and prices).
const xs = Array.from({ length: 80 }, (_, i) => 1000 + i * 5);
const ys = xs.map((x) => 5000 + 300 * Math.sin((x - 1000) / 40));
const data = datasetFromPoints(xs, ys, {
  domain: [1000, 1400],
  bands: [[1000, 1300]],
  valFraction: 0.2,
  seed: 2,
  gridSize: 64,
});
const scale = { xShift: 1200, xScale: 1 / 200, yShift: 5000, yScale: 1 / 300 };

function hostFrames(cfg: ReturnType<typeof mlp>) {
  const out: FromWorker[] = [];
  const queue: (() => void)[] = [];
  const handle = createHost({
    post: (m) => out.push(m),
    schedule: (cb) => queue.push(cb),
    now: () => 0,
  });
  handle({ type: 'init', runId: 'r', config: cfg, data, seed: 3, epochs: 40, epochsPerFrame: 40 });
  handle({ type: 'play' });
  for (let i = 0; i < 100 && queue.length; i++) queue.shift()?.();
  return out.filter((m): m is FrameMsg => m.type === 'frame');
}

describe('rescaled networks', () => {
  for (const loss of ['mse', 'l1', 'huber'] as const) {
    it(`report predictions and ${loss} losses in original units`, () => {
      const cfg = { ...mlp({ hidden: [6], activations: ['tanh'], loss: { kind: loss } }), scale };
      const direct = createRun(cfg, scaleData(data, scale), 3);
      direct.step(40);
      const f = hostFrames(cfg).at(-1);
      if (!f) throw new Error('no frame');
      expect(f.epoch).toBe(40);
      const k = loss === 'l1' ? 300 : 300 * 300;
      expect(f.trainLoss).toBeCloseTo(direct.trainLoss[39] * k, 6);
      expect(f.newValLoss.at(-1)).toBeCloseTo(direct.valLoss[39] * k, 6);
      const grid = direct.frame().grid;
      expect(f.grid[10]).toBeCloseTo(grid[10] * 300 + 5000, 2);
      expect(f.metrics.beyond).toBeCloseTo(scoreGrid(f.grid, data).beyond, 9);
    });
  }

  it('train far better than on raw values', () => {
    const raw = mlp({
      hidden: [16, 16],
      activations: ['tanh', 'tanh'],
      optimizer: { kind: 'adam', lr: 0.01 },
    });
    const end = (cfg: typeof raw) => {
      const out: FromWorker[] = [];
      const queue: (() => void)[] = [];
      const handle = createHost({
        post: (m) => out.push(m),
        schedule: (cb) => queue.push(cb),
        now: () => 0,
      });
      handle({
        type: 'init',
        runId: 'r',
        config: cfg,
        data,
        seed: 1,
        epochs: 400,
        epochsPerFrame: 400,
      });
      handle({ type: 'play' });
      for (let i = 0; i < 100 && queue.length; i++) queue.shift()?.();
      return out.filter((m): m is FrameMsg => m.type === 'frame').at(-1)?.metrics.inside ?? NaN;
    };
    expect(end({ ...raw, scale })).toBeLessThan(end(raw) / 3);
  });
});
