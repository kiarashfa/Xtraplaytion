// Regression trees in one dimension (CART, squared error), random forests (bagging)
// and gradient boosting. Stages: depth for one tree, trees for a forest, rounds for
// boosting. Outside the data every tree is flat.
import { Rng } from '@xtraplaytion/dmath';
import type { TreeConfig } from '../config.ts';
import { clampInt, constantStage, meanOf, sortedByX, type Fitter, type Stage } from './staged.ts';

export const MAX_DEPTH = 12;
export const MAX_TREES = 300;

/** Flat binary tree: node i has split threshold thr[i] (NaN for a leaf), children. */
interface Tree {
  thr: number[];
  left: number[];
  right: number[];
  mean: number[];
  depth: number[];
}

/** Grows a tree on points sorted by x (greedy splits do not depend on the depth limit). */
function grow(x: Float64Array, y: Float64Array, maxDepth: number, minLeaf: number): Tree {
  const t: Tree = { thr: [], left: [], right: [], mean: [], depth: [] };
  const n = y.length;
  const ps = new Float64Array(n + 1);
  const ps2 = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    ps[i + 1] = ps[i] + y[i];
    ps2[i + 1] = ps2[i] + y[i] * y[i];
  }
  const sse = (a: number, b: number) => {
    const s = ps[b] - ps[a];
    return ps2[b] - ps2[a] - (s * s) / (b - a);
  };
  const node = (a: number, b: number, d: number): number => {
    const id = t.thr.length;
    t.thr.push(NaN);
    t.left.push(-1);
    t.right.push(-1);
    t.mean.push(b > a ? (ps[b] - ps[a]) / (b - a) : 0);
    t.depth.push(d);
    if (d >= maxDepth || b - a < 2 * minLeaf) return id;
    const base = sse(a, b);
    let best = -1;
    let bestErr = base;
    for (let i = a + minLeaf; i <= b - minLeaf; i++) {
      if (!(x[i - 1] < x[i])) continue; // only between distinct x
      const e = sse(a, i) + sse(i, b);
      if (e < bestErr) {
        bestErr = e;
        best = i;
      }
    }
    if (best < 0 || !(bestErr < base * (1 - 1e-12))) return id;
    t.thr[id] = (x[best - 1] + x[best]) / 2;
    const l = node(a, best, d + 1);
    const r = node(best, b, d + 1);
    t.left[id] = l;
    t.right[id] = r;
    return id;
  };
  if (n) node(0, n, 0);
  return t;
}

function evalTree(t: Tree, v: number, depthLimit: number): number {
  let i = 0;
  while (!Number.isNaN(t.thr[i]) && t.depth[i] < depthLimit)
    i = v < t.thr[i] ? t.left[i] : t.right[i];
  return t.mean[i];
}

/** Stored numbers of a tree cut at a depth: one threshold per split plus one value per leaf. */
function sizeOf(t: Tree, depthLimit: number): number {
  // Every node down to the limit is either a split (threshold) or a leaf (value).
  let s = 0;
  for (let i = 0; i < t.thr.length; i++) if (t.depth[i] <= depthLimit) s++;
  return s;
}

export function treeFitter(
  c: TreeConfig,
  x0: Float64Array,
  y0: Float64Array,
  seed: number,
): Fitter {
  const { x, y } = sortedByX(x0, y0);
  const n = y.length;
  const depth = clampInt(c.depth, 1, MAX_DEPTH);
  const minLeaf = clampInt(c.minLeaf, 1, Math.max(1, n));
  const T = clampInt(c.trees, 1, MAX_TREES);
  const base = meanOf(y);

  if (c.ensemble === 'single') {
    const tree = grow(x, y, depth, minLeaf);
    return {
      stages: depth + 1,
      stage(d: number): Stage {
        if (!n) return constantStage(d, 0);
        return {
          value: d,
          params: sizeOf(tree, d),
          predict(xs, out) {
            for (let i = 0; i < xs.length; i++) out[i] = evalTree(tree, xs[i], d);
          },
        };
      },
    };
  }

  if (c.ensemble === 'forest') {
    // Each tree sees a bootstrap sample (drawn with replacement, seeded).
    const rng = new Rng(seed, 5);
    const trees: Tree[] = [];
    const bx = new Float64Array(n);
    const by = new Float64Array(n);
    const counts = new Int32Array(n);
    const plant = () => {
      counts.fill(0);
      for (let i = 0; i < n; i++) counts[rng.int(n)]++;
      // Expand the counts in sorted order: the sample stays sorted by x.
      let k = 0;
      for (let i = 0; i < n; i++) {
        for (let r = 0; r < counts[i]; r++) {
          bx[k] = x[i];
          by[k] = y[i];
          k++;
        }
      }
      trees.push(grow(bx, by, depth, minLeaf));
    };
    return {
      stages: T,
      stage(s: number): Stage {
        const m = s + 1;
        if (!n) return constantStage(m, 0);
        while (trees.length < m) plant();
        const use = trees.slice(0, m);
        return {
          value: m,
          params: use.reduce((a, t) => a + sizeOf(t, depth), 0),
          predict(xs, out) {
            for (let i = 0; i < xs.length; i++) {
              let sum = 0;
              for (const t of use) sum += evalTree(t, xs[i], depth);
              out[i] = sum / m;
            }
          },
        };
      },
    };
  }

  // Gradient boosting with squared error: each round fits a small tree to the residuals.
  const lr = Number.isFinite(c.lr) ? Math.min(1, Math.max(1e-4, c.lr)) : 0.1;
  const rounds: Tree[] = [];
  const fitted = new Float64Array(n).fill(base);
  const resid = new Float64Array(n);
  return {
    stages: T + 1,
    stage(m: number): Stage {
      if (!n) return constantStage(m, 0);
      while (rounds.length < m) {
        for (let i = 0; i < n; i++) resid[i] = y[i] - fitted[i];
        const t = grow(x, resid, depth, minLeaf);
        for (let i = 0; i < n; i++) fitted[i] += lr * evalTree(t, x[i], depth);
        rounds.push(t);
      }
      const use = rounds.slice(0, m);
      return {
        value: m,
        params: 1 + use.reduce((a, t) => a + sizeOf(t, depth), 0),
        predict(xs, out) {
          for (let i = 0; i < xs.length; i++) {
            let s = base;
            for (const t of use) s += lr * evalTree(t, xs[i], depth);
            out[i] = s;
          }
        },
      };
    },
  };
}
