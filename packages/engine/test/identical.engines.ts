// Training must give bit-identical results in every engine, directly and through
// the real worker (CPU backend).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectedWorkerHash, runScenarios } from './scenarios.ts';
import { engines, launchers, serve } from './serve.ts';

let origin = '';
let close = () => {};
beforeAll(async () => {
  ({ origin, close } = await serve());
});
afterAll(() => close());

describe('identical training across engines', () => {
  const node = runScenarios();
  const nodeWorker = expectedWorkerHash();

  for (const name of engines) {
    it(`${name}: every scenario matches Node, directly and through the worker`, async () => {
      const browser = await launchers[name]();
      try {
        const page = await browser.newPage();
        await page.goto(`${origin}/`);
        const direct = await page.evaluate(
          `import('${origin}/engine/test/scenarios.ts').then((m) => m.runScenarios())`,
        );
        expect(direct).toEqual(node);
        const viaWorker = await page.evaluate(
          `import('${origin}/engine/test/scenarios.ts').then((m) => m.runViaWorker('${origin}/engine/src/worker/entry.ts'))`,
        );
        expect(viaWorker).toBe(nodeWorker);
      } finally {
        await browser.close();
      }
    });
  }
});
