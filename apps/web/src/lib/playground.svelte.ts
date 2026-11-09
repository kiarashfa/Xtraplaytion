// Playground state (Svelte 5 runes): one dataset, up to six competing models.
// Each model trains in its own worker. The page keeps them on a shared epoch
// clock: a model's frames are acknowledged only while it is close to the slowest
// active model, so the race is fair on screen. Every frame goes into a history
// store, which the replay scrubber reads.
import {
  mlp,
  paramCountOf,
  regionMetrics,
  type Activation,
  type Backend,
  type BackendChoice,
  type FallbackReason,
  type Dataset,
  type LossKind,
  type MLPConfig,
  type Noise,
  type OptimizerKind,
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
import { datasetFor, presetState, trainingIdentity } from './experiment.ts';
import { FrameHistory, type StoredFrame } from './history.ts';
import type { Preset } from './presets.ts';
import { loadRecording, type Recording, type RecordedModel } from './recording.ts';
import { recordingUrl } from './recordings.ts';
import { LIMITS, type ExperimentState } from './share.ts';
import { Trainer } from './trainer.ts';

export type Status = 'ready' | 'running' | 'paused' | 'done' | 'diverged' | 'error';
export type RunStatus = 'queued' | 'ready' | 'running' | 'paused' | 'done' | 'diverged' | 'error';
export type NoiseKind = 'none' | 'gaussian' | 'uniform' | 'outliers';
export type Layout = 'overlay' | 'stacked';

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

export interface ModelSpec {
  /** Stable id (survives reordering). */
  id: number;
  /** Palette slot 1..6 (color and dash pattern). */
  color: number;
  layers: Layer[];
  optimizer: OptimizerKind;
  lr: number;
  loss: LossKind;
  /** Seed for the initial weights. */
  seed: number;
  visible: boolean;
}

export function specConfig(s: ModelSpec): MLPConfig {
  return mlp({
    hidden: s.layers.map((l) => l.width),
    activations: s.layers.map((l) => l.act),
    optimizer: {
      kind: s.optimizer,
      lr: s.lr,
      ...(s.optimizer === 'adamw' ? { weightDecay: 0.01 } : {}),
    },
    loss: { kind: s.loss, ...(s.loss === 'huber' ? { delta: 0.5 } : {}) },
  });
}

export const dimsLabel = (s: ModelSpec) => `[1, ${s.layers.map((l) => l.width).join(', ')}, 1]`;

/** A preset's recording plays instead of live training above this estimated time. */
export const LIVE_LIMIT_SECONDS = 60;
/** Assumed display rate when estimating how long a recording plays. */
const PLAYBACK_FPS = 60;

const FINISHED: ReadonlySet<RunStatus> = new Set(['done', 'diverged', 'error']);

/** One model's live run. */
export class ModelRun {
  readonly spec: ModelSpec;
  readonly trainer: Trainer;
  readonly history = new FrameHistory(600);
  status = $state<RunStatus>('queued');
  latest = $state(0);
  epochsPerSec = $state(0);
  /** Bumped on every new frame (history and losses are not reactive themselves). */
  version = $state(0);
  errorMessage = '';
  pendingSeq = 0;
  /** Start wave: models started together keep pace with each other. */
  wave = 0;
  /** Backend in use (null until the worker is ready). */
  backend = $state<Backend | null>(null);
  /** Set when the GPU was asked for but this model trains on the CPU. */
  fallback = $state<FallbackReason | null>(null);
  /** Epoch from which training continued after the GPU was lost. */
  recoveredAt = $state<number | null>(null);
  adapter = '';

  constructor(spec: ModelSpec, onDone: (run: ModelRun) => void) {
    this.spec = spec;
    this.trainer = new Trainer(
      {
        ready: (m) => {
          this.backend = m.backend;
          this.fallback = m.fallback ?? null;
          this.adapter = m.adapter ?? '';
        },
        recovered: (epoch, backend, reason) => {
          this.backend = backend;
          this.fallback = backend === 'webgpu' ? null : reason;
          this.recoveredAt = epoch;
        },
        frame: (f) => {
          this.backend = f.backend;
          this.history.add({
            epoch: f.epoch,
            grid: f.grid,
            metrics: f.metrics,
            trainLoss: f.trainLoss,
            valLoss: f.valLoss,
          });
          this.latest = f.epoch;
          if (f.epochsPerSec) this.epochsPerSec = f.epochsPerSec;
          this.pendingSeq = f.seq;
          this.version++;
        },
        done: (reason) => {
          this.status = reason === 'diverged' ? 'diverged' : 'done';
          onDone(this);
        },
        error: (message) => {
          this.status = 'error';
          this.errorMessage = message;
          onDone(this);
        },
      },
      { autoAck: false },
    );
  }

  get finished(): boolean {
    return FINISHED.has(this.status);
  }

  frameAt(epoch: number): StoredFrame | null {
    void this.version;
    return this.history.at(epoch);
  }

  /** Recorded runs: the last epoch of the recording, and whether it diverged there. */
  final = 0;
  recordedDiverged = false;

  /** Fills the history from a recording (no worker). Playback then moves `latest`. */
  loadRecorded(m: RecordedModel, data: Dataset, backend: Backend) {
    this.history.clear();
    m.grids.forEach((grid, i) => {
      const epoch = m.frameEpochs[i];
      this.history.add({
        epoch,
        grid,
        metrics: regionMetrics(grid, data.clean, data.region),
        trainLoss: epoch > 0 ? m.trainLoss[epoch - 1] : NaN,
        valLoss: epoch > 0 ? m.valLoss[epoch - 1] : NaN,
      });
    });
    this.trainer.trainLoss.clear();
    this.trainer.valLoss.clear();
    this.trainer.trainLoss.push(Float64Array.from(m.trainLoss));
    this.trainer.valLoss.push(Float64Array.from(m.valLoss));
    this.final = m.frameEpochs[m.frameEpochs.length - 1] ?? 0;
    this.recordedDiverged = m.diverged;
    this.backend = backend;
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
): ModelSpec => ({
  id: nextId++,
  color,
  layers: layers.map((l) => ({ width: l.width, act: act ?? l.act })),
  optimizer: 'adam',
  lr,
  loss: 'mse',
  seed,
  visible: true,
});

export class Playground {
  // ---- target and data
  expr = $state('sin(x) + 0.5 sin(2x) + (1/3) sin(3x)');
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
  private lastTick = 0;

  parsed = $derived(parse(this.expr));
  fn = $derived(this.parsed.ok ? compile(this.parsed.expr) : null);

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
    const f = this.fn;
    if (!f) return null;
    return datasetFor(f, {
      domain: this.domain,
      n: this.n,
      bands: $state.snapshot(this.bands) as [number, number][],
      noise: this.noise,
      valFraction: this.valFraction,
      seed: this.seed,
    });
  });

  invalidPoints = $derived(this.fn && this.data ? sample(this.fn, this.data.gridX).invalid : 0);

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

  status = $derived.by((): Status => {
    if (!this.runs.length) return 'ready';
    if (this.runs.some((r) => r.status === 'error')) return 'error';
    if (this.runs.every((r) => r.finished))
      return this.runs.every((r) => r.status === 'diverged') ? 'diverged' : 'done';
    if (this.playing) return 'running';
    return this.clock > 0 ? 'paused' : 'ready';
  });

  /** Estimated training time of each model on this device (models run in parallel). */
  estimates = $derived(
    this.models.map((m) => {
      const cfg = specConfig(m);
      const points = this.data ? this.data.trainY.length : this.n;
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
    if (this.onGpu) return this.estimates.reduce((s, e) => s + e, 0);
    const k = Math.min(this.models.length, this.maxWorkers);
    const rounds = Math.ceil(this.models.length / this.maxWorkers);
    return Math.max(0, ...this.estimates) * rounds * (1 + 0.25 * (k - 1));
  });

  /** True when the race on screen should be the preset's recording: the experiment is
   *  exactly the recorded one and training it here would take too long. */
  recordingWanted = $derived.by(() => {
    const r = this.recordedPreset;
    if (!r || this.liveChosen) return false;
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
    run.trainer.start({
      config: specConfig(run.spec),
      data,
      seed: run.spec.seed,
      epochs: this.epochs,
      epochsPerFrame: this.speed,
      backend: this.backend,
    });
    if (this.playing) {
      run.trainer.play();
      run.status = 'running';
    }
  }

  private onRunDone = () => {
    const next = this.runs.find((r) => r.status === 'queued');
    // A model that waited for a free worker starts from epoch 0; finished models
    // are replayed from their history in step with it.
    if (next) this.startRun(next, ++this.waves);
    if (this.runs.every((r) => r.finished)) this.playing = false;
  };

  /** Start over from epoch 0 with the current settings (paused). */
  restart() {
    for (const r of this.runs) r.trainer.dispose();
    this.playing = false;
    this.replayEpoch = null;
    this.held = null;
    this.mode = 'live';
    if (!this.data) {
      this.runs = [];
      return;
    }
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
    runs.slice(0, this.maxWorkers).forEach((r) => this.startRun(r, 0));
  }

  private showRecording(rec: Recording, data: Dataset) {
    this.mode = 'recorded';
    this.runs = this.models.map((m, i) => {
      const run = new ModelRun($state.snapshot(m) as ModelSpec, () => {});
      const rm = rec.models[i];
      if (rm) run.loadRecorded(rm, data, rec.backend);
      return run;
    });
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
      if (!r.pendingSeq) continue;
      let pace = Infinity;
      for (const o of active) if (o.wave <= r.wave && o.latest < pace) pace = o.latest;
      if (r.finished || r.latest <= pace + window) {
        r.trainer.ack(r.pendingSeq);
        r.pendingSeq = 0;
      }
    }
    requestAnimationFrame(this.loop);
  };

  play() {
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
        r.trainer.play();
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
        if (this.mode === 'live') r.trainer.pause();
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
          r.trainer.step(1);
          r.status = 'paused';
        }
      }
    }
  }

  setSpeed(epochsPerFrame: number) {
    this.speed = epochsPerFrame;
    if (this.mode === 'live') for (const r of this.runs) r.trainer.setSpeed(epochsPerFrame);
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
    for (const r of this.runs) r.trainer.dispose();
  }

  // ------------------------------------------------------------ models

  addModel() {
    if (this.models.length >= LIMITS.models) return;
    const used = this.models.map((m) => m.color);
    const color = [1, 2, 3, 4, 5, 6].find((c) => !used.includes(c)) ?? 1;
    const base = this.models[this.selected] ?? this.models[0];
    const seed = Math.max(...this.models.map((m) => m.seed)) + 1;
    this.models = [
      ...this.models,
      { ...$state.snapshot(base), id: nextId++, color, seed, visible: true } as ModelSpec,
    ];
    this.selected = this.models.length - 1;
  }

  removeModel(i: number) {
    if (this.models.length <= 1) return;
    this.models = this.models.filter((_, k) => k !== i);
    this.selected = Math.min(this.selected, this.models.length - 1);
  }

  updateModel(i: number, patch: Partial<ModelSpec>) {
    this.models = this.models.map((m, k) => (k === i ? { ...m, ...patch } : m));
  }

  runOf(spec: ModelSpec): ModelRun | undefined {
    return this.runs.find((r) => r.spec.id === spec.id);
  }

  applyPreset(p: Preset) {
    const backend = this.backend; // a preset does not change where models train
    const state = presetState(p);
    this.loadState(state);
    this.backend = backend;
    this.liveChosen = false;
    this.recordedPreset = p.recorded ? { id: p.id, key: trainingIdentity(state) } : null;
  }

  // ------------------------------------------------------------ sharing

  snapshotState(): ExperimentState {
    return {
      v: 2,
      expr: this.expr,
      domain: [...this.domain],
      n: this.n,
      noise: $state.snapshot(this.noise) as Noise,
      seed: this.seed,
      valFraction: this.valFraction,
      bands: $state.snapshot(this.bands) as [number, number][],
      models: this.models.map((m) => ({ model: specConfig(m), seed: m.seed, visible: m.visible })),
      epochs: this.epochs,
      layout: this.layout,
      ...(this.backend !== 'auto' ? { backend: this.backend } : {}),
    };
  }

  loadState(s: ExperimentState) {
    this.expr = s.expr;
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
    this.models = s.models.map((m, i) => ({
      id: nextId++,
      color: i + 1,
      layers: m.model.hidden.map((width, k) => ({ width, act: m.model.activations[k] })),
      optimizer: m.model.optimizer.kind,
      lr: m.model.optimizer.lr,
      loss: m.model.loss.kind,
      seed: m.seed,
      visible: m.visible,
    }));
    this.selected = 0;
    this.layout = s.layout;
    this.epochs = s.epochs;
    this.backend = s.backend ?? 'auto';
  }
}
