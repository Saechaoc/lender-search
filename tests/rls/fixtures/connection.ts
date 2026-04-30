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
 * connectAsAnonymous — same as connectAsTenant but does NOT set the GUC.
 * Asserts that without a tenant context, current_setting(..., true) is NULL,
 * so RLS policies fail and zero rows return.
 */
import type { Pool, PoolClient } from 'pg';

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

export async function connectAsAnonymous<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Intentionally do NOT call set_config. current_setting('app.tenant_id', true)
    // returns NULL → RLS policies fail closed → zero rows.
    const result = await fn(client);
    await client.query('ROLLBACK');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* swallow */
    }
    throw err;
  } finally {
    client.release();
  }
}
