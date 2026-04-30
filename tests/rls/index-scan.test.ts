/**
 * TNT-03 / T-01-08: tenant_id is indexed on _rls_canary, and Postgres uses
 * the index for tenant-scoped lookups.
 *
 * Postgres may choose seq scan on tiny test data (the planner thinks seq is
 * cheaper than index for <100 rows). We force the planner's hand with
 * `SET LOCAL enable_seqscan = off`, which validates the index EXISTS and
 * IS USABLE — not that the planner chooses it under realistic data volumes
 * (which is a Phase 2+ concern).
 *
 * Closes D-03 row "EXPLAIN uses index scan" + RESEARCH §Open Questions Q4.
 */
import { describe, expect, it } from 'vitest';
import { connectAsTenant } from './fixtures/connection.js';
import { seedTwoTenants } from './fixtures/tenants.js';

describe('TNT-03: tenant_id index on _rls_canary', () => {
  it('rls_canary_tenant_idx exists in pg_indexes', async () => {
    const { rows } = await globalThis.__pgPool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = '_rls_canary'`,
    );
    const idxNames = rows.map((r) => r.indexname);
    expect(idxNames).toContain('rls_canary_tenant_idx');
  });

  it('EXPLAIN on tenant_id lookup uses Index Scan (with seqscan disabled)', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      // Defeat the small-table planner heuristic.
      await client.query('SET LOCAL enable_seqscan = off');

      const { rows } = await client.query<Record<string, unknown>>(
        `EXPLAIN (FORMAT JSON) SELECT id FROM _rls_canary WHERE tenant_id = $1`,
        [seed.tenantA],
      );
      // EXPLAIN (FORMAT JSON) returns a single row whose `QUERY PLAN`
      // column is a JSON array of plan nodes.
      const plan = rows[0]!['QUERY PLAN'];
      const planJson = JSON.stringify(plan);
      // The plan should contain Index Scan (or Bitmap Index Scan via the
      // canary index). Neither Seq Scan nor a complete absence of index
      // references is acceptable.
      expect(planJson).toMatch(/Index (Scan|Only Scan)|Bitmap Index Scan/);
      expect(planJson).toContain('rls_canary_tenant_idx');
    });
  });
});
