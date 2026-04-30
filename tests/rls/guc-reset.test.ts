/**
 * GUC reset / T-01-05: after each transaction (COMMIT or ROLLBACK), the
 * `app.tenant_id` GUC's effect dies. is_local=true ensures the GUC is
 * transaction-scoped, not session-scoped — pooled-connection reuse cannot
 * leak the GUC's value across requests in any way that affects RLS.
 *
 * Postgres 16 quirk: once a placeholder GUC has been touched in a session,
 * it remains DEFINED for the life of that session — RESET / DISCARD ALL
 * leave it as the empty string '' rather than reverting it to NULL. The
 * load-bearing assertion is therefore "the VALUE set by set_config(...,
 * true) does not survive ROLLBACK" (the post-ROLLBACK value is no longer
 * the uuid we set; it's '' or NULL depending on whether the session has
 * ever been touched). Both outcomes fail closed under the RLS policy
 * because '' and NULL both fail to cast to a uuid that matches any row.
 *
 * Closes D-03 row #6 ("GUC reset between cases (transactional rollback per test)").
 */
import { describe, expect, it } from 'vitest';
import { connectAsTenant } from './fixtures/connection.js';
import { seedTwoTenants } from './fixtures/tenants.js';

describe('RLS: GUC reset (T-01-05)', () => {
  it('after connectAsTenant ROLLBACK, the GUC value does NOT match the previously-set tenant', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const { rows } = await client.query(`SELECT id FROM _rls_canary`);
      expect(rows).toHaveLength(1);
    });

    // Open a fresh transaction on the SAME pool. The pool may hand us the
    // same physical connection (recycled). is_local=true means the value
    // we set inside connectAsTenant did not persist past its ROLLBACK.
    const client = await globalThis.__pgPool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{
        guc: string | null;
        matches_a: boolean;
      }>(
        `SELECT current_setting('app.tenant_id', true) AS guc,
                current_setting('app.tenant_id', true) = $1 AS matches_a`,
        [seed.tenantA],
      );
      // The GUC value MUST NOT still be Tenant A's id — that would prove
      // the previous transaction's set_config leaked. It is permitted to
      // be NULL (truly fresh session) or '' (placeholder GUC residue).
      expect(rows[0]!.matches_a).toBe(false);
      // current_setting returns NULL on a never-touched session, '' on a
      // touched-then-RESET session. Either is fail-closed under the policy.
      const guc = rows[0]!.guc;
      expect(guc === null || guc === '').toBe(true);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it("two consecutive connectAsTenant calls don't leak the first tenant's GUC into the second", async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool);

    // Visit A first — should see exactly one canary (A's).
    let aRowCount: number | null = null;
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const { rows } = await client.query(`SELECT id FROM _rls_canary`);
      aRowCount = rows.length;
    });
    expect(aRowCount).toBe(1);

    // Visit B next — should see exactly one canary (B's). If A's GUC leaked,
    // we would see 0 rows here (A's GUC + B's data → mismatch → 0).
    let bRows: { id: string }[] = [];
    await connectAsTenant(globalThis.__pgPool, seed.tenantB, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id::text AS id FROM _rls_canary`,
      );
      bRows = rows;
    });
    expect(bRows).toHaveLength(1);
    expect(bRows[0]!.id).toBe(seed.canaryB);
  });

  it('within a transaction, set_config returns the new value (Postgres semantics sanity)', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool);
    const client = await globalThis.__pgPool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ set_config: string }>(
        `SELECT set_config('app.tenant_id', $1, true) AS set_config`,
        [seed.tenantA],
      );
      expect(rows[0]!.set_config).toBe(seed.tenantA);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
