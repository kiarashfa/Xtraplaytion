// WGSL sources for the WebGPU trainer (f32). One tiled matmul template with an
// epilogue per use (forward with activation, plain gradient, backprop through an
// activation), a loss kernel, a per-slice optimizer kernel and a step counter.
// Approximate by nature: GPU float rounding differs from the CPU f64 reference.
import type { Activation, LossKind } from '../config.ts';

/** f(z) and f'(z, a) in WGSL, mirroring activations.ts (PyTorch defaults). */
const ACT: Record<Activation, [string, string]> = {
  relu: ['max(z, 0.0)', 'select(0.0, 1.0, z > 0.0)'],
  leaky_relu: ['select(0.01 * z, z, z > 0.0)', 'select(0.01, 1.0, z > 0.0)'],
  elu: ['select(exp(min(z, 0.0)) - 1.0, z, z > 0.0)', 'select(a + 1.0, 1.0, z > 0.0)'],
  gelu: [
    '0.5 * z * (1.0 + erf_(z * 0.70710678))',
    '0.5 * (1.0 + erf_(z * 0.70710678)) + z * 0.39894228 * exp(-0.5 * z * z)',
  ],
  silu: ['z * sigm(z)', 'sigm(z) * (1.0 + z * (1.0 - sigm(z)))'],
  softplus: ['select(log(1.0 + exp(min(z, 20.0))), z, z > 20.0)', 'select(sigm(z), 1.0, z > 20.0)'],
  // Clamped: some drivers return NaN for tanh of large arguments.
  tanh: ['tanh(clamp(z, -15.0, 15.0))', '1.0 - a * a'],
  sigmoid: ['sigm(z)', 'a * (1.0 - a)'],
  sin: ['sin(z)', 'cos(z)'],
  abs: ['abs(z)', 'sign(z)'],
  identity: ['z', '1.0'],
};

const HELPERS = /* wgsl */ `
fn sigm(z: f32) -> f32 { return 1.0 / (1.0 + exp(-z)); }
// Abramowitz-Stegun 7.1.26 (|error| < 1.5e-7, below f32 resolution near 1).
fn erf_(x: f32) -> f32 {
  let s = sign(x);
  let t = 1.0 / (1.0 + 0.3275911 * abs(x));
  let y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x);
  return s * y;
}`;

/** Matmul uses. C[M x N] = sum_k A[i, k] B[k, j] with strides (see Dims). */
export type MatmulMode =
  /** z = acc + bias; Z = z; C = f(z). Training forward of a hidden layer. */
  | { kind: 'fwdTrain'; act: Activation }
  /** C = f(acc + bias) (or acc + bias for the output layer, act identity). */
  | { kind: 'fwdEval'; act: Activation }
  /** C = acc. Weight and bias gradients. */
  | { kind: 'plain' }
  /** C = acc * f'(Z, Act). Backprop into the previous hidden layer. */
  | { kind: 'backprop'; act: Activation };

export const TILE = 16;

export function matmulSource(mode: MatmulMode): string {
  const extra: string[] = [];
  let epilogue: string;
  switch (mode.kind) {
    case 'fwdTrain':
      extra.push('@group(0) @binding(4) var<storage, read_write> Z: array<f32>;');
      extra.push('@group(0) @binding(5) var<storage, read> bias: array<f32>;');
      epilogue = `let z = acc + bias[j]; Z[idx] = z; C[idx] = ${ACT[mode.act][0]};`;
      break;
    case 'fwdEval':
      extra.push('@group(0) @binding(5) var<storage, read> bias: array<f32>;');
      epilogue = `let z = acc + bias[j]; C[idx] = ${ACT[mode.act][0]};`;
      break;
    case 'backprop':
      extra.push('@group(0) @binding(4) var<storage, read> Z: array<f32>;');
      extra.push('@group(0) @binding(5) var<storage, read> Act: array<f32>;');
      epilogue = `let z = Z[idx]; let a = Act[idx]; C[idx] = acc * (${ACT[mode.act][1]});`;
      break;
    default:
      epilogue = 'C[idx] = acc;';
  }
  return /* wgsl */ `
struct Dims { M: u32, N: u32, K: u32, sai: u32, sak: u32, sbk: u32, sbj: u32, _p: u32 }
@group(0) @binding(0) var<uniform> d: Dims;
@group(0) @binding(1) var<storage, read> A: array<f32>;
@group(0) @binding(2) var<storage, read> B: array<f32>;
@group(0) @binding(3) var<storage, read_write> C: array<f32>;
${extra.join('\n')}
${HELPERS}
const T = ${TILE}u;
var<workgroup> tA: array<array<f32, ${TILE}>, ${TILE}>;
var<workgroup> tB: array<array<f32, ${TILE}>, ${TILE}>;
@compute @workgroup_size(${TILE}, ${TILE})
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) l: vec3u) {
  let i = wg.y * T + l.y;
  let j = wg.x * T + l.x;
  var acc = 0.0;
  let tiles = (d.K + T - 1u) / T;
  for (var t = 0u; t < tiles; t++) {
    let ka = t * T + l.x;
    let kb = t * T + l.y;
    var av = 0.0;
    if (i < d.M && ka < d.K) { av = A[i * d.sai + ka * d.sak]; }
    var bv = 0.0;
    if (kb < d.K && j < d.N) { bv = B[kb * d.sbk + j * d.sbj]; }
    tA[l.y][l.x] = av;
    tB[l.y][l.x] = bv;
    workgroupBarrier();
    for (var k = 0u; k < T; k++) { acc += tA[l.y][k] * tB[k][l.x]; }
    workgroupBarrier();
  }
  if (i >= d.M || j >= d.N) { return; }
  let idx = i * d.N + j;
  ${epilogue}
}`;
}

