// Serves the production build for the browser tests.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';
import { SITE } from '../src/site.config.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    baseURL: string;
  }
}

export default async function setup(project: TestProject) {
  process.env['ASTRO_TELEMETRY_DISABLED'] = '1';
  const root = fileURLToPath(new URL('..', import.meta.url));
  if (!existsSync(`${root}dist/index.html`)) {
    throw new Error('No build found. Run `pnpm build` before the browser tests.');
  }
  const { preview } = await import('astro');
  const server = await preview({
    root,
    logLevel: 'warn',
    server: { host: '127.0.0.1', port: 4399 },
  });
  project.provide('baseURL', `http://127.0.0.1:${server.port}${SITE.basePath}`);
  return async () => {
    await server.stop();
  };
}
