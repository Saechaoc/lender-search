/**
 * Schema function: detect_loosenings(uuid) (D-12 / D-14 / D-20.5).
 */
import { describe, expect, it } from 'vitest';
import { connectAsTenant } from '../rls/fixtures/connection.js';
import { seedTenantWithProgramAndCitation, seedAgencyDerogRule } from './fixtures/seed.js';
import { fnmaForeclosure } from '../rules/fixtures/fnma-foreclosure.js';

describe('detect_loosenings(uuid) (D-20.5)', () => {
  it('returns 1 row when overlay loosens ltv_max above agency', async () => {
    const agencySeed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-01-01,2027-01-01)', fnmaForeclosure);
    const seed = await seedTenantWithProgramAndCitation(globalThis.__pgPool, globalThis.__pgAdminPool, agencySeed.agencyRuleVersionId);

    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      await adminClient.query(
        `INSERT INTO agency_rule (agency_rule_version_id, rule_kind, rule_body, primary_citation_id)
         VALUES ($1, 'ltv_max', '{"value": 95}'::jsonb, $2)`,
        [agencySeed.agencyRuleVersionId, agencySeed.citationId],
      );
    } finally {
      adminClient.release();
    }

    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      await client.query(
        `INSERT INTO program_rule (tenant_id, program_version_id, layer, rule_kind, rule_body, primary_citation_id)
         VALUES ($1, $2, 'INVESTOR_OVERLAY', 'ltv_max', '{"value": 97}'::jsonb, $3)`,
        [seed.tenantId, seed.programVersionId, seed.citationId],
      );

      const { rows } = await client.query(`SELECT * FROM detect_loosenings($1::uuid)`, [seed.programVersionId]);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.find((r) => r.dimension === 'ltv_max')).toBeTruthy();
    });
  });

  it('returns 0 rows when overlay is restrictive (overlay <= agency)', async () => {
    const agencySeed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-01-01,2027-01-01)', fnmaForeclosure);
    const seed = await seedTenantWithProgramAndCitation(globalThis.__pgPool, globalThis.__pgAdminPool, agencySeed.agencyRuleVersionId);

    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      await adminClient.query(
        `INSERT INTO agency_rule (agency_rule_version_id, rule_kind, rule_body, primary_citation_id)
         VALUES ($1, 'ltv_max', '{"value": 95}'::jsonb, $2)`,
        [agencySeed.agencyRuleVersionId, agencySeed.citationId],
      );
    } finally {
      adminClient.release();
    }

    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      await client.query(
        `INSERT INTO program_rule (tenant_id, program_version_id, layer, rule_kind, rule_body, primary_citation_id)
         VALUES ($1, $2, 'INVESTOR_OVERLAY', 'ltv_max', '{"value": 80}'::jsonb, $3)`,
        [seed.tenantId, seed.programVersionId, seed.citationId],
      );

      const { rows } = await client.query(`SELECT * FROM detect_loosenings($1::uuid)`, [seed.programVersionId]);
      expect(rows.find((r) => r.dimension === 'ltv_max')).toBeUndefined();
    });
  });
});
