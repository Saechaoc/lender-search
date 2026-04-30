/**
 * Schema constraint: program_rule.primary_citation_id (D-01 / SCH-13).
 */
import { describe, expect, it } from 'vitest';
import { connectAsTenant } from '../rls/fixtures/connection.js';
import { seedTenantWithProgramAndCitation, seedAgencyDerogRule } from './fixtures/seed.js';
import { fnmaForeclosure } from '../rules/fixtures/fnma-foreclosure.js';

describe('program_rule.primary_citation_id citation discipline (D-01 / SCH-13)', () => {
  it('rejects INSERT without primary_citation_id (NOT NULL violation)', async () => {
    const agencySeed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-01-01,2027-01-01)', fnmaForeclosure);
    const seed = await seedTenantWithProgramAndCitation(globalThis.__pgPool, globalThis.__pgAdminPool, agencySeed.agencyRuleVersionId);

    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      await expect(
        client.query(
          `INSERT INTO program_rule (tenant_id, program_version_id, layer, rule_kind, rule_body)
           VALUES ($1, $2, 'INVESTOR_OVERLAY', 'ltv_max', '{"value": 80}'::jsonb)`,
          [seed.tenantId, seed.programVersionId],
        ),
      ).rejects.toThrow(/null value in column "primary_citation_id"/i);
    });
  });

  it('rejects INSERT with non-existent primary_citation_id (FK violation)', async () => {
    const agencySeed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-01-01,2027-01-01)', fnmaForeclosure);
    const seed = await seedTenantWithProgramAndCitation(globalThis.__pgPool, globalThis.__pgAdminPool, agencySeed.agencyRuleVersionId);

    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      await expect(
        client.query(
          `INSERT INTO program_rule (tenant_id, program_version_id, layer, rule_kind, rule_body, primary_citation_id)
           VALUES ($1, $2, 'INVESTOR_OVERLAY', 'ltv_max', '{"value": 80}'::jsonb, '00000000-0000-0000-0000-000000000000'::uuid)`,
          [seed.tenantId, seed.programVersionId],
        ),
      ).rejects.toThrow(/violates foreign key constraint/i);
    });
  });

  it('accepts INSERT with valid primary_citation_id', async () => {
    const agencySeed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-01-01,2027-01-01)', fnmaForeclosure);
    const seed = await seedTenantWithProgramAndCitation(globalThis.__pgPool, globalThis.__pgAdminPool, agencySeed.agencyRuleVersionId);

    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO program_rule (tenant_id, program_version_id, layer, rule_kind, rule_body, primary_citation_id)
         VALUES ($1, $2, 'INVESTOR_OVERLAY', 'ltv_max', '{"value": 80}'::jsonb, $3)
         RETURNING id::text`,
        [seed.tenantId, seed.programVersionId, seed.citationId],
      );
      expect(result.rows).toHaveLength(1);
    });
  });
});
