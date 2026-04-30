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
  // eslint-disable-next-line no-var
  var __pgPool: Pool;
  // eslint-disable-next-line no-var
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
