// dmath must produce bit-identical results in every engine. The TypeScript
// sources are served to the browser with their types stripped (no bundler).
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { chromium, firefox, webkit, type Browser } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { computeVectors, type VectorReport } from './vectors.ts';

const ORIGIN = 'http://dmath.test';
const root = new URL('..', import.meta.url);

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

export async function vectorsInBrowser(name: string): Promise<VectorReport> {
  const launch = launchers[name];
  if (!launch) throw new Error(`Unknown browser "${name}"`);
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.route(`${ORIGIN}/**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/') {
        return route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><title>dmath</title>',
        });
      }
      const source = readFileSync(new URL(`.${path}`, root), 'utf8');
      return route.fulfill({ contentType: 'text/javascript', body: stripTypeScriptTypes(source) });
    });
    await page.goto(`${ORIGIN}/`);
    // A string, so the test runner's transforms never touch the dynamic import.
    return (await page.evaluate(
      `import('${ORIGIN}/test/vectors.ts').then((m) => m.computeVectors(${JSON.stringify(name)}))`,
    )) as VectorReport;
  } finally {
    await browser.close();
  }
}

describe('identical results across engines', () => {
  const node = computeVectors('node');

  for (const name of engines) {
    it(`${name} matches Node bit for bit`, async () => {
      const report = await vectorsInBrowser(name);
      expect(report.dmath).toEqual(node.dmath);

      // Informational: how often the engine's own Math differs from Node's.
      const drift = Object.entries(report.native)
        .map(([fn, bits]) => {
          const diff = bits.filter((b, i) => b !== node.native[fn][i]).length;
          return diff ? `${fn} ${diff}/${bits.length}` : '';
        })
        .filter(Boolean);
      console.info(`[${name}] native Math differs from Node in: ${drift.join(', ') || 'nothing'}`);
    });
  }
});
