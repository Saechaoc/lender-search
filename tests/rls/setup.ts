/**
 * Vitest setupFiles — runs in each pen-test file's process.
 *
 * Two non-negotiable sanity checks happen here:
 *   1. The connection role must NOT be BYPASSRLS (Pitfall 4). If the
 *      connection accidentally connects as a superuser, RLS is silently
 *      bypassed and pen tests pass vacuously. Aborting the suite is the
 *      only safe response.
 *   2. `relforcerowsecurity` must be `true` for every tenant-scoped table
 *      (Pitfall 6). FORCE makes the table owner subject to RLS — without it,
 *      Plan 05's migration didn't apply correctly and the tests would pass
 *      for the wrong reason. Phase 2 D-19 extends this check to cover the 5
 *      new tenant-scoped tables (program / program_version / program_rule /
 *      rule_citation / lender_overlay_rule); Plan 02-07's introspection
 *      already verified this once, but the per-test-run sanity check protects
 *      against accidental rollback during long-running CI sessions.
 *
 * The global pg.Pool is exposed via globalThis.__pgPool for fixture functions
 * that need direct DB access (seedTwoTenants, connectAsTenant). Vitest's
 * pool: 'forks' isolates each file into its own process, so the global is
 * file-scoped despite the name.
 *
 * Phase 2 D-19: a SECOND pool — globalThis.__pgAdminPool (postgres
 * superuser) — is constructed here defensively. Vitest 4's globalSetup and
 * setupFiles run in DIFFERENT module contexts (Plan 01-06 §Rule 3
 * deviation), so the __pgAdminPool set in global-setup.ts may not survive
 * into setup.ts. This file constructs its own. seedTwoTenants() needs the
 * adminPool because agency_rule_version is system-owned (Pitfall G).
 *
 * Connects as `app_user` (NOBYPASSRLS NOSUPERUSER) for __pgPool so RLS is
 * meaningful; connects as postgres for __pgAdminPool so agency-side seeds
 * work.
 */
import { config as loadDotenv } from 'dotenv';
import { Pool } from 'pg';
import { afterAll, beforeAll } from 'vitest';

// Load .env.local first (local-dev secrets; gitignored), then fall back to .env.
// Same pattern drizzle.config.ts + global-setup.ts use (Plan 01-05 deviation fix).
// dotenv does not override pre-set env vars, so CI's GitHub Actions secrets take
// precedence over committed dotfiles.
loadDotenv({ path: '.env.local' });
loadDotenv({ path: '.env' });

declare global {
  // `var` is required for `declare global` to attach a property to globalThis
  // at runtime. typescript-eslint's `no-var` rule does not flag this pattern
  // (declarations inside `declare global`), so no disable directive is needed.
  var __pgPool: Pool;
  var __pgAdminPool: Pool;
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set for the pen-test suite to run.');
}

// Phase 2 D-19: derive the admin (postgres-superuser) connection string for
// __pgAdminPool. Mirrors the pattern in tests/schema/setup.ts and
// global-setup.ts.
const ADMIN_URL =
  process.env.DATABASE_MIGRATION_URL ??
  process.env.DATABASE_URL?.replace('app_user:app_user_password', 'postgres:postgres') ??
  '';

if (!ADMIN_URL) {
  throw new Error(
    'DATABASE_MIGRATION_URL or DATABASE_URL must yield a postgres-superuser URL for tests/rls Phase 2 extension (Pitfall G).',
  );
}

// Phase 2 D-19: every tenant-scoped table that participates in cross-tenant
// pen tests must have FORCE ROW LEVEL SECURITY enabled. Listed in pg_class
// query order (alphabetical so introspection failures point at a specific
// row).
const FORCED_TABLES = [
  '_rls_canary',
  'lender_overlay_rule',
  'program',
  'program_rule',
  'program_version',
  'rule_citation',
  'tenant',
];

beforeAll(async () => {
  globalThis.__pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
  });
  globalThis.__pgAdminPool = new Pool({
    connectionString: ADMIN_URL,
    max: 3,
  });

  // Sanity check 1 (Pitfall 4): the connection role MUST NOT bypass RLS.
  const { rows: roleRows } = await globalThis.__pgPool.query<{
    role: string;
    rolbypassrls: boolean;
  }>(
    `SELECT rolname AS role, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
  );
  if (!roleRows[0]) {
    throw new Error('Could not introspect connection role. Aborting.');
  }
  if (roleRows[0].rolbypassrls) {
    throw new Error(
      `Pen tests connected as BYPASSRLS role '${roleRows[0].role}'. RLS is silently bypassed; tests would be vacuous. Aborting.`,
    );
  }

  // Sanity check 2 (Pitfall 6 / Plan 05 verification): FORCE ROW LEVEL SECURITY
  // MUST be active on every tenant-scoped table — Phase 1's 2 + Phase 2's 5.
  const { rows: forced } = await globalThis.__pgPool.query<{
    relname: string;
    relforcerowsecurity: boolean;
  }>(
    `SELECT relname, relforcerowsecurity FROM pg_class WHERE relname = ANY($1::text[]) ORDER BY relname`,
    [FORCED_TABLES],
  );
  if (forced.length !== FORCED_TABLES.length) {
    const found = forced.map((r) => r.relname).join(', ');
    throw new Error(
      `Expected pg_class to list all ${FORCED_TABLES.length} tenant-scoped tables [${FORCED_TABLES.join(', ')}]; got ${forced.length} rows [${found}]. Migrations may not have applied. Aborting.`,
    );
  }
  for (const row of forced) {
    if (!row.relforcerowsecurity) {
      throw new Error(
        `Table '${row.relname}' does NOT have FORCE ROW LEVEL SECURITY. Plan 05/Plan 02-06 migration may not have applied. Aborting.`,
      );
    }
  }

  // Sanity check 3: Phase 1 + Phase 2 expected policies exist on every
  // tenant-scoped table. Phase 2 D-19 names: program_tenant_isolation,
  // program_version_tenant_isolation, program_rule_tenant_isolation,
  // rule_citation_tenant_isolation, lender_overlay_rule_tenant_isolation.
  const { rows: policies } = await globalThis.__pgPool.query<{ polname: string }>(
    `SELECT polname FROM pg_policy WHERE polrelid::regclass::text IN (
       'tenant', '_rls_canary',
       'program', 'program_version', 'program_rule', 'rule_citation', 'lender_overlay_rule'
     )`,
  );
  const polNames = new Set(policies.map((p) => p.polname));
  const required = [
    'tenant_self_filter',
    'canary_tenant_isolation',
    'program_tenant_isolation',
    'program_version_tenant_isolation',
    'program_rule_tenant_isolation',
    'rule_citation_tenant_isolation',
    'lender_overlay_rule_tenant_isolation',
  ];
  const missing = required.filter((p) => !polNames.has(p));
  if (missing.length > 0) {
    throw new Error(
      `Expected RLS policies [${required.join(', ')}]; missing [${missing.join(', ')}]. Migrations may not have applied. Aborting.`,
    );
  }
});

afterAll(async () => {
  await globalThis.__pgPool?.end();
  await globalThis.__pgAdminPool?.end();
});
