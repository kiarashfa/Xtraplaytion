// Worker-side controller, written against a tiny environment interface so tests
// can drive it directly. entry.ts wires it to a real DedicatedWorker and WebGPU.
//
// CPU runs are synchronous: every message is handled to completion at once. GPU
// runs are asynchronous (submit, then read back); while one operation is in
// flight, messages that touch the run wait in a queue, and a reset or dispose
// abandons the operation. If the GPU device is lost, training continues from the
// last checkpoint on a new GPU device, or on the CPU when none is available.
import type { ModelConfig } from '../config.ts';
import type { Dataset } from '../data.ts';
import { gpuUnsupported, type Checkpoint } from '../gpu/run.ts';
import { createRun, type Frame } from '../run.ts';
import {
  MAX_IN_FLIGHT,
  type Backend,
  type FallbackReason,
  type FromWorker,
  type ToWorker,
} from './protocol.ts';

/** What the host needs from a run (MLPRun on the CPU, GpuRun on the GPU). */
export interface RunLike {
  readonly paramCount: number;
  readonly epoch: number;
  readonly diverged: boolean;
  readonly trainLoss: number[];
  readonly valLoss: number[];
  step(epochs: number): void | Promise<void>;
  frame(): Frame | Promise<Frame>;
  dispose(): void;
}

export interface GpuHandle {
  run: RunLike & { checkpoint(): Promise<Checkpoint> };
  adapter: string;
  /** Resolves if the device is lost (not when we dispose the run ourselves). */
  lost: Promise<void>;
}

export interface HostEnv {
  post(msg: FromWorker, transfer: Transferable[]): void;
  /** Run `cb` soon, after pending messages (MessageChannel in browsers). */
  schedule(cb: () => void): void;
  now(): number;
  /** Creates a GPU run, optionally resumed from a checkpoint. Absent when there is no WebGPU.
   *  Rejects with an Error whose message is a FallbackReason (or anything else: deviceError). */
  gpu?(config: ModelConfig, data: Dataset, seed: number, from?: Checkpoint): Promise<GpuHandle>;
}

type Init = Extract<ToWorker, { type: 'init' }>;

/** Wall time between GPU checkpoints (state copied back for recovery). */
const CHECKPOINT_MS = 4000;

const REASONS: ReadonlySet<string> = new Set([
  'noWebGPU',
  'noAdapter',
  'unsupported',
  'outOfMemory',
  'deviceError',
  'deviceLost',
]);
function reasonOf(e: unknown): FallbackReason {
  const m = e instanceof Error ? e.message : String(e);
  if (m === 'minibatch' || m === 'dropout') return 'unsupported';
  return REASONS.has(m) ? (m as FallbackReason) : 'deviceError';
}

/** Calls cb with the value now (sync) or when the promise settles (async). */
function chain<T, R>(v: T | Promise<T>, cb: (x: T) => R | Promise<R>): R | Promise<R> {
  return v instanceof Promise ? v.then(cb) : cb(v);
}

