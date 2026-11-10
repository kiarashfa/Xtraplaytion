import { mlp } from '@xtraplaytion/engine';
import { describe, expect, it } from 'vitest';
import { generateCode } from './codegen.ts';
import { datasetOf, presetState } from './experiment.ts';
import { PRESETS } from './presets.ts';
import type { ExperimentState } from './share.ts';

const base = presetState(PRESETS[0]);
const withModels: ExperimentState = {
  ...base,
  expr: 'x sin(x) + erf(x/2) - step(x) + mod(x, 3) + max(x, 1, -x)',
  epochs: 30,
  models: [
    { model: mlp({ hidden: [8, 8], activations: ['relu', 'sin'] }), seed: 1, visible: true },
    { model: { kind: 'poly', degree: 5 }, seed: 2, visible: true },
    { model: { kind: 'spline', segments: 12, smoothing: 0.01 }, seed: 3, visible: true },
  ],
};

describe('copy as code', () => {
  it('embeds the exact data and every model', () => {
    const data = datasetOf(withModels);
    if (!data) throw new Error('no data');
    const code = generateCode('pytorch', { state: withModels, data, names: ['N1', 'P2', 'S3'] });
    expect(code).toContain(String(data.trainX[3]));
    expect(code).toContain('def train_N1()');
    expect(code).toContain('np.polynomial.Legendre.fit');
    expect(code).toContain('from scipy.special import erf');
    expect(code).toContain('Sin()');
    expect(code).not.toContain('\u2014');
    const jax = generateCode('jax', { state: withModels, data, names: ['N1', 'P2', 'S3'] });
    expect(jax).toContain('optax.adam(');
  });

  it('names averaged models like the site and says the site averages them', () => {
    const avg = {
      ...withModels,
      models: withModels.models.map((m, i) => (i === 0 ? { ...m, copies: 5 } : m)),
    };
    const data = datasetOf(avg);
    if (!data) throw new Error('no data');
    const code = generateCode('pytorch', { state: avg, data, names: ['N1 ×5', 'P2', 'S3'] });
    expect(code).toContain('def train_N1():');
    expect(code).toContain('preds["N1"] = train_N1()');
    expect(code).toContain('average of 5 copies');
    expect(code).not.toContain('×');
  });
});
