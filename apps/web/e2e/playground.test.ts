import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, test } from 'vitest';
import { openPage, targets } from './browsers.ts';

const baseURL = inject('baseURL');

/** Current epoch as shown in the run bar. */
async function epochOf(page: Page): Promise<number> {
  const text = (await page.locator('p.font-mono').first().textContent()) ?? '';
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
    await showTab(page, 'Model');
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
    await showTab(fresh, 'Model');
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

  test('playground has no horizontal scroll', async () => {
    const { context, page } = await openPage(browser, target, baseURL);
    await page.goto('./playground/', { waitUntil: 'networkidle' });
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
