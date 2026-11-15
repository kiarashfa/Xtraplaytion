// The profile and the save file: setting up a profile and picture, the circle in the header, the
// save file as the key to another browser, signing out, and cloud save with Dropbox answered by
// a stand-in (the test never reaches the real service).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, test } from 'vitest';
import { presetState } from '../src/lib/experiment.ts';
import { experimentFile } from '../src/lib/file.ts';
import { PRESETS } from '../src/lib/presets.ts';
import { hydrated, openPage, targets } from './browsers.ts';

const baseURL = inject('baseURL');
const PHOTO = fileURLToPath(new URL('../public/og/site.png', import.meta.url));

async function setUpProfile(page: Page, name: string) {
  await page.goto('./user/', { waitUntil: 'networkidle' });
  // An empty browser shows the welcome panel; one with experiments shows the profile.
  await page.locator('[data-user-start], [data-user-edit]').click();
  await page.locator('[data-profile-name-input]').fill(name);
  await page.locator('[data-profile-save]').click();
  await expect.poll(() => page.locator('[data-user-name]').textContent()).toContain(name);
}

async function addExperiment(page: Page, name: string) {
  await page.goto('./library/', { waitUntil: 'networkidle' });
  await page.locator('[data-lib-file]').setInputFiles({
    name: 'one.json',
    mimeType: 'application/json',
    buffer: Buffer.from(experimentFile(presetState(PRESETS[0]), name)),
  });
  await expect.poll(() => page.locator('[data-lib-entry]').count()).toBe(1);
}

const headerKind = (page: Page) =>
  page.locator('[data-profile-trigger] .xp-avatar').getAttribute('data-kind');

