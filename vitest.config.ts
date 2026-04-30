import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    isolate: true,
    globalSetup: ['./tests/rls/global-setup.ts'],
    setupFiles: ['./tests/rls/setup.ts'],
    sequence: { concurrent: false },
    testTimeout: 10_000,
    hookTimeout: 10_000,
    include: ['tests/rls/**/*.test.ts'],
  },
});
