import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GRID_SIZE, presetState, trainingIdentity } from './experiment.ts';
import { PRESETS } from './presets.ts';
import {
  compressRecording,
  decodeRecording,
  decompressRecording,
  encodeRecording,
  type Recording,
} from './recording.ts';

function sample(): Recording {
  const state = presetState(PRESETS[0]);
  const grid = (k: number) =>
    Float32Array.from({ length: 64 }, (_, i) => (i === 5 ? NaN : Math.sin(i / 7 + k) * (k + 1)));
  return {
    key: trainingIdentity(state),
    state,
    backend: 'webgpu',
    adapter: 'test gpu',
    created: '2026-11-09',
    gridSize: 64,
    models: [0, 1].map((m) => ({
      trainLoss: Float32Array.from({ length: 30 }, (_, e) => 1 / (e + 1 + m)),
      valLoss: Float32Array.from({ length: 30 }, (_, e) => 2 / (e + 1 + m)),
      frameEpochs: Uint32Array.of(0, 10, 20, 30),
      grids: [0, 1, 2, 3].map((k) => grid(k + m)),
      diverged: m === 1,
    })),
  };
}

describe('recordings', () => {
  it('round-trips: losses exactly, grids within the quantization step, gaps kept', async () => {
    const rec = sample();
    const back = await decompressRecording(await compressRecording(rec));
    expect(back.key).toBe(rec.key);
    expect(back.state).toEqual(rec.state);
    expect(back.models).toHaveLength(2);
    back.models.forEach((m, i) => {
      const src = rec.models[i];
      expect(m.trainLoss).toEqual(src.trainLoss);
      expect(m.valLoss).toEqual(src.valLoss);
      expect(Array.from(m.frameEpochs)).toEqual([0, 10, 20, 30]);
      expect(m.diverged).toBe(i === 1);
      const span = 2 * (i + 4); // max |value| bound of the sample, times two
      m.grids.forEach((g, f) =>
        g.forEach((v, k) => {
          const want = src.grids[f][k];
          if (Number.isNaN(want)) expect(v).toBeNaN();
          else expect(Math.abs(v - want)).toBeLessThan(span / 65534);
        }),
      );
    });
  });

  it('rejects other files and truncated data', () => {
    expect(() => decodeRecording(new Uint8Array(16))).toThrow();
    const bytes = encodeRecording(sample());
    expect(() => decodeRecording(bytes.subarray(0, bytes.length - 8))).toThrow();
  });

  // A recording is only used for exactly the experiment it was made from. If a preset
  // changes, its recording must be made again: node scripts/record.ts <id>
  for (const p of PRESETS.filter((x) => x.recorded)) {
    it(`${p.id}: shipped recording matches the preset`, async () => {
      const raw = readFileSync(new URL(`../recordings/${p.id}.xpr`, import.meta.url));
      const rec = await decompressRecording(new Uint8Array(raw));
      const state = presetState(p);
      expect(rec.key).toBe(trainingIdentity(state));
      expect(rec.gridSize).toBe(GRID_SIZE);
      expect(rec.models).toHaveLength(state.models.length);
      for (const m of rec.models) {
        expect(m.trainLoss.length).toBe(state.epochs);
        expect(m.grids.length).toBeLessThanOrEqual(600);
        expect(m.frameEpochs[0]).toBe(0);
        expect(m.frameEpochs.at(-1)).toBe(state.epochs);
      }
    });
  }
});
