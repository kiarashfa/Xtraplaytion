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
    await page.getByRole('button', { name: /Copy link/ }).click();
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
    // The first canvas of a fresh browser can take seconds (GPU process start-up).
    await expect.poll(() => rows.count(), { timeout: 20000 }).toBe(3);
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
    await page.getByRole('button', { name: /^Neural network/ }).click();
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

  test('classical models race with a network, build up, then hold, and survive a share link', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto('./playground/', { waitUntil: 'networkidle' });
    await showTab(page, 'Train');
    await page.getByRole('spinbutton', { name: 'Epochs' }).fill('400');
    await page.getByRole('spinbutton', { name: 'Epochs' }).press('Tab');
    await showTab(page, 'Models');
    for (const kind of ['Polynomial', 'Gaussian process', 'Decision tree']) {
      await page.getByRole('button', { name: 'Add model' }).click();
      await page.getByRole('button', { name: new RegExp(`^${kind}`) }).click();
    }
    // A forest instead of one tree; a degree-11 polynomial.
    await page.getByRole('combobox', { name: 'Type' }).selectOption('forest');
    await page.getByRole('button', { name: 'Edit P2' }).click();
    await page.getByRole('spinbutton', { name: 'Degree' }).fill('11');
    await page.getByRole('spinbutton', { name: 'Degree' }).press('Tab');
    const rows = page.locator('table tbody tr');
    await expect
      .poll(() => rows.allTextContents())
      .toEqual([
        expect.stringContaining('N1'),
        expect.stringContaining('P2'),
        expect.stringContaining('G3'),
        expect.stringContaining('T4'),
      ]);
    await page.getByRole('button', { name: 'Play' }).click();
    await expect
      .poll(() => page.getByText('Finished 400 epochs.').count(), { timeout: 60000 })
      .toBeGreaterThan(0);
    const done = await rows.allTextContents();
    expect(done.some((r) => r.includes('building'))).toBe(false);
    expect(done[1]).toMatch(/P2.*12$/); // degree 11: 12 coefficients
    // While building, the polynomial is simpler (lower degree) than at the end.
    await page.getByRole('slider', { name: 'Epoch shown' }).fill('20');
    await expect.poll(() => rows.nth(1).textContent()).toContain('building');
    await page.getByRole('button', { name: 'Live' }).click();
    await page.getByRole('button', { name: /Share/ }).click();
    await page.getByRole('button', { name: /Copy link/ }).click();
    await expect.poll(() => page.url()).toContain('#s=');
    const fresh = await context.newPage();
    await fresh.goto(page.url());
    await expect.poll(() => fresh.locator('table tbody tr').count()).toBe(4);
    await showTab(fresh, 'Models');
    await fresh.getByRole('button', { name: 'Edit P2' }).click();
    expect(await fresh.getByRole('spinbutton', { name: 'Degree' }).inputValue()).toBe('11');
    expect(await fresh.locator('[data-model="T4"]').textContent()).toContain('50 trees');
    expect(problems).toEqual([]);
    await context.close();
  }, 90_000);

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

  test('train on: Auto, CPU or GPU, and the badge tells which one runs', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto('./playground/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Play' }).click();
    await expect.poll(() => epochOf(page), { timeout: 15000 }).toBeGreaterThan(20);
    const badge = page.locator('[data-backend]');
    // Auto: the GPU where this browser has a usable one, otherwise the processor.
    const where = await badge.getAttribute('data-backend');
    expect(['gpu', 'cpu']).toContain(where);
    const tagged = await page.locator('table tbody tr', { hasText: 'GPU' }).count();
    expect(tagged).toBe(where === 'gpu' ? 1 : 0);
    await showTab(page, 'Train');
    await page.locator('[data-backend-choice=cpu]').click();
    await expect.poll(() => badge.getAttribute('data-backend')).toBe('cpu');
    expect(await page.locator('[data-backend-hint]').textContent()).toContain('identical');
    await page.getByRole('button', { name: 'Play' }).click();
    await expect.poll(() => epochOf(page), { timeout: 15000 }).toBeGreaterThan(20);
    expect(await badge.textContent()).toContain('CPU · exact');
    expect(await page.locator('table tbody tr', { hasText: 'GPU' }).count()).toBe(0);
    expect(problems).toEqual([]);
    await context.close();
  });

  test('a heavy preset plays its recording where training would be slow', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto('./playground/#preset=race-width', { waitUntil: 'networkidle' });
    // On the processor, a million-parameter network takes far too long: the recording plays.
    await showTab(page, 'Train');
    await page.locator('[data-backend-choice=cpu]').click();
    // Changing the backend restarts the race after a short debounce. Without WebGPU the
    // recording is already showing, so let that restart happen before pressing play.
    await page.waitForTimeout(500);
    const notice = page.locator('[data-recorded-notice]');
    await expect.poll(() => notice.isVisible(), { timeout: 10000 }).toBe(true);
    expect(await page.locator('[data-backend]').getAttribute('data-backend')).toBe('recorded');
    // Playback moves a fixed number of epochs per animation frame; CI browsers draw few
    // frames per second, so play at the top speed where the slider is shown.
    const speedSlider = page.locator('label:has-text("Speed") input[type=range]');
    if (await speedSlider.isVisible()) await speedSlider.fill('7');
    await page.getByRole('button', { name: 'Play' }).click();
    await expect.poll(() => epochOf(page), { timeout: 45000 }).toBe(1600);
    const rows = await page.locator('table tbody tr').allTextContents();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => /\d\.\d{3}/.test(r))).toBe(true);
    expect(rows[2]).toContain('1,004,001');
    // Replay works on recordings too.
    await page.getByRole('slider', { name: 'Epoch shown' }).fill('400');
    expect(await epochOf(page)).toBe(400);
    await page.getByRole('button', { name: 'Train it yourself' }).click();
    await expect.poll(() => notice.isVisible()).toBe(false);
    await expect
      .poll(() => page.locator('[data-backend]').getAttribute('data-backend'))
      .toBe('cpu');
    expect(await epochOf(page)).toBe(0);
    expect(problems).toEqual([]);
    await context.close();
  }, 90_000);

  test('lesson 2: a recorded race and a live one, both revealed', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto('./lessons/width-depth-and-spectral-bias/', { waitUntil: 'networkidle' });
    for (const id of ['race-width', 'race-depth']) {
      const race = page.locator(`[data-lesson-race=${id}]`);
      await race.getByRole('radio').nth(1).click();
      await race.getByRole('button', { name: 'Run the race' }).click();
      await expect
        .poll(() => race.getByText(/Well spotted|Not this time/).isVisible(), { timeout: 60000 })
        .toBe(true);
    }
    expect(await page.locator('[data-lesson-race=race-width]').getByText('Recorded').count()).toBe(
      1,
    );
    expect(problems).toEqual([]);
    await context.close();
  }, 90_000);

  // Lesson races train live on the CPU; CI WebKit (2-core Linux runner) is several times
  // slower than a desktop, so these waits are generous.
  test('lesson 4: classical races, revealed', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto('./lessons/classical-models-out-of-range/', { waitUntil: 'networkidle' });
    for (const id of ['classic-beyond', 'classic-runge']) {
      const race = page.locator(`[data-lesson-race=${id}]`);
      await race.getByRole('radio').nth(1).click();
      await race.getByRole('button', { name: 'Run the race' }).click();
      await expect
        .poll(() => race.getByText(/Well spotted|Not this time/).isVisible(), { timeout: 150000 })
        .toBe(true);
    }
    expect(problems).toEqual([]);
    await context.close();
  }, 330_000);

  // The lesson text says degree 7 and the strongest penalty win (measured on data seeds 7-9).
  test('lesson 3: overfitting races end as the lesson says', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto('./lessons/noise-overfitting-and-regularization/', {
      waitUntil: 'networkidle',
    });
    for (const [id, pick] of [
      ['overfit-poly', 1],
      ['overfit-net', 2],
    ] as const) {
      const race = page.locator(`[data-lesson-race=${id}]`);
      await race.getByRole('radio').nth(pick).click();
      await race.getByRole('button', { name: 'Run the race' }).click();
      await expect
        .poll(() => race.getByText(/Well spotted|Not this time/).textContent(), {
          timeout: 200000,
        })
        .toMatch(/^Well spotted/);
    }
    // Previous and next lessons are linked at the end.
    expect(await page.getByRole('link', { name: /Previous lesson/ }).getAttribute('href')).toMatch(
      /width-depth-and-spectral-bias\/$/,
    );
    expect(await page.getByRole('link', { name: /Next lesson/ }).getAttribute('href')).toMatch(
      /classical-models-out-of-range\/$/,
    );
    expect(problems).toEqual([]);
    await context.close();
  }, 420_000);

  test('lesson: predict, race, reveal', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto('./lessons/activations-and-extrapolation/', { waitUntil: 'networkidle' });
    await page.getByRole('radio', { name: 'tanh' }).click();
    await page.getByRole('button', { name: 'Run the race' }).click();
    await expect
      .poll(() => page.getByText(/Well spotted|Not this time/).isVisible(), { timeout: 120000 })
      .toBe(true);
    expect(problems).toEqual([]);
    await context.close();
  }, 150_000);
});
