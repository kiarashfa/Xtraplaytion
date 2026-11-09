import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, test } from 'vitest';
import { hydrated, openPage, targets } from './browsers.ts';

const baseURL = inject('baseURL');

describe.each(targets)('$name', (target) => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await target.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  test('home page renders without errors, CSP violations or third-party requests', async () => {
    const { context, page, problems, external } = await openPage(browser, target, baseURL);
    const res = await page.goto('./', { waitUntil: 'networkidle' });
    expect(res?.status()).toBe(200);
    expect(await page.title()).toBe('Xtraplaytion');
    expect(await page.getByRole('heading', { level: 1 }).isVisible()).toBe(true);
    expect(await page.getByRole('img', { name: /Illustration/ }).isVisible()).toBe(true);
    expect(problems).toEqual([]);
    expect(external).toEqual([]);
    await context.close();
  });

  test('theme toggle switches and persists', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto('./');
    await hydrated(page);
    const theme = () => page.getAttribute('html', 'data-theme');
    await page.getByRole('radio', { name: 'Dark' }).check({ force: true });
    expect(await theme()).toBe('dark');
    await page.reload();
    await hydrated(page);
    expect(await theme()).toBe('dark');
    expect(await page.getByRole('radio', { name: 'Dark' }).isChecked()).toBe(true);
    await page.getByRole('radio', { name: 'Light' }).check({ force: true });
    expect(await theme()).toBe('light');
    expect(problems).toEqual([]);
    await context.close();
  });

  test('system theme follows the OS setting', async () => {
    const { context, page } = await openPage(browser, target, baseURL, { colorScheme: 'dark' });
    await page.goto('./');
    await hydrated(page);
    expect(await page.getAttribute('html', 'data-theme')).toBe('dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => page.getAttribute('html', 'data-theme')).toBe('light');
    await context.close();
  });

  test('unknown paths show the 404 page', async () => {
    const { context, page } = await openPage(browser, target, baseURL);
    const res = await page.goto('./this-page-does-not-exist');
    expect(res?.status()).toBe(404);
    expect(await page.getByRole('heading', { level: 1 }).textContent()).toBe('Page not found');
    await page.getByRole('link', { name: 'Go to the home page' }).click();
    await page.waitForURL(baseURL);
    await context.close();
  });

  test('third-party notices are published', async () => {
    const { context } = await openPage(browser, target, baseURL);
    const res = await context.request.get('THIRD_PARTY.md');
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('# Third-party notices');
    await context.close();
  });

  test('layout has no horizontal scroll', async () => {
    const { context, page } = await openPage(browser, target, baseURL);
    await page.goto('./');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });
});
