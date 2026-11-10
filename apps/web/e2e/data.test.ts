// Drawn and imported targets, and saving: links, files and the library must bring back
// exactly the same CPU runs.
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, test } from 'vitest';
import { openPage, targets } from './browsers.ts';

const baseURL = inject('baseURL');

async function showTab(page: Page, name: string) {
  const tab = page.getByRole('tab', { name, exact: true });
  if (await tab.isVisible()) await tab.click();
}

/** 120 days of a wave on a slope: large x, so networks need the rescaling. */
const CSV =
  'day,value\n' +
  Array.from({ length: 120 }, (_, i) => `${i},${(Math.sin(i / 8) * 3 + i / 20).toFixed(3)}`).join(
    '\n',
  );

async function setEpochs(page: Page, n: number) {
  await showTab(page, 'Train');
  await page.getByRole('spinbutton', { name: 'Epochs' }).fill(String(n));
  await page.getByRole('spinbutton', { name: 'Epochs' }).press('Tab');
}

/** Plays the race to the end and returns the leaderboard rows. */
async function race(page: Page, epochs: number): Promise<string[]> {
  await page.getByRole('button', { name: 'Play' }).click();
  await expect
    .poll(() => page.getByText(`Finished ${epochs.toLocaleString('en')} epochs.`).count(), {
      timeout: 60000,
    })
    .toBeGreaterThan(0);
  return page.locator('table tbody tr').allTextContents();
}

/** Imported data, CPU, a network and a polynomial, few epochs. */
async function setUpImported(page: Page) {
  await page.goto('./playground/', { waitUntil: 'networkidle' });
  await showTab(page, 'Target');
  await page.getByRole('tab', { name: 'Your data', exact: true }).click();
  await page.locator('[data-import-text]').fill(CSV);
  await page.locator('[data-import-use]').click();
  await expect
    .poll(() => page.locator('[data-import-status]').textContent())
    .toContain('120 points');
  await setEpochs(page, 300);
  await page.locator('[data-backend-choice="cpu"]').click();
  await showTab(page, 'Models');
  await page.getByRole('button', { name: 'Add model' }).click();
  await page.getByRole('button', { name: /^Polynomial/ }).click();
  await expect.poll(() => page.locator('table tbody tr').count()).toBe(2);
  await page.waitForTimeout(300); // debounced restart
}

const nums = (rows: string[]) => rows.flatMap((r) => (r.match(/\d+\.\d{3}/g) ?? []).map(Number));