export function createHost(env: HostEnv): (msg: ToWorker) => void {
  let init: Init | null = null;
  let run: RunLike | null = null;
  let gpu: GpuHandle | null = null;
  let backend: Backend = 'cpu-f64';
  let checkpoint: Checkpoint | null = null;
  let checkpointAt = 0;
  let playing = false;
  let scheduled = false;
  let epochsPerFrame = 1;
  let seq = 0;
  let acked = 0;
  let sentLosses = 0;
  let speed = 0; // epochs per second, smoothed
  /** Bumped by init, reset and dispose: async work of an older generation is dropped. */
  let gen = 0;
  /** Bumped per async operation (a device loss abandons the one in flight). */
  let op = 0;
  let busy = false;
  let queue: ToWorker[] = [];

  const fail = (e: unknown) =>
    env.post(
      {
        type: 'error',
        runId: init?.runId ?? '',
        message: e instanceof Error ? e.message : String(e),
      },
      [],
    );

  const post = (fr: Frame) => {
    if (!run || !init) return;
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
        backend,
      },
      [fr.grid.buffer, newTrainLoss.buffer, newValLoss.buffer],
    );
  };

  const sendFrame = (): void | Promise<void> => {
    if (!run) return;
    return chain(run.frame(), post);
  };

  /** Runs fn now; if it returns a promise, the host is busy until it settles. */
  const exec = (fn: () => void | Promise<void>) => {
    let r: void | Promise<void>;
    try {
      r = fn();
    } catch (e) {
      playing = false;
      fail(e);
      return;
    }
    if (!(r instanceof Promise)) return;
    busy = true;
    const g = gen;
    const o = ++op;
    r.then(
      () => {
        if (g !== gen || o !== op) return;
        idle();
      },
      (e) => {
        if (g !== gen || o !== op) return;
        busy = false;
        if (gpu) {
          // A failed GPU operation is usually a lost device; its promise may settle a moment later.
          const h = gpu;
          void Promise.race([
            h.lost.then(() => true),
            new Promise<boolean>((res) => setTimeout(() => res(false), 300)),
          ]).then((wasLost) => {
            if (g !== gen || gpu !== h) return;
            if (wasLost) recover('deviceLost');
            else {
              playing = false;
              fail(e);
            }
          });
        } else {
          playing = false;
          fail(e);
        }
      },
    );
  };

  /** End of an async operation: handle what waited, then keep training. */
  const idle = () => {
    busy = false;
    while (!busy && queue.length) handle(queue.shift() as ToWorker);
    if (!busy && playing) kick();
  };

  const maybeCheckpoint = (): void | Promise<void> => {
    if (!gpu || env.now() - checkpointAt < CHECKPOINT_MS) return;
    const g = gen;
    return gpu.run.checkpoint().then((cp) => {
      if (g !== gen) return;
      checkpoint = cp;
      checkpointAt = env.now();
    });
  };

  const advance = (n: number): void | Promise<void> => {
    if (!run) return;
    const r = run;
    const t0 = env.now();
    return chain(r.step(n), () => {
      const dt = env.now() - t0;
      if (dt > 0) {
        const now = (n / dt) * 1000;
        speed = speed ? 0.8 * speed + 0.2 * now : now;
      }
      return chain(maybeCheckpoint(), sendFrame);
    });
  };

  const finishIfDone = (): boolean => {
    if (!run || !init) return true;
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
      return true;
    }
    return false;
  };

  const tick = () => {
    scheduled = false;
    if (!playing || !run || !init || busy) return;
    if (seq - acked >= MAX_IN_FLIGHT) return; // wait for the page to catch up
    const remaining = init.epochs - run.epoch;
    if (remaining <= 0) {
      finishIfDone();
      return;
    }
    exec(() =>
      chain(advance(Math.min(epochsPerFrame, remaining)), () => {
        if (!finishIfDone()) kick();
      }),
    );
  };

  const kick = () => {
    if (!scheduled) {
      scheduled = true;
      env.schedule(tick);
    }
  };

  const ready = (fallback?: FallbackReason, adapter?: string) => {
    if (!run || !init) return;
    env.post(
      {
        type: 'ready',
        runId: init.runId,
        paramCount: run.paramCount,
        backend,
        ...(fallback ? { fallback } : {}),
        ...(adapter ? { adapter } : {}),
      },
      [],
    );
  };

  const drop = () => {
    run?.dispose();
    run = null;
    gpu = null;
    checkpoint = null;
  };

  const useGpu = (h: GpuHandle) => {
    gpu = h;
    run = h.run;
    backend = 'webgpu';
    checkpointAt = env.now();
    const g = gen;
    void h.lost.then(() => {
      if (g !== gen || gpu !== h) return;
      op++; // abandon the operation in flight, if any
      busy = false;
      recover('deviceLost');
    });
  };

  const useCpu = (from?: Checkpoint | null) => {
    if (!init) return;
    const r = createRun(init.config, init.data, init.seed);
    if (from) r.restore(from);
    run = r;
    gpu = null;
    backend = 'cpu-f64';
  };

  /** The GPU is gone: continue from the last checkpoint (or epoch 0) on a new device or the CPU. */
  const recover = (reason: FallbackReason) => {
    if (!init) return;
    const cfg = init;
    const from = checkpoint;
    const old = run;
    gpu = null;
    run = null;
    old?.dispose();
    const g = gen;
    busy = true;
    const attempt = env.gpu
      ? env.gpu(cfg.config, cfg.data, cfg.seed, from ?? undefined)
      : Promise.reject(new Error('noWebGPU'));
    void attempt
      .then(
        (h) => {
          if (g !== gen) {
            h.run.dispose();
            return false;
          }
          useGpu(h);
          return true;
        },
        () => {
          if (g !== gen) return false;
          useCpu(from);
          return true;
        },
      )
      .then((ok) => {
        if (!ok || !run) return;
        sentLosses = run.epoch; // losses after the checkpoint are sent again
        env.post({ type: 'recovered', runId: cfg.runId, epoch: run.epoch, backend, reason }, []);
        busy = false;
        exec(sendFrame);
        if (!busy) idle();
      });
  };

  const start = () => {
    if (!init) return;
    const cfg = init;
    gen++;
    queue = [];
    busy = false;
    drop();
    seq = 0;
    acked = 0;
    sentLosses = 0;
    speed = 0;
    const choice = cfg.backend ?? 'cpu';
    const onCpu = (fallback?: FallbackReason) => {
      useCpu();
      ready(fallback);
      exec(sendFrame); // epoch 0: the untrained network
    };
    if (choice === 'cpu') return onCpu();
    if (gpuUnsupported(cfg.config)) return onCpu('unsupported');
    if (!env.gpu) return onCpu('noWebGPU');
    const g = gen;
    busy = true;
    env.gpu(cfg.config, cfg.data, cfg.seed).then(
      (h) => {
        if (g !== gen) {
          h.run.dispose();
          return;
        }
        useGpu(h);
        ready(undefined, h.adapter);
        busy = false;
        exec(sendFrame);
        if (!busy) idle();
      },
      (e) => {
        if (g !== gen) return;
        busy = false;
        onCpu(reasonOf(e));
        if (!busy) idle();
      },
    );
  };

  function handle(msg: ToWorker): void {
    try {
      switch (msg.type) {
        case 'init':
          init = msg;
          epochsPerFrame = Math.max(1, Math.floor(msg.epochsPerFrame));
          playing = false;
          start();
          return;
        case 'reset':
          playing = false;
          start();
          return;
        case 'dispose':
          gen++;
          queue = [];
          busy = false;
          playing = false;
          drop();
          init = null;
          return;
        case 'play':
          playing = true;
          kick();
          return;
        case 'pause':
          playing = false;
          return;
        case 'setSpeed':
          epochsPerFrame = Math.max(1, Math.floor(msg.epochsPerFrame));
          return;
        case 'ack':
          acked = Math.max(acked, msg.seq);
          if (playing) kick();
          return;
      }
      // Messages below act on the run: they wait while an async operation runs.
      if (busy) {
        queue.push(msg);
        return;
      }
      switch (msg.type) {
        case 'step':
          if (run && init) {
            const n = Math.max(0, Math.min(msg.n, init.epochs - run.epoch));
            exec(() => advance(n));
          }
          return;
        case 'simulateDeviceLoss':
          if (gpu) {
            op++;
            recover('deviceLost');
          }
          return;
      }
    } catch (e) {
      fail(e);
    }
  }

  return handle;
}
