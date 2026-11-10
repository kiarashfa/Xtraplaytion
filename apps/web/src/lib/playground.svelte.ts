// Playground state (Svelte 5 runes): one dataset, up to six competing models.
// Each model trains in its own worker. The page keeps them on a shared epoch
// clock: a model's frames are acknowledged only while it is close to the slowest
// active model, so the race is fair on screen. Every frame goes into a history
// store, which the replay scrubber reads.
import {
  mlp,
  paramCountOf,
  scoreGrid,
  type Activation,
  type Backend,
  type BackendChoice,
  type ClassicalConfig,
  type FallbackReason,
  type Dataset,
  type LossKind,
  type MLPConfig,
  type ModelConfig,
  type Noise,
  type OptimizerKind,
  type Scaling,
} from '@xtraplaytion/engine';
import { compile, parse, sample } from '@xtraplaytion/expr';
import {
  estimateGpuSeconds,
  estimateSeconds,
  FALLBACK_GPU,
  FALLBACK_SPEED,
  webgpuPresent,
  type GpuSpeed,
} from './capability.ts';
import { datasetFrom, GRID_SIZE, presetState, trainingIdentity } from './experiment.ts';
import { canKink, kinkView } from './insight.ts';
import { FrameHistory, snapshotHistory, type StoredFrame, type WeightSnapshot } from './history.ts';
import {
  bootstrapData,
  classicalSeconds,
  copySeed,
  defaultClassical,
  LETTER,
  type Family,
} from './models.ts';
import type { Preset } from './presets.ts';
import { isoNow, loadRecording, type Recording, type RecordedModel } from './recording.ts';
import { recordingUrl } from './recordings.ts';
import { LIMITS, STATE_VERSION, type ExperimentState } from './share.ts';
import { autoYDomain } from './scene/draw.ts';
import {
  drawnFunction,
  pointsLayout,
  type DataSource,
  type DrawnSource,
  type PointsSource,
} from './source.ts';
import { Series, Trainer, type StartOptions, type TrainerEvents } from './trainer.ts';

export type Status = 'ready' | 'running' | 'paused' | 'done' | 'diverged' | 'error';
export type RunStatus = 'queued' | 'ready' | 'running' | 'paused' | 'done' | 'diverged' | 'error';
export type NoiseKind = 'none' | 'gaussian' | 'uniform' | 'outliers';
export type Layout = 'overlay' | 'stacked';
export type TargetTab = 'formula' | 'presets' | 'draw' | 'data';
export type InsightTab = 'neurons' | 'kinks' | 'waves' | 'weights' | 'map';
/** A library entry the playground was opened from. */
export interface SavedRef {
  id: string;
  name: string;
  rec: Recording | null;
}

export const ACTIVATIONS: Activation[] = [
  'relu',
  'leaky_relu',
  'elu',
  'gelu',
  'silu',
  'softplus',
  'tanh',
  'sigmoid',
  'sin',
  'abs',
  'identity',
];
export const OPTIMIZERS: OptimizerKind[] = [
  'adam',
  'adamw',
  'sgd',
  'momentum',
  'nesterov',
  'rmsprop',
];
export const LOSSES: LossKind[] = ['mse', 'l1', 'huber'];

export interface Layer {
  width: number;
  act: Activation;
}

interface SpecBase {
  /** Stable id (survives reordering). */
  id: number;
  /** Palette slot 1..6 (color and dash pattern). */
  color: number;
  /** Seed for the initial weights (networks) or the bootstrap samples (forests). */
  seed: number;
  visible: boolean;
  /** Average of this many copies (absent or 1: a single model). */
  copies?: number;
}

export interface NetSpec extends SpecBase {
  kind: 'mlp';
  layers: Layer[];
  optimizer: OptimizerKind;
  lr: number;
  loss: LossKind;
  /** L2 penalty on the weights ("keep weights small"); absent: none. */
  l2?: number;
}

/** Strengths offered for the L2 penalty (0: off). */
export const L2_STEPS = [0, 1e-5, 1e-4, 1e-3, 1e-2, 1e-1];

export interface ClassicSpec extends SpecBase {
  kind: 'classical';
  config: ClassicalConfig;
}

export type ModelSpec = NetSpec | ClassicSpec;

export const familyOf = (s: ModelSpec): Family => (s.kind === 'mlp' ? 'mlp' : s.config.kind);
/** Display name: family letter + color slot (N1, P3...). */
export const modelName = (s: ModelSpec) => {
  const k = copiesOf(s);
  return `${LETTER[familyOf(s)]}${s.color}${k > 1 ? ` ×${k}` : ''}`;
};

export function specConfig(s: ModelSpec): ModelConfig {
  return s.kind === 'classical' ? s.config : netConfig(s);
}

export function netConfig(s: NetSpec): MLPConfig {
  return mlp({
    hidden: s.layers.map((l) => l.width),
    activations: s.layers.map((l) => l.act),
    optimizer: {
      kind: s.optimizer,
      lr: s.lr,
      ...(s.optimizer === 'adamw' ? { weightDecay: 0.01 } : {}),
    },
    loss: { kind: s.loss, ...(s.loss === 'huber' ? { delta: 0.5 } : {}) },
    ...(s.l2 ? { l2: s.l2 } : {}),
  });
}

export const dimsLabel = (s: NetSpec) => `[1, ${s.layers.map((l) => l.width).join(', ')}, 1]`;

/** A preset's recording plays instead of live training above this estimated time. */
export const LIVE_LIMIT_SECONDS = 60;
/** Assumed display rate when estimating how long a recording plays. */
const PLAYBACK_FPS = 60;

