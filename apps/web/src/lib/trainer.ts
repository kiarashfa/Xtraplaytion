// Page-side client of one training worker. Frames are acknowledged on the next
// animation frame, so training never runs ahead of what the screen can show.
import type {
  Backend,
  BackendChoice,
  Dataset,
  FallbackReason,
  FrameMsg,
  FromWorker,
  MLPConfig,
  ReadyMsg,
  ToWorker,
} from '@xtraplaytion/engine';

export interface TrainerEvents {
  ready?(m: ReadyMsg): void;
  /** The GPU was lost; training went on from `epoch` on `backend`. */
  recovered?(epoch: number, backend: Backend, reason: FallbackReason): void;
  frame?(f: FrameMsg): void;
  done?(reason: 'finished' | 'diverged', epoch: number): void;
  error?(message: string): void;
}

export interface StartOptions {
  config: MLPConfig;
  data: Dataset;
  seed: number;
  epochs: number;
  epochsPerFrame: number;
  /** Default 'cpu'. */
  backend?: BackendChoice;
}

export interface TrainerOptions {
  /** Acknowledge frames automatically on the next animation frame (default true).
   *  The arena turns this off to keep several models on one shared epoch clock. */
  autoAck?: boolean;
}

/** Growable float64 series (loss history). */
export class Series {
  data = new Float64Array(1024);
  length = 0;
  push(values: Float64Array) {
    if (this.length + values.length > this.data.length) {
      const next = new Float64Array(Math.max(this.data.length * 2, this.length + values.length));
      next.set(this.data.subarray(0, this.length));
      this.data = next;
    }
    this.data.set(values, this.length);
    this.length += values.length;
  }
  clear() {
    this.length = 0;
  }
  /** Drops values from index `n` on (a GPU recovery resends losses after a checkpoint). */
  truncate(n: number) {
    this.length = Math.max(0, Math.min(this.length, n));
  }
  view(): Float64Array {
    return this.data.subarray(0, this.length);
  }
}

export class Trainer {
  readonly trainLoss = new Series();
  readonly valLoss = new Series();
  private worker: Worker | null = null;
  private runId = 0;
  private readonly events: TrainerEvents;
  private readonly autoAck: boolean;

  constructor(events: TrainerEvents, options: TrainerOptions = {}) {
    this.events = events;
    this.autoAck = options.autoAck ?? true;
  }

  start(opts: StartOptions) {
    this.dispose();
    const id = String(++this.runId);
    this.trainLoss.clear();
    this.valLoss.clear();
    const w = new Worker(new URL('../workers/train.ts', import.meta.url), { type: 'module' });
    this.worker = w;
    w.onmessage = (e: MessageEvent<FromWorker>) => this.receive(id, e.data);
    w.onerror = (e) => this.events.error?.(e.message || 'worker error');
    this.post({ type: 'init', runId: id, ...opts });
  }

  private receive(id: string, m: FromWorker) {
    if (m.runId !== id) return; // a message from a run we already replaced
    switch (m.type) {
      case 'ready':
        this.events.ready?.(m);
        break;
      case 'frame':
        // The new losses end at m.epoch (after a recovery they can start before the last frame).
        this.trainLoss.truncate(m.epoch - m.newTrainLoss.length);
        this.valLoss.truncate(m.epoch - m.newValLoss.length);
        this.trainLoss.push(m.newTrainLoss);
        this.valLoss.push(m.newValLoss);
        this.events.frame?.(m);
        if (this.autoAck) requestAnimationFrame(() => this.post({ type: 'ack', seq: m.seq }));
        break;
      case 'done':
        this.events.done?.(m.reason, m.epoch);
        break;
      case 'error':
        this.events.error?.(m.message);
        break;
      case 'recovered':
        this.events.recovered?.(m.epoch, m.backend, m.reason);
        break;
    }
  }

  private post(m: ToWorker) {
    this.worker?.postMessage(m);
  }

  /** Let the worker send more frames (manual mode). */
  ack(seq: number) {
    this.post({ type: 'ack', seq });
  }
  get started(): boolean {
    return this.worker !== null;
  }
  play() {
    this.post({ type: 'play' });
  }
  pause() {
    this.post({ type: 'pause' });
  }
  step(n = 1) {
    this.post({ type: 'step', n });
  }
  setSpeed(epochsPerFrame: number) {
    this.post({ type: 'setSpeed', epochsPerFrame });
  }
  reset() {
    this.trainLoss.clear();
    this.valLoss.clear();
    this.post({ type: 'reset' });
  }
  dispose() {
    this.worker?.terminate();
    this.worker = null;
  }
}
