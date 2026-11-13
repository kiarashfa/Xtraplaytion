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
import { bootstrapData, copySeed } from '../src/lib/models.ts';
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
      // Averaged models: k copies (networks from other starting weights, classical models on
      // bootstrap resamples), mean as the line and their spread as the band, as on the page.
      const k = m.copies ?? 1;
      const grids: Float32Array[] = [];
      let band: Float32Array | undefined;
      for (let i = 0; i < k; i++) {
        const net = m.model.kind === 'mlp';
        const run = createRun(
          m.model,
          k > 1 && !net ? bootstrapData(data, m.seed + i) : data,
          k > 1 && net ? copySeed(m.seed, i) : m.seed,
          state.epochs,
        );
        run.step(state.epochs);
        const f = run.frame();
        run.dispose();
        grids.push(f.grid);
        if (k === 1 && f.band) band = f.band;
      }
      let grid = grids[0];
      if (k > 1) {
        grid = new Float32Array(grid.length);
        band = new Float32Array(grid.length);
        for (let j = 0; j < grid.length; j++) {
          let s = 0;
          let s2 = 0;
          for (const g of grids) {
            s += g[j];
            s2 += g[j] * g[j];
          }
          grid[j] = s / k;
          band[j] = Math.sqrt(Math.max(0, s2 / k - (s / k) ** 2));
        }
      }
      const g = packValues(grid);
      models.push({
        lo: g.lo,
        hi: g.hi,
        grid: g.data,
        ...(band ? { band: packValues(band) } : {}),
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
