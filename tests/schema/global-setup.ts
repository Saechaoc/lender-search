/**
 * Vitest globalSetup for tests/schema/ — runs ONCE per test invocation
 * (not per worker fork) before any worker starts.
 *
 * Plan 03 review WR-04: previously `pnpm db:seed` lived in
 * tests/schema/setup.ts's beforeAll, which fires per-fork. With Vitest's
 * default forks pool that spawned 5+ concurrent `pnpm db:seed` invocations
 * racing against the same database. Two concrete failure modes:
 *   1. seedFhfaYear's UPDATE-close-prior-versions step can see zero rows
 *      because another worker already closed them; subsequent INSERT then
 *      collides on the EXCLUDE constraint.
 *   2. captureCurrentBundle + persistSnapshot race produces multiple
 *      rule_snapshot rows when bundles diverge mid-flight.
 *
 * Moving to globalSetup gives us exactly one invocation per `pnpm test:schema`
 * call, eliminating the race entirely. Vitest 4 spec:
 *   https://vitest.dev/config/#globalsetup
 *
 * Per Pitfall G: agency seeds require the postgres superuser connection.
 * The seed script reads DATABASE_MIGRATION_URL (or derives from DATABASE_URL).
 */
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env.local' });
loadDotenv({ path: '.env' });

export default async function globalSetup(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('tests/schema globalSetup: DATABASE_URL must be set.');
  }

  const ADMIN_URL =
    process.env.DATABASE_MIGRATION_URL ??
    process.env.DATABASE_URL?.replace('app_user:app_user_password', 'postgres:postgres') ??
    '';

  if (!ADMIN_URL) {
    throw new Error(
      'tests/schema globalSetup: DATABASE_MIGRATION_URL or DATABASE_URL must yield a postgres-superuser URL for agency-table writes (Pitfall G).',
    );
  }

  const { execFileSync } = await import('node:child_process');
  try {
    execFileSync('pnpm', ['db:seed'], {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_MIGRATION_URL: ADMIN_URL },
    });
  } catch (err) {
    throw new Error(
      `tests/schema globalSetup: pnpm db:seed failed. Original: ${(err as Error).message}`,
    );
  }
}
