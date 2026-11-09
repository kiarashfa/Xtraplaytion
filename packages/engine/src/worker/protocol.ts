// Messages between the page and a training worker. One worker hosts one run.
import type { ModelConfig } from '../config.ts';
import type { Dataset } from '../data.ts';
import type { RegionMetrics } from '../metrics.ts';

/** Requested backend. Auto uses WebGPU whenever it is available and supports the model. */
export type BackendChoice = 'auto' | 'cpu' | 'gpu';
/** Backend actually used. */
export type Backend = 'cpu-f64' | 'webgpu';
/** Why a run did not get (or lost) the GPU it asked for. */
export type FallbackReason =
  'noWebGPU' | 'noAdapter' | 'unsupported' | 'outOfMemory' | 'deviceError' | 'deviceLost';

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
      /** Default 'cpu' (exact). */
      backend?: BackendChoice;
    }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'step'; n: number }
  | { type: 'setSpeed'; epochsPerFrame: number }
  | { type: 'reset' }
  | { type: 'ack'; seq: number }
  | { type: 'dispose' }
  /** Behave as if the GPU device was lost (tests and diagnostics). */
  | { type: 'simulateDeviceLoss' };

export interface FrameMsg {
  type: 'frame';
  runId: string;
  seq: number;
  epoch: number;
  trainLoss: number;
  valLoss: number;
  /** Predictions on the dataset grid (transferred). */
  grid: Float32Array;
  /** Losses of the epochs since the previous frame (transferred), for the full loss curve.
   *  They end at `epoch`, so they start at epoch - newTrainLoss.length (after a GPU
   *  recovery that can be earlier than the previous frame). */
  newTrainLoss: Float64Array;
  newValLoss: Float64Array;
  metrics: RegionMetrics;
  /** Smoothed training speed. */
  epochsPerSec: number;
  backend: Backend;
}

export interface ReadyMsg {
  type: 'ready';
  runId: string;
  paramCount: number;
  backend: Backend;
  /** Set when the GPU was requested but the run uses the CPU. */
  fallback?: FallbackReason;
  /** GPU description, when on the GPU. */
  adapter?: string;
}

export type FromWorker =
  | ReadyMsg
  | FrameMsg
  | { type: 'done'; runId: string; epoch: number; reason: 'finished' | 'diverged' }
  | { type: 'error'; runId: string; message: string }
  /** The GPU was lost; training continues from `epoch` on `backend`. */
  | {
      type: 'recovered';
      runId: string;
      epoch: number;
      backend: Backend;
      reason: FallbackReason;
    };

/** Frames sent but not yet acknowledged before the worker waits (backpressure). */
export const MAX_IN_FLIGHT = 2;
