// Recorded runs for heavy presets: trains them on WebGPU in headless Chrome (the
// installed Google Chrome, through playwright-core) and writes src/recordings/<id>.xpr.
//   node scripts/record.ts                 every preset marked `recorded`
//   node scripts/record.ts race-width      only these presets
//   XP_GPU=discrete node scripts/record.ts ask Chrome for the discrete GPU
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { presetState, trainingIdentity } from '../src/lib/experiment.ts';
import { PRESETS } from '../src/lib/presets.ts';
import { compressRecording, type Recording } from '../src/lib/recording.ts';
import type { PageModel } from './record-page.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = fileURLToPath(new URL('../src/recordings/', import.meta.url));
/** Frames kept per model (the playground's replay history holds 600). */
const FRAMES = 500;

const ALIASES: Record<string, string> = {
  "'@xtraplaytion/engine'": "'/packages/engine/src/index.ts'",
  "'@xtraplaytion/expr'": "'/packages/expr/src/index.ts'",
  "'@xtraplaytion/dmath'": "'/packages/dmath/src/index.ts'",
};

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  if (path === '/') {
    res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>record</title>');
    return;
  }
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file) || !file.endsWith('.ts')) {
    res.writeHead(404).end();
    return;
  }
  let code = stripTypeScriptTypes(readFileSync(file, 'utf8'));
  for (const [from, to] of Object.entries(ALIASES)) code = code.replaceAll(from, to);
  res.writeHead(200, { 'content-type': 'text/javascript' }).end(code);
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const addr = server.address();
const origin = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

const wanted = process.argv.slice(2);
const list = PRESETS.filter((p) => (wanted.length ? wanted.includes(p.id) : p.recorded));
if (!list.length) throw new Error(`No preset to record (${wanted.join(', ') || 'none marked'})`);

const browser = await chromium.launch({
  channel: 'chrome',
  args: process.env['XP_GPU'] === 'discrete' ? ['--force_high_performance_gpu'] : [],
});
try {
  const page = await browser.newPage();
  page.on('console', (m) => console.log(`  [page] ${m.text()}`));
  await page.goto(`${origin}/`);
  for (const p of list) {
    const state = presetState(p);
    const every = Math.max(1, Math.ceil(state.epochs / FRAMES));
    const t0 = performance.now();
    const out = (await page.evaluate(
      `import('/apps/web/scripts/record-page.ts').then((m) => m.record(${JSON.stringify(state)}, ${every}))`,
    )) as { adapter: string; models: PageModel[] };
    const rec: Recording = {
      key: trainingIdentity(state),
      state,
      backend: 'webgpu',
      adapter: out.adapter,
      created: new Date().toISOString().slice(0, 10),
      gridSize: out.models[0]?.grids[0]?.length ?? 0,
      models: out.models.map((m) => ({
        trainLoss: Float32Array.from(m.trainLoss),
        valLoss: Float32Array.from(m.valLoss),
        frameEpochs: Uint32Array.from(m.frameEpochs),
        grids: m.grids.map((g) => Float32Array.from(g)),
        diverged: m.diverged,
      })),
    };
    const bytes = await compressRecording(rec);
    writeFileSync(join(OUT, `${p.id}.xpr`), bytes);
    const sec = ((performance.now() - t0) / 1000).toFixed(1);
    const finals = out.models.map((m) => m.trainLoss.at(-1)?.toExponential(2)).join(', ');
    console.log(
      `${p.id}: ${out.models.length} models, ${rec.models[0].grids.length} frames each, ` +
        `${(bytes.length / 1024).toFixed(0)} KB, ${sec} s on ${out.adapter}; final losses ${finals}`,
    );
  }
} finally {
  await browser.close();
  server.close();
}