const FINISHED: ReadonlySet<RunStatus> = new Set(['done', 'diverged', 'error']);

/** How many copies a model averages (the Gaussian process has its own band). */
export const copiesOf = (s: ModelSpec) =>
  s.kind === 'classical' && s.config.kind === 'gp' ? 1 : Math.max(1, Math.round(s.copies ?? 1));

/** One model's live run (one worker, or one per copy when the model averages copies). */
export class ModelRun {
  readonly spec: ModelSpec;
  readonly copies: number;
  readonly trainers: Trainer[];
  readonly history = new FrameHistory(600);
  /** Weights per frame (networks without copies, up to SNAPSHOT_PARAMS parameters). */
  snapshots: FrameHistory<WeightSnapshot> | null = null;
  /** Weights sent on request (bigger networks). */
  requested = $state.raw<WeightSnapshot | null>(null);
  /** Loss curves shown (the average over copies for an averaged model). */
  readonly trainLoss: Series;
  readonly valLoss: Series;
  status = $state<RunStatus>('queued');
  latest = $state(0);
  epochsPerSec = $state(0);
  /** Bumped on every new frame (history and losses are not reactive themselves). */
  version = $state(0);
  errorMessage = '';
  /** Start wave: models started together keep pace with each other. */
  wave = 0;
  /** Backend in use (null until the worker is ready). */
  backend = $state<Backend | null>(null);
  /** Set when the GPU was asked for but this model trains on the CPU. */
  fallback = $state<FallbackReason | null>(null);
  /** Epoch from which training continued after the GPU was lost. */
  recoveredAt = $state<number | null>(null);
  adapter = '';
  /** Dataset the run trains on (scoring the average of copies). */
  data: Dataset | null = null;
  private readonly pending: number[];
  private readonly memberLatest: number[];
  private readonly memberHist: FrameHistory[];
  private readonly memberDone: (string | null)[];
  private readonly onDone: (run: ModelRun) => void;
  private combinedAt = -1;

  constructor(spec: ModelSpec, onDone: (run: ModelRun) => void) {
    this.spec = spec;
    this.onDone = onDone;
    this.copies = copiesOf(spec);
    this.trainers = Array.from(
      { length: this.copies },
      (_, i) => new Trainer(this.events(i), { autoAck: false }),
    );
    this.pending = new Array<number>(this.copies).fill(0);
    this.memberLatest = new Array<number>(this.copies).fill(-1);
    this.memberDone = new Array<string | null>(this.copies).fill(null);
    this.memberHist = this.copies > 1 ? this.trainers.map(() => new FrameHistory(600)) : [];
    this.trainLoss = this.copies > 1 ? new Series() : this.trainers[0].trainLoss;
    this.valLoss = this.copies > 1 ? new Series() : this.trainers[0].valLoss;
  }

  private events(i: number): TrainerEvents {
    return {
      ready: (m) => {
        if (i === 0 || m.backend === 'webgpu') this.backend = m.backend;
        if (m.fallback) this.fallback = m.fallback;
        if (m.adapter) this.adapter = m.adapter;
      },
      recovered: (epoch, backend, reason) => {
        this.backend = backend;
        this.fallback = backend === 'webgpu' ? null : reason;
        this.recoveredAt = epoch;
      },
      frame: (f) => {
        this.pending[i] = f.seq;
        this.memberLatest[i] = f.epoch;
        if (i === 0) {
          this.backend = f.backend;
          if (f.epochsPerSec) this.epochsPerSec = f.epochsPerSec;
        }
        const stored: StoredFrame = {
          epoch: f.epoch,
          grid: f.grid,
          metrics: f.metrics,
          trainLoss: f.trainLoss,
          valLoss: f.valLoss,
          ...(f.band ? { band: f.band } : {}),
          ...(f.stage ? { stage: f.stage } : {}),
        };
        if (this.copies === 1) {
          this.history.add(stored);
          if (f.params) {
            this.snapshots ??= snapshotHistory(f.params.length);
            this.snapshots.add({ epoch: f.epoch, params: f.params });
          }
          this.latest = f.epoch;
          this.version++;
        } else {
          this.memberHist[i].add(stored);
          this.combine();
        }
      },
      snapshot: (epoch, params) => {
        this.requested = { epoch, params };
      },
      done: (reason) => {
        this.memberDone[i] = reason;
        if (this.memberDone.some((d) => d === null)) return;
        if (this.copies > 1) this.combine();
        this.status = this.memberDone.every((d) => d === 'diverged') ? 'diverged' : 'done';
        this.onDone(this);
      },
      error: (message) => {
        if (this.status === 'error') return;
        this.status = 'error';
        this.errorMessage = message;
        this.onDone(this);
      },
    };
  }

