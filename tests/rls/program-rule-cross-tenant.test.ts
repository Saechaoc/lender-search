/**
 * Cross-tenant pen tests for `program_rule` table (D-19 / T-2-01 / SCH-01).
 *
 * program_rule rows carry the rule_kind + rule_body that Phase 4 evaluator
 * walks; tenant isolation here is critical for the antitrust posture
 * (Pitfall 3.5: tenant A's overlay rules MUST NOT leak to tenant B).
 *
 * D-03 matrix per CONTEXT D-19: 6 cases — cross-tenant SELECT, anonymous,
 * in-tenant SELECT, cross-tenant INSERT (RLS reject), cross-tenant UPDATE
 * (0 rowCount), cross-tenant DELETE (0 rowCount).
 */
import { describe, expect, it } from 'vitest';
import { connectAsAnonymous, connectAsTenant } from './fixtures/connection.js';
import { seedTwoTenants } from './seedTwoTenants.js';

describe('RLS: cross-tenant access on program_rule table (D-19 / T-2-01)', () => {
  it('cross-tenant SELECT returns 0 rows', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const { rows } = await client.query(
        `SELECT id::text FROM program_rule WHERE id = $1::uuid`,
        [seed.programRuleB],
      );
      expect(rows).toHaveLength(0);
    });
  });

  it('connectAsAnonymous returns 0 rows', async () => {
    await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsAnonymous(globalThis.__pgPool, async (client) => {
      const { rows } = await client.query(`SELECT id::text FROM program_rule`);
      expect(rows).toHaveLength(0);
    });
  });

  it('in-tenant SELECT returns the in-tenant row', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id::text AS id FROM program_rule WHERE id = $1::uuid`,
        [seed.programRuleA],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(seed.programRuleA);
    });
  });

  it('cross-tenant INSERT with mismatched tenant_id is rejected', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await expect(
      connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
        await client.query(
          `INSERT INTO program_rule (
             tenant_id, program_version_id, layer, rule_kind,
             rule_body, primary_citation_id
           ) VALUES ($1, $2, 'INVESTOR_OVERLAY', 'ltv_max',
                     '{"value": 99}'::jsonb, $3)`,
          [seed.tenantB, seed.programVersionA, seed.citationA],
        );
      }),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it('cross-tenant UPDATE affects 0 rows', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const result = await client.query(
        `UPDATE program_rule SET rule_body = '{"value": 99}'::jsonb WHERE id = $1::uuid`,
        [seed.programRuleB],
      );
      expect(result.rowCount).toBe(0);
    });
  });

  it('cross-tenant DELETE affects 0 rows', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const result = await client.query(
        `DELETE FROM program_rule WHERE id = $1::uuid`,
        [seed.programRuleB],
      );
      expect(result.rowCount).toBe(0);
    });
  });
});
