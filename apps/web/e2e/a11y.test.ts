// Automated accessibility audit (axe-core, WCAG 2.2 A and AA rules) of every page in both
// themes, plus the playground's dialogs and open panels.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, test } from 'vitest';
import { LESSONS } from '../src/lib/lessons.ts';
import { hydrated, openPage, targets } from './browsers.ts';

const baseURL = inject('baseURL');
const NL = String.fromCharCode(10);
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const PAGES = [
  './',
  './playground/',
  './lessons/',
  ...LESSONS.map((l) => `./lessons/${l.slug}/`),
  './gallery/',
  './library/',
  './about/',
  './embed/#preset=race-activations',
  './no-such-page/',
];

interface Violation {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: string[]; failureSummary?: string }[];
}

/** Runs axe on the page; returns readable violation lines (empty when clean). */
async function audit(page: Page, scrolled = false): Promise<string[]> {
  // Evaluated through the automation protocol, so the page's CSP does not apply.
  await page.evaluate(AXE);
  const violations = await page.evaluate(async (scrolled) => {
    const axe = (
      window as unknown as { axe: { run: (o: unknown) => Promise<{ violations: Violation[] }> } }
    ).axe;
    const r = await axe.run({
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      resultTypes: ['violations'],
      // After clicks the page is scrolled, and targets half out of the viewport count as
      // "obscured". Target sizes are checked by the page-level runs, at the top of each page.
      ...(scrolled ? { rules: { 'target-size': { enabled: false } } } : {}),
    });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => ({ target: n.target, failureSummary: n.failureSummary })),
    }));
  }, scrolled);
  return violations.flatMap((v) =>
    v.nodes.map(
      (n) =>
        `${v.id} (${v.impact}): ${n.target.join(' ')} | ${v.help} | ${(n.failureSummary ?? '').split(NL).slice(1, 3).join(' ').trim()}`,
    ),
  );
}

describe.each(targets)('$name', (target) => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await target.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test.each(PAGES)(`%s passes axe (${scheme})`, async (path) => {
      const { context, page } = await openPage(browser, target, baseURL, { colorScheme: scheme });
      await page.goto(path, { waitUntil: 'networkidle' });
      await hydrated(page);
      await page.waitForTimeout(300);
      expect(await audit(page)).toEqual([]);
      await context.close();
    });
  }

  test('playground panels and dialogs pass axe', async () => {
    const { context, page } = await openPage(browser, target, baseURL);
    await page.goto('./playground/#preset=race-activations', { waitUntil: 'networkidle' });
    await hydrated(page);
    const found: string[] = [];
    const check = async (step: string) =>
      found.push(...(await audit(page, true)).map((v) => `${step}: ${v}`));
    const tab = page.getByRole('tab', { name: 'Models' });
    if (await tab.isVisible()) await tab.click();
    await page.getByRole('button', { name: 'Edit N1' }).click();
    await page.getByText('Advanced').click();
    await check('model editor');
    await page.getByRole('button', { name: 'Add model' }).click();
    await check('add menu');
    await page.keyboard.press('Escape');
    for (const name of ['Kinks', 'Waves', 'Weights', 'Loss map']) {
      const t = page.getByRole('tab', { name });
      if (await t.isVisible()) {
        await t.click();
        await check(`${name} view`);
      }
    }
    await page.getByText('Show the curves as a table').click();
    const table = page.locator('[data-values-table]');
    await expect.poll(() => table.locator('tbody tr').count()).toBe(21);
    expect(await table.locator('thead').textContent()).toContain('N1');
    await check('values table');
    await page.getByRole('button', { name: 'Share' }).click();
    await check('share menu');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save' }).click();
    await check('save popover');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Export' }).click();
    await page.getByRole('dialog').waitFor();
    await check('export dialog');
    expect([...new Set(found)]).toEqual([]);
    await context.close();
  });
});
