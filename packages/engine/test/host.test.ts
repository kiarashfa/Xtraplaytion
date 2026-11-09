import { sin } from '@xtraplaytion/dmath';
import { describe, expect, it } from 'vitest';
import { buildDataset, createRun, mlp } from '../src/index.ts';
import { createHost } from '../src/worker/host.ts';
import type { FrameMsg, FromWorker, ToWorker } from '../src/worker/protocol.ts';

const data = buildDataset((x) => sin(x), {
  domain: [-3, 3],
  n: 60,
  bands: [],
  noise: { kind: 'none' },
  valFraction: 0.2,
  seed: 1,
  gridSize: 101,
});
const config = mlp({
  hidden: [8, 8],
  activations: ['tanh', 'tanh'],
  optimizer: { kind: 'adam', lr: 1e-2 },
});

function harness() {
  const out: FromWorker[] = [];
  const queue: (() => void)[] = [];
  let t = 0;
  const handle = createHost({
    post: (m) => out.push(m),
    schedule: (cb) => queue.push(cb),
    now: () => (t += 1),
  });
  const drain = (max = 1000) => {
    for (let i = 0; i < max && queue.length; i++) queue.shift()?.();
  };
  const frames = () => out.filter((m): m is FrameMsg => m.type === 'frame');
  const send = (m: ToWorker) => handle(m);
  send({ type: 'init', runId: 'r1', config, data, seed: 5, epochs: 50, epochsPerFrame: 10 });
  return { out, drain, frames, send, queue };
}

function lastFrame(h: { frames(): FrameMsg[] }): FrameMsg {
  const f = h.frames().at(-1);
  if (!f) throw new Error('no frame yet');
  return f;
}

describe('worker host', () => {
  it('announces the run and sends the untrained frame', () => {
    const h = harness();
    expect(h.out[0]).toEqual({ type: 'ready', runId: 'r1', paramCount: 97, backend: 'cpu-f64' });
    expect(h.frames()[0].epoch).toBe(0);
  });

  it('applies backpressure: at most 2 unacknowledged frames (the epoch-0 frame counts)', () => {
    const h = harness();
    h.send({ type: 'play' });
    h.drain();
    expect(h.frames().map((f) => f.epoch)).toEqual([0, 10]);
    h.send({ type: 'ack', seq: 2 });
    h.drain();
    expect(h.frames().map((f) => f.epoch)).toEqual([0, 10, 20, 30]);
    h.send({ type: 'ack', seq: 4 });
    h.drain();
    expect(h.frames().at(-1)?.epoch).toBe(50);
    expect(h.out.at(-1)).toEqual({ type: 'done', runId: 'r1', epoch: 50, reason: 'finished' });
  });

  it('streams every loss exactly once and matches a direct run bit for bit', () => {
    const h = harness();
    h.send({ type: 'play' });
    for (let i = 0; i < 20; i++) {
      h.drain();
      h.send({ type: 'ack', seq: h.frames().at(-1)?.seq ?? 0 });
    }
    const losses = h.frames().flatMap((f) => Array.from(f.newTrainLoss));
    const direct = createRun(config, data, 5);
    direct.step(50);
    expect(losses).toEqual(direct.trainLoss);
    expect(Array.from(lastFrame(h).grid)).toEqual(Array.from(direct.frame().grid));
  });

  it('stops and reports divergence instead of training on NaN', () => {
    const out: FromWorker[] = [];
    const queue: (() => void)[] = [];
    const handle = createHost({
      post: (m) => out.push(m),
      schedule: (cb) => queue.push(cb),
      now: () => 0,
    });
    const wild = mlp({ hidden: [8], activations: ['relu'], optimizer: { kind: 'sgd', lr: 1e6 } });
    handle({
      type: 'init',
      runId: 'w',
      config: wild,
      data,
      seed: 1,
      epochs: 500,
      epochsPerFrame: 50,
    });
    handle({ type: 'play' });
    for (let i = 0; i < 50 && queue.length; i++) {
      queue.shift()?.();
      const last = out.filter((m) => m.type === 'frame').at(-1);
      if (last && last.type === 'frame') handle({ type: 'ack', seq: last.seq });
    }
    const done = out.find((m) => m.type === 'done');
    expect(done).toMatchObject({ type: 'done', reason: 'diverged' });
    expect(done && done.type === 'done' && done.epoch).toBeLessThan(500);
  });

  it('pauses, single-steps, changes speed and resets to an identical start', () => {
    const h = harness();
    h.send({ type: 'step', n: 3 });
    expect(h.frames().at(-1)?.epoch).toBe(3);
    h.send({ type: 'ack', seq: 2 });
    h.send({ type: 'setSpeed', epochsPerFrame: 7 });
    h.send({ type: 'play' });
    h.send({ type: 'pause' });
    h.drain();
    expect(h.frames().at(-1)?.epoch).toBe(3); // paused before the scheduled tick ran
    h.send({ type: 'play' });
    h.queue.shift()?.();
    expect(h.frames().at(-1)?.epoch).toBe(10);
    const before = Array.from(h.frames()[0].grid);
    h.send({ type: 'reset' });
    expect(h.frames().at(-1)?.epoch).toBe(0);
    expect(Array.from(lastFrame(h).grid)).toEqual(before);
  });
});
