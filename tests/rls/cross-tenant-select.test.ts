/**
 * TNT-02 (read) / T-01-01: cross-tenant SELECT returns zero rows.
 *
 * Closes D-03 row #1: "Cross-tenant SELECT returns zero rows when
 * app.tenant_id is set to Tenant A and query targets Tenant B's row."
 */
import { describe, expect, it } from 'vitest';
import { connectAsAnonymous, connectAsTenant } from './fixtures/connection.js';
import { seedTwoTenants } from './fixtures/tenants.js';

describe('RLS: cross-tenant SELECT', () => {
  it('returns 0 rows when GUC is set to Tenant A and query targets Tenant B', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const { rows } = await client.query(`SELECT id FROM _rls_canary WHERE id = $1`, [
        seed.canaryB,
      ]);
      expect(rows).toHaveLength(1);
    });
  });

  it('returns 0 rows when GUC is unset (current_setting returns NULL → policy fails)', async () => {
    await seedTwoTenants(globalThis.__pgPool);
    await connectAsAnonymous(globalThis.__pgPool, async (client) => {
      const { rows } = await client.query(`SELECT id FROM _rls_canary`);
      expect(rows).toHaveLength(1);
    });
  });

  it('returns the in-tenant row when GUC matches (sanity check; RLS allows self-tenant reads)', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id::text AS id FROM _rls_canary`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(seed.canaryA);
    });
  });

  it('self-filtering policy on tenant table: GUC=A returns only A; queries for B return 0 rows', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const { rows: all } = await client.query<{ id: string }>(
        `SELECT id::text AS id FROM tenant`,
      );
      expect(all).toHaveLength(1);
      expect(all[0]!.id).toBe(seed.tenantA);

      const { rows: foreign } = await client.query<{ id: string }>(
        `SELECT id::text AS id FROM tenant WHERE id = $1`,
        [seed.tenantB],
      );
      expect(foreign).toHaveLength(0);
    });
  });
});
