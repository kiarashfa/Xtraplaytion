import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { presetState, trainingIdentity } from './experiment.ts';
import { GALLERY } from './gallery.ts';
import { PRESETS } from './presets.ts';
import { packValues, unpackValues, type ThumbFile } from './thumbs.ts';

const file = JSON.parse(
  readFileSync(new URL('../gallery/thumbs.json', import.meta.url), 'utf8'),
) as ThumbFile;

describe('gallery', () => {
  it('lists presets, each once', () => {
    const ids = GALLERY.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(PRESETS.some((p) => p.id === id)).toBe(true);
  });

  // Fails when a gallery preset changes: run `pnpm --filter @xtraplaytion/web gallery`.
  it('has an up-to-date thumbnail for every item', () => {
    expect(Object.keys(file.items).sort()).toEqual(GALLERY.map((g) => g.id).sort());
    for (const g of GALLERY) {
      const p = PRESETS.find((x) => x.id === g.id);
      if (!p) throw new Error(g.id);
      const state = presetState(p);
      const item = file.items[g.id];
      expect(item.key).toBe(trainingIdentity(state));
      expect(item.models).toHaveLength(state.models.length);
      for (const m of item.models) expect(unpackValues({ ...m, data: m.grid })).toHaveLength(512);
    }
  });

  it('packs values to 16 bits', () => {
    const v = [0, 0.5, -1, NaN, 2, Infinity];
    const back = unpackValues(packValues(v));
    expect(back[3]).toBeNaN();
    expect(back[5]).toBeNaN();
    for (const i of [0, 1, 2, 4]) expect(Math.abs(back[i] - v[i])).toBeLessThan(3 / 65534);
    expect(unpackValues(packValues([NaN, NaN]))[0]).toBeNaN();
  });
});
