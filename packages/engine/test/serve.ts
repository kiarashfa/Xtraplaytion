// Local test server for browser tests: serves the workspace packages with types
// stripped (no bundler) and the dmath import rewritten. 127.0.0.1 is a secure
// context, so workers and WebGPU behave as on the real site.
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit, type Browser } from 'playwright-core';

const PACKAGES = fileURLToPath(new URL('../../', import.meta.url));

export async function serve(): Promise<{ origin: string; close: () => void }> {
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (path === '/') {
      res
        .writeHead(200, { 'content-type': 'text/html' })
        .end('<!doctype html><title>engine</title>');
      return;
    }
    const file = join(PACKAGES, path);
    if (!file.startsWith(PACKAGES) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    const code = stripTypeScriptTypes(readFileSync(file, 'utf8')).replaceAll(
      "'@xtraplaytion/dmath'",
      "'/dmath/src/index.ts'",
    );
    res.writeHead(200, { 'content-type': 'text/javascript' }).end(code);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const origin = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return { origin, close: () => server.close() };
}

export const launchers: Record<string, () => Promise<Browser>> = {
  chrome: () => chromium.launch({ channel: 'chrome' }),
  msedge: () => chromium.launch({ channel: 'msedge' }),
  firefox: () => firefox.launch(),
  webkit: () => webkit.launch(),
};

export const engines = (process.env['XP_BROWSERS'] ?? 'chrome')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