describe.each(targets)('$name', (target) => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await target.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  test('a profile with initials, then a photo, shows in the header on every page', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto('./user/', { waitUntil: 'networkidle' });
    await expect.poll(() => page.locator('[data-user-welcome]').count()).toBe(1);
    await setUpProfile(page, 'Ada Lovelace');
    expect(await page.locator('[data-profile-trigger]').getAttribute('aria-label')).toBe(
      'Your profile: Ada Lovelace',
    );
    expect(await headerKind(page)).toBe('letters');
    expect(
      await page.locator('[data-profile-trigger] .xp-avatar-glyph').getAttribute('data-letters'),
    ).toBe('AL');

    await page.locator('[data-user-edit]').click();
    await page.locator('[data-profile-kind=photo]').check({ force: true });
    await page.locator('[data-profile-photo-file]').setInputFiles(PHOTO);
    await page.locator('[data-profile-crop]').waitFor();
    await expect.poll(() => page.locator('[data-profile-photo-size]').count()).toBe(1);
    await page.keyboard.press('Tab');
    await page.locator('[data-profile-crop]').press('+');
    await page.locator('[data-profile-crop]').press('ArrowLeft');
    await page.waitForTimeout(250);
    await page.locator('[data-profile-save]').click();
    await expect.poll(() => headerKind(page)).toBe('picture');
    const picture = await page.locator('[data-profile-trigger] img').getAttribute('src');
    expect(picture).toMatch(/^data:image\/(webp|jpeg);base64,/);
    expect(picture?.length ?? 0).toBeLessThan(60_000);

    // Another page draws the photo before its scripts run (inline script, allowed by the CSP).
    await page.goto('./gallery/', { waitUntil: 'commit' });
    await page.locator('[data-profile-trigger] img').waitFor();
    await page.waitForLoadState('networkidle');
    await page.locator('[data-profile-trigger]').click();
    await expect
      .poll(() => page.locator('[data-profile-sub]').textContent())
      .toContain('Nothing saved');
    await page.keyboard.press('Escape');
    expect(await page.locator('[data-profile-menu]').isHidden()).toBe(true);
    expect(problems).toEqual([]);
    await context.close();
  }, 90_000);

  test('the save file is the key: download, sign out, open it again', async () => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await addExperiment(page, 'Kept in the file');
    await setUpProfile(page, 'Grace Hopper');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-user-download]').click(),
    ]);
    expect(download.suggestedFilename()).toBe('xtraplaytion-save.json');
    const path = await download.path();
    const save = JSON.parse(await readFile(path, 'utf8'));
    expect(save.format).toBe('xtraplaytion-save');
    expect(save.profile.name).toBe('Grace Hopper');
    expect(save.entries).toHaveLength(1);

    // Experiments kept only here: signing out asks first.
    await page.locator('[data-user-signout]').click();
    await page.locator('[data-user-signout-anyway]').click();
    await expect.poll(() => page.locator('[data-user-welcome]').count()).toBe(1);
    expect(await headerKind(page)).toBe('');

    await page.locator('[data-user-file]').setInputFiles(path);
    await expect
      .poll(() => page.locator('[data-user-notice]').textContent())
      .toContain('1 new experiment and your profile');
    await expect.poll(() => page.locator('[data-user-name]').textContent()).toContain('Grace');
    expect(await headerKind(page)).toBe('letters');

    // Opening it again changes nothing; a single experiment or junk is refused.
    await page.locator('[data-user-file]').setInputFiles(path);
    await expect
      .poll(() => page.locator('[data-user-notice]').textContent())
      .toContain('was already here');
    await page.locator('[data-user-file]').setInputFiles({
      name: 'one.json',
      mimeType: 'application/json',
      buffer: Buffer.from(experimentFile(presetState(PRESETS[0]), 'x')),
    });
    await expect
      .poll(() => page.locator('[data-user-notice]').textContent())
      .toContain('single experiment');
    await page.goto('./library/', { waitUntil: 'networkidle' });
    await expect.poll(() => page.locator('[data-lib-entry]').count()).toBe(1);
    expect(problems).toEqual([]);
    await context.close();
  }, 90_000);

  test('cloud save with Dropbox: connect, save, then sign in on a new browser', async (ctx) => {
    const { context, page, problems } = await openPage(browser, target, baseURL);
    await page.goto('./user/', { waitUntil: 'networkidle' });
    await hydrated(page);
    if ((await page.locator('[data-cloud-connect=dropbox]').count()) === 0) {
      ctx.skip(); // a build without the Dropbox app key offers no cloud save
      return;
    }
    // A stand-in for Dropbox, shared by both browsers.
    const cloud = { file: null as string | null, rev: 0, revoked: 0 };
    // Clicks Connect, waits until the page has really left for Dropbox, then comes back the way
    // Dropbox sends visitors back: to the redirect address with a code and the same state.
    const connectDropbox = async (p: Page) => {
      const [request] = await Promise.all([
        p.waitForRequest((r) => r.url().startsWith('https://www.dropbox.com/oauth2/authorize?')),
        p.locator('[data-cloud-connect=dropbox]').click(),
      ]);
      await p.waitForURL((u) => u.hostname === 'www.dropbox.com');
      const q = new URL(request.url()).searchParams;
      const back = new URL(q.get('redirect_uri') ?? '');
      back.search = new URLSearchParams({
        code: 'test-code',
        state: q.get('state') ?? '',
      }).toString();
      await p.goto(back.href);
      await hydrated(p);
    };
    const answer = async (p: Page) => {
      // Dropbox's sign-in page (connectDropbox plays the visitor coming back from it).
      await p.route('https://www.dropbox.com/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><title>Dropbox</title>',
        }),
      );
      await p.route('https://api.dropboxapi.com/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        const json = (status: number, body: unknown) =>
          route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (path === '/oauth2/token')
          return json(200, { access_token: 'a', refresh_token: 'r', expires_in: 14400 });
        if (path === '/2/users/get_current_account')
          return json(200, { name: { display_name: 'Test' }, email: 'test@example.com' });
        if (path === '/2/files/get_metadata')
          return cloud.file ? json(200, { rev: String(cloud.rev) }) : json(409, {});
        if (path === '/2/auth/token/revoke') {
          cloud.revoked++;
          return json(200, null);
        }
        return json(404, {});
      });
      await p.route('https://content.dropboxapi.com/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/2/files/download')
          return route.fulfill({ status: 200, body: cloud.file ?? '' });
        cloud.file = route.request().postData();
        cloud.rev++;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ rev: String(cloud.rev) }),
        });
      });
    };

    await answer(page);
    await addExperiment(page, 'Kept in the cloud');
    await setUpProfile(page, 'Alan Turing');
    await connectDropbox(page);
    await expect
      .poll(() => page.locator('[data-user-notice]').textContent())
      .toContain('Saved to Dropbox');
    await expect
      .poll(() => page.locator('[data-cloud-provider=dropbox]').textContent())
      .toContain('test@example.com');
    expect(page.url()).not.toContain('code=');
    const saved = JSON.parse(cloud.file ?? '{}');
    expect(saved.profile.name).toBe('Alan Turing');
    expect(saved.entries).toHaveLength(1);
    expect(await page.locator('[data-cloud-dot]').first().getAttribute('data-dot')).toBe('saved');

    // With everything in the cloud, signing out needs no question.
    await page.locator('[data-user-signout]').click();
    await expect.poll(() => page.locator('[data-user-welcome]').count()).toBe(1);
    expect(cloud.revoked).toBe(1);

    // A new browser signs in by connecting the same Dropbox.
    const other = await openPage(browser, target, baseURL);
    await answer(other.page);
    await other.page.goto('./user/', { waitUntil: 'networkidle' });
    await hydrated(other.page);
    await connectDropbox(other.page);
    await expect
      .poll(() => other.page.locator('[data-user-notice]').textContent())
      .toContain('Brought in 1 new experiment and your profile from Dropbox');
    await expect
      .poll(() => other.page.locator('[data-user-name]').textContent())
      .toContain('Alan Turing');
    // Dropbox answers 409 while the save does not exist yet; Chrome logs that as a failed load.
    const real = (list: string[]) => list.filter((m) => !/status of 409/.test(m));
    expect(real(problems)).toEqual([]);
    expect(real(other.problems)).toEqual([]);
    await other.context.close();
    await context.close();
  }, 120_000);
});
