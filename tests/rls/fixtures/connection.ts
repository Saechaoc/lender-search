/**
 * connectAsTenant — opens a transaction, sets the GUC, and yields a client
 * to a callback. ROLLBACK is automatic on exit so the GUC dies and no
 * test data persists.
 *
 * Mirrors the lib/tenant/context.ts::setTenantContext primitive but uses
 * `pg`'s `client.query` directly per CONTEXT §D-01 + RESEARCH §Pitfall 5.
 * The pen tests exercise the SQL contract, not the Drizzle TS abstraction.
 *
 * Usage:
 *   const seed = await seedTwoTenants(globalThis.__pgPool);
 *   await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
 *     const { rows } = await client.query(`SELECT id FROM _rls_canary`);
 *     expect(rows).toHaveLength(1);  // sees only A's canary
 *   });
 *
 * connectAsAnonymous — opens a FRESH pg.Client (NOT from the pool) so no
 * prior `set_config('app.tenant_id', ...)` call has touched this session.
 * `current_setting('app.tenant_id', true)` returns NULL → RLS policies fail
 * closed → zero rows. (Postgres 16 quirk: once a placeholder GUC has been
 * touched in a session, RESET / DISCARD ALL leave it as the empty string
 * '' rather than NULL, so the cast `''::uuid` raises 22P02. A fresh client
 * has never touched it, so the missing-ok variant of current_setting
 * returns NULL cleanly. See Plan 06 SUMMARY §Phase 7 Findings.)
 */
import { Client, type Pool, type PoolClient } from 'pg';

export async function connectAsTenant<T>(
  pool: Pool,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // is_local=true so the GUC dies with ROLLBACK or COMMIT.
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const result = await fn(client);
    // Always ROLLBACK in tests — the test's writes are throwaway, and
    // ROLLBACK is faster than COMMIT + cleanup.
    await client.query('ROLLBACK');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* swallow — transaction already aborted */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Open a fresh pg.Client (not pooled) so no prior session state — no prior
 * `set_config('app.tenant_id', ...)` — exists. The placeholder GUC has never
 * been touched in this session, so `current_setting('app.tenant_id', true)`
 * (missing-ok variant) returns NULL → policy fails closed → zero rows.
 *
 * The callback receives a `Client` (compatible with PoolClient at the query()
 * surface used by tests). Tests should not call `client.release()` — this
 * helper owns the connection lifecycle and `end()`s the fresh client itself.
 */
export async function connectAsAnonymous<T>(
  pool: Pool,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  // Reuse the pool's connection-string config so this helper is parameterized
  // the same way the rest of the harness is. `pool.options` is the pg.Pool
  // option bag (connectionString or host/port/db/user/pwd).
  const opts = (pool as unknown as { options: Record<string, unknown> }).options ?? {};
  const fresh = new Client(opts as ConstructorParameters<typeof Client>[0]);
  await fresh.connect();
  try {
    await fresh.query('BEGIN');
    // Intentionally do NOT call set_config. On this never-before-used session,
    // current_setting('app.tenant_id', true) returns NULL (not '') → RLS
    // policies fail closed → zero rows. See file header for the Postgres 16
    // placeholder-GUC quirk this works around.
    const result = await fn(fresh);
    await fresh.query('ROLLBACK');
    return result;
  } catch (err) {
    try {
      await fresh.query('ROLLBACK');
    } catch {
      /* swallow — transaction may already be aborted */
    }
    throw err;
  } finally {
    await fresh.end();
  }
}