/**
 * Mean loss over n points into losses[slot * 2 + column] (slot = epoch within the
 * current submission). With `grad`, also writes dLoss/dPrediction (divided by n).
 */
export function lossSource(kind: LossKind, grad: boolean): string {
  const term: Record<LossKind, string> = {
    mse: 'let v = r * r; let gr = 2.0 * r;',
    l1: 'let v = abs(r); let gr = sign(r);',
    huber:
      'let ar = abs(r); let v = select(u.delta * (ar - 0.5 * u.delta), 0.5 * r * r, ar < u.delta); let gr = select(sign(r) * u.delta, r, ar < u.delta);',
  };
  return /* wgsl */ `
struct U { n: u32, column: u32, delta: f32, _p: u32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> pred: array<f32>;
@group(0) @binding(2) var<storage, read> y: array<f32>;
@group(0) @binding(3) var<storage, read_write> losses: array<f32>;
@group(0) @binding(4) var<storage, read> state: array<u32>;
${grad ? '@group(0) @binding(5) var<storage, read_write> g: array<f32>;' : ''}
var<workgroup> part: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) li: u32) {
  let inv = 1.0 / f32(u.n);
  var s = 0.0;
  for (var q = li; q < u.n; q += 256u) {
    let r = pred[q] - y[q];
    ${term[kind]}
    s += v;
    ${grad ? 'g[q] = gr * inv;' : '_ = gr;'}
  }
  part[li] = s;
  workgroupBarrier();
  for (var w = 128u; w > 0u; w >>= 1u) {
    if (li < w) { part[li] += part[li + w]; }
    workgroupBarrier();
  }
  if (li == 0u) {
    let slot = state[0] - state[1] - 1u;
    losses[slot * 2u + u.column] = part[0] * inv;
  }
}`;
}

/** Optimizer kinds as numbers for the uniform block. */
export const OPT_CODE = {
  sgd: 0,
  momentum: 1,
  nesterov: 2,
  rmsprop: 3,
  adam: 4,
  adamw: 5,
} as const;
export const SCHED_CODE = { constant: 0, step: 1, cosine: 2 } as const;

/**
 * One optimizer update of the whole packed parameter vector (padding between
 * slices stays zero: its gradient and state are zero). Mirrors optim.ts and the L1/L2 penalties of mlp.ts. The learning rate
 * schedule is evaluated here from the step counter, so many epochs fit in one
 * submission.
 */
export const OPTIMIZER = /* wgsl */ `
struct U {
  count: u32, _p2: u32, _p3: u32, kind: u32,
  lr: f32, mom: f32, b1: f32, b2: f32,
  alpha: f32, eps: f32, wd: f32, l1: f32,
  l2: f32, sched: u32, every: f32, gamma: f32,
  minLr: f32, total: f32, _p0: u32, _p1: u32,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> p: array<f32>;
@group(0) @binding(2) var<storage, read> grad: array<f32>;
@group(0) @binding(3) var<storage, read_write> m: array<f32>;
@group(0) @binding(4) var<storage, read_write> v: array<f32>;
@group(0) @binding(5) var<storage, read> state: array<u32>;
@group(0) @binding(6) var<storage, read> isWeight: array<u32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nw: vec3u) {
  let i = id.x + id.y * nw.x * 256u;
  if (i >= u.count) { return; }
  let t = state[0];
  let e = f32(t - 1u);
  var lr = u.lr;
  if (u.sched == 1u) {
    lr = u.lr * pow(u.gamma, floor(e / u.every));
  } else if (u.sched == 2u) {
    let tt = min(e, u.total);
    lr = u.minLr + 0.5 * (u.lr - u.minLr) * (1.0 + cos(3.14159265 * tt / u.total));
  }
  var w = p[i];
  var g = grad[i];
  if (isWeight[i] == 1u) { g += u.l1 * sign(w) + 2.0 * u.l2 * w; }
  if (u.wd != 0.0 && u.kind != 5u) { g += u.wd * w; }
  switch u.kind {
    case 0u: { w -= lr * g; }
    case 1u, 2u: {
      var b = g;
      if (t != 1u) { b = u.mom * m[i] + g; }
      m[i] = b;
      if (u.kind == 2u) { w -= lr * (g + u.mom * b); } else { w -= lr * b; }
    }
    case 3u: {
      let vv = u.alpha * v[i] + (1.0 - u.alpha) * g * g;
      v[i] = vv;
      w -= lr * (g / (sqrt(vv) + u.eps));
    }
    default: {
      if (u.kind == 5u && u.wd != 0.0) { w *= 1.0 - lr * u.wd; }
      let tf = f32(t);
      let bc1 = 1.0 - pow(u.b1, tf);
      let bc2s = sqrt(1.0 - pow(u.b2, tf));
      let mm = m[i] + (1.0 - u.b1) * (g - m[i]);
      let vv = u.b2 * v[i] + (1.0 - u.b2) * g * g;
      m[i] = mm;
      v[i] = vv;
      w -= (lr / bc1) * (mm / (sqrt(vv) / bc2s + u.eps));
    }
  }
  p[i] = w;
}`;

/** Advances the step counter at the start of every epoch. */
export const TICK = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> state: array<u32>;
@compute @workgroup_size(1) fn main() { state[0] = state[0] + 1u; }`;
