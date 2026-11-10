// Exact kinks of a 1-D network built from piecewise-linear activations.
//
// With relu, leaky relu, abs and identity, every neuron is a piecewise-linear
// function of x, and so is the output. We propagate the pieces layer by layer:
// on each piece of the current partition every neuron is affine (s x + c); the
// next layer's pre-activations are affine there too, and each one that changes
// sign inside a piece splits it at its root. After the output layer, adjacent
// pieces with the same slope are merged. What is left are the output's kinks,
// and outside the outermost kink the network is exactly a straight line.
import type { Activation } from '../config.ts';
import type { LayerView } from '../mlp.ts';

export const PIECEWISE_LINEAR: ReadonlySet<Activation> = new Set([
  'relu',
  'leaky_relu',
  'abs',
  'identity',
]);

export interface Kinks {
  /** Positions where the output's slope changes, increasing. */
  xs: Float64Array;
  /** Output = slopes[p] x + intercepts[p] on piece p (xs.length + 1 pieces, the first and
   *  last reach to minus and plus infinity). */
  slopes: Float64Array;
  intercepts: Float64Array;
}

export interface KinkOptions {
  /** Work budget (multiply-adds); above it the answer is null. Default 6e7. */
  budget?: number;
  /** Most pieces kept per layer; above it the answer is null. Default 200,000. */
  maxPieces?: number;
}

/** Can this network's kinks be computed (1-D input, piecewise-linear activations)? */
export function hasKinks(dims: number[], activations: Activation[]): boolean {
  return dims[0] === 1 && activations.every((a) => PIECEWISE_LINEAR.has(a));
}

function act(kind: Activation, s: number, c: number, positive: boolean): [number, number] {
  if (positive || kind === 'identity') return [s, c];
  switch (kind) {
    case 'relu':
      return [0, 0];
    case 'leaky_relu':
      return [0.01 * s, 0.01 * c];
    default: // abs
      return [-s, -c];
  }
}

/** A representative point inside piece p of `bps` (pieces reach to +-infinity). */
function inside(bps: number[], p: number): number {
  const n = bps.length;
  if (n === 0) return 0;
  if (p === 0) return bps[0] - 1 - Math.abs(bps[0]);
  if (p === n) return bps[n - 1] + 1 + Math.abs(bps[n - 1]);
  return 0.5 * (bps[p - 1] + bps[p]);
}

/**
 * Exact kinks of the network with layer sizes `dims` (dims[0] must be 1) and the given
 * hidden activations, at parameters `params` (layout of MLP). Returns null when an
 * activation is not piecewise linear or the work would exceed the budget.
 */
export function kinksOf(
  dims: number[],
  activations: Activation[],
  layers: LayerView[],
  params: ArrayLike<number>,
  opts: KinkOptions = {},
): Kinks | null {
  if (!hasKinks(dims, activations)) return null;
  const budget = opts.budget ?? 6e7;
  const maxPieces = opts.maxPieces ?? 200_000;
  let work = 0;
  // Current partition and the affine form of every neuron of the current layer per piece.
  let bps: number[] = [];
  let S = new Float64Array([1]); // pieces x width
  let C = new Float64Array([0]);
  let width = 1;
  for (let l = 0; l < layers.length; l++) {
    const { inDim, outDim, w, b } = layers[l];
    const pieces = bps.length + 1;
    work += pieces * inDim * outDim;
    if (work > budget) return null;
    const zs = new Float64Array(pieces * outDim);
    const zc = new Float64Array(pieces * outDim);
    for (let p = 0; p < pieces; p++) {
      for (let k = 0; k < outDim; k++) {
        let s = 0;
        let c = params[b + k];
        const row = w + k * inDim;
        for (let j = 0; j < inDim; j++) {
          const wk = params[row + j];
          s += wk * S[p * width + j];
          c += wk * C[p * width + j];
        }
        zs[p * outDim + k] = s;
        zc[p * outDim + k] = c;
      }
    }
    if (l === layers.length - 1) return merge(bps, zs, zc);
    const kind = activations[l];
    // Roots of the pre-activations inside their pieces split the partition.
    const next: number[] = [];
    if (kind !== 'identity') {
      for (let p = 0; p < pieces; p++) {
        const lo = p === 0 ? -Infinity : bps[p - 1];
        const hi = p === pieces - 1 ? Infinity : bps[p];
        for (let k = 0; k < outDim; k++) {
          const s = zs[p * outDim + k];
          if (s === 0) continue;
          const r = -zc[p * outDim + k] / s;
          if (r > lo && r < hi) next.push(r);
        }
      }
    }
    const nb = unique([...bps, ...next]);
    if (nb.length + 1 > maxPieces) return null;
    // Affine forms after the activation on the refined partition.
    const np = nb.length + 1;
    work += np * outDim;
    if (work > budget) return null;
    const S2 = new Float64Array(np * outDim);
    const C2 = new Float64Array(np * outDim);
    let parent = 0;
    for (let q = 0; q < np; q++) {
      const x = inside(nb, q);
      while (parent < bps.length && x > bps[parent]) parent++;
      for (let k = 0; k < outDim; k++) {
        const s = zs[parent * outDim + k];
        const c = zc[parent * outDim + k];
        const [a1, a0] = act(kind, s, c, s * x + c > 0);
        S2[q * outDim + k] = a1;
        C2[q * outDim + k] = a0;
      }
    }
    bps = nb;
    S = S2;
    C = C2;
    width = outDim;
  }
  return null; // a network has at least one layer
}

function unique(xs: number[]): number[] {
  xs.sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of xs) if (!out.length || x > out[out.length - 1]) out.push(x);
  return out;
}

/** Joins neighbouring output pieces whose slopes agree (to rounding). */
function merge(bps: number[], zs: Float64Array, zc: Float64Array): Kinks {
  let scale = 0;
  for (const s of zs) scale = Math.max(scale, Math.abs(s));
  const tol = 1e-9 * scale + 1e-300;
  const xs: number[] = [];
  const slopes: number[] = [zs[0]];
  const intercepts: number[] = [zc[0]];
  for (let p = 1; p < zs.length; p++) {
    if (Math.abs(zs[p] - slopes[slopes.length - 1]) <= tol) continue;
    xs.push(bps[p - 1]);
    slopes.push(zs[p]);
    intercepts.push(zc[p]);
  }
  return {
    xs: Float64Array.from(xs),
    slopes: Float64Array.from(slopes),
    intercepts: Float64Array.from(intercepts),
  };
}

/** Evaluates the piecewise-linear output at x (for tests and tooltips). */
export function evalKinks(k: Kinks, x: number): number {
  let lo = 0;
  let hi = k.xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x > k.xs[mid]) lo = mid + 1;
    else hi = mid;
  }
  return k.slopes[lo] * x + k.intercepts[lo];
}
