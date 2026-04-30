/**
 * Cross-tenant pen tests for `rule_citation` table (D-19 / T-2-01 / SCH-13).
 *
 * D-03 matrix per CONTEXT D-19. rule_citation rows carry the page+bbox+excerpt
 * payload — citation discipline is a hard schema constraint (Pitfall 2.8 +
 * PROJECT.md §Conventions). Cross-tenant access here would expose another
 * tenant's source-document attribution (Phase 7 AM upload metadata).
 */
import { describe, expect, it } from 'vitest';
import { connectAsAnonymous, connectAsTenant } from './fixtures/connection.js';
import { seedTwoTenants } from './seedTwoTenants.js';

describe('RLS: cross-tenant access on rule_citation table (D-19 / T-2-01)', () => {
  it('cross-tenant SELECT returns 0 rows', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const { rows } = await client.query(
        `SELECT id::text FROM rule_citation WHERE id = $1::uuid`,
        [seed.citationB],
      );
      expect(rows).toHaveLength(0);
    });
  });

  it('connectAsAnonymous returns 0 rows', async () => {
    await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsAnonymous(globalThis.__pgPool, async (client) => {
      const { rows } = await client.query(`SELECT id::text FROM rule_citation`);
      expect(rows).toHaveLength(0);
    });
  });

  it('in-tenant SELECT returns the in-tenant row', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id::text AS id FROM rule_citation WHERE id = $1::uuid`,
        [seed.citationA],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(seed.citationA);
    });
  });

  it('cross-tenant INSERT with mismatched tenant_id is rejected', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await expect(
      connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
        await client.query(
          `INSERT INTO rule_citation (tenant_id, source_url, excerpt)
           VALUES ($1, 'https://hack.example', 'cross-tenant insert attempt')`,
          [seed.tenantB],
        );
      }),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it('cross-tenant UPDATE affects 0 rows', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const result = await client.query(
        `UPDATE rule_citation SET excerpt = 'HACKED' WHERE id = $1::uuid`,
        [seed.citationB],
      );
      expect(result.rowCount).toBe(0);
    });
  });

  it('cross-tenant DELETE affects 0 rows', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const result = await client.query(
        `DELETE FROM rule_citation WHERE id = $1::uuid`,
        [seed.citationB],
      );
      expect(result.rowCount).toBe(0);
    });
  });
});
