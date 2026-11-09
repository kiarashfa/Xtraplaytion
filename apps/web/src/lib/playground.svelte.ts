// Playground state (Svelte 5 runes): one dataset, up to six competing models.
// Each model trains in its own worker. The page keeps them on a shared epoch
// clock: a model's frames are acknowledged only while it is close to the slowest
// active model, so the race is fair on screen. Every frame goes into a history
// store, which the replay scrubber reads.
import {
  buildDataset,
  mlp,
  paramCountOf,
  type Activation,
  type Dataset,
  type LossKind,
  type MLPConfig,
  type Noise,
  type OptimizerKind,
} from '@xtraplaytion/engine';
import { compile, parse, sample } from '@xtraplaytion/expr';
import { estimateSeconds, FALLBACK_SPEED } from './capability.ts';
import { FrameHistory, type StoredFrame } from './history.ts';
import type { Preset } from './presets.ts';
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

  constructor(spec: ModelSpec, onDone: (run: ModelRun) => void) {
    this.spec = spec;
    this.trainer = new Trainer(
      {
        frame: (f) => {
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
  /** Device speed from the first-run benchmark (work units per second). */
  deviceSpeed = $state(FALLBACK_SPEED);
  deviceMeasured = $state(false);

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
    const [a, b] = this.domain;
    if (!(b > a)) return null;
    return buildDataset(f, {
      domain: [a, b],
      n: Math.max(2, Math.min(LIMITS.n, Math.round(this.n))),
      bands: $state.snapshot(this.bands) as [number, number][],
      noise: this.noise,
      valFraction: this.valFraction,
      seed: this.seed,
      gridSize: 512,
    });
  });

  invalidPoints = $derived(this.fn && this.data ? sample(this.fn, this.data.gridX).invalid : 0);

  /** Changes that require retraining (visibility and layout do not). */
  trainingKey = $derived(
    JSON.stringify([this.epochs, this.models.map(({ visible: _v, ...m }) => m)]),
  );

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
      return estimateSeconds(
        paramCountOf(cfg),
        points,
        this.epochs,
        cfg.activations,
        this.deviceSpeed,
      );
    }),
  );
  /** Whole race: the slowest model sets the pace, models beyond the worker count wait
   *  their turn, and parallel workers slow each other down somewhat (shared caches,
   *  lower boost clocks; about 25% per extra worker, measured on desktop Chrome). */
  estimateTotal = $derived.by(() => {
    const k = Math.min(this.models.length, this.maxWorkers);
    const rounds = Math.ceil(this.models.length / this.maxWorkers);
    return Math.max(0, ...this.estimates) * rounds * (1 + 0.25 * (k - 1));
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
    if (!this.data) {
      this.runs = [];
      return;
    }
    const runs = this.models.map(
      (m) => new ModelRun($state.snapshot(m) as ModelSpec, this.onRunDone),
    );
    this.runs = runs;
    this.waves = 0;
    runs.slice(0, this.maxWorkers).forEach((r) => this.startRun(r, 0));
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
        r.trainer.pause();
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
        r.trainer.step(1);
        r.status = 'paused';
      }
    }
  }

  setSpeed(epochsPerFrame: number) {
    this.speed = epochsPerFrame;
    for (const r of this.runs) r.trainer.setSpeed(epochsPerFrame);
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
    this.expr = p.expr;
    this.domain = [...p.domain];
    this.n = p.n;
    this.noiseKind = p.sigma > 0 ? 'gaussian' : 'none';
    if (p.sigma > 0) this.sigma = p.sigma;
    this.bands = p.bands.map((b) => [...b] as [number, number]);
    const list = p.models ?? [{ hidden: p.hidden, act: p.act, lr: p.lr }];
    this.models = list.map((m, i) =>
      newSpec(
        i + 1,
        i + 1,
        m.hidden.map((width) => ({ width, act: m.act })),
        m.lr ?? p.lr,
      ),
    );
    this.selected = 0;
    this.layout = p.layout ?? (list.length > 1 ? 'stacked' : 'overlay');
    this.epochs = p.epochs;
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
  }
}
