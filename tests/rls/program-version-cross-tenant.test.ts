/**
 * Cross-tenant pen tests for `program_version` table (D-19 / T-2-01).
 *
 * D-03 matrix per CONTEXT D-19. program_version carries effective_period +
 * state + source_document_fingerprint — Phase 4 evaluator hydrates the
 * RuleSnapshot through this table. Cross-tenant access here would mean
 * tenant A's rule_stack snapshot for tenant B's loan — same antitrust
 * release-blocker class as program isolation (Pitfall 3.5).
 */
import { describe, expect, it } from 'vitest';
import { connectAsAnonymous, connectAsTenant } from './fixtures/connection.js';
import { seedTwoTenants } from './seedTwoTenants.js';

describe('RLS: cross-tenant access on program_version table (D-19 / T-2-01)', () => {
  it('cross-tenant SELECT returns 0 rows', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const { rows } = await client.query(
        `SELECT id::text FROM program_version WHERE id = $1::uuid`,
        [seed.programVersionB],
      );
      expect(rows).toHaveLength(0);
    });
  });

  it('connectAsAnonymous returns 0 rows', async () => {
    await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsAnonymous(globalThis.__pgPool, async (client) => {
      const { rows } = await client.query(`SELECT id::text FROM program_version`);
      expect(rows).toHaveLength(0);
    });
  });

  it('in-tenant SELECT returns the in-tenant row', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id::text AS id FROM program_version WHERE id = $1::uuid`,
        [seed.programVersionA],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(seed.programVersionA);
    });
  });

  it('cross-tenant INSERT with mismatched tenant_id is rejected', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await expect(
      connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
        await client.query(
          `INSERT INTO program_version (
             tenant_id, program_id, agency_rule_version_id,
             effective_period, state, source_document_fingerprint
           ) VALUES ($1, $2, $3, '[2028-01-01,2029-01-01)', 'draft', 'sha256:hack')`,
          [seed.tenantB, seed.programA, seed.sharedAgencyRuleVersionId],
        );
      }),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it('cross-tenant UPDATE affects 0 rows', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const result = await client.query(
        `UPDATE program_version SET state = 'sunset' WHERE id = $1::uuid`,
        [seed.programVersionB],
      );
      expect(result.rowCount).toBe(0);
    });
  });

  it('cross-tenant DELETE affects 0 rows', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const result = await client.query(
        `DELETE FROM program_version WHERE id = $1::uuid`,
        [seed.programVersionB],
      );
      expect(result.rowCount).toBe(0);
    });
  });
});
