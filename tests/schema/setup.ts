/**
 * Vitest setupFiles for tests/schema/ — exposes __pgPool (app_user) and
 * __pgAdminPool (postgres) globals for fixture helpers.
 *
 * Per Pitfall G: agency-rule INSERTs require the postgres superuser
 * connection because agency_rule's system_write policy uses `to: system_role`
 * and only postgres has system_role GRANTed.
 *
 * Plan 02-07 [BLOCKING] migrate already applied all migrations; this file
 * does NOT run drizzle-kit migrate. It only opens connections.
 */
import { config as loadDotenv } from 'dotenv';
import { Pool } from 'pg';
import { afterAll, beforeAll } from 'vitest';

loadDotenv({ path: '.env.local' });
loadDotenv({ path: '.env' });

declare global {
  var __pgPool: Pool;
  var __pgAdminPool: Pool;
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set for tests/schema/ to run.');
}

const ADMIN_URL =
  process.env.DATABASE_MIGRATION_URL ??
  process.env.DATABASE_URL?.replace('app_user:app_user_password', 'postgres:postgres') ??
  '';

if (!ADMIN_URL) {
  throw new Error('DATABASE_MIGRATION_URL or DATABASE_URL must yield a postgres-superuser URL for agency-table writes (Pitfall G).');
}

beforeAll(async () => {
  globalThis.__pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
  });
  globalThis.__pgAdminPool = new Pool({
    connectionString: ADMIN_URL,
    max: 3,
  });

  // Phase 3 / D-06: ensure agency seeds + FHFA loan limits are loaded.
  // Idempotent (ON CONFLICT DO NOTHING / INSERT WHERE NOT EXISTS) so
  // re-running across test suites is a structural no-op when state is
  // current. The schema test suite runs after rls (per package.json
  // script ordering) but vitest.schema.config.ts has no globalSetup;
  // calling here defensively keeps the suite self-contained.
  const { execFileSync } = await import('node:child_process');
  try {
    execFileSync('pnpm', ['db:seed'], {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_MIGRATION_URL: ADMIN_URL },
    });
  } catch (err) {
    throw new Error(
      `tests/schema setup: pnpm db:seed failed. Original: ${(err as Error).message}`,
    );
  }
});

afterAll(async () => {
  await globalThis.__pgPool?.end();
  await globalThis.__pgAdminPool?.end();
});
