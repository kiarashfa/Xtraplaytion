import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, test } from 'vitest';
import { CONSENT_KEY } from '../src/lib/consent.ts';
import { SITE } from '../src/site.config.ts';
import { openPage, targets } from './browsers.ts';

const baseURL = inject('baseURL');
const GA_ID = SITE.analytics.ga4MeasurementId;
const fromGoogle = (urls: string[]) => urls.filter((u) => /google/.test(new URL(u).hostname));

describe.each(targets)('$name', (target) => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await target.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  test('first visit shows the bar and loads nothing from Google', async () => {
    const { context, page, external, problems } = await openPage(browser, target, baseURL, {
      consent: null,
    });
    await page.goto('./', { waitUntil: 'networkidle' });
    const bar = page.getByRole('region', { name: 'Cookie consent' });
    await bar.waitFor();
    expect(await bar.isVisible()).toBe(true);
    expect(fromGoogle(external)).toEqual([]);
    expect(problems).toEqual([]);
    await context.close();
  });

  test('decline hides the bar for good and still loads nothing', async () => {
    const { context, page, external } = await openPage(browser, target, baseURL, {
      consent: null,
    });
    await page.goto('./');
    await page.getByRole('button', { name: 'Decline' }).click();
    expect(await page.getByRole('region', { name: 'Cookie consent' }).isVisible()).toBe(false);
    expect(await page.evaluate((k) => localStorage.getItem(k), CONSENT_KEY)).toBe('denied');
    await page.reload({ waitUntil: 'networkidle' });
    expect(await page.getByRole('region', { name: 'Cookie consent' }).isVisible()).toBe(false);
    expect(fromGoogle(external)).toEqual([]);
    await context.close();
  });

  test('accept loads GA4 without the fragment or query of the page', async () => {
    const { context, page, external } = await openPage(browser, target, baseURL, {
      consent: null,
    });
    await page.goto('./?q=private#experiment=private');
    await page.getByRole('button', { name: 'Accept' }).click();
    await expect.poll(() => fromGoogle(external).length).toBeGreaterThan(0);
    expect(fromGoogle(external)[0]).toContain(`googletagmanager.com/gtag/js?id=${GA_ID}`);
    const config = await page.evaluate(() =>
      (window as unknown as { dataLayer: IArguments[] }).dataLayer
        .map((args) => Array.from(args))
        .find((args) => args[0] === 'config'),
    );
    expect(config?.[1]).toBe(GA_ID);
    const fields = config?.[2] as Record<string, unknown>;
    expect(fields['page_location']).toBe(new URL(baseURL).href);
    expect(fields['allow_ad_personalization_signals']).toBe(false);
    await context.close();
  });

  test('cookie settings reopens the bar', async () => {
    const { context, page } = await openPage(browser, target, baseURL);
    await page.goto('./');
    const bar = page.getByRole('region', { name: 'Cookie consent' });
    expect(await bar.isVisible()).toBe(false);
    await page.getByRole('button', { name: 'Cookie settings' }).click();
    expect(await bar.isVisible()).toBe(true);
    await context.close();
  });
});
