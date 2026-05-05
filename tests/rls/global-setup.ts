/**
 * Vitest globalSetup — runs once before the entire pen-test suite.
 *
 * Phase 1 baseline: truncate tenant + _rls_canary; run drizzle-kit migrate;
 * GRANT DML on tenant + _rls_canary to app_user.
 *
 * Phase 2 D-19 extension: extend the TRUNCATE list to cover the 5 new
 * tenant-scoped tables (program, program_version, program_rule,
 * lender_overlay_rule, rule_citation) AND the agency tables; extend GRANTs
 * to cover the 5 new tables + SELECT on agency_rule + agency_rule_version.
 * Also expose globalThis.__pgAdminPool (postgres connection) for Plan
 * 02-09's seedTwoTenants extension. Note: Vitest 4 globalSetup and
 * setupFiles run in DIFFERENT module contexts (Plan 01-06 §Rule 3
 * deviation), so this exposure is best-effort — setup.ts ALSO constructs
 * its own __pgAdminPool defensively.
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
import { Client, Pool } from 'pg';
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

// __pgAdminPool's global type is declared in tests/rls/setup.ts (and
// tests/schema/setup.ts). We assign to it here for the case where Vitest 4's
// module-context boundary (Plan 01-06 §Rule 3 deviation) lets globals
// propagate from globalSetup → setupFiles. setup.ts ALSO constructs its own
// __pgAdminPool defensively for the case where the propagation fails.
declare global {
  var __pgAdminPool: Pool;
}

export default async function globalSetup(): Promise<void> {
  // Step 1: Truncate Phase 1 + Phase 2 tables (idempotent; safe on a fresh CI DB; useful for repeated local runs).
  // Skip if Phase 1 tables don't exist yet (first run before any migrate).
  // CASCADE handles FK chains across all Phase 1 + Phase 2 tables.
  const adminClient = new Client({ connectionString: MIGRATION_DB_URL });
  await adminClient.connect();
  try {
    const { rows } = await adminClient.query<{ t: string | null; c: string | null }>(
      `SELECT to_regclass('public.tenant') AS t, to_regclass('public._rls_canary') AS c`,
    );
    if (rows[0]?.t && rows[0]?.c) {
      // Tables exist — truncate. The truncate list covers Phase 1 + Phase 2.
      // Tables that don't exist yet (e.g., on a fresh DB before Plan 02-07's
      // [BLOCKING] migrate) are skipped via to_regclass guards below.
      const { rows: phase2 } = await adminClient.query<{ p: string | null }>(
        `SELECT to_regclass('public.program') AS p`,
      );
      if (phase2[0]?.p) {
        await adminClient.query(
          `TRUNCATE TABLE
             program_rule, program_version, program, lender_overlay_rule,
             agency_rule, agency_rule_version, rule_citation, _rls_canary, tenant
           CASCADE`,
        );
      } else {
        // Phase 1 tables exist but Phase 2 don't — Phase 1-only truncate.
        await adminClient.query('TRUNCATE TABLE _rls_canary, tenant CASCADE');
      }
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

  // Step 3: GRANT DML on Phase 1 + Phase 2 tenant-scoped tables to app_user.
  // The 0003 + 0006 migrations already include these GRANTs, but issuing
  // again is idempotent and protects against future migration regressions.
  // Agency tables get SELECT-only (writes go through system_role / postgres).
  const grantClient = new Client({ connectionString: MIGRATION_DB_URL });
  await grantClient.connect();
  try {
    await grantClient.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
         tenant, _rls_canary,
         program, program_version, program_rule, rule_citation, lender_overlay_rule
       TO app_user`,
    );
    await grantClient.query(
      `GRANT SELECT ON TABLE agency_rule_version, agency_rule TO app_user`,
    );
  } finally {
    await grantClient.end();
  }

  // Step 4: Expose adminPool on globalThis for tests that need to seed
  // agency-side rows (Pitfall G — system_role policy requires postgres role).
  // Note: Vitest 4 globalSetup and setupFiles run in DIFFERENT module
  // contexts (Plan 01-06 §Rule 3 deviation), so this exposure is
  // best-effort — setup.ts also constructs its own adminPool.
  globalThis.__pgAdminPool = new Pool({
    connectionString: MIGRATION_DB_URL,
    max: 3,
  });
}
