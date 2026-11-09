// WebGPU backend: agrees with the CPU reference within f32 tolerance, meets the
// throughput target, and survives a lost device through the real worker.
// Skipped (with a note) where the browser has no WebGPU adapter.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Parity, WorkerReport } from './gpu-scenarios.ts';
import { engines, launchers, serve } from './serve.ts';

let origin = '';
let close = () => {};
beforeAll(async () => {
  ({ origin, close } = await serve());
});
afterAll(() => close());

const mod = () => `import('${origin}/engine/test/gpu-scenarios.ts')`;

describe('WebGPU backend', () => {
  for (const name of engines) {
    it(`${name}: matches the CPU, is fast, recovers from device loss`, async () => {
      const browser = await launchers[name]();
      try {
        const page = await browser.newPage();
        await page.goto(`${origin}/`);
        const adapter = (await page.evaluate(`${mod()}.then((m) => m.hasGpu())`)) as string | null;
        if (!adapter) {
          console.warn(`${name}: no WebGPU adapter, GPU tests skipped`);
          return;
        }
        const parity = (await page.evaluate(`${mod()}.then((m) => m.parity())`)) as Record<
          string,
          Parity
        >;
        console.log(`${name} (${adapter}) parity`, parity);
        for (const [scenario, p] of Object.entries(parity)) {
          expect(p.epochs, scenario).toBe(60);
          expect(p.loss, scenario).toBeLessThan(1e-4);
          expect(p.val, scenario).toBeLessThan(1e-4);
          expect(p.grid, scenario).toBeLessThan(1e-4);
        }
        const speeds = (await page.evaluate(`${mod()}.then((m) => m.speedTable())`)) as Record<
          string,
          { gpu: number; cpu: number }
        >;
        console.log(`${name} (${adapter}) epochs/s for [1, w, w, 1], N=96`, speeds);
        expect(speeds['1000'].gpu).toBeGreaterThan(50);
        const w = (await page.evaluate(
          `${mod()}.then((m) => m.viaWorker('${origin}/engine/src/worker/entry.ts'))`,
        )) as WorkerReport;
        expect(w.ready?.backend).toBe('webgpu');
        expect(w.recovered).toHaveLength(1);
        expect(w.recovered[0].reason).toBe('deviceLost');
        expect(w.recovered[0].epoch).toBeLessThanOrEqual(60);
        expect(w.done).toBe('finished');
        expect(w.epoch).toBe(120);
        expect(w.losses).toBe(120);
      } finally {
        await browser.close();
      }
    });
  }
});