  /** Averaged model: once every copy reached an epoch, store the average and spread there. */
  private combine() {
    const e = Math.min(...this.memberLatest);
    if (e < 0 || e <= this.combinedAt || !this.data) return;
    this.combinedAt = e;
    const frames = this.memberHist.map((h) => h.at(e));
    const n = frames[0]?.grid.length ?? 0;
    const mean = new Float32Array(n);
    const sd = new Float32Array(n);
    for (let j = 0; j < n; j++) {
      let s = 0;
      let s2 = 0;
      let k = 0;
      for (const fr of frames) {
        const v = fr ? fr.grid[j] : NaN;
        if (!Number.isFinite(v)) continue;
        s += v;
        s2 += v * v;
        k++;
      }
      mean[j] = k ? s / k : NaN;
      sd[j] = k ? Math.sqrt(Math.max(0, s2 / k - (s / k) ** 2)) : NaN;
    }
    // Loss curves: the average of the copies' losses, as far as every copy got.
    const len = Math.min(...this.trainers.map((t) => t.trainLoss.length));
    const from = Math.min(this.trainLoss.length, len);
    this.trainLoss.truncate(from);
    this.valLoss.truncate(from);
    const avg = (pick: (t: Trainer) => Series) =>
      Float64Array.from({ length: len - from }, (_, q) => {
        let s = 0;
        let k = 0;
        for (const t of this.trainers) {
          const v = pick(t).data[from + q];
          if (Number.isFinite(v)) {
            s += v;
            k++;
          }
        }
        return k ? s / k : NaN;
      });
    this.trainLoss.push(avg((t) => t.trainLoss));
    this.valLoss.push(avg((t) => t.valLoss));
    const stage = frames[0]?.stage;
    this.history.add({
      epoch: e,
      grid: mean,
      band: sd,
      metrics: scoreGrid(mean, this.data),
      trainLoss: this.trainLoss.length ? this.trainLoss.data[this.trainLoss.length - 1] : NaN,
      valLoss: this.valLoss.length ? this.valLoss.data[this.valLoss.length - 1] : NaN,
      ...(stage ? { stage } : {}),
    });
    this.latest = e;
    this.version++;
  }

  /** Starts training (every copy in its own worker). */
  start(opts: Omit<StartOptions, 'seed'>) {
    this.data = opts.data;
    const classical = opts.config.kind !== 'mlp';
    this.trainers.forEach((t, i) =>
      t.start({
        ...opts,
        data:
          this.copies > 1 && classical ? bootstrapData(opts.data, this.spec.seed + i) : opts.data,
        seed: classical ? this.spec.seed : copySeed(this.spec.seed, i),
      }),
    );
  }
  play() {
    for (const t of this.trainers) t.play();
  }
  pause() {
    for (const t of this.trainers) t.pause();
  }
  step(n = 1) {
    for (const t of this.trainers) t.step(n);
  }
  setSpeed(epochsPerFrame: number) {
    for (const t of this.trainers) t.setSpeed(epochsPerFrame);
  }
  dispose() {
    for (const t of this.trainers) t.dispose();
  }
  /** Asks the worker for the current weights (networks without copies). */
  requestSnapshot() {
    if (this.copies === 1 && this.trainers[0].started) this.trainers[0].snapshot();
  }
  get hasPending(): boolean {
    return this.pending.some((s) => s > 0);
  }
  /** Lets copies that are not ahead of `limit` send their next frame. */
  ack(limit: number) {
    this.pending.forEach((seq, i) => {
      if (!seq) return;
      const mine = this.copies > 1 ? this.memberLatest[i] : this.latest;
      if (this.finished || mine <= limit) {
        this.trainers[i].ack(seq);
        this.pending[i] = 0;
      }
    });
  }

  get finished(): boolean {
    return FINISHED.has(this.status);
  }

  frameAt(epoch: number): StoredFrame | null {
    void this.version;
    return this.history.at(epoch);
  }

  /** Weights shown at `epoch`: the snapshot at or before it, else the latest requested. */
  weightsAt(epoch: number): WeightSnapshot | null {
    void this.version;
    return this.snapshots?.at(epoch) ?? this.requested;
  }

  /** Recorded runs: the last epoch of the recording, and whether it diverged there. */
  final = 0;
  recordedDiverged = false;

  /** This run as a recorded model (for saving to the library). */
  toRecorded(): RecordedModel {
    const frames = this.history.frames;
    const hasBand = frames.length > 0 && frames.every((f) => f.band);
    const n = this.trainLoss.length;
    return {
      trainLoss: Float32Array.from(this.trainLoss.view().subarray(0, n)),
      valLoss: Float32Array.from(this.valLoss.view().subarray(0, n)),
      frameEpochs: Uint32Array.from(frames, (f) => f.epoch),
      grids: frames.map((f) => f.grid),
      diverged: this.status === 'diverged',
      ...(hasBand ? { bands: frames.map((f) => f.band ?? new Float32Array(0)) } : {}),
      ...(frames.some((f) => f.stage) ? { stages: frames.map((f) => f.stage ?? null) } : {}),
      ...(this.backend ? { backend: this.backend } : {}),
    };
  }

  /** Fills the history from a recording (no worker). Playback then moves `latest`. */
  loadRecorded(m: RecordedModel, data: Dataset, backend: Backend) {
    this.history.clear();
    m.grids.forEach((grid, i) => {
      const epoch = m.frameEpochs[i];
      const band = m.bands?.[i];
      const stage = m.stages?.[i];
      this.history.add({
        epoch,
        grid,
        metrics: scoreGrid(grid, data),
        trainLoss: epoch > 0 ? m.trainLoss[epoch - 1] : NaN,
        valLoss: epoch > 0 ? m.valLoss[epoch - 1] : NaN,
        ...(band && band.length ? { band } : {}),
        ...(stage ? { stage } : {}),
      });
    });
    this.trainLoss.clear();
    this.valLoss.clear();
    this.trainLoss.push(Float64Array.from(m.trainLoss));
    this.valLoss.push(Float64Array.from(m.valLoss));
    this.final = m.frameEpochs[m.frameEpochs.length - 1] ?? 0;
    this.recordedDiverged = m.diverged;
    this.backend = backend;
    this.data = data;
    this.status = 'ready';
    this.latest = 0;
    this.version++;
  }
}

let nextId = 1;
const newSpec = (
  color: number,
  seed: number,
  layers: Layer[],
  lr = 0.003,
  act?: Activation,
): NetSpec => ({
  id: nextId++,
  kind: 'mlp',
  color,
  layers: layers.map((l) => ({ width: l.width, act: act ?? l.act })),
  optimizer: 'adam',
  lr,
  loss: 'mse',
  seed,
  visible: true,
});

