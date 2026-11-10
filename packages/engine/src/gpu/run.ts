// WebGPU training run (f32, approximate). Same model, data, init and optimizer
// semantics as MLPRun, but everything stays resident on the GPU: many epochs are
// encoded per submission and only the losses and the grid prediction are read
// back per frame. Full batch only; minibatch and dropout train on the CPU.
import { dimsOf, type MLPConfig, type ModelConfig } from '../config.ts';
import type { Dataset } from '../data.ts';
import { scoreGrid } from '../metrics.ts';
import { MLP } from '../mlp.ts';
import { SNAPSHOT_PARAMS, type Frame } from '../run.ts';
import {
  lossSource,
  matmulSource,
  OPT_CODE,
  OPTIMIZER,
  SCHED_CODE,
  TICK,
  TILE,
  type MatmulMode,
} from './kernels.ts';

/** Why a configuration cannot train on the GPU, or null if it can. */
export function gpuUnsupported(c: ModelConfig): string | null {
  if (c.kind !== 'mlp') return 'classical';
  if (c.batch.kind !== 'full') return 'minibatch';
  if (c.dropout > 0) return 'dropout';
  return null;
}

/** Optimizer state that can move between devices (GPU restarts, CPU fallback). */
export interface Checkpoint {
  epoch: number;
  /** Optimizer steps taken (equals epoch for full batch). */
  steps: number;
  params: Float64Array;
  m: Float64Array;
  v: Float64Array;
  trainLoss: number[];
  valLoss: number[];
}

// GPUBufferUsage / GPUMapMode values (TypeScript's libs declare the types but not the constants).
const USAGE = { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 } as const;
const MAP_READ = 1;

const ALIGN = 64; // floats: storage buffer offsets must be 256-byte aligned
const up = (x: number) => Math.ceil(x / ALIGN) * ALIGN;
/** Epochs per submission (sizes the loss buffer). */
const CHUNK = 256;

interface Dispatch {
  pipe: GPUComputePipeline;
  group: GPUBindGroup;
  x: number;
  y: number;
}

interface Slice {
  /** Offset in the CPU parameter vector and in the padded GPU vector. */
  cpu: number;
  gpu: number;
  count: number;
  isWeight: boolean;
}

export async function requestDevice(): Promise<{ device: GPUDevice; adapter: string }> {
  const gpu = (globalThis as { navigator?: { gpu?: GPU } }).navigator?.gpu;
  if (!gpu) throw new Error('noWebGPU');
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('noAdapter');
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });
  const info = adapter.info;
  const name = [info.vendor, info.architecture || info.device].filter(Boolean).join(' ');
  return { device, adapter: name || 'gpu' };
}

export class GpuRun {
  readonly config: MLPConfig;
  readonly data: Dataset;
  readonly seed: number;
  readonly paramCount: number;
  readonly trainLoss: number[] = [];
  readonly valLoss: number[] = [];
  readonly device: GPUDevice;
  private ep = 0;
  private steps = 0;
  private readonly slices: Slice[] = [];
  private readonly total: number;
  private readonly buffers: GPUBuffer[] = [];
  private readonly params: GPUBuffer;
  private readonly m: GPUBuffer;
  private readonly v: GPUBuffer;
  private readonly state: GPUBuffer;
  private readonly losses: GPUBuffer;
  private readonly gridOut: GPUBuffer;
  private readonly staging: GPUBuffer;
  private readonly train: Dispatch[] = [];
  private readonly val: Dispatch[] = [];
  private readonly grid: Dispatch[] = [];
  private readonly pipes = new Map<string, GPUComputePipeline>();
  /** Grid prediction read back with the last training chunk (saves a round trip). */
  private cachedGrid: Float32Array | null = null;
  private cachedParams: Float32Array | null = null;
  /** Small networks send their weights with every frame (insight views). */
  private readonly snapshots: boolean;
  private cachedAt = -1;
  private disposed = false;

