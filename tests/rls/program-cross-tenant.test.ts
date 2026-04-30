/**
 * Cross-tenant pen tests for `program` table (Phase 2 D-19 / TNT-01-04 / T-2-01).
 *
 * Mirrors the D-03 matrix from Phase 1 tests/rls/cross-tenant-select.test.ts +
 * cross-tenant-write.test.ts. Closes T-2-01 for the new tenant-scoped
 * `program` table.
 *
 * D-03 matrix per CONTEXT D-19:
 *   1. cross-tenant SELECT returns 0 rows
 *   2. anonymous (no GUC) returns 0 rows
 *   3. in-tenant SELECT returns the in-tenant row
 *   4. cross-tenant INSERT with mismatched tenant_id is rejected (RLS)
 *   5. cross-tenant UPDATE on foreign tenant row affects 0 rows
 *   6. cross-tenant DELETE on foreign tenant row affects 0 rows
 */
import { describe, expect, it } from 'vitest';
import { connectAsAnonymous, connectAsTenant } from './fixtures/connection.js';
import { seedTwoTenants } from './seedTwoTenants.js';

describe('RLS: cross-tenant access on program table (D-19 / T-2-01)', () => {
  it('cross-tenant SELECT returns 0 rows when GUC is A and target is B', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const { rows } = await client.query(
        `SELECT id::text FROM program WHERE id = $1::uuid`,
        [seed.programB],
      );
      expect(rows).toHaveLength(0);
    });
  });

  it('connectAsAnonymous returns 0 rows (no GUC; policy fails closed)', async () => {
    await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsAnonymous(globalThis.__pgPool, async (client) => {
      const { rows } = await client.query(`SELECT id::text FROM program`);
      expect(rows).toHaveLength(0);
    });
  });

  it('in-tenant SELECT returns the in-tenant row', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id::text AS id FROM program WHERE id = $1::uuid`,
        [seed.programA],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(seed.programA);
    });
  });

  it('cross-tenant INSERT with mismatched tenant_id is rejected', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await expect(
      connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
        // GUC is A; INSERT with tenant_id=B fails the WITH CHECK clause.
        await client.query(
          `INSERT INTO program (tenant_id, lender, channel, name)
           VALUES ($1, 'PennyMac', 'wholesale', 'Cross-Tenant Attempt')`,
          [seed.tenantB],
        );
      }),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it('cross-tenant UPDATE on foreign tenant row affects 0 rows', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const result = await client.query(
        `UPDATE program SET name = 'HACKED' WHERE id = $1::uuid`,
        [seed.programB],
      );
      expect(result.rowCount).toBe(0);
    });
  });

  it('cross-tenant DELETE on foreign tenant row affects 0 rows', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const result = await client.query(
        `DELETE FROM program WHERE id = $1::uuid`,
        [seed.programB],
      );
      expect(result.rowCount).toBe(0);
    });
  });
});
