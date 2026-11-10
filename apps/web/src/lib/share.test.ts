import { mlp, type MLPConfig, type ModelConfig } from '@xtraplaytion/engine';
import { describe, expect, it } from 'vitest';
import { decodeState, encodeState, validateState, type ExperimentState } from './share.ts';

const model = (w: number) => ({
  ...mlp({ hidden: [w, w] }),
  init: { kind: 'torch_default' as const },
});
const hidden = (c: ModelConfig | undefined) => (c as MLPConfig | undefined)?.hidden;

const state: ExperimentState = {
  v: 4,
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

const classical: ModelConfig[] = [
  { kind: 'poly', degree: 9 },
  { kind: 'fourier', harmonics: 5, period: 3.5 },
  { kind: 'spline', segments: 16, smoothing: 0.1 },
  { kind: 'knn', k: 3, weights: 'distance' },
  { kind: 'tree', ensemble: 'boost', depth: 3, trees: 80, minLeaf: 2, lr: 0.1 },
  {
    kind: 'gp',
    kernel: [
      { kind: 'periodic', scale: 1, length: 0.8, period: 2 },
      { kind: 'rbf', scale: 0.3, length: 3, period: 2 },
    ],
    noise: 0.05,
    tune: false,
  },
];

describe('share links', () => {
  it('round-trip a race of several models', async () => {
    const back = await decodeState(await encodeState(state));
    expect(back).not.toBeNull();
    expect(back?.models.map((m) => [hidden(m.model), m.seed, m.visible])).toEqual([
      [[10, 10], 1, true],
      [[40, 40], 2, false],
    ]);
    expect(back?.layout).toBe('stacked');
    expect(back?.epochs).toBe(900);
  });

  it('round-trip every classical family exactly', async () => {
    const s = {
      ...state,
      models: classical.map((model, i) => ({ model, seed: i, visible: true })),
    };
    const back = await decodeState(await encodeState(s));
    expect(back?.models.map((m) => m.model)).toEqual(classical);
  });

  it('clamp classical settings and reject unknown families', () => {
    const s = validateState({
      ...state,
      models: [{ model: { kind: 'poly', degree: 500 }, seed: 1, visible: true }],
    });
    expect(s?.models[0].model).toEqual({ kind: 'poly', degree: 30 });
    expect(
      validateState({ ...state, models: [{ model: { kind: 'svm' }, seed: 1, visible: true }] }),
    ).toBeNull();
    // Version 2 links held networks only.
    expect(
      validateState({ ...state, v: 2, models: [{ model: classical[0], seed: 1, visible: true }] }),
    ).toBeNull();
  });

  it('migrate version 1 links: one model whose weights use the data seed', () => {
    const { models: _m, layout: _l, ...rest } = state;
    const v1 = { ...rest, v: 1, model: model(17) };
    const s = validateState(v1);
    expect(s?.v).toBe(4);
    expect(s?.models).toHaveLength(1);
    expect(hidden(s?.models[0].model)).toEqual([17, 17]);
    expect(s?.models[0].seed).toBe(7);
    expect(s?.layout).toBe('overlay');
  });

  it('accept version 2 and 3 links unchanged', () => {
    expect(validateState({ ...state, v: 2 })?.models).toHaveLength(2);
    expect(validateState({ ...state, v: 3 })?.models).toHaveLength(2);
    // A source only exists from version 4 on.
    const drawn = { kind: 'drawn', x0: -1, x1: 1, ys: [0, 1, 0] };
    expect(validateState({ ...state, v: 3, source: drawn })?.source).toBeUndefined();
  });

  it('round-trip drawings and imported points exactly', async () => {
    const drawn = { kind: 'drawn' as const, x0: -4.5, x1: 3.25, ys: [0.12, -1.5, 2e-3, 7] };
    const back = await decodeState(await encodeState({ ...state, source: drawn }));
    expect(back?.source).toEqual(drawn);
    const xs = Array.from({ length: 50 }, (_, i) => i * 0.1 + 1 / 3);
    const pts = { kind: 'points' as const, xs, ys: xs.map((x) => Math.sqrt(x)) };
    const back2 = await decodeState(await encodeState({ ...state, source: pts }));
    expect(back2?.source).toEqual(pts);
  });

  it('reject malformed sources', () => {
    const bad = [
      { kind: 'drawn', x0: 1, x1: 1, ys: [0, 1] },
      { kind: 'drawn', x0: 0, x1: 1, ys: [0] },
      { kind: 'drawn', x0: 0, x1: 1, ys: [0, null] },
      { kind: 'points', xs: [1, 2], ys: [1] },
      { kind: 'points', xs: [1, 2], ys: [1, 1e300] },
      { kind: 'csv' },
    ];
    for (const source of bad) expect(validateState({ ...state, source })).toBeNull();
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
    expect(validateState({ ...state, v: 5 })).toBeNull();
    expect(await decodeState('not-a-real-link')).toBeNull();
  });

  it('keeps the number of copies of averaged models (2..8, never for a GP)', async () => {
    const withCopies: ExperimentState = {
      ...state,
      models: [
        { model: model(10), seed: 1, visible: true, copies: 5 },
        { model: classical[0], seed: 2, visible: true, copies: 30 },
        { model: classical[5], seed: 3, visible: true, copies: 4 },
      ],
    };
    const back = await decodeState(await encodeState(withCopies));
    expect(back?.models.map((m) => m.copies)).toEqual([5, 8, undefined]);
    expect(
      validateState({ ...state, models: [{ model: model(4), seed: 1, copies: 1 }] })?.models[0]
        .copies,
    ).toBeUndefined();
  });
});
