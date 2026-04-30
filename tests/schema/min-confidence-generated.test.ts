/**
 * Schema column: program_rule.min_confidence GENERATED STORED (D-10 / Pitfall C).
 */
import { describe, expect, it } from 'vitest';
import { connectAsTenant } from '../rls/fixtures/connection.js';
import { seedTenantWithProgramAndCitation, seedAgencyDerogRule } from './fixtures/seed.js';
import { fnmaForeclosure } from '../rules/fixtures/fnma-foreclosure.js';

describe('program_rule.min_confidence GENERATED STORED (D-10)', () => {
  it('computes min from field_confidence jsonb', async () => {
    const agencySeed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-01-01,2027-01-01)', fnmaForeclosure);
    const seed = await seedTenantWithProgramAndCitation(globalThis.__pgPool, globalThis.__pgAdminPool, agencySeed.agencyRuleVersionId);

    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      const result = await client.query<{ min_confidence: string | null }>(
        `INSERT INTO program_rule (tenant_id, program_version_id, layer, rule_kind, rule_body, field_confidence, primary_citation_id)
         VALUES ($1, $2, 'INVESTOR_OVERLAY', 'ltv_max', '{"value": 80}'::jsonb, '{"a": 0.9, "b": 0.7}'::jsonb, $3)
         RETURNING min_confidence::text`,
        [seed.tenantId, seed.programVersionId, seed.citationId],
      );
      expect(result.rows[0]?.min_confidence).toBe('0.7');
    });
  });

  it('returns NULL when field_confidence is empty default', async () => {
    const agencySeed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-01-01,2027-01-01)', fnmaForeclosure);
    const seed = await seedTenantWithProgramAndCitation(globalThis.__pgPool, globalThis.__pgAdminPool, agencySeed.agencyRuleVersionId);

    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      const result = await client.query<{ min_confidence: string | null }>(
        `INSERT INTO program_rule (tenant_id, program_version_id, layer, rule_kind, rule_body, primary_citation_id)
         VALUES ($1, $2, 'INVESTOR_OVERLAY', 'ltv_max', '{"value": 80}'::jsonb, $3)
         RETURNING min_confidence::text`,
        [seed.tenantId, seed.programVersionId, seed.citationId],
      );
      expect(result.rows[0]?.min_confidence).toBeNull();
    });
  });

  it('rejects INSERT writing directly to min_confidence column (GENERATED)', async () => {
    const agencySeed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-01-01,2027-01-01)', fnmaForeclosure);
    const seed = await seedTenantWithProgramAndCitation(globalThis.__pgPool, globalThis.__pgAdminPool, agencySeed.agencyRuleVersionId);

    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      await expect(
        client.query(
          `INSERT INTO program_rule (tenant_id, program_version_id, layer, rule_kind, rule_body, field_confidence, primary_citation_id, min_confidence)
           VALUES ($1, $2, 'INVESTOR_OVERLAY', 'ltv_max', '{"value": 80}'::jsonb, '{"a": 0.5}'::jsonb, $3, 0.5)`,
          [seed.tenantId, seed.programVersionId, seed.citationId],
        ),
      ).rejects.toThrow(/cannot insert a non-DEFAULT value into column.*min_confidence/i);
    });
  });
});
