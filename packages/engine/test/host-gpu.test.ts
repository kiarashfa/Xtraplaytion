// The worker host's GPU path (asynchronous runs, checkpoints, device loss) with a
// fake GPU: a CPU run behind promises. Real WebGPU is covered by gpu.engines.ts.
import { sin } from '@xtraplaytion/dmath';
import { describe, expect, it } from 'vitest';
import { buildDataset, createRun, mlp, type Checkpoint, type MLPRun } from '../src/index.ts';
import { createHost, type GpuHandle, type HostEnv } from '../src/worker/host.ts';
import type { FrameMsg, FromWorker, ToWorker } from '../src/worker/protocol.ts';

const data = buildDataset((x) => sin(x), {
  domain: [-3, 3],
  n: 40,
  bands: [],
  noise: { kind: 'none' },
  valFraction: 0.2,
  seed: 1,
  gridSize: 33,
});
const config = mlp({ hidden: [6, 6], activations: ['tanh', 'tanh'] });

const tick = () => new Promise((r) => setTimeout(r, 0));

function fakeGpu(run: MLPRun, lost: Promise<void>): GpuHandle {
  return {
    adapter: 'fake gpu',
    lost,
    run: {
      get paramCount() {
        return run.paramCount;
      },
      get epoch() {
        return run.epoch;
      },
      get diverged() {
        return run.diverged;
      },
      trainLoss: run.trainLoss,
      valLoss: run.valLoss,
      step: async (n) => {
        await tick();
        run.step(n);
      },
      frame: async () => {
        await tick();
        return run.frame();
      },
      dispose: () => run.dispose(),
      checkpoint: async (): Promise<Checkpoint> => {
        const st = run.opt.state();
        return {
          epoch: run.epoch,
          steps: st.steps,
          params: run.net.params.slice(),
          m: st.m,
          v: st.v,
          trainLoss: run.trainLoss.slice(),
          valLoss: run.valLoss.slice(),
        };
      },
    },
  };
}

function harness(gpu: HostEnv['gpu']) {
  const out: FromWorker[] = [];
  let t = 0;
  const handle = createHost({
    post: (m) => out.push(m),
    schedule: (cb) => setTimeout(cb, 0),
    now: () => (t += 1000), // every call is a second later: checkpoints happen often
    ...(gpu ? { gpu } : {}),
  });
  const frames = () => out.filter((m): m is FrameMsg => m.type === 'frame');
  return { out, frames, send: (m: ToWorker) => handle(m) };
}

async function until(cond: () => boolean) {
  for (let i = 0; i < 2000 && !cond(); i++) await tick();
  expect(cond()).toBe(true);
}

describe('worker host on the GPU path', () => {
  it('trains asynchronously and ends exactly like the CPU', async () => {
    const h = harness(async (c, d, s) => fakeGpu(createRun(c, d, s), new Promise(() => {})));
    h.send({
      type: 'init',
      runId: 'g',
      config,
      data,
      seed: 3,
      epochs: 40,
      epochsPerFrame: 8,
      backend: 'auto',
    });
    h.send({ type: 'play' });
    await until(() => {
      for (const f of h.frames()) h.send({ type: 'ack', seq: f.seq });
      return h.out.some((m) => m.type === 'done');
    });
    expect(h.out[0]).toMatchObject({ type: 'ready', backend: 'webgpu', adapter: 'fake gpu' });
    const losses = h.frames().flatMap((f) => Array.from(f.newTrainLoss));
    const ref = createRun(config, data, 3);
    ref.step(40);
    expect(losses).toEqual(ref.trainLoss);
    expect(h.frames().at(-1)?.backend).toBe('webgpu');
  });

  it('falls back to the CPU when the GPU cannot be used, and says why', async () => {
    const h = harness(async () => {
      throw new Error('outOfMemory');
    });
    h.send({
      type: 'init',
      runId: 'g',
      config,
      data,
      seed: 3,
      epochs: 10,
      epochsPerFrame: 5,
      backend: 'gpu',
    });
    await until(() => h.out.some((m) => m.type === 'ready'));
    expect(h.out[0]).toMatchObject({ type: 'ready', backend: 'cpu-f64', fallback: 'outOfMemory' });
    const noGpu = harness(undefined);
    noGpu.send({
      type: 'init',
      runId: 'g',
      config,
      data,
      seed: 3,
      epochs: 10,
      epochsPerFrame: 5,
      backend: 'auto',
    });
    expect(noGpu.out[0]).toMatchObject({ backend: 'cpu-f64', fallback: 'noWebGPU' });
    const unsupported = harness(async (c, d, s) =>
      fakeGpu(createRun(c, d, s), new Promise(() => {})),
    );
    unsupported.send({
      type: 'init',
      runId: 'g',
      config: mlp({ hidden: [4], dropout: 0.1 }),
      data,
      seed: 3,
      epochs: 10,
      epochsPerFrame: 5,
      backend: 'auto',
    });
    expect(unsupported.out[0]).toMatchObject({ backend: 'cpu-f64', fallback: 'unsupported' });
  });

  it('continues on the CPU from the last checkpoint when the device is lost', async () => {
    let lose = () => {};
    let calls = 0;
    const h = harness(async (c, d, s, from) => {
      calls++;
      if (calls > 1) throw new Error('noAdapter'); // no GPU after the loss
      const run = createRun(c, d, s);
      if (from) run.restore(from);
      return fakeGpu(run, new Promise<void>((r) => (lose = r)));
    });
    h.send({
      type: 'init',
      runId: 'g',
      config,
      data,
      seed: 3,
      epochs: 60,
      epochsPerFrame: 5,
      backend: 'auto',
    });
    h.send({ type: 'play' });
    const ackAll = () => {
      for (const f of h.frames()) h.send({ type: 'ack', seq: f.seq });
    };
    await until(() => {
      ackAll();
      return h.frames().some((f) => f.epoch >= 30);
    });
    lose();
    await until(() => {
      ackAll();
      return h.out.some((m) => m.type === 'done');
    });
    const rec = h.out.find((m) => m.type === 'recovered');
    expect(rec).toMatchObject({ backend: 'cpu-f64', reason: 'deviceLost' });
    // Rebuild the loss curve as the page does (truncate to epoch - new, then append).
    const series: number[] = [];
    for (const f of h.frames()) {
      series.length = f.epoch - f.newTrainLoss.length;
      series.push(...f.newTrainLoss);
    }
    const ref = createRun(config, data, 3);
    ref.step(60);
    expect(series).toEqual(ref.trainLoss); // the fake GPU is exact, so recovery is seamless
    expect(h.frames().at(-1)?.backend).toBe('cpu-f64');
  });
});