const defaultNet = (color: number, seed: number) =>
  newSpec(color, seed, [
    { width: 64, act: 'relu' },
    { width: 64, act: 'relu' },
  ]);

export class Playground {
  // ---- target and data
  expr = $state('sin(x) + 0.5 sin(2x) + (1/3) sin(3x)');
  /** Open tab of the target panel. It decides the target: the formula (Formula and Presets),
   *  the drawing (Draw) or the imported points (Your data). The others are kept, so going
   *  back to a tab restores what was there. */
  targetTab = $state<TargetTab>('formula');
  drawing = $state.raw<DrawnSource | null>(null);
  imported = $state.raw<PointsSource | null>(null);
  /** Where imported points came from (file name), shown in the panel. */
  importedName = $state('');
  /** y range kept fixed while drawing, so the plot does not rescale under the pen. */
  drawY = $state<[number, number] | null>(null);
  source = $derived<DataSource | null>(
    this.targetTab === 'draw' ? this.drawing : this.targetTab === 'data' ? this.imported : null,
  );
  domain = $state<[number, number]>([-10, 10]);
  n = $state(200);
  noiseKind = $state<NoiseKind>('gaussian');
  sigma = $state(0.08);
  seed = $state(7);
  valFraction = $state(0.2);
  bands = $state<[number, number][]>([
    [-7.5, -2],
    [1.5, 6.5],
  ]);
  // ---- competitors
  models = $state<ModelSpec[]>([
    newSpec(1, 1, [
      { width: 64, act: 'relu' },
      { width: 64, act: 'relu' },
    ]),
  ]);
  selected = $state(0);
  layout = $state<Layout>('overlay');
  // ---- insight views
  /** Model shown in the Look inside card (by spec id; null: the first visible one). */
  inspectId = $state<number | null>(null);
  insightTab = $state<InsightTab>('neurons');
  // ---- training
  epochs = $state(1600);
  /** Epochs per frame, a power of two. */
  speed = $state(8);
  /** Where models train. Auto: the GPU whenever this browser has WebGPU. */
  backend = $state<BackendChoice>('auto');
  /** Device speed from the first-run benchmark (work units per second). */
  deviceSpeed = $state(FALLBACK_SPEED);
  deviceMeasured = $state(false);
  /** GPU cost model (null: no usable WebGPU). */
  gpuSpeed = $state<GpuSpeed | null>(webgpuPresent() ? FALLBACK_GPU : null);
  readonly webgpu = webgpuPresent();

  // ---- runs
  runs = $state.raw<ModelRun[]>([]);
  playing = $state(false);
  replayEpoch = $state<number | null>(null);
  /** Epoch on screen when Pause was pressed. Frames already in flight still arrive
   *  (and are stored), but the view stays where the user stopped it. */
  private held = $state<number | null>(null);
  pausedByHiddenTab = $state(false);
  readonly maxWorkers = Math.max(
    1,
    Math.min(LIMITS.models, (globalThis.navigator?.hardwareConcurrency ?? 4) - 1),
  );
  private looping = false;
  private waves = 0;

  // ---- recorded runs
  /** Preset whose recording may play, and the identity it was recorded for. */
  private recordedPreset = $state.raw<{ id: string; key: string } | null>(null);
  /** The visitor asked to train this preset for real. */
  liveChosen = $state(false);
  /** Lessons: play a preset's recording whenever there is one (instant, same everywhere). */
  alwaysRecorded = false;
  private recording: Recording | null = null;
  private loadingRecording: string | null = null;
  /** 'recorded' while the race on screen plays a recording. */
  mode = $state<'live' | 'recorded'>('live');
  /** The library entry this experiment was opened from (its saved results play first). */
  saved = $state.raw<SavedRef | null>(null);
  /** What the recorded race on screen is: a preset's recording or saved results. */
  recordedKind = $state<'preset' | 'saved'>('preset');
  private lastTick = 0;

  parsed = $derived(parse(this.expr));
  /** The true function, when there is one (formula or drawing). */
  fn = $derived.by((): ((x: number) => number) | null => {
    if (this.source?.kind === 'drawn') return drawnFunction(this.source);
    if (this.source?.kind === 'points') return null;
    return this.parsed.ok ? compile(this.parsed.expr) : null;
  });
  /** What the target is right now. */
  targetKind = $derived<'formula' | 'drawn' | 'points'>(
    this.targetTab === 'draw' ? 'drawn' : this.targetTab === 'data' ? 'points' : 'formula',
  );

  noise = $derived.by((): Noise => {
    switch (this.noiseKind) {
      case 'none':
        return { kind: 'none' };
      case 'uniform':
        return { kind: 'uniform', width: 2 * this.sigma };
      case 'outliers':
        return { kind: 'outliers', sigma: this.sigma, percent: 5, magnitude: 1.5 };
      default:
        return { kind: 'gaussian', sigma: this.sigma };
    }
  });

  data = $derived.by((): Dataset | null => {
    if (this.targetKind !== 'formula' && !this.source) return null; // nothing drawn or imported yet
    return datasetFrom(this.expr, this.source, {
      domain: this.domain,
      n: this.n,
      bands: $state.snapshot(this.bands) as [number, number][],
      noise: this.noise,
      valFraction: this.valFraction,
      seed: this.seed,
    });
  });

