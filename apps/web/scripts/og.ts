// Social preview images (Open Graph cards, 1200 x 630): one for the site and one per lesson,
// written to public/og/. Each card shows a finished race from the gallery thumbnails, drawn
// by the site itself in the installed Google Chrome. Run after `pnpm build`:
//   node scripts/og.ts
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { LESSONS } from '../src/lib/lessons.ts';
import { SITE } from '../src/site.config.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const OUT = `${root}public/og/`;
const fontFile = (re: RegExp) => readdirSync(`${root}dist/_astro`).find((f) => re.test(f));

interface Card {
  file: string;
  kicker: string;
  title: string;
  text: string;
  /** Gallery item whose finished race is shown. */
  race: string;
}

/** Gallery race shown on each lesson's card. */
const RACE: Record<number, string> = {
  1: 'race-activations',
  2: 'race-width',
  3: 'overfit-net',
  4: 'classic-beyond',
  5: 'lr-sweep',
  6: 'layout-crowded',
  7: 'ensemble',
  8: 'classic-gap',
};

const cards: Card[] = [
  {
    file: 'site.png',
    kicker: 'Playground and lessons',
    title: 'See how models learn a curve, and where they break.',
    text: 'Train neural networks and classical models in your browser. Watch them interpolate, extrapolate and fail outside their data.',
    race: 'race-activations',
  },
  ...LESSONS.map((l) => ({
    file: `lesson-${l.n}.png`,
    kicker: `Lesson ${l.n}`,
    title: l.title,
    text: l.summary,
    race: RACE[l.n] ?? 'race-activations',
  })),
];

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

process.env['ASTRO_TELEMETRY_DISABLED'] = '1';
const { preview } = await import('astro');
const server = await preview({ root, logLevel: 'warn', server: { host: '127.0.0.1', port: 4394 } });
const base = `http://127.0.0.1:${server.port}${SITE.basePath}`;
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    bypassCSP: true,
    storageState: {
      cookies: [],
      origins: [
        { origin: new URL(base).origin, localStorage: [{ name: 'xp-consent', value: 'denied' }] },
      ],
    },
  });
  // Race pictures: the gallery's thumbnails, drawn by the site at twice the card size.
  const shots = new Map<string, string>();
  const gallery = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  });
  await gallery.goto(`${base}gallery/`, { waitUntil: 'networkidle' });
  for (const id of new Set(cards.map((c) => c.race))) {
    const canvas = gallery.locator(`[data-gallery="${id}"] canvas`);
    await canvas.scrollIntoViewIfNeeded();
    await gallery.waitForTimeout(150);
    shots.set(id, (await canvas.screenshot()).toString('base64'));
  }
  await gallery.close();

  const page = await context.newPage();
  await page.goto(`${base}404.html`);
  const sans = `${base}_astro/${fontFile(/^inter-latin-wght-normal\..*\.woff2$/)}`;
  mkdirSync(OUT, { recursive: true });
  for (const c of cards) {
    await page.setContent(`<!doctype html><html><head><style>
      @font-face { font-family: Inter; src: url(${sans}) format('woff2'); font-weight: 100 900; }
      * { box-sizing: border-box; margin: 0; }
      body { width: 1200px; height: 630px; overflow: hidden; background: #f3f5f9; color: #0f172a;
        font-family: Inter, sans-serif; display: grid; grid-template-columns: 500px 1fr; gap: 36px;
        padding: 56px; }
      .brand { display: flex; align-items: center; gap: 14px; font-size: 30px; font-weight: 700; letter-spacing: -0.02em; }
      .brand img { width: 52px; height: 52px; }
      .kicker { margin-top: 56px; font-size: 24px; font-weight: 600; color: #1d5fd6; }
      h1 { margin-top: 12px; font-size: 50px; line-height: 1.08; font-weight: 800; letter-spacing: -0.03em; }
      p { margin-top: 20px; font-size: 24px; line-height: 1.4; color: #526073; }
      .plot { align-self: center; background: #fff; border: 1px solid #dde3ec; border-radius: 22px;
        padding: 14px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
      .plot img { display: block; width: 100%; border-radius: 10px; }
    </style></head><body>
      <div><div class="brand"><img src="${base}favicon.svg" alt="">${esc(SITE.name)}</div>
      <div class="kicker">${esc(c.kicker)}</div><h1>${esc(c.title)}</h1><p>${esc(c.text)}</p></div>
      <div class="plot"><img src="data:image/png;base64,${shots.get(c.race)}" alt=""></div>
    </body></html>`);
    await page.evaluate(() => document.fonts.ready);
    writeFileSync(`${OUT}${c.file}`, await page.screenshot({ type: 'png' }));
    console.log(`og/${c.file}`);
  }
} finally {
  await browser.close();
  await server.stop();
}
