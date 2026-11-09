import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: 'unit', environment: 'node', include: ['test/**/*.test.ts'] },
      },
      {
        // Same vectors in real browsers (XP_BROWSERS, default: the installed Chrome).
        test: {
          name: 'engines',
          environment: 'node',
          include: ['test/**/*.engines.ts'],
          testTimeout: 120_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