  /** Networks train on rescaled values when the target is imported data (x: the plot range
   *  maps to [-1, 1]; y: standardized with the data inside the training ranges). */
  netScale = $derived.by((): Scaling | undefined => {
    const d = this.data;
    if (this.targetKind !== 'points' || !d) return undefined;
    const ys = [...d.trainY, ...d.valY];
    if (ys.length < 2) return undefined;
    const mean = ys.reduce((a, v) => a + v, 0) / ys.length;
    const sd = Math.sqrt(ys.reduce((a, v) => a + (v - mean) ** 2, 0) / ys.length);
    const [a, b] = this.domain;
    const r = (v: number) => +v.toPrecision(6);
    return {
      xShift: r((a + b) / 2),
      xScale: r(2 / (b - a)),
      yShift: r(mean),
      yScale: r(sd > 0 ? 1 / sd : 1),
    };
  });

  /** Configuration a model trains with (networks on imported data get the scaling). */
  configOf(m: ModelSpec): ModelConfig {
    const cfg = specConfig(m);
    const sc = this.netScale;
    return cfg.kind === 'mlp' && sc ? { ...cfg, scale: sc } : cfg;
  }

  invalidPoints = $derived(
    this.targetKind === 'formula' && this.fn && this.data
      ? sample(this.fn, this.data.gridX).invalid
      : 0,
  );

  /** Changes that require retraining (visibility and layout do not). */
  trainingKey = $derived(
    JSON.stringify([this.epochs, this.backend, this.models.map(({ visible: _v, ...m }) => m)]),
  );

  /** True when new runs are expected to train on the GPU. */
  onGpu = $derived(this.backend !== 'cpu' && this.gpuSpeed !== null);

  /** Shared clock: the slowest model still training sets the pace. */
  clock = $derived.by(() => {
    const active = this.runs.filter((r) => r.status !== 'queued' && !r.finished);
    if (active.length) return Math.min(...active.map((r) => r.latest));
    return this.runs.reduce((m, r) => Math.max(m, r.latest), 0);
  });
  viewEpoch = $derived(this.replayEpoch ?? this.held ?? this.clock);
  /** Runs of the models currently shown, in list order (visibility never restarts a run). */
  visibleRuns = $derived.by(() => {
    const shown = this.models.filter((m) => m.visible).map((m) => m.id);
    return this.runs.filter((r) => shown.includes(r.spec.id));
  });
  maxEpoch = $derived(this.runs.reduce((m, r) => Math.max(m, r.latest), 0));
  /** The model in the Look inside card, and its run. */
  inspected = $derived.by((): { spec: ModelSpec; run: ModelRun | null } | null => {
    const shown = this.models.filter((m) => m.visible);
    const spec = shown.find((m) => m.id === this.inspectId) ?? shown[0] ?? this.models[0] ?? null;
    if (!spec) return null;
    return { spec, run: this.runs.find((r) => r.spec.id === spec.id) ?? null };
  });
  /** Mark the inspected network's kinks on the fit plot (the playground's Look inside card;
   *  lessons and embeds have no inspector, so they turn it off). */
  kinksOnPlot = true;
  /** Kinks of the inspected network at the epoch shown (marked on the fit plot). */
  kinkMarks = $derived.by((): { id: number; xs: Float64Array } | null => {
    if (!this.kinksOnPlot) return null;
    const r = this.inspected?.run;
    if (!r || this.mode !== 'live' || r.copies > 1 || r.spec.kind !== 'mlp') return null;
    const cfg = this.configOf(r.spec);
    if (cfg.kind !== 'mlp' || !canKink(cfg)) return null;
    const w = r.weightsAt(this.viewEpoch);
    const k = w ? kinkView(cfg, w.params) : null;
    return k ? { id: r.spec.id, xs: k.xs } : null;
  });

  status = $derived.by((): Status => {
    if (!this.runs.length) return 'ready';
    if (this.runs.some((r) => r.status === 'error')) return 'error';
    if (this.runs.every((r) => r.finished))
      return this.runs.every((r) => r.status === 'diverged') ? 'diverged' : 'done';
    if (this.playing) return 'running';
    return this.clock > 0 ? 'paused' : 'ready';
  });

  /** Estimated training time of each model on this device (models run in parallel).
   *  Classical models fit on the CPU in a moment (Gaussian processes take longer). */
  estimates = $derived(
    this.models.map((m) => {
      const cfg = specConfig(m);
      const points = this.data ? this.data.trainY.length : this.n;
      if (cfg.kind !== 'mlp')
        return classicalSeconds(cfg, points, FALLBACK_SPEED / this.deviceSpeed) * copiesOf(m);
      const params = paramCountOf(cfg);
      return this.onGpu && this.gpuSpeed
        ? estimateGpuSeconds(params, points, this.epochs, this.gpuSpeed)
        : estimateSeconds(params, points, this.epochs, cfg.activations, this.deviceSpeed);
    }),
  );
  /** Whole race. On the CPU the slowest model sets the pace, models beyond the worker
   *  count wait their turn, and parallel workers slow each other down somewhat (shared
   *  caches, lower boost clocks; about 25% per extra worker, measured on desktop
   *  Chrome). On the GPU, models share one graphics card, so their times add up. */
  estimateTotal = $derived.by(() => {
    const isNet = (i: number) => this.models[i]?.kind === 'mlp';
    // Every copy of an averaged network trains in its own worker.
    const nets = this.estimates.flatMap((e, i) =>
      isNet(i) ? new Array<number>(copiesOf(this.models[i])).fill(e) : [],
    );
    const classic = Math.max(0, ...this.estimates.filter((_, i) => !isNet(i)));
    if (this.onGpu)
      return Math.max(
        classic,
        nets.reduce((s, e) => s + e, 0),
      );
    const k = Math.min(nets.length, this.maxWorkers);
    const rounds = Math.ceil(nets.length / this.maxWorkers);
    return Math.max(classic, Math.max(0, ...nets) * rounds * (1 + 0.25 * Math.max(0, k - 1)));
  });

