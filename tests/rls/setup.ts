/**
 * Vitest setupFiles — runs in each pen-test file's process.
 *
 * Two non-negotiable sanity checks happen here:
 *   1. The connection role must NOT be BYPASSRLS (Pitfall 4). If the
 *      connection accidentally connects as a superuser, RLS is silently
 *      bypassed and pen tests pass vacuously. Aborting the suite is the
 *      only safe response.
 *   2. `relforcerowsecurity` must be `true` for both tenant and _rls_canary
 *      (Pitfall 6). FORCE makes the table owner subject to RLS — without it,
 *      Plan 05's migration didn't apply correctly and the tests would pass
 *      for the wrong reason.
 *
 * The global pg.Pool is exposed via globalThis.__pgPool for fixture functions
 * that need direct DB access (seedTwoTenants, connectAsTenant). Vitest's
 * pool: 'forks' isolates each file into its own process, so the global is
 * file-scoped despite the name.
 *
 * Connects as `app_user` (NOBYPASSRLS NOSUPERUSER) so RLS is meaningful.
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { afterAll, beforeAll } from 'vitest';

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool;
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set for the pen-test suite to run.');
}

beforeAll(async () => {
  globalThis.__pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
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
  // MUST be active on every tenant-scoped table.
  const { rows: forced } = await globalThis.__pgPool.query<{
    relname: string;
    relforcerowsecurity: boolean;
  }>(
    `SELECT relname, relforcerowsecurity FROM pg_class WHERE relname IN ('tenant', '_rls_canary') ORDER BY relname`,
  );
  if (forced.length !== 2) {
    throw new Error(
      `Expected pg_class to list both 'tenant' and '_rls_canary'; got ${forced.length} rows. Migrations may not have applied. Aborting.`,
    );
  }
  for (const row of forced) {
    if (!row.relforcerowsecurity) {
      throw new Error(
        `Table '${row.relname}' does NOT have FORCE ROW LEVEL SECURITY. Plan 05's 0001_force_rls.sql may not have applied. Aborting.`,
      );
    }
  }

  // Sanity check 3: both expected policies exist.
  const { rows: policies } = await globalThis.__pgPool.query<{ polname: string }>(
    `SELECT polname FROM pg_policy WHERE polrelid::regclass::text IN ('tenant', '_rls_canary')`,
  );
  const polNames = policies.map((p) => p.polname);
  if (!polNames.includes('tenant_self_filter') || !polNames.includes('canary_tenant_isolation')) {
    throw new Error(
      `Expected policies 'tenant_self_filter' and 'canary_tenant_isolation'; got [${polNames.join(', ')}]. Migrations may not have applied. Aborting.`,
    );
  }
});

afterAll(async () => {
  await globalThis.__pgPool?.end();
});
