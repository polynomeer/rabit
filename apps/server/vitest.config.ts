import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/helpers/env.ts'],
    globalSetup: ['test/helpers/global-setup.ts'],
    // Integration tests share one database; run files sequentially for determinism.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    restoreMocks: true,
  },
});
