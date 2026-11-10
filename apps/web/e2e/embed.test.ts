import { mlp } from '@xtraplaytion/engine';
import type { Browser, FrameLocator } from 'playwright-core';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, inject, onTestFinished, test } from 'vitest';
import { encodeState, type ExperimentState } from '../src/lib/share.ts';
import { openPage, targets } from './browsers.ts';

const baseURL = inject('baseURL');

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
  ],
  epochs: 150,
  layout: 'overlay',
  backend: 'cpu',
};

async function epochOf(frame: FrameLocator): Promise<string> {
  return ((await frame.locator('[data-epoch]').textContent()) ?? '').replace(/\s+/g, ' ');
}

describe.each(targets)('$name', (target) => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await target.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  test('embeds in a page from another origin', { timeout: 120000 }, async () => {
    const { context, page, problems, external } = await openPage(browser, target, baseURL);
    // A third-party page on another origin (a real local server: Chrome refuses loopback
    // frames inside pages it has to treat as public, such as intercepted ones).
    const code = await encodeState(state);
    const src = `${baseURL}embed/#s=${code}&title=${encodeURIComponent('Who fills the gap?')}&theme=dark`;
    const body = `<!doctype html><title>Blog</title><h1>My post</h1>
<iframe src="${src}" title="Race" width="100%" height="300" style="border:0"></iframe>
<script>window.heights=[];addEventListener('message',function(e){if(e.data&&e.data.type==='xtraplaytion:height'){window.heights.push(e.data.height);document.querySelector('iframe').style.height=e.data.height+'px'}})</script>`;
    const server = createServer((_, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(body);
    });
    await new Promise<void>((r) => server.listen(0, 'localhost', r));
    const host = `http://localhost:${(server.address() as AddressInfo).port}/blog/post.html`;
    await context.route(host, (route) => route.continue());
    onTestFinished(() => void server.close());
    await page.goto(host, { waitUntil: 'networkidle' });
    const frame = page.frameLocator('iframe');
    await expect
      .poll(async () => (await frame.locator('[data-embed-title]').textContent())?.trim(), {
        timeout: 20000,
      })
      .toBe('Who fills the gap?');
    expect(await frame.locator('html').getAttribute('data-theme')).toBe('dark');
    // No consent bar and no analytics inside an embed.
    expect(await frame.locator('[data-consent]').count()).toBe(0);

    await frame.locator('[data-embed-play]').click();
    await expect.poll(() => epochOf(frame), { timeout: 60000 }).toBe('Epoch 150/150');
    // The page around it learned the height and resized the frame.
    const heights = await page.evaluate(() => (window as unknown as { heights: number[] }).heights);
    expect(heights.length).toBeGreaterThan(0);
    expect(heights.at(-1)).toBeGreaterThan(250);
    const box = await page.locator('iframe').boundingBox();
    expect(Math.round(box?.height ?? 0)).toBe(heights.at(-1));

    // The link opens the same experiment in the full playground.
    const open = await frame.locator('[data-embed-open]').getAttribute('href');
    expect(open).toBe(`/Xtraplaytion/playground/#s=${code}`);

    // The embedding page can load another experiment with postMessage.
    await page.evaluate(() =>
      document
        .querySelector('iframe')
        ?.contentWindow?.postMessage({ type: 'xtraplaytion:load', link: '#preset=sine-gap' }, '*'),
    );
    await expect.poll(() => epochOf(frame)).toMatch(/^Epoch 0\/[\d,]+$/);
    expect(await frame.locator('[data-embed-open]').getAttribute('href')).toBe(
      '/Xtraplaytion/playground/#preset=sine-gap',
    );

    // A damaged link explains itself instead of failing silently.
    await page.evaluate(() =>
      document
        .querySelector('iframe')
        ?.contentWindow?.postMessage({ type: 'xtraplaytion:load', link: '#s=broken' }, '*'),
    );
    await expect.poll(() => frame.locator('[data-embed-problem]').count()).toBe(1);

    expect(problems).toEqual([]);
    expect(external).toEqual([]);
    await context.close();
  });

  test('the share menu writes embed code', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto(`./playground/#s=${await encodeState(state)}`, { waitUntil: 'networkidle' });
    await page.locator('[data-share]').click();
    await page.locator('[data-share-embed]').click();
    const snippet = page.locator('[data-embed-snippet]');
    await expect
      .poll(() => snippet.inputValue())
      .toMatch(/^<iframe src="https:\/\/kiarashfa\.github\.io\/Xtraplaytion\/embed\/#s=/);
    const html = await snippet.inputValue();
    expect(html).toContain('xtraplaytion:height');
    expect(html).not.toContain('&title=');
    await page.locator('[data-embed-code] input').first().fill('Gap race');
    await expect.poll(() => snippet.inputValue()).toContain('&amp;title=Gap+race');
    expect(problems).toEqual([]);
    await context.close();
  });
});
