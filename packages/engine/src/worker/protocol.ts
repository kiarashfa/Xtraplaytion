// Messages between the page and a training worker. One worker hosts one run.
import type { ModelConfig } from '../config.ts';
import type { Dataset } from '../data.ts';
import type { RegionMetrics } from '../metrics.ts';

export type ToWorker =
  | {
      type: 'init';
      runId: string;
      config: ModelConfig;
      data: Dataset;
      seed: number;
      /** Total epochs for this run. */
      epochs: number;
      epochsPerFrame: number;
    }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'step'; n: number }
  | { type: 'setSpeed'; epochsPerFrame: number }
  | { type: 'reset' }
  | { type: 'ack'; seq: number }
  | { type: 'dispose' };

export interface FrameMsg {
  type: 'frame';
  runId: string;
  seq: number;
  epoch: number;
  trainLoss: number;
  valLoss: number;
  /** Predictions on the dataset grid (transferred). */
  grid: Float32Array;
  /** Losses of the epochs since the previous frame (transferred), for the full loss curve. */
  newTrainLoss: Float64Array;
  newValLoss: Float64Array;
  metrics: RegionMetrics;
  /** Smoothed training speed. */
  epochsPerSec: number;
  backend: 'cpu-f64';
}

export type FromWorker =
  | { type: 'ready'; runId: string; paramCount: number }
  | FrameMsg
  | { type: 'done'; runId: string; epoch: number; reason: 'finished' | 'diverged' }
  | { type: 'error'; runId: string; message: string };

/** Frames sent but not yet acknowledged before the worker waits (backpressure). */
export const MAX_IN_FLIGHT = 2;