  /** True when the race on screen should be the preset's recording: the experiment is
   *  exactly the recorded one and training it here would take too long. */
  recordingWanted = $derived.by(() => {
    if (this.liveChosen) return false;
    const sv = this.saved?.rec;
    if (sv) return trainingIdentity(this.snapshotState()) === sv.key;
    const r = this.recordedPreset;
    if (!r) return false;
    if (!this.alwaysRecorded && this.estimateTotal <= LIVE_LIMIT_SECONDS) return false;
    return trainingIdentity(this.snapshotState()) === r.key;
  });
  /** How long the recording takes to play at the current speed. */
  playbackSeconds = $derived(this.epochs / (this.speed * PLAYBACK_FPS));

  /** Backends in use by the current runs (empty before they are ready). */
  backends = $derived.by(() => {
    const list: Backend[] = [];
    for (const r of this.runs) if (r.backend && !list.includes(r.backend)) list.push(r.backend);
    return list;
  });

  // ---------------------------------------------------------------- runs

  private startRun(run: ModelRun, wave: number) {
    const data = this.data;
    if (!data) return;
    run.wave = wave;
    run.status = 'ready';
    run.start({
      config: this.configOf(run.spec),
      data,
      epochs: this.epochs,
      epochsPerFrame: this.speed,
      backend: this.backend,
    });
    if (this.playing) {
      run.play();
      run.status = 'running';
    }
  }

  /** Workers a run keeps busy (classical models fit in a moment and do not count). */
  private workersOf = (r: ModelRun) => (r.spec.kind === 'mlp' ? r.copies : 0);

  private onRunDone = () => {
    // Models that waited for free workers start from epoch 0; finished models
    // are replayed from their history in step with them.
    let busy = this.runs
      .filter((r) => r.status !== 'queued' && !r.finished)
      .reduce((n, r) => n + this.workersOf(r), 0);
    let wave = 0;
    for (const r of this.runs) {
      if (r.status !== 'queued') continue;
      const need = this.workersOf(r);
      if (busy > 0 && busy + need > this.maxWorkers) break;
      if (!wave) wave = ++this.waves;
      this.startRun(r, wave);
      busy += need;
    }
    if (this.runs.every((r) => r.finished)) this.playing = false;
  };

  /** Set while a settings change waits to restart the race (debounced by the page). */
  restartPending = false;
  /** Play was pressed while a restart was pending: play once the new race exists. */
  private playAfterRestart = false;

  /** Start over from epoch 0 with the current settings (paused, unless Play was pressed
   *  while this restart was pending). */
  restart() {
    const resume = this.playAfterRestart;
    this.playAfterRestart = false;
    this.restartPending = false;
    this.rebuild();
    if (resume) {
      if (this.runs.length) this.play();
      else this.playAfterRestart = true; // a recording is still loading
    }
  }

  private rebuild() {
    for (const r of this.runs) r.dispose();
    this.playing = false;
    this.replayEpoch = null;
    this.held = null;
    this.mode = 'live';
    if (!this.data) {
      this.runs = [];
      return;
    }
    const sv = this.saved?.rec;
    if (this.recordingWanted && sv) return this.showRecording(sv, this.data, 'saved');
    if (this.recordingWanted && this.recordedPreset) {
      const { id, key } = this.recordedPreset;
      if (this.recording?.key === key) return this.showRecording(this.recording, this.data);
      const url = recordingUrl(id);
      if (url) {
        this.runs = [];
        if (this.loadingRecording !== url) {
          this.loadingRecording = url;
          loadRecording(url).then(
            (rec) => {
              this.loadingRecording = null;
              this.recording = rec;
              this.restart();
            },
            () => {
              // Recording unavailable: train live instead.
              this.loadingRecording = null;
              this.liveChosen = true;
              this.restart();
            },
          );
        }
        return;
      }
    }
    const runs = this.models.map(
      (m) => new ModelRun($state.snapshot(m) as ModelSpec, this.onRunDone),
    );
    this.runs = runs;
    this.waves = 0;
    // Classical models fit in a moment and then idle, so they do not take a worker slot.
    let busy = 0;
    for (const r of runs) {
      const need = this.workersOf(r);
      if (need && busy > 0 && busy + need > this.maxWorkers) continue;
      this.startRun(r, 0);
      busy += need;
    }
  }

  private showRecording(rec: Recording, data: Dataset, kind: 'preset' | 'saved' = 'preset') {
    this.mode = 'recorded';
    this.recordedKind = kind;
    this.runs = this.models.map((m, i) => {
      const run = new ModelRun($state.snapshot(m) as ModelSpec, () => {});
      const rm = rec.models[i];
      if (rm) run.loadRecorded(rm, data, rm.backend ?? rec.backend);
      // Saved results open where they were saved; Play replays them from the start.
      if (rm && kind === 'saved') {
        run.latest = run.final;
        run.status = run.recordedDiverged ? 'diverged' : 'done';
      }
      return run;
    });
  }

  /** The race on screen as a recording (for the library). Null before anything trained. */
  recordingOfRace(): Recording | null {
    if (!this.runs.length || this.maxEpoch === 0) return null;
    const state = this.snapshotState();
    const first = this.runs.find((r) => r.backend)?.backend ?? 'cpu-f64';
    return {
      key: trainingIdentity(state),
      state,
      backend: first,
      adapter: this.runs.find((r) => r.adapter)?.adapter ?? '',
      created: isoNow(),
      gridSize: GRID_SIZE,
      models: this.runs.map((r) => r.toRecorded()),
    };
  }

