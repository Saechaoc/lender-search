/**
 * TNT-02 (write) / T-01-02: cross-tenant INSERT/UPDATE/DELETE rejected.
 *
 * Closes D-03 rows #2 + #3: "Cross-tenant INSERT with mismatched tenant_id
 * payload is rejected" + "Cross-tenant UPDATE/DELETE on Tenant B's row
 * from Tenant A's GUC affects zero rows."
 *
 * The WITH CHECK clause on canary_tenant_isolation policy rejects the
 * INSERT — Postgres raises error code 42501 (insufficient_privilege) with
 * message "new row violates row-level security policy". The UPDATE/DELETE
 * cases instead just affect zero rows because B's row is invisible (USING
 * clause filters before WITH CHECK can fire).
 */
import { describe, expect, it } from 'vitest';
import { connectAsTenant } from './fixtures/connection.js';
import { seedTwoTenants } from './seedTwoTenants.js';

describe('RLS: cross-tenant write', () => {
  it('INSERT _rls_canary with tenant_id=B while GUC=A → rejected by WITH CHECK', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool);
    await expect(
      connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
        await client.query(
          `INSERT INTO _rls_canary (tenant_id, payload) VALUES ($1, 'attacker')`,
          [seed.tenantB],
        );
      }),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it('UPDATE _rls_canary on B-row from GUC=A → 0 rows affected (row invisible)', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const result = await client.query(
        `UPDATE _rls_canary SET payload = 'pwned' WHERE id = $1`,
        [seed.canaryB],
      );
      expect(result.rowCount).toBe(0);
    });
  });

  it('DELETE _rls_canary on B-row from GUC=A → 0 rows affected', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const result = await client.query(`DELETE FROM _rls_canary WHERE id = $1`, [
        seed.canaryB,
      ]);
      expect(result.rowCount).toBe(0);
    });
  });

  it('INSERT _rls_canary with matching tenant_id=A while GUC=A → succeeds (sanity)', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO _rls_canary (tenant_id, payload) VALUES ($1, 'in-tenant') RETURNING id::text`,
        [seed.tenantA],
      );
      expect(result.rows).toHaveLength(1);
      // ROLLBACK in connectAsTenant tears this down — no persistence.
    });
  });
});
