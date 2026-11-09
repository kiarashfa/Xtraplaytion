// Browser targets and page helpers for the e2e tests (playwright-core, no bundled browsers).
import {
  chromium,
  devices,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from 'playwright-core';
import { CONSENT_KEY, type Consent } from '../src/lib/consent.ts';

export interface Target {
  name: string;
  launch: () => Promise<Browser>;
  context: BrowserContextOptions;
}

const launchers: Record<string, () => Promise<Browser>> = {
  chrome: () => chromium.launch({ channel: 'chrome' }),
  msedge: () => chromium.launch({ channel: 'msedge' }),
  firefox: () => firefox.launch(),
  webkit: () => webkit.launch(),
};

const { defaultBrowserType: _ignored, ...pixel7 } = devices['Pixel 7'];

/**
 * Engines to test, from XP_BROWSERS (comma separated). Default: the installed Google Chrome.
 * CI adds firefox and webkit, installed with `playwright-core install`.
 */
export const targets: Target[] = (process.env['XP_BROWSERS'] ?? 'chrome')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .flatMap((name) => {
    const launch = launchers[name];
    if (!launch) throw new Error(`Unknown browser "${name}". Use: ${Object.keys(launchers)}`);
    const list: Target[] = [{ name, launch, context: { viewport: { width: 1280, height: 800 } } }];
    if (name === 'chrome') list.push({ name: 'chrome-mobile', launch, context: pixel7 });
    return list;
  });

export interface Session {
  context: BrowserContext;
  page: Page;
  /** Page errors, console errors and CSP violations. */
  problems: string[];
  /** Requests to other origins. They are answered locally and never reach the network. */
  external: string[];
}

export async function openPage(
  browser: Browser,
  target: Target,
  baseURL: string,
  options: { consent?: Consent | null; colorScheme?: 'light' | 'dark' } = {},
): Promise<Session> {
  const origin = new URL(baseURL).origin;
  // Most tests act as a returning visitor who already declined analytics.
  const consent = options.consent === undefined ? 'denied' : options.consent;
  const context = await browser.newContext({
    ...target.context,
    baseURL,
    colorScheme: options.colorScheme ?? 'light',
    storageState: {
      cookies: [],
      origins: consent ? [{ origin, localStorage: [{ name: CONSENT_KEY, value: consent }] }] : [],
    },
  });
  const external: string[] = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(origin)) return route.continue();
    external.push(url);
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
  });
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return { context, page, problems, external };
}

/** Waits until every Astro island on the page has hydrated. */
export async function hydrated(page: Page) {
  await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
}
