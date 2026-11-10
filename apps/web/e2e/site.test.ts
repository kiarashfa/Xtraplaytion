import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, test } from 'vitest';
import { GALLERY } from '../src/lib/gallery.ts';
import { hydrated, openPage, targets } from './browsers.ts';

const baseURL = inject('baseURL');
const LINKS = ['Playground', 'Lessons', 'Gallery', 'Library', 'About'];

/** Non-background pixels in a canvas (it is drawn, not blank). */
const inked = (page: Page, selector: string) =>
  page.locator(selector).evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d');
    if (!ctx || !c.width) return 0;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++;
    return n;
  });

describe.each(targets)('$name', (target) => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await target.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  test('header links every section (a menu on phones)', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto('./gallery/', { waitUntil: 'networkidle' });
    const menu = page.locator('[data-nav-menu] summary');
    const phone = await menu.isVisible();
    if (phone) {
      await menu.click();
      const nav = page.locator('[data-nav-menu] nav');
      expect(await nav.getByRole('link').allTextContents()).toEqual(LINKS);
      expect(await nav.getByRole('link', { name: 'Gallery' }).getAttribute('aria-current')).toBe(
        'page',
      );
      await page.keyboard.press('Escape');
      expect(await page.locator('[data-nav-menu]').getAttribute('open')).toBeNull();
    } else {
      const nav = page.getByRole('navigation', { name: 'Main' });
      expect((await nav.getByRole('link').allTextContents()).map((s) => s.trim())).toEqual(LINKS);
    }
    expect(problems).toEqual([]);
    await context.close();
  });

  test('gallery shows finished races and opens them by permalink', async () => {
    const { context, page, problems, external } = await openPage(browser, target, baseURL);
    await page.goto('./gallery/', { waitUntil: 'networkidle' });
    await hydrated(page);
    expect(await page.locator('[data-gallery]').count()).toBe(GALLERY.length);
    const first = GALLERY[1].id;
    await page.locator(`[data-thumb=${first}]`).scrollIntoViewIfNeeded();
    await expect
      .poll(() => inked(page, `[data-thumb=${first}]`), { timeout: 15000 })
      .toBeGreaterThan(1000);
    await page
      .locator(`[data-gallery=${first}]`)
      .getByRole('link', { name: 'Open the race' })
      .click();
    await page.waitForURL(`**/playground/#preset=${first}`);
    await expect.poll(() => page.locator('[data-epoch]').first().isVisible()).toBe(true);
    expect(problems).toEqual([]);
    expect(external).toEqual([]);
    await context.close();
  });

  test('about page explains privacy and reopens the cookie choice', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto('./about/#privacy', { waitUntil: 'networkidle' });
    expect(await page.getByRole('heading', { name: 'Privacy' }).isVisible()).toBe(true);
    await page.locator('main [data-consent-open]').click();
    await expect.poll(() => page.locator('[data-consent]').isVisible()).toBe(true);
    expect(
      await page
        .locator('[data-consent]')
        .getByRole('link', { name: 'Privacy' })
        .getAttribute('href'),
    ).toBe('/Xtraplaytion/about/#privacy');
    expect(problems).toEqual([]);
    await context.close();
  });

  test('pages have no horizontal scroll', async () => {
    const { context, page } = await openPage(browser, target, baseURL);
    for (const path of [
      './gallery/',
      './about/',
      './lessons/',
      './lessons/noise-overfitting-and-regularization/',
      './embed/#preset=sine-gap',
    ]) {
      await page.goto(path, { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
    await context.close();
  });
});
