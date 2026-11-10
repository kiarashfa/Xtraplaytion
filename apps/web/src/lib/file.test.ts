import { mlp } from '@xtraplaytion/engine';
import { describe, expect, it } from 'vitest';
import { datasetOf, presetState } from './experiment.ts';
import { experimentFile, fileNameFor, readExperimentFile } from './file.ts';
import { PRESETS } from './presets.ts';
import { decodeState, encodeState, type ExperimentState } from './share.ts';

const bits = (a: ArrayLike<number>) => Array.from(new Float64Array(Float64Array.from(a).buffer));
const xs = Array.from({ length: 300 }, (_, i) => 1990 + i / 12);
const points: ExperimentState = {
  ...presetState(PRESETS[0]),
  domain: [1985, 2020],
  bands: [[1990, 2010]],
  source: { kind: 'points', xs, ys: xs.map((x) => Math.sin(x) * 100 + x / 7) },
  models: [
    {
      model: {
        ...mlp({ hidden: [8], activations: ['tanh'] }),
        scale: { xShift: 2002.5, xScale: 0.0571429, yShift: 287.1, yScale: 0.0141 },
      },
      seed: 3,
      visible: true,
    },
    { model: { kind: 'knn', k: 4, weights: 'uniform' }, seed: 4, visible: true },
  ],
};
const drawn: ExperimentState = {
  ...presetState(PRESETS[1]),
  source: { kind: 'drawn', x0: -3.2, x1: 4.1, ys: [0.5, 0.7, -0.25, 1.125, 0] },
};

function sameRun(a: ExperimentState, b: ExperimentState | null) {
  expect(b).not.toBeNull();
  if (!b) return;
  expect(b.models).toEqual(a.models);
  const da = datasetOf(a);
  const db = datasetOf(b);
  if (!da || !db) throw new Error('no data');
  for (const k of ['trainX', 'trainY', 'valX', 'valY', 'gridX', 'clean'] as const)
    expect(bits(db[k])).toEqual(bits(da[k]));
  expect(bits(db.test?.y ?? [])).toEqual(bits(da.test?.y ?? []));
}

describe('round trips rebuild bit-identical data and models', () => {
  it('through a link', async () => {
    sameRun(drawn, await decodeState(await encodeState(drawn)));
    sameRun(points, await decodeState(await encodeState(points)));
  });

  it('through a file', () => {
    for (const s of [drawn, points]) {
      const back = readExperimentFile(experimentFile(s, 'Test'));
      if (typeof back === 'string') throw new Error(back);
      expect(back.name).toBe('Test');
      sameRun(s, back.state);
    }
  });

  it('files: refuse what is not ours, newer or damaged', () => {
    expect(readExperimentFile('nope')).toBe('notJson');
    expect(readExperimentFile('{"a":1}')).toBe('notExperiment');
    expect(
      readExperimentFile(JSON.stringify({ format: 'xtraplaytion-experiment', version: 9 })),
    ).toBe('newer');
    expect(
      readExperimentFile(
        JSON.stringify({ format: 'xtraplaytion-experiment', version: 1, state: { v: 4 } }),
      ),
    ).toBe('invalid');
    expect(fileNameFor('Sin(x) · N1, P2')).toBe('sinx-n1-p2.xtraplaytion.json');
  });
});
