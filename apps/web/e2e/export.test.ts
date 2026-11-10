import { mlp } from '@xtraplaytion/engine';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, test } from 'vitest';
import { encodeState, type ExperimentState } from '../src/lib/share.ts';
import { openPage, targets } from './browsers.ts';

const baseURL = inject('baseURL');

async function epochOf(page: Page): Promise<number> {
  const text = (await page.locator('[data-epoch]').first().textContent()) ?? '';
  return Number(text.replace(/[^\d/]/g, '').split('/')[0]);
}

const state: ExperimentState = {
  v: 4,
  expr: 'sin(3x)',
  domain: [-3, 3],
  n: 60,
  noise: { kind: 'none' },
  seed: 7,
  valFraction: 0.2,
  bands: [
    [-3, -1],
    [1, 3],
  ],
  models: [
    {
      model: mlp({ hidden: [10, 10], optimizer: { kind: 'adam', lr: 0.01 } }),
      seed: 1,
      visible: true,
    },
    {
      model: mlp({
        hidden: [10, 10],
        activations: ['tanh', 'tanh'],
        optimizer: { kind: 'adam', lr: 0.01 },
      }),
      seed: 1,
      visible: true,
    },
  ],
  epochs: 200,
  layout: 'stacked',
  backend: 'cpu',
};

/** Non-white pixels in the preview canvas (it is drawn, not blank). */
const inked = (page: Page) =>
  page.locator('[data-export-preview]').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data ?? [];
    let n = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] < 200 || d[i + 1] < 200) n++;
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

  test('exports the race as a video (or GIF) and a PNG', { timeout: 240000 }, async () => {
    const { context, page, problems, external } = await openPage(browser, target, baseURL);
    await page.goto(`./playground/#s=${await encodeState(state)}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Play' }).click();
    await expect.poll(() => epochOf(page), { timeout: 90000 }).toBe(200);

    await page.locator('[data-export]').click();
    const dialog = page.locator('[data-export-dialog]');
    await expect.poll(() => dialog.isVisible()).toBe(true);
    // The default title names the networks and typesets the formula.
    expect(await page.locator('[data-export-title]').inputValue()).toBe(
      'Neural networks learn $\\sin(3 x)$',
    );
    await expect.poll(() => inked(page), { timeout: 20000 }).toBeGreaterThan(500);
    for (const a of ['16:9', '1:1', '4:5', '9:16'])
      await page.locator(`[data-aspect="${a}"]`).click();

    // Short and small, so every engine finishes quickly.
    await dialog.locator('select').selectOption({ index: 1 });
    await dialog.locator('input[type=range]').fill('4');
    const video = await page.locator('[data-format="mp4"]').isEnabled();
    const webm = await page.locator('[data-format="webm"]').isEnabled();
    const format = video ? 'mp4' : webm ? 'webm' : 'gif';
    await page.locator(`[data-format="${format}"]`).click();
    await page.locator('[data-export-render]').click();
    const status = page.locator('[data-export-status]');
    await expect
      .poll(() => status.textContent(), { timeout: 120000 })
      .toMatch(/(MP4|WebM|GIF) ready, [\d.]+ (KB|MB)\./);
    if (format !== 'gif') {
      const meta = await page.locator('[data-export-video]').evaluate(
        (v: HTMLVideoElement) =>
          new Promise<number[]>((resolve) => {
            const done = () => resolve([v.videoWidth, v.videoHeight, Math.round(v.duration)]);
            if (v.readyState >= 1) done();
            else v.addEventListener('loadedmetadata', done);
          }),
      );
      expect(meta).toEqual([720, 1280, 4]);
    }
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-export-download]').click(),
    ]);
    expect(file.suggestedFilename()).toBe(`neural-networks-learn.${format}`);

    // A PNG of the epoch on screen, at full size.
    await page.getByRole('button', { name: 'Change settings' }).click();
    await page.locator('[data-format="png"]').click();
    await dialog.locator('select').selectOption({ index: 0 });
    await page.locator('[data-export-render]').click();
    await expect.poll(() => status.textContent(), { timeout: 60000 }).toMatch(/PNG ready/);
    const [png] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-export-download]').click(),
    ]);
    const stream = await png.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const bytes = Buffer.concat(chunks);
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    expect(bytes.readUInt32BE(16)).toBe(1080);
    expect(bytes.readUInt32BE(20)).toBe(1920);

    await page.keyboard.press('Escape');
    await expect.poll(() => dialog.count()).toBe(0);
    expect(problems).toEqual([]);
    expect(external).toEqual([]);
    await context.close();
  });
});
