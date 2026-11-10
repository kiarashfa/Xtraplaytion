// Small dense linear algebra in f64 with a fixed operation order (bit-identical
// in every engine). Matrices are row-major Float64Arrays.
import { sqrt } from '@xtraplaytion/dmath';

/**
 * Solves min |A c - y|^2 + |P c|^2 by Householder QR of the stacked matrix [A; P]
 * (A is m x p, P is r x p, both row-major). Numerically far better than normal
 * equations, which matters for high polynomial degrees and gapped data.
 */
export function leastSquares(
  A: Float64Array,
  m: number,
  p: number,
  y: ArrayLike<number>,
  P?: Float64Array,
  r = 0,
): Float64Array {
  const rows = m + r;
  const M = new Float64Array(rows * p);
  M.set(A.subarray(0, m * p));
  if (P && r) M.set(P.subarray(0, r * p), m * p);
  const b = new Float64Array(rows);
  for (let i = 0; i < m; i++) b[i] = y[i];
  const v = new Float64Array(rows);
  for (let k = 0; k < p && k < rows; k++) {
    let norm2 = 0;
    for (let i = k; i < rows; i++) norm2 += M[i * p + k] * M[i * p + k];
    if (norm2 === 0) continue;
    const norm = sqrt(norm2);
    const akk = M[k * p + k];
    const alpha = akk > 0 ? -norm : norm;
    let vn2 = 0;
    for (let i = k; i < rows; i++) {
      v[i] = M[i * p + k];
      if (i === k) v[i] -= alpha;
      vn2 += v[i] * v[i];
    }
    if (vn2 === 0) continue;
    for (let j = k; j < p; j++) {
      let s = 0;
      for (let i = k; i < rows; i++) s += v[i] * M[i * p + j];
      const f = (2 * s) / vn2;
      if (f !== 0) for (let i = k; i < rows; i++) M[i * p + j] -= f * v[i];
    }
    let s = 0;
    for (let i = k; i < rows; i++) s += v[i] * b[i];
    const f = (2 * s) / vn2;
    for (let i = k; i < rows; i++) b[i] -= f * v[i];
  }
  // Back substitution with R (upper p x p).
  const c = new Float64Array(p);
  for (let k = Math.min(p, rows) - 1; k >= 0; k--) {
    let s = b[k];
    for (let j = k + 1; j < p; j++) s -= M[k * p + j] * c[j];
    const d = M[k * p + k];
    c[k] = d === 0 ? 0 : s / d;
  }
  return c;
}

/** Identity rows sqrt(w) I (p x p), for a ridge term w |c|^2 on every coefficient but the first `skip`. */
export function ridgeRows(p: number, w: number, skip = 0): Float64Array {
  const P = new Float64Array(p * p);
  const s = sqrt(w);
  for (let i = skip; i < p; i++) P[i * p + i] = s;
  return P;
}

/** In-place Cholesky factorization K = L L^T (lower triangle kept, upper zeroed).
 *  Returns false when K is not positive definite. */
export function cholesky(K: Float64Array, n: number): boolean {
  for (let j = 0; j < n; j++) {
    let d = K[j * n + j];
    for (let k = 0; k < j; k++) d -= K[j * n + k] * K[j * n + k];
    if (!(d > 0)) return false;
    const ljj = sqrt(d);
    K[j * n + j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let s = K[i * n + j];
      for (let k = 0; k < j; k++) s -= K[i * n + k] * K[j * n + k];
      K[i * n + j] = s / ljj;
    }
    for (let i = 0; i < j; i++) K[i * n + j] = 0;
  }
  return true;
}

/** Solves L x = b (L lower triangular) into out. */
export function forward(L: Float64Array, n: number, b: ArrayLike<number>, out: Float64Array) {
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * n + k] * out[k];
    out[i] = s / L[i * n + i];
  }
}

/** Solves L^T x = b (L lower triangular) into out. */
export function backward(L: Float64Array, n: number, b: ArrayLike<number>, out: Float64Array) {
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * out[k];
    out[i] = s / L[i * n + i];
  }
}

/** K^{-1} from its Cholesky factor (full symmetric n x n). */
export function cholInverse(L: Float64Array, n: number): Float64Array {
  // Linv = L^{-1} (lower), then K^{-1} = Linv^T Linv.
  const Li = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    Li[j * n + j] = 1 / L[j * n + j];
    for (let i = j + 1; i < n; i++) {
      let s = 0;
      for (let k = j; k < i; k++) s -= L[i * n + k] * Li[k * n + j];
      Li[i * n + j] = s / L[i * n + i];
    }
  }
  const out = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = 0;
      for (let k = i; k < n; k++) s += Li[k * n + i] * Li[k * n + j];
      out[i * n + j] = s;
      out[j * n + i] = s;
    }
  }
  return out;
}
