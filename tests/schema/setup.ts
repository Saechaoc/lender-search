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
 *
 * Plan 03 review WR-04: `pnpm db:seed` was previously invoked here in
 * `beforeAll`, which Vitest's `pool: 'forks'` fires once per worker fork.
 * That spawned 5+ concurrent seed processes racing each other (see
 * tests/schema/global-setup.ts header comment for failure modes). The seed
 * has been moved to vitest.schema.config.ts's `globalSetup` so it runs
 * exactly once per `pnpm test:schema` invocation. This file now opens
 * connection pools only.
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
});

afterAll(async () => {
  await globalThis.__pgPool?.end();
  await globalThis.__pgAdminPool?.end();
});