  private constructor(
    device: GPUDevice,
    config: MLPConfig,
    data: Dataset,
    seed: number,
    from?: Checkpoint,
  ) {
    this.device = device;
    this.config = config;
    this.data = data;
    this.seed = seed;
    // Same initial weights as the CPU run (computed in f64, uploaded as f32).
    const cpu = new MLP(config, seed);
    this.paramCount = cpu.paramCount;
    let gpuOff = 0;
    for (const L of cpu.layers) {
      const nw = L.inDim * L.outDim;
      this.slices.push({ cpu: L.w, gpu: gpuOff, count: nw, isWeight: true });
      gpuOff += up(nw);
      this.slices.push({ cpu: L.b, gpu: gpuOff, count: L.outDim, isWeight: false });
      gpuOff += up(L.outDim);
    }
    this.total = gpuOff;
    this.params = this.buf(this.total);
    this.m = this.buf(this.total);
    this.v = this.buf(this.total);
    const grads = this.buf(this.total);
    this.state = this.buf(4);
    this.losses = this.buf(2 * CHUNK);
    if (from) {
      this.ep = from.epoch;
      this.steps = from.steps;
      for (const x of from.trainLoss) this.trainLoss.push(x);
      for (const x of from.valLoss) this.valLoss.push(x);
      this.putPacked(this.params, from.params);
      this.putPacked(this.m, from.m);
      this.putPacked(this.v, from.v);
    } else {
      this.putPacked(this.params, cpu.params);
    }
    device.queue.writeBuffer(this.state, 0, new Uint32Array([this.steps, 0, 0, 0]));

    const dims = dimsOf(config);
    const L = dims.length - 1;
    const N = data.trainY.length;
    const nVal = data.valY.length;
    const nGrid = data.gridX.length;
    const f32 = (a: Float64Array) => Float32Array.from(a);
    const upload = (a: Float64Array) => {
      const b = this.buf(Math.max(1, a.length));
      if (a.length) device.queue.writeBuffer(b, 0, f32(a));
      return b;
    };
    const trainX = upload(data.trainX);
    const trainY = upload(data.trainY);
    const valX = upload(data.valX);
    const valY = upload(data.valY);
    const gridX = upload(data.gridX);
    const ones = upload(new Float64Array(N).fill(1));
    const dOut = this.buf(N);

    const act = (l: number) => config.activations[l] ?? 'identity';
    const wSlice = (l: number) => this.slices[2 * l];
    const bSlice = (l: number) => this.slices[2 * l + 1];
    const range = (b: GPUBuffer, s: Slice): GPUBufferBinding => ({
      buffer: b,
      offset: s.gpu * 4,
      size: s.count * 4,
    });

    // ---- training forward + loss + backward + optimizer
    const A: GPUBuffer[] = [trainX];
    const Z: GPUBuffer[] = [trainX];
    const D: GPUBuffer[] = [trainX];
    for (let l = 1; l <= L; l++) {
      A.push(this.buf(N * dims[l]));
      Z.push(l < L ? this.buf(N * dims[l]) : A[l]);
      D.push(l < L ? this.buf(N * dims[l]) : dOut);
    }
    this.train.push(this.dispatch(TICK, 'tick', [{ buffer: this.state }], 1, 1));
    for (let l = 0; l < L; l++) {
      const i = dims[l];
      const o = dims[l + 1];
      const last = l === L - 1;
      if (last) {
        this.train.push(
          this.matmul(
            { kind: 'fwdEval', act: 'identity' },
            N,
            o,
            i,
            [i, 1, 1, i],
            [
              { buffer: A[l] },
              range(this.params, wSlice(l)),
              { buffer: A[l + 1] },
              null,
              range(this.params, bSlice(l)),
            ],
          ),
        );
      } else {
        this.train.push(
          this.matmul(
            { kind: 'fwdTrain', act: act(l) },
            N,
            o,
            i,
            [i, 1, 1, i],
            [
              { buffer: A[l] },
              range(this.params, wSlice(l)),
              { buffer: A[l + 1] },
              { buffer: Z[l + 1] },
              range(this.params, bSlice(l)),
            ],
          ),
        );
      }
    }
    this.train.push(this.loss(N, 0, true, A[L], trainY, dOut));
    for (let l = L - 1; l >= 0; l--) {
      const i = dims[l];
      const o = dims[l + 1];
      this.train.push(
        this.matmul(
          { kind: 'plain' },
          o,
          i,
          N,
          [1, o, i, 1],
          [{ buffer: D[l + 1] }, { buffer: A[l] }, range(grads, wSlice(l))],
        ),
      );
      this.train.push(
        this.matmul(
          { kind: 'plain' },
          o,
          1,
          N,
          [1, o, 1, 0],
          [{ buffer: D[l + 1] }, { buffer: ones }, range(grads, bSlice(l))],
        ),
      );
      if (l > 0) {
        this.train.push(
          this.matmul(
            { kind: 'backprop', act: act(l - 1) },
            N,
            i,
            o,
            [o, 1, i, 1],
            [
              { buffer: D[l + 1] },
              range(this.params, wSlice(l)),
              { buffer: D[l] },
              { buffer: Z[l] },
              { buffer: A[l] },
            ],
          ),
        );
      }
    }
    const mask = new Uint32Array(this.total);
    for (const s of this.slices) if (s.isWeight) mask.fill(1, s.gpu, s.gpu + s.count);
    const isWeight = this.buf(this.total);
    device.queue.writeBuffer(isWeight, 0, mask);
    this.train.push(this.optimizer(grads, isWeight));

    // ---- evaluation (validation every epoch, grid every frame)
    const evalNet = (n: number, x: GPUBuffer, out: Dispatch[]): GPUBuffer => {
      let prev = x;
      for (let l = 0; l < L; l++) {
        const i = dims[l];
        const o = dims[l + 1];
        const next = this.buf(n * o);
        const last = l === L - 1;
        out.push(
          this.matmul(
            { kind: 'fwdEval', act: last ? 'identity' : act(l) },
            n,
            o,
            i,
            [i, 1, 1, i],
            [
              { buffer: prev },
              range(this.params, wSlice(l)),
              { buffer: next },
              null,
              range(this.params, bSlice(l)),
            ],
          ),
        );
        prev = next;
      }
      return prev;
    };
    if (nVal > 0) {
      const valOut = evalNet(nVal, valX, this.val);
      this.val.push(this.loss(nVal, 1, false, valOut, valY));
    }
    this.gridOut = evalNet(nGrid, gridX, this.grid);
    this.snapshots = this.paramCount <= SNAPSHOT_PARAMS;
    this.staging = device.createBuffer({
      size: (2 * CHUNK + nGrid + (this.snapshots ? this.total : 0)) * 4,
      usage: USAGE.MAP_READ | USAGE.COPY_DST,
    });
    this.buffers.push(this.staging);
  }

