/**
 * Vitest globalSetup — runs once before the entire pen-test suite.
 *
 * Ensures the test DB is in a known clean state by:
 *   1. Truncating both tables (locally — preserves the docker volume).
 *   2. Re-running migrations (idempotent — drizzle-kit skips already-applied).
 *   3. GRANT-ing DML on the tables to `app_user` so the per-file setup
 *      (which connects as app_user) can read/write through RLS.
 *
 * In CI, the postgres service container starts empty every run, so the
 * truncate is a no-op but the migrate is required. Locally the truncate
 * keeps repeated test runs stable.
 *
 * Connects as the `postgres` superuser (the migration role) — only the
 * owner can ALTER TABLE / GRANT.
 *
 * Uses execFileSync (NOT the shell-invoking sibling) — codebase convention;
 * arguments here are pinned literals so injection is not feasible, but
 * execFile is the safer default.
 */
import { config as loadDotenv } from 'dotenv';
import { Client } from 'pg';
import { execFileSync } from 'node:child_process';

// Load .env.local first (local-dev secrets; gitignored), then fall back to .env.
// Same pattern drizzle.config.ts uses (Plan 01-05 deviation fix). dotenv does not
// override pre-set env vars, so CI's GitHub Actions secrets take precedence over
// committed dotfiles.
loadDotenv({ path: '.env.local' });
loadDotenv({ path: '.env' });

// Use the postgres-superuser DATABASE_URL for migrations + grants.
// The default DATABASE_URL (in .env.local) connects as app_user, which is
// intentionally NOBYPASSRLS — it cannot ALTER TABLE.
const MIGRATION_DB_URL =
  process.env.DATABASE_MIGRATION_URL ??
  process.env.DATABASE_URL?.replace('app_user:app_user_password', 'postgres:postgres') ??
  '';

if (!MIGRATION_DB_URL) {
  throw new Error(
    'DATABASE_MIGRATION_URL or DATABASE_URL must be set for globalSetup to run migrations.',
  );
}

export default async function globalSetup(): Promise<void> {
  // Step 1: Truncate (idempotent; safe on a fresh CI DB; useful for repeated local runs).
  // Skip if tables don't exist yet (first run before any migrate).
  const adminClient = new Client({ connectionString: MIGRATION_DB_URL });
  await adminClient.connect();
  try {
    const { rows } = await adminClient.query<{ t: string | null; c: string | null }>(
      `SELECT to_regclass('public.tenant') AS t, to_regclass('public._rls_canary') AS c`,
    );
    if (rows[0]?.t && rows[0]?.c) {
      // Tables exist — truncate. CASCADE handles the FK from _rls_canary.
      await adminClient.query('TRUNCATE TABLE _rls_canary, tenant CASCADE');
    }
  } finally {
    await adminClient.end();
  }

  // Step 2: Apply migrations. drizzle-kit migrate is non-interactive and
  // idempotent — already-applied migrations are skipped via the journal.
  // Use execFileSync (no shell interpretation) — args are pinned literals.
  try {
    execFileSync('pnpm', ['drizzle-kit', 'migrate'], {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: MIGRATION_DB_URL },
    });
  } catch (err) {
    throw new Error(
      `globalSetup: drizzle-kit migrate failed. Ensure the docker postgres container is up and DATABASE_URL points at it. Original: ${(err as Error).message}`,
    );
  }

  // Step 3: GRANT DML on the tables to app_user. drizzle-kit migrate creates
  // tables owned by the postgres user; app_user (NOBYPASSRLS) cannot read/write
  // until granted. The init-db.sh script's ALTER DEFAULT PRIVILEGES does NOT
  // retroactively cover tables the postgres user just created in this same
  // session — explicit GRANTs are required.
  const grantClient = new Client({ connectionString: MIGRATION_DB_URL });
  await grantClient.connect();
  try {
    await grantClient.query(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tenant, _rls_canary TO app_user',
    );
  } finally {
    await grantClient.end();
  }
}
