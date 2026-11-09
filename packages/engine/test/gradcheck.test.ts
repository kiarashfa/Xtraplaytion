// Analytic gradients against central finite differences.
import { Rng } from '@xtraplaytion/dmath';
import { describe, expect, it } from 'vitest';
import {
  lossAndGrad,
  lossOnly,
  mlp,
  MLP,
  type Activation,
  type LossKind,
  type MLPConfig,
} from '../src/index.ts';

const ACTS: Activation[] = [
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

function check(config: MLPConfig, lossKind: LossKind, n = 7) {
  const net = new MLP(config, 11);
  const rng = new Rng(99);
  // Move parameters away from 0 so kinks (relu, abs) are unlikely near the probe.
  for (let i = 0; i < net.params.length; i++) net.params[i] += rng.uniform(-0.3, 0.3);
  const X = Float64Array.from({ length: n * config.inDim }, () => rng.uniform(-2, 2));
  const Y = Float64Array.from({ length: n }, () => rng.uniform(-1, 1));
  const dOut = new Float64Array(n);
  const f = () => {
    const out = net.forward(X, n, true);
    return lossOnly(lossKind, out, Y, n, 0.4) + net.penalty();
  };
  const out = net.forward(X, n, true);
  lossAndGrad(lossKind, out, Y, n, dOut, 0.4);
  net.backward(dOut, n);
  const analytic = Float64Array.from(net.grads);
  let worst = 0;
  const h = 1e-6;
  for (let i = 0; i < net.params.length; i++) {
    const keep = net.params[i];
    net.params[i] = keep + h;
    const up = f();
    net.params[i] = keep - h;
    const down = f();
    net.params[i] = keep;
    const numeric = (up - down) / (2 * h);
    // Combined tolerance: |diff| <= atol + rtol |numeric|; report the ratio to that bound.
    const err = Math.abs(numeric - analytic[i]) / (1e-8 + 1e-5 * Math.abs(numeric));
    worst = Math.max(worst, err);
  }
  return worst;
}

describe('gradient check', () => {
  for (const act of ACTS) {
    it(`${act} hidden layers, MSE`, () => {
      expect(check(mlp({ hidden: [5, 4], activations: [act, act] }), 'mse')).toBeLessThan(1);
    });
  }

  it('mixed activations and 2-D input', () => {
    expect(
      check(mlp({ inDim: 2, hidden: [6, 5, 3], activations: ['tanh', 'gelu', 'silu'] }), 'mse'),
    ).toBeLessThan(1);
  });

  it.each<LossKind>(['l1', 'huber'])('%s loss', (kind) => {
    expect(check(mlp({ hidden: [5], activations: ['tanh'] }), kind)).toBeLessThan(1);
  });

  it('L1 and L2 penalties', () => {
    expect(
      check(mlp({ hidden: [5, 4], activations: ['tanh', 'sigmoid'], l1: 0.01, l2: 0.03 }), 'mse'),
    ).toBeLessThan(1);
  });
});
