import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, test } from 'vitest';
import { openPage, targets } from './browsers.ts';

const baseURL = inject('baseURL');

/** Current epoch as shown in the run bar. */
async function epochOf(page: Page): Promise<number> {
  const text = (await page.locator('[data-epoch]').textContent()) ?? '';
  return Number(text.replace(/[^\d/]/g, '').split('/')[0]);
}

/** On phones the settings are tabs; open one so its fields are visible. */
async function showTab(page: Page, name: string) {
  const tab = page.getByRole('tab', { name, exact: true });
  if (await tab.isVisible()) await tab.click();
}

describe.each(targets)('$name', (target) => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await target.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  test('trains, pauses and stays clean (no errors, CSP violations or third-party requests)', async () => {
    const { context, page, problems, external } = await openPage(browser, target, baseURL);
    await page.goto('./playground/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Play' }).click();
    await expect.poll(() => epochOf(page), { timeout: 15000 }).toBeGreaterThan(50);
    await page.getByRole('button', { name: 'Pause' }).click();
    const paused = await epochOf(page);
    await page.waitForTimeout(400);
    expect(await epochOf(page)).toBe(paused);
    expect(await page.getByRole('img', { name: /Plot of the target function/ }).isVisible()).toBe(
      true,
    );
    expect(problems).toEqual([]);
    expect(external).toEqual([]);
    await context.close();
  });

  test('explains formula mistakes and disables play', async () => {
    const { context, page } = await openPage(browser, target, baseURL);
    await page.goto('./playground/');
    const input = page.getByRole('textbox', { name: 'f(x) =' });
    await input.fill('sin x');
    await expect
      .poll(() => page.getByText('Write sin(…) with parentheses.').isVisible())
      .toBe(true);
    expect(await page.getByRole('button', { name: 'Play' }).isDisabled()).toBe(true);
    await input.fill('x sin(x)');
    await expect.poll(() => page.getByRole('button', { name: 'Play' }).isEnabled()).toBe(true);
    await context.close();
  });

  test('share links rebuild the experiment', async () => {
    const { context, page } = await openPage(browser, target, baseURL);
    await page.goto('./playground/');
    await page.getByRole('textbox', { name: 'f(x) =' }).fill('exp(-x^2) cos(5x)');
    await showTab(page, 'Models');
    // the editor starts closed
    expect(await page.getByRole('spinbutton', { name: 'Neurons in layer 1' }).count()).toBe(0);
    await page.getByRole('button', { name: 'Edit N1' }).click();
    await page.getByRole('spinbutton', { name: 'Neurons in layer 1' }).fill('17');
    await page.getByRole('spinbutton', { name: 'Neurons in layer 1' }).press('Tab');
    await page.getByRole('button', { name: /Share/ }).click();
    await expect.poll(() => page.url()).toContain('#s=');
    const link = page.url();
    const fresh = await context.newPage();
    await fresh.goto(link);
    await expect
      .poll(() => fresh.getByRole('textbox', { name: 'f(x) =' }).inputValue())
      .toBe('exp(-x^2) cos(5x)');
    await showTab(fresh, 'Models');
    await fresh.getByRole('button', { name: 'Edit N1' }).click();
    expect(await fresh.getByRole('spinbutton', { name: 'Neurons in layer 1' }).inputValue()).toBe(
      '17',
    );
    await context.close();
  });

  test('preset links and bad links', async () => {
    const { context, page } = await openPage(browser, target, baseURL);
    await page.goto('./playground/#preset=sine-gap');
    await expect
      .poll(() => page.getByRole('textbox', { name: 'f(x) =' }).inputValue())
      .toBe('sin(3x)');
    await page.goto('./playground/#s=not-a-real-link');
    await page.reload();
    await expect
      .poll(() => page.getByText('This link could not be read').first().isVisible())
      .toBe(true);
    await context.close();
  });

  test('races several models on one clock, and replay shows exactly what was shown live', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto('./playground/#preset=race-activations', { waitUntil: 'networkidle' });
    const rows = page.locator('table tbody tr');
    await expect.poll(() => rows.count()).toBe(3);
    await page.getByRole('button', { name: 'Play' }).click();
    await expect.poll(() => epochOf(page), { timeout: 20000 }).toBeGreaterThan(200);
    await page.getByRole('button', { name: 'Pause' }).click();
    await page.waitForTimeout(300);
    const at = await epochOf(page);
    const live = await rows.allTextContents();
    expect(live.every((r) => /\d\.\d{3}/.test(r))).toBe(true);
    // keep training, then rewind to the same epoch
    await page.getByRole('button', { name: 'Play' }).click();
    await expect.poll(() => epochOf(page), { timeout: 20000 }).toBeGreaterThan(at + 100);
    await page.getByRole('slider', { name: 'Epoch shown' }).fill(String(at));
    expect(await epochOf(page)).toBe(at);
    expect(await rows.allTextContents()).toEqual(live);
    expect(await page.getByRole('button', { name: 'Pause' }).count()).toBe(0);
    await page.getByRole('button', { name: 'Live' }).click();
    expect(await epochOf(page)).toBeGreaterThan(at + 100);
    expect(problems).toEqual([]);
    await context.close();
  });

  test('adds a model to the race', async () => {
    const { context, page } = await openPage(browser, target, baseURL);
    await page.goto('./playground/', { waitUntil: 'networkidle' });
    await showTab(page, 'Models');
    const rows = page.locator('table tbody tr');
    await expect.poll(() => rows.count()).toBe(1);
    await page.getByRole('button', { name: 'Add model' }).click();
    await expect.poll(() => rows.count()).toBe(2);
    // adding opens the settings of the new model, and only those
    expect(await page.getByRole('button', { name: 'Edit N2' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(await page.getByRole('button', { name: 'Edit N1' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    await page.getByRole('button', { name: 'Edit N2' }).click();
    expect(await page.getByRole('spinbutton', { name: 'Neurons in layer 1' }).count()).toBe(0);
    await context.close();
  });

  test('epochs: slider steps and exact numbers', async () => {
    const { context, page } = await openPage(browser, target, baseURL);
    await page.goto('./playground/', { waitUntil: 'networkidle' });
    await showTab(page, 'Train');
    const field = page.getByRole('spinbutton', { name: 'Epochs' });
    await page.getByRole('slider', { name: 'Epochs (slider)' }).fill('8');
    expect(await field.inputValue()).toBe('1000');
    await field.fill('1234');
    await field.press('Tab');
    expect(await page.locator('[data-epoch]').textContent()).toContain('1,234');
    await context.close();
  });

  test('version 1 links still open', async () => {
    const { context, page } = await openPage(browser, target, baseURL);
    await page.goto('./playground/');
    const code = await page.evaluate(async () => {
      const v1 = {
        v: 1,
        expr: 'x^2',
        domain: [-2, 2],
        n: 50,
        noise: { kind: 'none' },
        seed: 3,
        valFraction: 0.2,
        bands: [],
        epochs: 500,
        model: {
          kind: 'mlp',
          hidden: [23],
          activations: ['tanh'],
          optimizer: { kind: 'adam', lr: 0.01 },
          loss: { kind: 'mse' },
        },
      };
      const stream = new Blob([JSON.stringify(v1)])
        .stream()
        .pipeThrough(new CompressionStream('deflate-raw'));
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    });
    await page.goto(`./playground/#s=${code}`);
    await page.reload();
    await expect.poll(() => page.getByRole('textbox', { name: 'f(x) =' }).inputValue()).toBe('x^2');
    await showTab(page, 'Models');
    await page.getByRole('button', { name: 'Edit N1' }).click();
    expect(await page.getByRole('spinbutton', { name: 'Neurons in layer 1' }).inputValue()).toBe(
      '23',
    );
    expect(await page.getByRole('spinbutton', { name: 'Weight seed' }).inputValue()).toBe('3');
    await context.close();
  });

  test('playground has no horizontal scroll, even with stacked races', async () => {
    const { context, page } = await openPage(browser, target, baseURL);
    await page.goto('./playground/#preset=race-width', { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });

  test('lesson: predict, race, reveal', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto('./lessons/activations-and-extrapolation/', { waitUntil: 'networkidle' });
    await page.getByRole('radio', { name: 'tanh' }).click();
    await page.getByRole('button', { name: 'Run the race' }).click();
    await expect
      .poll(() => page.getByText(/Well spotted|Not this time/).isVisible(), { timeout: 30000 })
      .toBe(true);
    expect(problems).toEqual([]);
    await context.close();
  });
});
