// Fully connected network on the CPU in f64. Parameters live in one flat vector:
// for each layer l, W_l (out x in, row-major, same layout as torch.nn.Linear.weight)
// followed by b_l. Summation order is fixed, so results are bit-identical everywhere.
import { Rng } from '@xtraplaytion/dmath';
import { ACTIVATIONS, RELU_LIKE, type Bwd, type Fwd } from './activations.ts';
import { dimsOf, type MLPConfig } from './config.ts';

export interface LayerView {
  inDim: number;
  outDim: number;
  w: number; // offset of W in the parameter vector
  b: number; // offset of b
}

export class MLP {
  readonly dims: number[];
  readonly layers: LayerView[];
  readonly params: Float64Array;
  readonly grads: Float64Array;
  private readonly fwd: Fwd[];
  private readonly bwd: Bwd[];
  private readonly dropout: number;
  // Work buffers, sized for the largest batch seen.
  private cap = 0;
  private Z: Float64Array[] = [];
  private A: Float64Array[] = [];
  private D: Float64Array[] = [];
  private mask: Float64Array[] = [];
  private readonly dropRng: Rng;
  readonly config: MLPConfig;

  constructor(config: MLPConfig, seed: number) {
    this.config = config;
    this.dims = dimsOf(config);
    const L = this.dims.length - 1;
    this.layers = [];
    let off = 0;
    for (let l = 0; l < L; l++) {
      const inDim = this.dims[l];
      const outDim = this.dims[l + 1];
      this.layers.push({ inDim, outDim, w: off, b: off + inDim * outDim });
      off += inDim * outDim + outDim;
    }
    this.params = new Float64Array(off);
    this.grads = new Float64Array(off);
    this.fwd = config.activations.map((a) => ACTIVATIONS[a][0]);
    this.bwd = config.activations.map((a) => ACTIVATIONS[a][1]);
    this.dropout = config.dropout;
    this.dropRng = new Rng(seed, 7);
    this.initialize(seed);
  }

  get paramCount(): number {
    return this.params.length;
  }

  /** Seeded initialization (stream 1 of the seed). Biases start at 0 except torch_default. */
  initialize(seed: number): void {
    const rng = new Rng(seed, 1);
    const { kind, std = 0.1 } = this.config.init;
    this.params.fill(0);
    this.layers.forEach((L, l) => {
      const fin = L.inDim;
      const fout = L.outDim;
      const act = this.config.activations[l] ?? 'identity';
      let k = kind;
      if (k === 'auto')
        k =
          l < this.config.activations.length && RELU_LIKE.has(act)
            ? 'he_uniform'
            : 'xavier_uniform';
      const n = fin * fout;
      for (let i = 0; i < n; i++) {
        let v: number;
        switch (k) {
          case 'xavier_uniform': {
            const a = Math.sqrt(6 / (fin + fout));
            v = rng.uniform(-a, a);
            break;
          }
          case 'xavier_normal':
            v = rng.normal(0, Math.sqrt(2 / (fin + fout)));
            break;
          case 'he_uniform': {
            const a = Math.sqrt(6 / fin);
            v = rng.uniform(-a, a);
            break;
          }
          case 'he_normal':
            v = rng.normal(0, Math.sqrt(2 / fin));
            break;
          case 'normal':
            v = rng.normal(0, std);
            break;
          default: {
            const a = 1 / Math.sqrt(fin);
            v = rng.uniform(-a, a);
          }
        }
        this.params[L.w + i] = v;
      }
      if (kind === 'torch_default') {
        const a = 1 / Math.sqrt(fin);
        for (let j = 0; j < fout; j++) this.params[L.b + j] = rng.uniform(-a, a);
      }
    });
  }

  private ensure(n: number): void {
    if (n <= this.cap) return;
    this.cap = n;
    this.Z = this.dims.map((d) => new Float64Array(n * d));
    this.A = this.dims.map((d) => new Float64Array(n * d));
    this.D = this.dims.map((d) => new Float64Array(n * d));
    this.mask = this.dims.map((d) => new Float64Array(this.dropout > 0 ? n * d : 0));
  }