  /** Opens a library entry: its settings, with its saved results shown first. */
  openSaved(ref: SavedRef, state: ExperimentState) {
    this.loadState(state);
    this.recordedPreset = null;
    this.liveChosen = false;
    this.saved = ref;
  }

  /** Plays the recording: every model advances `speed` epochs per animation frame. */
  private playback = (now: number) => {
    if (!this.playing || this.mode !== 'recorded') {
      this.looping = false;
      return;
    }
    const dt = this.lastTick ? Math.max(1, now - this.lastTick) : 1000 / PLAYBACK_FPS;
    this.lastTick = now;
    for (const r of this.runs) {
      if (r.finished) continue;
      r.latest = Math.min(r.final, r.latest + this.speed);
      r.epochsPerSec = (this.speed * 1000) / dt;
      if (r.latest >= r.final) r.status = r.recordedDiverged ? 'diverged' : 'done';
    }
    if (this.runs.every((r) => r.finished)) {
      this.playing = false;
      this.looping = false;
      return;
    }
    requestAnimationFrame(this.playback);
  };

  /** Leave the recording and train this experiment for real on this device. */
  trainLive() {
    this.liveChosen = true;
    this.restart();
  }

  private loop = () => {
    if (!this.playing) {
      this.looping = false;
      return;
    }
    // Acknowledge frames only for models that are not ahead of the slowest model
    // of their own or an earlier wave (a later wave never holds an earlier one back).
    const window = 2 * this.speed;
    const active = this.runs.filter((r) => r.status !== 'queued' && !r.finished);
    for (const r of this.runs) {
      if (!r.hasPending) continue;
      let pace = Infinity;
      for (const o of active) if (o.wave <= r.wave && o.latest < pace) pace = o.latest;
      r.ack(pace + window);
    }
    requestAnimationFrame(this.loop);
  };

  play() {
    if (this.restartPending) {
      this.playAfterRestart = true;
      return;
    }
    if (this.mode === 'recorded' && this.runs.length && this.runs.every((r) => r.finished)) {
      // Replay a recording from the start without reloading it.
      for (const r of this.runs) {
        r.latest = 0;
        r.status = 'ready';
      }
    }
    if (
      this.status === 'done' ||
      this.status === 'diverged' ||
      this.status === 'error' ||
      !this.runs.length
    )
      this.restart();
    this.pausedByHiddenTab = false;
    this.replayEpoch = null;
    this.held = null;
    this.playing = true;
    if (this.mode === 'recorded') {
      for (const r of this.runs) if (!r.finished) r.status = 'running';
      this.lastTick = 0;
      if (!this.looping) {
        this.looping = true;
        requestAnimationFrame(this.playback);
      }
      return;
    }
    for (const r of this.runs) {
      if (r.status === 'ready' || r.status === 'paused') {
        r.play();
        r.status = 'running';
      }
    }
    if (!this.looping) {
      this.looping = true;
      requestAnimationFrame(this.loop);
    }
  }

