// Activations and their derivatives. Definitions follow PyTorch's defaults
// (leaky slope 0.01, ELU alpha 1, exact GELU, softplus threshold 20).
import { erf, exp, expm1, log1p, cos, sin, tanh } from '@xtraplaytion/dmath';
import type { Activation } from './config.ts';

/** f(z) */
export type Fwd = (z: number) => number;
/** f'(z), given z and a = f(z) */
export type Bwd = (z: number, a: number) => number;

const SQRT1_2 = 0.7071067811865476;
const INV_SQRT_2PI = 0.3989422804014327;

function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + exp(-z));
  const e = exp(z);
  return e / (1 + e);
}

export const ACTIVATIONS: Record<Activation, [Fwd, Bwd]> = {
  relu: [(z) => (z > 0 ? z : 0), (z) => (z > 0 ? 1 : 0)],
  leaky_relu: [(z) => (z > 0 ? z : 0.01 * z), (z) => (z > 0 ? 1 : 0.01)],
  elu: [(z) => (z > 0 ? z : expm1(z)), (z, a) => (z > 0 ? 1 : a + 1)],
  gelu: [
    (z) => 0.5 * z * (1 + erf(z * SQRT1_2)),
    (z) => 0.5 * (1 + erf(z * SQRT1_2)) + z * INV_SQRT_2PI * exp(-0.5 * z * z),
  ],
  silu: [
    (z) => z * sigmoid(z),
    (z) => {
      const s = sigmoid(z);
      return s * (1 + z * (1 - s));
    },
  ],
  softplus: [(z) => (z > 20 ? z : log1p(exp(z))), (z) => (z > 20 ? 1 : sigmoid(z))],
  tanh: [tanh, (_z, a) => 1 - a * a],
  sigmoid: [sigmoid, (_z, a) => a * (1 - a)],
  sin: [sin, (z) => cos(z)],
  abs: [Math.abs, (z) => (z > 0 ? 1 : z < 0 ? -1 : 0)],
  identity: [(z) => z, () => 1],
};

/** Activations whose natural init is He (Kaiming); the rest use Xavier (Glorot). */
export const RELU_LIKE: ReadonlySet<Activation> = new Set([
  'relu',
  'leaky_relu',
  'elu',
  'gelu',
  'silu',
  'softplus',
  'abs',
]);
