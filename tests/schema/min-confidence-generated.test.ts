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

  it('handles field_confidence with non-numeric values gracefully (WR-02)', async () => {
    // Regression for WR-02: jsonb_min_numeric must skip non-numeric entries
    // rather than raise inside the GENERATED ALWAYS AS STORED expression.
    // Without the regex filter, a stray non-numeric entry (e.g. {"flag":
    // true}) would cause `(value)::numeric` to raise "invalid input syntax
    // for type numeric", rejecting the entire INSERT. The resilient wrapper
    // computes MIN over numeric-shaped values only and ignores the rest;
    // this mixed-shape input therefore lands min_confidence=0.8 (skipping
    // the boolean), not an INSERT failure.
    const agencySeed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-01-01,2027-01-01)', fnmaForeclosure);
    const seed = await seedTenantWithProgramAndCitation(globalThis.__pgPool, globalThis.__pgAdminPool, agencySeed.agencyRuleVersionId);

    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      const result = await client.query<{ min_confidence: string | null }>(
        `INSERT INTO program_rule (tenant_id, program_version_id, layer, rule_kind, rule_body, field_confidence, primary_citation_id)
         VALUES ($1, $2, 'INVESTOR_OVERLAY', 'ltv_max', '{"value": 80}'::jsonb, '{"flag": true, "score": 0.8}'::jsonb, $3)
         RETURNING min_confidence::text`,
        [seed.tenantId, seed.programVersionId, seed.citationId],
      );
      // Boolean entry is skipped; minimum of remaining numeric entries is 0.8.
      expect(Number(result.rows[0]?.min_confidence)).toBeCloseTo(0.8, 5);
    });
  });

  it('returns NULL when field_confidence has only non-numeric values (WR-02)', async () => {
    // All entries non-numeric -> the filter excludes everything -> MIN over
    // an empty set returns NULL, which is the same semantics as the empty-
    // jsonb case at line 25-38. The INSERT still succeeds.
    const agencySeed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-01-01,2027-01-01)', fnmaForeclosure);
    const seed = await seedTenantWithProgramAndCitation(globalThis.__pgPool, globalThis.__pgAdminPool, agencySeed.agencyRuleVersionId);

    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      const result = await client.query<{ min_confidence: string | null }>(
        `INSERT INTO program_rule (tenant_id, program_version_id, layer, rule_kind, rule_body, field_confidence, primary_citation_id)
         VALUES ($1, $2, 'INVESTOR_OVERLAY', 'ltv_max', '{"value": 80}'::jsonb, '{"flag": true, "label": "high"}'::jsonb, $3)
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
