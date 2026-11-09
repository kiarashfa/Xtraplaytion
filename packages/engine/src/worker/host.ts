// Worker-side controller, written against a tiny environment interface so tests
// can drive it directly. entry.ts wires it to a real DedicatedWorker.
import { createRun, type MLPRun } from '../run.ts';
import { MAX_IN_FLIGHT, type FromWorker, type ToWorker } from './protocol.ts';

export interface HostEnv {
  post(msg: FromWorker, transfer: Transferable[]): void;
  /** Run `cb` soon, after pending messages (MessageChannel in browsers). */
  schedule(cb: () => void): void;
  now(): number;
}

type Init = Extract<ToWorker, { type: 'init' }>;

export function createHost(env: HostEnv): (msg: ToWorker) => void {
  let init: Init | null = null;
  let run: MLPRun | null = null;
  let playing = false;
  let scheduled = false;
  let epochsPerFrame = 1;
  let seq = 0;
  let acked = 0;
  let sentLosses = 0;
  let speed = 0; // epochs per second, smoothed

  const fail = (e: unknown) =>
    env.post(
      {
        type: 'error',
        runId: init?.runId ?? '',
        message: e instanceof Error ? e.message : String(e),
      },
      [],
    );

  const sendFrame = () => {
    if (!run || !init) return;
    const fr = run.frame();
    const newTrainLoss = Float64Array.from(run.trainLoss.slice(sentLosses));
    const newValLoss = Float64Array.from(run.valLoss.slice(sentLosses));
    sentLosses = run.trainLoss.length;
    seq++;
    env.post(
      {
        type: 'frame',
        runId: init.runId,
        seq,
        ...fr,
        newTrainLoss,
        newValLoss,
        epochsPerSec: speed,
        backend: 'cpu-f64',
      },
      [fr.grid.buffer, newTrainLoss.buffer, newValLoss.buffer],
    );
  };

  const train = (n: number) => {
    if (!run) return;
    const t0 = env.now();
    run.step(n);
    const dt = env.now() - t0;
    if (dt > 0) {
      const now = (n / dt) * 1000;
      speed = speed ? 0.8 * speed + 0.2 * now : now;
    }
  };

  const tick = () => {
    scheduled = false;
    if (!playing || !run || !init) return;
    if (seq - acked >= MAX_IN_FLIGHT) return; // wait for the page to catch up
    const remaining = init.epochs - run.epoch;
    if (remaining <= 0) {
      playing = false;
      env.post({ type: 'done', runId: init.runId, epoch: run.epoch, reason: 'finished' }, []);
      return;
    }
    try {
      train(Math.min(epochsPerFrame, remaining));
      sendFrame();
    } catch (e) {
      playing = false;
      fail(e);
      return;
    }
    if (run.epoch >= init.epochs || run.diverged) {
      playing = false;
      env.post(
        {
          type: 'done',
          runId: init.runId,
          epoch: run.epoch,
          reason: run.diverged ? 'diverged' : 'finished',
        },
        [],
      );
      return;
    }
    kick();
  };

  const kick = () => {
    if (!scheduled) {
      scheduled = true;
      env.schedule(tick);
    }
  };

  const start = () => {
    if (!init) return;
    run = createRun(init.config, init.data, init.seed);
    seq = 0;
    acked = 0;
    sentLosses = 0;
    speed = 0;
    env.post({ type: 'ready', runId: init.runId, paramCount: run.paramCount }, []);
    sendFrame(); // epoch 0: the untrained network
  };

  return (msg: ToWorker) => {
    try {
      switch (msg.type) {
        case 'init':
          init = msg;
          epochsPerFrame = Math.max(1, Math.floor(msg.epochsPerFrame));
          playing = false;
          start();
          break;
        case 'play':
          playing = true;
          kick();
          break;
        case 'pause':
          playing = false;
          break;
        case 'step':
          if (run && init) {
            train(Math.max(0, Math.min(msg.n, init.epochs - run.epoch)));
            sendFrame();
          }
          break;
        case 'setSpeed':
          epochsPerFrame = Math.max(1, Math.floor(msg.epochsPerFrame));
          break;
        case 'reset':
          playing = false;
          start();
          break;
        case 'ack':
          acked = Math.max(acked, msg.seq);
          if (playing) kick();
          break;
        case 'dispose':
          playing = false;
          run?.dispose();
          run = null;
          init = null;
          break;
      }
    } catch (e) {
      fail(e);
    }
  };
}
