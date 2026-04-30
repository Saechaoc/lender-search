/**
 * Schema constraint: program_version EXCLUDE (D-15 / SC#3 / D-20.3).
 */
import { describe, expect, it } from 'vitest';
import { connectAsTenant } from '../rls/fixtures/connection.js';
import { seedTenantWithProgramAndCitation, seedAgencyDerogRule } from './fixtures/seed.js';
import { fnmaForeclosure } from '../rules/fixtures/fnma-foreclosure.js';

describe('program_version EXCLUDE constraint (D-20.3)', () => {
  it('blocks two overlapping state=active rows for same program; allows for different states', async () => {
    const agencySeed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-01-01,2027-01-01)', fnmaForeclosure);
    const seed = await seedTenantWithProgramAndCitation(globalThis.__pgPool, globalThis.__pgAdminPool, agencySeed.agencyRuleVersionId);

    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      await client.query(
        `INSERT INTO program_version (tenant_id, program_id, agency_rule_version_id, effective_period, state, source_document_fingerprint)
         VALUES ($1, $2, $3, '[2027-01-01,2027-12-31)', 'active', 'sha256:abc')`,
        [seed.tenantId, seed.programId, agencySeed.agencyRuleVersionId],
      );

      // Use SAVEPOINT so the EXCLUDE failure doesn't abort the outer transaction.
      await client.query('SAVEPOINT before_overlap');
      await expect(
        client.query(
          `INSERT INTO program_version (tenant_id, program_id, agency_rule_version_id, effective_period, state, source_document_fingerprint)
           VALUES ($1, $2, $3, '[2027-06-01,2028-06-01)', 'active', 'sha256:def')`,
          [seed.tenantId, seed.programId, agencySeed.agencyRuleVersionId],
        ),
      ).rejects.toThrow(/conflicting key value violates exclusion constraint/i);
      await client.query('ROLLBACK TO SAVEPOINT before_overlap');

      const allowed = await client.query(
        `INSERT INTO program_version (tenant_id, program_id, agency_rule_version_id, effective_period, state, source_document_fingerprint)
         VALUES ($1, $2, $3, '[2027-06-01,2028-06-01)', 'draft', 'sha256:ghi')
         RETURNING id::text`,
        [seed.tenantId, seed.programId, agencySeed.agencyRuleVersionId],
      );
      expect(allowed.rows).toHaveLength(1);
    });
  });

  it('allows adjacent (non-overlapping) active ranges per Pitfall A half-open daterange', async () => {
    const agencySeed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-01-01,2027-01-01)', fnmaForeclosure);
    const seed = await seedTenantWithProgramAndCitation(globalThis.__pgPool, globalThis.__pgAdminPool, agencySeed.agencyRuleVersionId);

    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      await client.query(
        `INSERT INTO program_version (tenant_id, program_id, agency_rule_version_id, effective_period, state, source_document_fingerprint)
         VALUES ($1, $2, $3, '[2027-01-01,2027-12-31)', 'active', 'sha256:abc')`,
        [seed.tenantId, seed.programId, agencySeed.agencyRuleVersionId],
      );
      const adjacent = await client.query(
        `INSERT INTO program_version (tenant_id, program_id, agency_rule_version_id, effective_period, state, source_document_fingerprint)
         VALUES ($1, $2, $3, '[2027-12-31,2028-12-31)', 'active', 'sha256:def')
         RETURNING id::text`,
        [seed.tenantId, seed.programId, agencySeed.agencyRuleVersionId],
      );
      expect(adjacent.rows).toHaveLength(1);
    });
  });
});
