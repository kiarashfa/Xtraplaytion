import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', environment: 'node', include: ['test/**/*.test.ts'] } },
      {
        test: {
          name: 'engines',
          environment: 'node',
          include: ['test/**/*.engines.ts'],
          testTimeout: 180_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
