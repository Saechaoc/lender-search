/**
 * vitest.schema.config.ts — Phase 2 schema-constraint + Zod-unit test config.
 *
 * Separate from Phase 1's vitest.config.ts because:
 *   - tests/schema/ tests connect as the migration role (postgres) for agency
 *     writes; tests/rls/setup.ts's FORCE-RLS sanity check on tenant + _rls_canary
 *     is irrelevant here (Plan 02-08 owns its own setup if needed)
 *   - tests/rls/global-setup.ts runs `drizzle-kit migrate` — already done by
 *     Plan 02-07's [BLOCKING] migrate task before this suite runs
 *   - tests/rules/ Zod-unit tests don't need a DB at all
 *
 * Used by `pnpm test:schema` (D-21).
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    isolate: true,
    // Plan 03 review WR-04: pnpm db:seed runs ONCE per invocation
    // (not per worker fork) to eliminate the parallel-fork seed race.
    globalSetup: ['./tests/schema/global-setup.ts'],
    setupFiles: ['./tests/schema/setup.ts'],
    sequence: { concurrent: false },
    testTimeout: 10_000,
    hookTimeout: 10_000,
    include: [
      'tests/schema/**/*.test.ts',
      'tests/rules/**/*.test.ts',
      'tests/audit/**/*.test.ts',
      'tests/agency/**/*.test.ts',
      'tests/cascade/**/*.test.ts',
    ],
  },
});
