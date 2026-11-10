// Messages between the page and a training worker. One worker hosts one run.
import type { StageInfo } from '../classical/staged.ts';
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
  /** Send the network's current weights (for insight views of networks too big for
   *  per-frame weights). Answered with a 'snapshot' message; ignored for classical models. */
  | { type: 'snapshot' }
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
  /** Posterior std on the grid (Gaussian process; transferred). */
  band?: Float32Array;
  /** Build-up of a classical model. */
  stage?: StageInfo;
  /** Network weights (transferred), for networks up to SNAPSHOT_PARAMS parameters. In the
   *  network's own units (scaled data when the config has `scale`). */
  params?: Float32Array;
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
  | { type: 'snapshot'; runId: string; epoch: number; params: Float32Array }
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