  /**
   * Forward pass on n points (row-major [n x inDim]). Returns the output buffer
   * (first n entries valid). With `train`, activations are kept for backward().
   */
  forward(X: Float64Array, n: number, train: boolean): Float64Array {
    this.ensure(n);
    const p = this.params;
    const L = this.layers.length;
    this.A[0].set(X.subarray(0, n * this.dims[0]));
    const keep = 1 - this.dropout;
    const drop = train && this.dropout > 0;
    for (let l = 0; l < L; l++) {
      const { inDim, outDim, w, b } = this.layers[l];
      const a = this.A[l];
      const z = this.Z[l + 1];
      const out = this.A[l + 1];
      const last = l === L - 1;
      const f = last ? null : this.fwd[l];
      if (inDim === 1) {
        for (let i = 0; i < n; i++) {
          const x = a[i];
          const row = i * outDim;
          for (let j = 0; j < outDim; j++) {
            const s = p[b + j] + x * p[w + j];
            z[row + j] = s;
            out[row + j] = f ? f(s) : s;
          }
        }
      } else {
        for (let i = 0; i < n; i++) {
          const arow = i * inDim;
          const row = i * outDim;
          for (let j = 0; j < outDim; j++) {
            let s = p[b + j];
            const wrow = w + j * inDim;
            for (let k = 0; k < inDim; k++) s += a[arow + k] * p[wrow + k];
            z[row + j] = s;
            out[row + j] = f ? f(s) : s;
          }
        }
      }
      if (drop && !last) {
        const m = this.mask[l + 1];
        for (let q = 0; q < n * outDim; q++) {
          const kept = this.dropRng.next() < keep ? 1 / keep : 0;
          m[q] = kept;
          out[q] *= kept;
        }
      }
    }
    return this.A[L];
  }

  /**
   * Backward pass for the last forward(train = true). `dOut` holds dLoss/dOutput
   * for the n points. Gradients (including L1/L2 penalties) go to this.grads.
   */
  backward(dOut: Float64Array, n: number): void {
    const p = this.params;
    const g = this.grads;
    g.fill(0);
    const L = this.layers.length;
    this.D[L].set(dOut.subarray(0, n));
    const drop = this.dropout > 0;
    for (let l = L - 1; l >= 0; l--) {
      const { inDim, outDim, w, b } = this.layers[l];
      const a = this.A[l];
      const dz = this.D[l + 1];
      const da = this.D[l];
      const needPrev = l > 0;
      if (needPrev) da.fill(0, 0, n * inDim);
      for (let i = 0; i < n; i++) {
        const arow = i * inDim;
        const row = i * outDim;
        for (let j = 0; j < outDim; j++) {
          const gz = dz[row + j];
          if (gz === 0) continue;
          g[b + j] += gz;
          const wrow = w + j * inDim;
          for (let k = 0; k < inDim; k++) {
            g[wrow + k] += gz * a[arow + k];
            if (needPrev) da[arow + k] += gz * p[wrow + k];
          }
        }
      }
      if (needPrev) {
        // through dropout, then through the activation of layer l
        const z = this.Z[l];
        const act = this.A[l];
        const df = this.bwd[l - 1];
        const m = this.mask[l];
        const cnt = n * inDim;
        for (let q = 0; q < cnt; q++) {
          if (drop) {
            if (m[q] === 0) {
              da[q] = 0;
              continue;
            }
            da[q] *= m[q];
            // act holds the dropped-out value; undo the scaling for f'(z, a)
            da[q] *= df(z[q], act[q] / m[q]);
          } else {
            da[q] *= df(z[q], act[q]);
          }
        }
      }
    }
    const { l1, l2 } = this.config;
    if (l1 !== 0 || l2 !== 0) {
      for (const { inDim, outDim, w } of this.layers) {
        for (let i = w; i < w + inDim * outDim; i++) {
          const v = p[i];
          if (l1 !== 0) g[i] += l1 * (v > 0 ? 1 : v < 0 ? -1 : 0);
          if (l2 !== 0) g[i] += 2 * l2 * v;
        }
      }
    }
  }

  /** l1 * sum|w| + l2 * sum w^2 over weights. */
  penalty(): number {
    const { l1, l2 } = this.config;
    if (l1 === 0 && l2 === 0) return 0;
    let s1 = 0;
    let s2 = 0;
    for (const { inDim, outDim, w } of this.layers) {
      for (let i = w; i < w + inDim * outDim; i++) {
        s1 += Math.abs(this.params[i]);
        s2 += this.params[i] * this.params[i];
      }
    }
    return l1 * s1 + l2 * s2;
  }

  /** Predictions without dropout, in chunks so work buffers stay small. */
  predict(X: Float64Array, n: number, out: Float64Array): void {
    const chunk = 1024;
    const d = this.dims[0];
    for (let s = 0; s < n; s += chunk) {
      const m = Math.min(chunk, n - s);
      const y = this.forward(X.subarray(s * d, (s + m) * d), m, false);
      out.set(y.subarray(0, m), s);
    }
  }
}