describe.each(targets)('$name', (target) => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await target.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  test('a drawing becomes the target, trains, and survives a link', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto('./playground/', { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Draw', exact: true }).click();
    const canvas = page.locator('canvas').first();
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no plot');
    const X = (t: number) => box.x + 50 + t * (box.width - 70);
    const Y = (v: number) => box.y + box.height / 2 - v * box.height * 0.25;
    await page.mouse.move(X(0), Y(0));
    await page.mouse.down();
    for (let i = 0; i <= 40; i++) await page.mouse.move(X(i / 40), Y(Math.sin(i / 5)));
    await page.mouse.up();
    await expect.poll(() => page.locator('[data-drawn-range]').count()).toBe(1);
    await setEpochs(page, 200);
    const rows = await race(page, 200);
    expect(rows[0]).toMatch(/\d\.\d{3}/);
    await page.getByRole('button', { name: /Share/ }).click();
    await page.getByRole('button', { name: /Copy link/ }).click();
    await expect.poll(() => page.url()).toContain('#s=');
    const range = await page.locator('[data-drawn-range]').textContent();
    const fresh = await context.newPage();
    await fresh.goto(page.url());
    await expect.poll(() => fresh.locator('[data-drawn-range]').textContent()).toBe(range);
    expect(problems).toEqual([]);
    await context.close();
  }, 90_000);

  test('imported data: held-out points score the rest, and bad input explains itself', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await setUpImported(page);
    const rows = await race(page, 300);
    // Training on the first 70%: the rest is "beyond", scored on held-out points.
    expect(nums(rows.slice(0, 1))).toHaveLength(3); // inside, validation, beyond (no gap)
    expect(await page.getByText('error on held-out points').count()).toBe(1);
    // Too many points for a link: the menu says so and offers the file.
    await showTab(page, 'Target');
    // The settings column scrolls inside a sticky container, which Playwright does not
    // scroll back up by itself.
    await page.locator('[data-import-text]').evaluate((el) => el.scrollIntoView());
    // A big paste is set directly: Playwright's fill() is very slow with thousands of lines.
    const big = Array.from({ length: 3000 }, (_, i) => `${i / 7},${Math.cos(i / 50) + i / 3001}`);
    await page.locator('[data-import-text]').evaluate((el, text) => {
      (el as HTMLTextAreaElement).value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, big.join('\n'));
    await page.locator('[data-import-use]').click();
    await expect
      .poll(() => page.locator('[data-import-status]').textContent())
      .toContain('3,000 points');
    await page.getByRole('button', { name: /Share/ }).click();
    await page.getByRole('button', { name: /Copy link/ }).click();
    await expect.poll(() => page.locator('[data-link-too-big]').count()).toBe(1);
    expect(page.url()).not.toContain('#s=');
    await page.keyboard.press('Escape');
    await page.locator('[data-import-text]').fill('hello\nworld');
    await page.locator('[data-import-use]').click();
    await expect
      .poll(() => page.locator('[data-import-error]').textContent())
      .toContain('No numbers');
    expect(problems).toEqual([]);
    await context.close();
  }, 90_000);

  test('link, file and library round trips reproduce identical CPU runs', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await setUpImported(page);
    const original = await race(page, 300);

    // 1. Link
    await page.getByRole('button', { name: /Share/ }).click();
    await page.getByRole('button', { name: /Copy link/ }).click();
    await expect.poll(() => page.url()).toContain('#s=');
    const viaLink = await context.newPage();
    await viaLink.goto(page.url(), { waitUntil: 'networkidle' });
    await expect.poll(() => viaLink.locator('table tbody tr').count()).toBe(2);
    await viaLink.waitForTimeout(300);
    expect(await race(viaLink, 300)).toEqual(original);
    await viaLink.close();

    // 2. File
    await page.getByRole('button', { name: /Share/ }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Download a file/ }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.xtraplaytion\.json$/);
    const path = await download.path();
    const viaFile = await context.newPage();
    await viaFile.goto('./playground/', { waitUntil: 'networkidle' });
    await viaFile.locator('[data-open-file]').setInputFiles(path);
    await expect.poll(() => viaFile.locator('table tbody tr').count()).toBe(2);
    await viaFile.waitForTimeout(300);
    expect(await race(viaFile, 300)).toEqual(original);
    await viaFile.close();

    // 3. Library: the saved results come back, and training again gives the same run.
    await page.getByRole('button', { name: /^Save/ }).click();
    await page.locator('[data-save-name]').fill('Round trip');
    await page.locator('[data-save-confirm]').click();
    await expect.poll(() => page.locator('[data-save-done]').count()).toBe(1);
    await page.goto('./library/', { waitUntil: 'networkidle' });
    await expect.poll(() => page.locator('[data-lib-entry]').count()).toBe(1);
    expect(await page.locator('[data-lib-entry]').textContent()).toContain('Round trip');
    await page.locator('[data-lib-open]').click();
    await expect.poll(() => page.locator('[data-backend]').textContent()).toContain('Saved');
    // Saved grids are stored compactly: the scores agree to display precision (or nearly).
    await expect
      .poll(async () => nums(await page.locator('table tbody tr').allTextContents()).length)
      .toBe(nums(original).length);
    const saved = nums(await page.locator('table tbody tr').allTextContents());
    saved.forEach((v, i) => expect(Math.abs(v - nums(original)[i])).toBeLessThan(0.0025));
    await page.getByRole('button', { name: 'Train again' }).click();
    await page.waitForTimeout(300);
    expect(await race(page, 300)).toEqual(original);

    // Duplicate and delete in the library.
    await page.goto('./library/', { waitUntil: 'networkidle' });
    await page.locator('[data-lib-duplicate]').click();
    await expect.poll(() => page.locator('[data-lib-entry]').count()).toBe(2);
    await page.locator('[data-lib-delete]').first().click();
    await page.locator('[data-lib-confirm-delete]').click();
    await expect.poll(() => page.locator('[data-lib-entry]').count()).toBe(1);
    expect(problems).toEqual([]);
    await context.close();
  }, 180_000);

  test('library: empty state, and damaged files are refused', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto('./library/', { waitUntil: 'networkidle' });
    await expect.poll(() => page.locator('[data-lib-empty]').count()).toBe(1);
    await page.locator('[data-lib-file]').setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"format":"xtraplaytion-experiment","version":1,"state":{"v":4}}'),
    });
    await expect.poll(() => page.locator('[data-lib-notice]').textContent()).toContain('damaged');
    await page.locator('[data-lib-file]').setInputFiles({
      name: 'other.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"hello":1}'),
    });
    await expect
      .poll(() => page.locator('[data-lib-notice]').textContent())
      .toContain('not an Xtraplaytion experiment');
    expect(problems).toEqual([]);
    await context.close();
  });
});
