import { mlp } from '@xtraplaytion/engine';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, test } from 'vitest';
import { encodeState, type ExperimentState } from '../src/lib/share.ts';
import { openPage, targets } from './browsers.ts';

const baseURL = inject('baseURL');

async function epochOf(page: Page): Promise<number> {
  const text = (await page.locator('[data-epoch]').textContent()) ?? '';
  return Number(text.replace(/[^\d/]/g, '').split('/')[0]);
}

const base: Omit<ExperimentState, 'models' | 'epochs'> = {
  v: 4,
  expr: 'sin(x) + 0.5 sin(2x)',
  domain: [-6, 6],
  n: 80,
  noise: { kind: 'none' },
  seed: 7,
  valFraction: 0.2,
  bands: [
    [-5, -1.5],
    [1, 4.5],
  ],
  layout: 'overlay',
  backend: 'cpu',
};

const link = async (s: ExperimentState) => `./playground/#s=${await encodeState(s)}`;

describe.each(targets)('$name', (target) => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await target.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  test('looks inside a ReLU network: neurons, kinks, waves, weights, loss map, replay', async () => {
    const { context, page, problems, external } = await openPage(browser, target, baseURL);
    await page.goto(
      await link({
        ...base,
        models: [
          {
            model: mlp({ hidden: [12, 12], optimizer: { kind: 'adam', lr: 0.01 } }),
            seed: 1,
            visible: true,
          },
        ],
        epochs: 300,
      }),
      { waitUntil: 'networkidle' },
    );
    await page.getByRole('button', { name: 'Play' }).click();
    await expect.poll(() => epochOf(page), { timeout: 60000 }).toBe(300);
    const card = page.locator('[data-insight]');
    await card.scrollIntoViewIfNeeded();
    await expect.poll(() => card.locator('[data-insight-neurons]').isVisible()).toBe(true);
    expect(await card.locator('[data-insight-neurons] li').count()).toBe(8);
    // Kinks: counted in the card and marked on the fit plot.
    await card.getByRole('tab', { name: 'Kinks' }).click();
    const kinks = Number(
      await card.locator('[data-insight-kinks]').getAttribute('data-insight-kinks'),
    );
    expect(kinks).toBeGreaterThan(3);
    expect(await page.locator('[data-legend-kinks]').isVisible()).toBe(true);
    await card.getByRole('tab', { name: 'Waves' }).click();
    expect(await card.locator('[data-insight-waves]').isVisible()).toBe(true);
    await card.getByRole('tab', { name: 'Weights' }).click();
    expect(await card.getByText('Layer 2 · 144 weights', { exact: false }).isVisible()).toBe(true);
    await card.getByRole('tab', { name: 'Loss map' }).click();
    await card.locator('[data-map-make]').click();
    await expect
      .poll(() => card.getByText(/41 × 41 points/).isVisible(), { timeout: 30000 })
      .toBe(true);
    expect(await card.getByText(/at epoch 300/).isVisible()).toBe(true);
    // The views follow the scrubber (weights are kept for small networks).
    await page.getByRole('slider', { name: 'Epoch shown' }).fill('40');
    await expect.poll(() => card.locator('[data-insight-at]').textContent()).toMatch(/epoch 40\b/);
    await card.getByRole('tab', { name: 'Kinks' }).click();
    expect(
      Number(await card.locator('[data-insight-kinks]').getAttribute('data-insight-kinks')),
    ).toBeGreaterThan(0);
    expect(problems).toEqual([]);
    expect(external).toEqual([]);
    await context.close();
  }, 120_000);

  test('averaged models show their spread; the card explains what it cannot show', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto(
      await link({
        ...base,
        models: [
          {
            model: mlp({
              hidden: [8, 8],
              activations: ['tanh', 'tanh'],
              optimizer: { kind: 'adam', lr: 0.01 },
            }),
            seed: 1,
            visible: true,
            copies: 3,
          },
          {
            model: { kind: 'spline', segments: 12, smoothing: 0.01 },
            seed: 2,
            visible: true,
            copies: 3,
          },
          {
            model: mlp({ hidden: [8], activations: ['tanh'] }),
            seed: 3,
            visible: true,
          },
        ],
        epochs: 200,
      }),
      { waitUntil: 'networkidle' },
    );
    await page.getByRole('button', { name: 'Play' }).click();
    await expect.poll(() => epochOf(page), { timeout: 60000 }).toBe(200);
    expect(await page.getByText('Copies disagree').first().isVisible()).toBe(true);
    const rows = await page.locator('table tbody tr').allTextContents();
    expect(rows[0]).toContain('N1 ×3');
    expect(rows[1]).toContain('S2 ×3');
    expect(rows.every((r) => /\d\.\d{3}/.test(r))).toBe(true);
    const card = page.locator('[data-insight]');
    await card.scrollIntoViewIfNeeded();
    expect(await card.locator('[data-insight-blocked]').textContent()).toContain(
      'average of 3 copies',
    );
    // Waves work for every model, also an averaged spline.
    await card.getByRole('button', { name: 'S2 ×3' }).click();
    await card.getByRole('tab', { name: 'Waves' }).click();
    expect(await card.locator('[data-insight-waves]').isVisible()).toBe(true);
    await card.getByRole('tab', { name: 'Neurons' }).click();
    expect(await card.locator('[data-insight-blocked]').textContent()).toContain('neural network');
    // A smooth network has no kinks.
    await card.getByRole('button', { name: 'N3' }).click();
    await card.getByRole('tab', { name: 'Kinks' }).click();
    expect(await card.locator('[data-insight-blocked]').textContent()).toContain('smooth');
    expect(problems).toEqual([]);
    await context.close();
  }, 120_000);
});