  /** Creates a run on `device` (fresh, or resumed from a checkpoint). */
  static async create(
    device: GPUDevice,
    config: MLPConfig,
    data: Dataset,
    seed: number,
    from?: Checkpoint,
  ): Promise<GpuRun> {
    const why = gpuUnsupported(config);
    if (why) throw new Error(why);
    device.pushErrorScope('validation');
    device.pushErrorScope('out-of-memory');
    const run = new GpuRun(device, config, data, seed, from);
    const oom = await device.popErrorScope();
    const invalid = await device.popErrorScope();
    if (oom || invalid) {
      run.dispose();
      throw new Error(oom ? 'outOfMemory' : `gpuValidation: ${invalid?.message}`);
    }
    return run;
  }

  get epoch(): number {
    return this.ep;
  }

  get diverged(): boolean {
    const last = this.trainLoss[this.trainLoss.length - 1];
    return last !== undefined && !Number.isFinite(last);
  }

  // ------------------------------------------------------------ building blocks

  private buf(floats: number): GPUBuffer {
    const b = this.device.createBuffer({
      size: Math.max(16, Math.ceil(floats) * 4),
      usage: USAGE.STORAGE | USAGE.COPY_DST | USAGE.COPY_SRC,
    });
    this.buffers.push(b);
    return b;
  }

  private uniform(data: ArrayBuffer): GPUBuffer {
    const b = this.device.createBuffer({
      size: Math.max(16, Math.ceil(data.byteLength / 16) * 16),
      usage: USAGE.UNIFORM | USAGE.COPY_DST,
    });
    this.device.queue.writeBuffer(b, 0, data);
    this.buffers.push(b);
    return b;
  }

  private pipeline(key: string, code: string): GPUComputePipeline {
    let p = this.pipes.get(key);
    if (!p) {
      p = this.device.createComputePipeline({
        layout: 'auto',
        compute: { module: this.device.createShaderModule({ code }), entryPoint: 'main' },
      });
      this.pipes.set(key, p);
    }
    return p;
  }

