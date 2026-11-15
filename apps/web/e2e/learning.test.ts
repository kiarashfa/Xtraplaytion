// The learning record: a lesson marks itself learned once its race finished and the reader
// reached the end (with undo), the first guess is remembered, the lessons list and the home
// page continue from there, gallery favorites and opened races, the profile card, and the save
// file carries all of it.
import { readFile } from 'node:fs/promises';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, test } from 'vitest';
import { hydrated, openPage, targets } from './browsers.ts';

const baseURL = inject('baseURL');
const LESSON = './lessons/where-to-put-training-data/';

describe.each(targets)('$name', (target) => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await target.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  test('a finished lesson marks itself learned, remembers the guess, and can be undone', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto(LESSON, { waitUntil: 'networkidle' });
    await hydrated(page);
    const box = page.locator('[data-lesson-progress]');
    const status = box.locator('[data-progress-text]');
    await expect.poll(() => status.textContent()).toContain('0 of 1 finished');

    const race = page.locator('[data-data-race]');
    await race.getByRole('radio').nth(2).click();
    await race.getByRole('button', { name: 'Run the race' }).click();
    await expect
      .poll(() => race.getByText(/Well spotted|Not this time/).textContent(), { timeout: 200_000 })
      .toMatch(/^Well spotted/);
    // Not learned until the reader reaches the end of the lesson.
    expect(await status.textContent()).toContain('1 of 1 finished');
    await box.scrollIntoViewIfNeeded();
    await expect.poll(() => status.textContent()).toContain('1 of 8 lessons learned');
    expect(await box.locator('[data-progress-icon]').getAttribute('data-learned')).toBe('');

    // Undo, then mark again by hand.
    await box.locator('[data-progress-unmark]').click();
    await expect.poll(() => status.textContent()).toContain('Not marked as learned');
    await box.locator('[data-progress-mark]').click();
    await expect.poll(() => status.textContent()).toContain('Learned on');

    // A later visit shows the first guess.
    await page.reload({ waitUntil: 'networkidle' });
    await hydrated(page);
    await expect
      .poll(() => page.locator('[data-past-guess]').textContent())
      .toMatch(/Your first guess here was .*, and it was right\./);

    // The lessons list and the home page continue from here.
    await page.goto('./lessons/', { waitUntil: 'networkidle' });
    await expect
      .poll(() => page.locator('[data-progress-count]').textContent())
      .toBe('1 of 8 lessons learned');
    const learned = page.locator('[data-lesson-card]:has([data-learned-badge]:not([hidden]))');
    expect(await learned.count()).toBe(1);
    expect(await learned.getAttribute('data-lesson-card')).toBe('where-to-put-training-data');
    expect(await page.locator('[data-continue]').textContent()).toContain('lesson 1');
    await page.goto('./', { waitUntil: 'networkidle' });
    await expect
      .poll(() => page.locator('[data-continue-lesson]').textContent())
      .toContain('Continue: lesson 1');
    expect(problems).toEqual([]);
    await context.close();
  }, 300_000);

  test('gallery favorites and opened races show on the profile and travel in the save file', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto('./gallery/', { waitUntil: 'networkidle' });
    const card = page.locator('[data-gallery]').first();
    const id = await card.getAttribute('data-gallery');
    const title = (await card.locator('h2').textContent())?.trim() ?? '';
    await card.locator('[data-fav]').click();
    expect(await card.locator('[data-fav]').getAttribute('aria-pressed')).toBe('true');
    await card.getByRole('link', { name: 'Open the race' }).click();
    await page.waitForURL(/playground/);
    await page.goto('./gallery/', { waitUntil: 'networkidle' });
    await expect
      .poll(() => page.locator(`[data-gallery="${id}"] [data-opened-badge]`).isVisible())
      .toBe(true);
    expect(
      await page.locator(`[data-gallery="${id}"] [data-fav]`).getAttribute('aria-pressed'),
    ).toBe('true');

    // Learning alone is enough for a profile page (no welcome panel).
    await page.goto('./user/', { waitUntil: 'networkidle' });
    await hydrated(page);
    const learning = page.locator('[data-user-learning]');
    await learning.waitFor();
    expect(await learning.locator('[data-learning-favorites]').textContent()).toContain(title);
    expect(await learning.textContent()).toContain('You opened 1 of');
    expect(await learning.locator('[data-learning-continue]').textContent()).toContain(
      'Start the first lesson',
    );

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-user-download]').click(),
    ]);
    const save = JSON.parse(await readFile(await download.path(), 'utf8'));
    expect(save.learning.favorites[id ?? ''].on).toBe(true);
    expect(Object.keys(save.learning.opened)).toEqual([id]);

    // Another browser: opening the save brings the learning record.
    const other = await openPage(browser, target, baseURL);
    await other.page.goto('./user/', { waitUntil: 'networkidle' });
    await hydrated(other.page);
    await other.page.locator('[data-user-file]').setInputFiles(await download.path());
    await expect
      .poll(() => other.page.locator('[data-user-notice]').textContent())
      .toContain('your learning progress');
    await expect
      .poll(() => other.page.locator('[data-learning-favorites]').textContent())
      .toContain(title);
    expect(problems).toEqual([]);
    expect(other.problems).toEqual([]);
    await other.context.close();
    await context.close();
  }, 120_000);
});
