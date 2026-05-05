/**
 * Schema constraint: rule_citation source CHECK (D-03 / D-20.8).
 */
import { describe, expect, it } from 'vitest';
import { connectAsTenant } from '../rls/fixtures/connection.js';
import { seedTenantWithProgramAndCitation, seedAgencyDerogRule } from './fixtures/seed.js';
import { fnmaForeclosure } from '../rules/fixtures/fnma-foreclosure.js';

describe('rule_citation source CHECK (D-20.8)', () => {
  it('rejects INSERT with both source_pdf_sha256 NULL AND source_url NULL', async () => {
    const agencySeed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-01-01,2027-01-01)', fnmaForeclosure);
    const seed = await seedTenantWithProgramAndCitation(globalThis.__pgPool, globalThis.__pgAdminPool, agencySeed.agencyRuleVersionId);

    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      await expect(
        client.query(`INSERT INTO rule_citation (tenant_id, excerpt) VALUES ($1, 'no source')`, [seed.tenantId]),
      ).rejects.toThrow(/check constraint "rule_citation_has_source"/i);
    });
  });

  it('accepts INSERT with only source_url', async () => {
    const agencySeed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-01-01,2027-01-01)', fnmaForeclosure);
    const seed = await seedTenantWithProgramAndCitation(globalThis.__pgPool, globalThis.__pgAdminPool, agencySeed.agencyRuleVersionId);

    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO rule_citation (tenant_id, source_url, excerpt) VALUES ($1, 'https://example.com', 'has url') RETURNING id::text`,
        [seed.tenantId],
      );
      expect(result.rows).toHaveLength(1);
    });
  });

  it('accepts INSERT with only source_pdf_sha256', async () => {
    const agencySeed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-01-01,2027-01-01)', fnmaForeclosure);
    const seed = await seedTenantWithProgramAndCitation(globalThis.__pgPool, globalThis.__pgAdminPool, agencySeed.agencyRuleVersionId);

    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO rule_citation (tenant_id, source_pdf_sha256, excerpt) VALUES ($1, 'abc123', 'has pdf hash') RETURNING id::text`,
        [seed.tenantId],
      );
      expect(result.rows).toHaveLength(1);
    });
  });
});
