/**
 * Schema constraint: program_rule.layer pgEnum (D-05 / SCH-01).
 */
import { describe, expect, it } from 'vitest';
import { connectAsTenant } from '../rls/fixtures/connection.js';
import { seedTenantWithProgramAndCitation, seedAgencyDerogRule } from './fixtures/seed.js';
import { fnmaForeclosure } from '../rules/fixtures/fnma-foreclosure.js';

describe('program_rule.layer enum constraint (D-05 / SCH-01)', () => {
  it('accepts INSERT with layer=INVESTOR_OVERLAY', async () => {
    const agencySeed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-01-01,2027-01-01)', fnmaForeclosure);
    const seed = await seedTenantWithProgramAndCitation(globalThis.__pgPool, globalThis.__pgAdminPool, agencySeed.agencyRuleVersionId);

    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO program_rule (tenant_id, program_version_id, layer, rule_kind, rule_body, primary_citation_id)
         VALUES ($1, $2, 'INVESTOR_OVERLAY', 'ltv_max', '{"value": 80}'::jsonb, $3) RETURNING id::text`,
        [seed.tenantId, seed.programVersionId, seed.citationId],
      );
      expect(result.rows).toHaveLength(1);
    });
  });

  it('accepts INSERT with layer=PRODUCT_FEATURE', async () => {
    const agencySeed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-01-01,2027-01-01)', fnmaForeclosure);
    const seed = await seedTenantWithProgramAndCitation(globalThis.__pgPool, globalThis.__pgAdminPool, agencySeed.agencyRuleVersionId);

    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO program_rule (tenant_id, program_version_id, layer, rule_kind, rule_body, primary_citation_id)
         VALUES ($1, $2, 'PRODUCT_FEATURE', 'manual_uw_path', '{"allowed": true}'::jsonb, $3) RETURNING id::text`,
        [seed.tenantId, seed.programVersionId, seed.citationId],
      );
      expect(result.rows).toHaveLength(1);
    });
  });

  it('rejects INSERT with layer=AGENCY_BASE (not in enum)', async () => {
    const agencySeed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-01-01,2027-01-01)', fnmaForeclosure);
    const seed = await seedTenantWithProgramAndCitation(globalThis.__pgPool, globalThis.__pgAdminPool, agencySeed.agencyRuleVersionId);

    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      await expect(
        client.query(
          `INSERT INTO program_rule (tenant_id, program_version_id, layer, rule_kind, rule_body, primary_citation_id)
           VALUES ($1, $2, 'AGENCY_BASE', 'ltv_max', '{"value": 95}'::jsonb, $3)`,
          [seed.tenantId, seed.programVersionId, seed.citationId],
        ),
      ).rejects.toThrow(/invalid input value for enum program_rule_layer.*AGENCY_BASE/i);
    });
  });
});
