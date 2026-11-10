// Gallery thumbnails: the finished race of every gallery experiment, written to
// src/gallery/thumbs.json. Networks and classical models train here on the CPU (exact, so
// the file is the same on every machine); presets with a recording use its last frame.
//   node scripts/gallery.ts            every gallery item
//   node scripts/gallery.ts race-depth only these
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRun } from '@xtraplaytion/engine';
import { datasetOf, presetState, trainingIdentity } from '../src/lib/experiment.ts';
import { GALLERY } from '../src/lib/gallery.ts';
import { PRESETS } from '../src/lib/presets.ts';
import { decompressRecording } from '../src/lib/recording.ts';
import { packValues, type ThumbFile, type ThumbModel } from '../src/lib/thumbs.ts';

const OUT = fileURLToPath(new URL('../src/gallery/thumbs.json', import.meta.url));
const REC = fileURLToPath(new URL('../src/recordings/', import.meta.url));
const only = process.argv.slice(2);

const old: ThumbFile = existsSync(OUT)
  ? (JSON.parse(readFileSync(OUT, 'utf8')) as ThumbFile)
  : { gridSize: 512, items: {} };
// Keep thumbnails of items not rebuilt now; drop items no longer in the gallery.
const file: ThumbFile = {
  gridSize: 512,
  items: Object.fromEntries(
    Object.entries(old.items).filter(([id]) => GALLERY.some((g) => g.id === id)),
  ),
};

for (const item of GALLERY) {
  if (only.length && !only.includes(item.id)) continue;
  const preset = PRESETS.find((p) => p.id === item.id);
  if (!preset) throw new Error(`no preset ${item.id}`);
  const state = presetState(preset);
  const data = datasetOf(state);
  if (!data) throw new Error(`no data for ${item.id}`);
  const t0 = performance.now();
  const models: ThumbModel[] = [];
  const rec = `${REC}${item.id}.xpr`;
  if (preset.recorded && existsSync(rec)) {
    const r = await decompressRecording(new Uint8Array(readFileSync(rec)));
    for (const m of r.models) {
      const g = packValues(m.grids[m.grids.length - 1]);
      const band = m.bands?.[m.bands.length - 1];
      models.push({
        lo: g.lo,
        hi: g.hi,
        grid: g.data,
        ...(band ? { band: packValues(band) } : {}),
      });
    }
  } else {
    for (const m of state.models) {
      const run = createRun(m.model, data, m.seed, state.epochs);
      run.step(state.epochs);
      const f = run.frame();
      run.dispose();
      const g = packValues(f.grid);
      models.push({
        lo: g.lo,
        hi: g.hi,
        grid: g.data,
        ...(f.band ? { band: packValues(f.band) } : {}),
      });
    }
  }
  file.items[item.id] = { key: trainingIdentity(state), models };
  console.log(
    `${item.id}: ${models.length} models, ${((performance.now() - t0) / 1000).toFixed(1)} s`,
  );
}

writeFileSync(OUT, `${JSON.stringify(file)}\n`);
console.log(`wrote ${OUT} (${(readFileSync(OUT).length / 1024).toFixed(1)} KB)`);
