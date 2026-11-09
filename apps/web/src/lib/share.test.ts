import { mlp } from '@xtraplaytion/engine';
import { describe, expect, it } from 'vitest';
import { decodeState, encodeState, validateState, type ExperimentState } from './share.ts';

const model = (w: number) => ({
  ...mlp({ hidden: [w, w] }),
  init: { kind: 'torch_default' as const },
});

const state: ExperimentState = {
  v: 2,
  expr: 'sin(3x)',
  domain: [-5, 5],
  n: 120,
  noise: { kind: 'gaussian', sigma: 0.1 },
  seed: 7,
  valFraction: 0.2,
  bands: [[-3, 3]],
  models: [
    { model: model(10), seed: 1, visible: true },
    { model: model(40), seed: 2, visible: false },
  ],
  epochs: 900,
  layout: 'stacked',
};

describe('share links', () => {
  it('round-trip a race of several models', async () => {
    const back = await decodeState(await encodeState(state));
    expect(back).not.toBeNull();
    expect(back?.models.map((m) => [m.model.hidden, m.seed, m.visible])).toEqual([
      [[10, 10], 1, true],
      [[40, 40], 2, false],
    ]);
    expect(back?.layout).toBe('stacked');
    expect(back?.epochs).toBe(900);
  });

  it('migrate version 1 links: one model whose weights use the data seed', () => {
    const { models: _m, layout: _l, ...rest } = state;
    const v1 = { ...rest, v: 1, model: model(17) };
    const s = validateState(v1);
    expect(s?.v).toBe(2);
    expect(s?.models).toHaveLength(1);
    expect(s?.models[0].model.hidden).toEqual([17, 17]);
    expect(s?.models[0].seed).toBe(7);
    expect(s?.layout).toBe('overlay');
  });

  it('reject malformed or oversized races', async () => {
    expect(validateState({ ...state, models: [] })).toBeNull();
    const seven = Array.from({ length: 7 }, (_, i) => ({
      model: model(4),
      seed: i,
      visible: true,
    }));
    expect(validateState({ ...state, models: seven })).toBeNull();
    expect(validateState({ ...state, models: [{ model: model(4) }] })).toBeNull();
    expect(validateState({ ...state, v: 3 })).toBeNull();
    expect(await decodeState('not-a-real-link')).toBeNull();
  });
});
