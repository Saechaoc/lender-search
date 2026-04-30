import { defineConfig } from 'vitest/config';

/**
 * Standalone Vitest config for `tests/rls/env-boot.test.ts` (Plan 01-02).
 *
 * Reason this exists: the main `vitest.config.ts` references
 * `tests/rls/global-setup.ts` and `tests/rls/setup.ts`, which Plan 01-06 lands.
 * Plan 01-02's env-boot test runs at Wave 1 (before Plan 06), so it cannot use
 * the main config without hitting "module not found" for the missing setup
 * files.
 *
 * The plan's documented workaround (`vitest run … --config=""`) is broken in
 * Vitest 4.1.5 — the empty-string argument is interpreted as the literal path
 * `"true"` rather than "skip config." This minimal config is the equivalent
 * fallback the plan also calls out: "a minimal config that doesn't include
 * the missing setup."
 *
 * Plan 01-06 lands the setup files; Plan 01-07 verifies env-boot.test.ts
 * also runs green inside the full `vitest.config.ts` suite. This standalone
 * file can be deleted at that point — kept as a regression smoke runner if
 * useful, removed otherwise.
 */
export default defineConfig({
  test: {
    pool: 'forks',
    isolate: true,
    sequence: { concurrent: false },
    testTimeout: 5_000,
    hookTimeout: 5_000,
    include: ['tests/rls/env-boot.test.ts'],
  },
});
