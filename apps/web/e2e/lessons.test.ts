// Lessons 5-8: every race ends the way the lesson text says (measured on data seeds 7-9 on
// the CPU engine; the margins are wide enough for the GPU path too).
import type { Browser, Locator } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, test } from 'vitest';
import { openPage, targets } from './browsers.ts';

const baseURL = inject('baseURL');

async function guessAndRun(race: Locator, pick: number, timeout = 200_000) {
  await race.getByRole('radio').nth(pick).click();
  await race.getByRole('button', { name: 'Run the race' }).click();
  await expect
    .poll(() => race.getByText(/Well spotted|Not this time/).textContent(), { timeout })
    .toMatch(/^Well spotted/);
}

describe.each(targets)('$name', (target) => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await target.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  test('lesson 5: the middle learning rate and Adam win', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto('./lessons/loss-curves-and-the-learning-rate/', { waitUntil: 'networkidle' });
    const lr = page.locator('[data-lesson-race=lr-sweep]');
    // The cards say what differs.
    expect(await lr.getByRole('radio').allTextContents()).toEqual([
      expect.stringContaining('learning rate 0.0001'),
      expect.stringContaining('learning rate 0.01'),
      expect.stringContaining('learning rate 0.3'),
    ]);
    await guessAndRun(lr, 1);
    const opt = page.locator('[data-lesson-race=optimizers]');
    expect(await opt.getByRole('radio').nth(0).textContent()).toContain('SGD');
    await guessAndRun(opt, 2);
    expect(problems).toEqual([]);
    await context.close();
  }, 420_000);

  test('lesson 6: spread-out data gives the best curve over the whole plot', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto('./lessons/where-to-put-training-data/', { waitUntil: 'networkidle' });
    const race = page.locator('[data-data-race]');
    expect(await race.getByRole('radio').allTextContents()).toEqual([
      expect.stringContaining('160 training points'),
      expect.stringContaining('19 training points'),
      expect.stringContaining('19 training points'),
    ]);
    await guessAndRun(race, 2);
    // Three plots, and a table with both errors per layout.
    const rows = race.locator('[data-data-race-table] tbody tr');
    expect(await rows.count()).toBe(3);
    const whole = async (i: number) =>
      Number((await rows.nth(i).locator('td').nth(2).textContent()) ?? NaN);
    const inside = async (i: number) =>
      Number((await rows.nth(i).locator('td').nth(1).textContent()) ?? NaN);
    // The crowded layout is best inside its own range and worst over the whole plot.
    expect(await inside(0)).toBeLessThan(await inside(2));
    expect(await whole(0)).toBeGreaterThan(await whole(1));
    expect(await whole(1)).toBeGreaterThan(await whole(2));
    expect(problems).toEqual([]);
    await context.close();
  }, 420_000);

  test('lesson 7: the Gaussian process wins inside, the copies show their spread', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto('./lessons/ensembles-and-uncertainty/', { waitUntil: 'networkidle' });
    const race = page.locator('[data-lesson-race=ensemble]');
    expect(await race.getByRole('radio').nth(1).textContent()).toContain('×5');
    await guessAndRun(race, 2, 300_000);
    expect(problems).toEqual([]);
    await context.close();
  }, 420_000);

  test('lesson 8: each example curve has the winner the lesson names', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto('./lessons/draw-your-own-challenge/', { waitUntil: 'networkidle' });
    const game = page.locator('[data-draw-challenge]');
    const status = game.locator('[data-draw-status]');
    await expect.poll(() => status.textContent()).toContain('Draw a curve');
    expect(await game.getByRole('button', { name: 'Run the race' }).isDisabled()).toBe(true);
    for (const [example, winner] of [
      ['A V shape', 'N1'],
      ['An S-curve', 'N2'],
      ['A ramp', 'G3'],
    ] as const) {
      await game.getByRole('button', { name: example }).click();
      await page.waitForTimeout(300); // the race restarts after a short debounce
      await game.getByRole('button', { name: /Run the race|Run again/ }).click();
      await expect
        .poll(() => status.textContent(), { timeout: 200_000 })
        .toMatch(/continues your curve best/);
      expect(await status.textContent()).toContain(winner);
    }
    expect(problems).toEqual([]);
    await context.close();
  }, 600_000);
});
