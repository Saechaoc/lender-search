/**
 * Schema policy: agency_rule cross-tenant readable via world_read (D-20.7).
 */
import { describe, expect, it } from 'vitest';
import { connectAsAnonymous, connectAsTenant } from '../rls/fixtures/connection.js';
import { seedTenantWithProgramAndCitation, seedAgencyDerogRule } from './fixtures/seed.js';
import { fnmaForeclosure } from '../rules/fixtures/fnma-foreclosure.js';

describe('agency_rule cross-tenant readability (D-20.7)', () => {
  it('SELECT from agency_rule succeeds under connectAsTenant(A)', async () => {
    const agencySeed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-01-01,2027-01-01)', fnmaForeclosure);
    const seed = await seedTenantWithProgramAndCitation(globalThis.__pgPool, globalThis.__pgAdminPool, agencySeed.agencyRuleVersionId);

    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      const { rows } = await client.query(`SELECT id::text FROM agency_rule WHERE id = $1::uuid`, [agencySeed.agencyRuleId]);
      expect(rows).toHaveLength(1);
    });
  });

  it('SELECT from agency_rule succeeds under connectAsAnonymous (no GUC; world_read policy)', async () => {
    const agencySeed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-01-01,2027-01-01)', fnmaForeclosure);

    await connectAsAnonymous(globalThis.__pgPool, async (client) => {
      const { rows } = await client.query(`SELECT id::text FROM agency_rule WHERE id = $1::uuid`, [agencySeed.agencyRuleId]);
      expect(rows).toHaveLength(1);
    });
  });

  it('INSERT into agency_rule from app_user fails (system_write policy gates)', async () => {
    const agencySeed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-01-01,2027-01-01)', fnmaForeclosure);
    const seed = await seedTenantWithProgramAndCitation(globalThis.__pgPool, globalThis.__pgAdminPool, agencySeed.agencyRuleVersionId);

    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      await expect(
        client.query(
          `INSERT INTO agency_rule (agency_rule_version_id, rule_kind, rule_body, primary_citation_id)
           VALUES ($1, 'ltv_max', '{"value": 80}'::jsonb, $2)`,
          [agencySeed.agencyRuleVersionId, agencySeed.citationId],
        ),
      ).rejects.toThrow(/(permission denied|new row violates row-level security policy|policy)/i);
    });
  });
});
