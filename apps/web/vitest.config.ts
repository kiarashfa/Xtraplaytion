import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
        },
      },
      {
        // Browser tests against the production build (run `pnpm build` first).
        test: {
          name: 'e2e',
          environment: 'node',
          include: ['e2e/**/*.test.ts'],
          globalSetup: ['e2e/setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          // Browsers on shared CI runners (WebKit on Linux most of all) can take several seconds
          // to start a page; polls wait for what they check, not for a fixed short time.
          expect: { poll: { timeout: 20_000 } },
        },
      },
    ],
  },
});
