// Page-side client of one training worker. Frames are acknowledged on the next
// animation frame, so training never runs ahead of what the screen can show.
import type { Dataset, FrameMsg, FromWorker, MLPConfig, ToWorker } from '@xtraplaytion/engine';

export interface TrainerEvents {
  ready?(paramCount: number): void;
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

  constructor(events: TrainerEvents) {
    this.events = events;
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
        this.events.ready?.(m.paramCount);
        break;
      case 'frame':
        if (m.epoch === 0) {
          this.trainLoss.clear();
          this.valLoss.clear();
        }
        this.trainLoss.push(m.newTrainLoss);
        this.valLoss.push(m.newValLoss);
        this.events.frame?.(m);
        requestAnimationFrame(() => this.post({ type: 'ack', seq: m.seq }));
        break;
      case 'done':
        this.events.done?.(m.reason, m.epoch);
        break;
      case 'error':
        this.events.error?.(m.message);
        break;
    }
  }

  private post(m: ToWorker) {
    this.worker?.postMessage(m);
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