  pause() {
    if (this.playing) this.held = this.clock;
    this.playing = false;
    for (const r of this.runs) {
      if (r.status === 'running') {
        if (this.mode === 'live') r.pause();
        r.status = 'paused';
      }
    }
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  step() {
    if (this.playing) this.pause();
    this.replayEpoch = null;
    this.held = null;
    for (const r of this.runs) {
      if (r.status === 'ready' || r.status === 'paused') {
        if (this.mode === 'recorded') {
          r.latest = Math.min(r.final, r.latest + 1);
          r.status = r.latest < r.final ? 'paused' : r.recordedDiverged ? 'diverged' : 'done';
        } else {
          r.step(1);
          r.status = 'paused';
        }
      }
    }
  }

  setSpeed(epochsPerFrame: number) {
    this.speed = epochsPerFrame;
    if (this.mode === 'live') for (const r of this.runs) r.setSpeed(epochsPerFrame);
  }

  /** Show the run as it was at `epoch` (pauses training). */
  scrub(epoch: number | null) {
    if (epoch !== null && this.playing) this.pause();
    if (epoch === null) this.held = null;
    this.replayEpoch =
      epoch === null ? null : Math.max(0, Math.min(this.maxEpoch, Math.round(epoch)));
  }

  dispose() {
    this.playing = false;
    for (const r of this.runs) r.dispose();
  }

  // ------------------------------------------------------------ models

  /** Adds a competitor. A network starts as a copy of the selected (or last) network with
   *  new starting weights; a classical model starts from its defaults. */
  addModel(family: Family = 'mlp') {
    if (this.models.length >= LIMITS.models) return;
    const used = this.models.map((m) => m.color);
    const color = [1, 2, 3, 4, 5, 6].find((c) => !used.includes(c)) ?? 1;
    const seed = Math.max(...this.models.map((m) => m.seed)) + 1;
    const common = { id: nextId++, color, seed, visible: true };
    let spec: ModelSpec;
    if (family === 'mlp') {
      const sel = this.models[this.selected];
      const base =
        sel?.kind === 'mlp' ? sel : this.models.findLast((m): m is NetSpec => m.kind === 'mlp');
      spec = {
        ...(base ? ($state.snapshot(base) as NetSpec) : defaultNet(color, seed)),
        ...common,
      };
    } else {
      spec = { kind: 'classical', config: this.defaultFor(family), ...common };
    }
    this.models = [...this.models, spec];
    this.selected = this.models.length - 1;
  }

  private defaultFor(family: ClassicalConfig['kind']): ClassicalConfig {
    return defaultClassical(family, this.domain[1] - this.domain[0]);
  }

  /** Turns model i into another family (keeps its color, seed and visibility). */
  changeFamily(i: number, family: Family) {
    const m = this.models[i];
    if (!m || familyOf(m) === family) return;
    const { id, color, seed, visible, copies } = m;
    const keep = { id, visible, ...(copies && family !== 'gp' ? { copies } : {}) };
    const next: ModelSpec =
      family === 'mlp'
        ? { ...defaultNet(color, seed), ...keep }
        : { kind: 'classical', config: this.defaultFor(family), color, seed, ...keep };
    this.models = this.models.map((s, k) => (k === i ? next : s));
  }

  removeModel(i: number) {
    if (this.models.length <= 1) return;
    this.models = this.models.filter((_, k) => k !== i);
    this.selected = Math.min(this.selected, this.models.length - 1);
  }

  /** Changes fields every model has, or network fields when model i is a network. */
  updateModel(i: number, patch: Partial<SpecBase> | Partial<Omit<NetSpec, 'kind'>>) {
    this.models = this.models.map((m, k) => {
      if (k !== i) return m;
      if (m.kind === 'mlp') return { ...m, ...patch };
      const { id, color, seed, visible, copies } = { ...m, ...(patch as Partial<SpecBase>) };
      return { ...m, id, color, seed, visible, ...(copies ? { copies } : {}) };
    });
  }

  /** Changes the configuration of classical model i (same family). */
  updateClassical(i: number, patch: Partial<ClassicalConfig>) {
    this.models = this.models.map((m, k) =>
      k === i && m.kind === 'classical'
        ? { ...m, config: { ...m.config, ...patch } as ClassicalConfig }
        : m,
    );
  }

  runOf(spec: ModelSpec): ModelRun | undefined {
    return this.runs.find((r) => r.spec.id === spec.id);
  }

  applyPreset(p: Preset) {
    this.saved = null;
    const backend = this.backend; // a preset does not change where models train
    const state = presetState(p);
    this.loadState(state);
    this.backend = backend;
    this.liveChosen = false;
    this.recordedPreset = p.recorded ? { id: p.id, key: trainingIdentity(state) } : null;
  }

  // ------------------------------------------------------------ targets

  /** Opens a target tab. Entering Draw keeps the current y range for the empty canvas. */
  setTargetTab(tab: TargetTab) {
    if (tab === this.targetTab) return;
    if (tab === 'draw') {
      const d = this.data;
      this.drawY = d ? autoYDomain(d.clean, d.trainY, d.valY) : [-2, 2];
    } else this.drawY = null;
    this.targetTab = tab;
  }

  /** Uses imported points as the target: plot range around them, training on the first 70%. */
  importPoints(src: PointsSource, name: string) {
    const layout = pointsLayout(src.xs);
    this.imported = src;
    this.importedName = name;
    this.domain = layout.domain;
    this.bands = layout.bands;
    this.targetTab = 'data';
  }

  // ------------------------------------------------------------ sharing

  snapshotState(): ExperimentState {
    return {
      v: STATE_VERSION,
      expr: this.expr,
      ...(this.source ? { source: $state.snapshot(this.source) as DataSource } : {}),
      domain: [...this.domain],
      n: this.n,
      noise: $state.snapshot(this.noise) as Noise,
      seed: this.seed,
      valFraction: this.valFraction,
      bands: $state.snapshot(this.bands) as [number, number][],
      models: this.models.map((m) => ({
        model: $state.snapshot(this.configOf(m)) as ModelConfig,
        seed: m.seed,
        visible: m.visible,
        ...(copiesOf(m) > 1 ? { copies: copiesOf(m) } : {}),
      })),
      epochs: this.epochs,
      layout: this.layout,
      ...(this.backend !== 'auto' ? { backend: this.backend } : {}),
    };
  }

  loadState(s: ExperimentState) {
    this.saved = null;
    this.expr = s.expr;
    this.drawY = null;
    if (s.source?.kind === 'drawn') this.drawing = s.source;
    if (s.source?.kind === 'points') {
      this.imported = s.source;
      this.importedName = '';
    }
    this.targetTab = s.source?.kind === 'drawn' ? 'draw' : s.source ? 'data' : 'formula';
    this.domain = s.domain;
    this.n = s.n;
    this.seed = s.seed;
    this.valFraction = s.valFraction;
    this.bands = s.bands;
    const nz = s.noise;
    this.noiseKind = nz.kind === 'hetero' ? 'gaussian' : nz.kind;
    if (nz.kind === 'gaussian' || nz.kind === 'outliers' || nz.kind === 'hetero')
      this.sigma = nz.sigma;
    if (nz.kind === 'uniform') this.sigma = nz.width / 2;
    this.models = s.models.map((m, i): ModelSpec => {
      const common = {
        id: nextId++,
        color: i + 1,
        seed: m.seed,
        visible: m.visible,
        ...(m.copies && m.copies > 1 ? { copies: m.copies } : {}),
      };
      const c = m.model;
      if (c.kind !== 'mlp') return { kind: 'classical', config: c, ...common };
      return {
        kind: 'mlp',
        layers: c.hidden.map((width, k) => ({ width, act: c.activations[k] })),
        optimizer: c.optimizer.kind,
        lr: c.optimizer.lr,
        loss: c.loss.kind,
        ...(c.l2 > 0 ? { l2: c.l2 } : {}),
        ...common,
      };
    });
    this.selected = 0;
    this.layout = s.layout;
    this.epochs = s.epochs;
    this.backend = s.backend ?? 'auto';
  }
}
