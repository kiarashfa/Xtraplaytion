// Training must give bit-identical results in every engine, directly and through
// the real worker. A local server (127.0.0.1 is a secure context) serves the
// workspace sources with types stripped and the dmath import rewritten.
import { readFileSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit, type Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectedWorkerHash, runScenarios } from './scenarios.ts';

const PACKAGES = fileURLToPath(new URL('../../', import.meta.url));
let server: Server;
let origin = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (path === '/') {
      res
        .writeHead(200, { 'content-type': 'text/html' })
        .end('<!doctype html><title>engine</title>');
      return;
    }
    const file = join(PACKAGES, path);
    if (!file.startsWith(PACKAGES) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    const code = stripTypeScriptTypes(readFileSync(file, 'utf8')).replaceAll(
      "'@xtraplaytion/dmath'",
      "'/dmath/src/index.ts'",
    );
    res.writeHead(200, { 'content-type': 'text/javascript' }).end(code);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  origin = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
afterAll(() => server?.close());

const launchers: Record<string, () => Promise<Browser>> = {
  chrome: () => chromium.launch({ channel: 'chrome' }),
  msedge: () => chromium.launch({ channel: 'msedge' }),
  firefox: () => firefox.launch(),
  webkit: () => webkit.launch(),
};
const engines = (process.env['XP_BROWSERS'] ?? 'chrome')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

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