  private dispatch(
    code: string,
    key: string,
    entries: (GPUBufferBinding | null)[],
    x: number,
    y: number,
  ): Dispatch {
    const pipe = this.pipeline(key, code);
    const group = this.device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: entries.flatMap((r, i) => (r ? [{ binding: i, resource: r }] : [])),
    });
    return { pipe, group, x, y };
  }

  /** bindings: A, B, C, Z (or null), bias / Act (or null). */
  private matmul(
    mode: MatmulMode,
    M: number,
    N: number,
    K: number,
    s: [number, number, number, number],
    bind: (GPUBufferBinding | null)[],
  ): Dispatch {
    const u = this.uniform(new Uint32Array([M, N, K, ...s, 0]).buffer);
    const key = `mm:${mode.kind}:${'act' in mode ? mode.act : ''}`;
    const entries: (GPUBufferBinding | null)[] = [{ buffer: u }, ...bind];
    return this.dispatch(
      matmulSource(mode),
      key,
      entries,
      Math.ceil(N / TILE),
      Math.ceil(M / TILE),
    );
  }

  private loss(
    n: number,
    column: number,
    grad: boolean,
    pred: GPUBuffer,
    y: GPUBuffer,
    g?: GPUBuffer,
  ): Dispatch {
    const kind = this.config.loss.kind;
    const ub = new ArrayBuffer(16);
    new Uint32Array(ub, 0, 2).set([n, column]);
    new Float32Array(ub, 8, 1)[0] = this.config.loss.delta ?? 1;
    const entries: (GPUBufferBinding | null)[] = [
      { buffer: this.uniform(ub) },
      { buffer: pred },
      { buffer: y },
      { buffer: this.losses },
      { buffer: this.state },
    ];
    if (grad && g) entries.push({ buffer: g });
    return this.dispatch(lossSource(kind, grad), `loss:${kind}:${grad}`, entries, 1, 1);
  }

  private optimizer(grads: GPUBuffer, isWeight: GPUBuffer): Dispatch {
    const c = this.config;
    const o = c.optimizer;
    const sc = c.schedule;
    const ub = new ArrayBuffer(80);
    const u32 = new Uint32Array(ub);
    const f = new Float32Array(ub);
    u32[0] = this.total;
    u32[3] = OPT_CODE[o.kind];
    f[4] = o.lr;
    f[5] = o.momentum ?? 0.9;
    f[6] = o.beta1 ?? 0.9;
    f[7] = o.beta2 ?? 0.999;
    f[8] = o.alpha ?? 0.99;
    f[9] = o.eps ?? 1e-8;
    f[10] = o.weightDecay ?? 0;
    f[11] = c.l1;
    f[12] = c.l2;
    u32[13] = SCHED_CODE[sc.kind];
    f[14] = sc.kind === 'step' ? sc.every : 1;
    f[15] = sc.kind === 'step' ? sc.gamma : 1;
    f[16] = sc.kind === 'cosine' ? sc.minLr : 0;
    f[17] = sc.kind === 'cosine' ? sc.total : 1;
    const groups = Math.ceil(this.total / 256);
    return this.dispatch(
      OPTIMIZER,
      'opt',
      [
        { buffer: this.uniform(ub) },
        { buffer: this.params },
        { buffer: grads },
        { buffer: this.m },
        { buffer: this.v },
        { buffer: this.state },
        { buffer: isWeight },
      ],
      Math.min(groups, 65535),
      Math.ceil(groups / 65535),
    );
  }

  private putPacked(b: GPUBuffer, flat: Float64Array) {
    const packed = new Float32Array(this.total);
    for (const s of this.slices) {
      for (let q = 0; q < s.count; q++) packed[s.gpu + q] = flat[s.cpu + q];
    }
    this.device.queue.writeBuffer(b, 0, packed);
  }

  /** All dispatches in one compute pass (WebGPU orders storage writes between dispatches). */
  private encode(enc: GPUCommandEncoder, lists: Dispatch[][]) {
    const pass = enc.beginComputePass();
    for (const list of lists) {
      for (const d of list) {
        pass.setPipeline(d.pipe);
        pass.setBindGroup(0, d.group);
        pass.dispatchWorkgroups(d.x, d.y);
      }
    }
    pass.end();
  }

  // ------------------------------------------------------------ training

  /** Trains `epochs` epochs. Losses of every epoch are read back (as on the CPU). */
  async step(epochs: number): Promise<void> {
    let left = Math.max(0, Math.floor(epochs));
    while (left > 0 && !this.disposed) {
      const n = Math.min(CHUNK, left);
      const lastChunk = n === left;
      const losses = await this.run(n, lastChunk);
      for (let e = 0; e < n; e++) {
        const tl = losses[2 * e];
        this.trainLoss.push(tl);
        this.valLoss.push(this.val.length ? losses[2 * e + 1] : NaN);
        this.ep++;
        this.steps++;
        if (!Number.isFinite(tl)) {
          // Same rule as the CPU run: stop at the first epoch whose loss is not finite.
          left = 0;
          break;
        }
      }
      left -= n;
      if (lastChunk || left === 0) {
        const nGrid = this.data.gridX.length;
        this.cachedGrid = lastChunk ? losses.slice(2 * CHUNK, 2 * CHUNK + nGrid) : null;
        this.cachedParams = lastChunk ? this.unpackParams(losses, 2 * CHUNK + nGrid) : null;
        this.cachedAt = this.ep;
      }
    }
  }

  /** Encodes n epochs (and optionally the grid), submits, reads back. */
  private async run(n: number, gridToo: boolean): Promise<Float32Array> {
    const q = this.device.queue;
    q.writeBuffer(this.state, 4, new Uint32Array([this.steps]));
    const enc = this.device.createCommandEncoder();
    const lists: Dispatch[][] = [];
    for (let e = 0; e < n; e++) lists.push(this.train, this.val);
    if (gridToo) lists.push(this.grid);
    this.encode(enc, lists);
    if (n > 0) enc.copyBufferToBuffer(this.losses, 0, this.staging, 0, 2 * n * 4);
    const nGrid = this.data.gridX.length;
    if (gridToo) {
      enc.copyBufferToBuffer(this.gridOut, 0, this.staging, 2 * CHUNK * 4, nGrid * 4);
      if (this.snapshots)
        enc.copyBufferToBuffer(
          this.params,
          0,
          this.staging,
          (2 * CHUNK + nGrid) * 4,
          this.total * 4,
        );
    }
    q.submit([enc.finish()]);
    await this.staging.mapAsync(MAP_READ);
    const out = new Float32Array(this.staging.getMappedRange().slice(0));
    this.staging.unmap();
    return out;
  }

  async frame(): Promise<Frame> {
    const nGrid = this.data.gridX.length;
    let grid: Float32Array;
    let params: Float32Array | null;
    if (this.cachedGrid && this.cachedAt === this.ep) {
      grid = this.cachedGrid;
      params = this.cachedParams;
      this.cachedGrid = null; // transferred by the caller
      this.cachedParams = null;
    } else {
      const out = await this.run(0, true);
      grid = out.slice(2 * CHUNK, 2 * CHUNK + nGrid);
      params = this.unpackParams(out, 2 * CHUNK + nGrid);
    }
    return {
      epoch: this.ep,
      trainLoss: this.trainLoss.length ? this.trainLoss[this.trainLoss.length - 1] : NaN,
      valLoss: this.valLoss.length ? this.valLoss[this.valLoss.length - 1] : NaN,
      grid,
      metrics: scoreGrid(grid, this.data),
      ...(params ? { params } : {}),
    };
  }

  /** Weights in the CPU layout from a staging read at float offset `at` (small nets only). */
  private unpackParams(out: Float32Array, at: number): Float32Array | null {
    if (!this.snapshots) return null;
    const flat = new Float32Array(this.paramCount);
    for (const s of this.slices) {
      for (let q = 0; q < s.count; q++) flat[s.cpu + q] = out[at + s.gpu + q];
    }
    return flat;
  }

  /** Parameters and optimizer state in the CPU layout (for restarts and fallback). */
  async checkpoint(): Promise<Checkpoint> {
    const size = this.total * 4;
    const rb = this.device.createBuffer({
      size: size * 3,
      usage: USAGE.MAP_READ | USAGE.COPY_DST,
    });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.params, 0, rb, 0, size);
    enc.copyBufferToBuffer(this.m, 0, rb, size, size);
    enc.copyBufferToBuffer(this.v, 0, rb, 2 * size, size);
    this.device.queue.submit([enc.finish()]);
    await rb.mapAsync(MAP_READ);
    const all = new Float32Array(rb.getMappedRange().slice(0));
    rb.destroy();
    const unpack = (k: number) => {
      const flat = new Float64Array(this.paramCount);
      for (const s of this.slices) {
        for (let q = 0; q < s.count; q++) flat[s.cpu + q] = all[k * this.total + s.gpu + q];
      }
      return flat;
    };
    return {
      epoch: this.ep,
      steps: this.steps,
      params: unpack(0),
      m: unpack(1),
      v: unpack(2),
      trainLoss: this.trainLoss.slice(),
      valLoss: this.valLoss.slice(),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const b of this.buffers) b.destroy();
    this.buffers.length = 0;
  }
}
