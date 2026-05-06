/**
 * Schema constraint: rule_citation_excerpt_length_check (Plan 03 review WR-02).
 *
 * Migration 0016 enforces excerpt length ≤ 500 chars at the DB layer. The
 * Phase 2 plan asserted the cap but no constraint was actually wired in.
 * This test gates the constraint so a future regression that drops it
 * fails CI.
 */
import { describe, expect, it } from 'vitest';
import { connectAsTenant } from '../rls/fixtures/connection.js';
import { seedTenantWithProgramAndCitation, seedAgencyDerogRule } from './fixtures/seed.js';
import { fnmaForeclosure } from '../rules/fixtures/fnma-foreclosure.js';

describe('rule_citation excerpt length CHECK (WR-02 / migration 0016)', () => {
  it('rejects INSERT with excerpt > 500 chars', async () => {
    const agencySeed = await seedAgencyDerogRule(
      globalThis.__pgAdminPool,
      'FNMA',
      '[2026-01-01,2027-01-01)',
      fnmaForeclosure,
    );
    const seed = await seedTenantWithProgramAndCitation(
      globalThis.__pgPool,
      globalThis.__pgAdminPool,
      agencySeed.agencyRuleVersionId,
    );

    const overCap = 'x'.repeat(501);
    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      await expect(
        client.query(
          `INSERT INTO rule_citation (tenant_id, source_url, excerpt)
           VALUES ($1, 'https://example.com/over-cap', $2)`,
          [seed.tenantId, overCap],
        ),
      ).rejects.toThrow(/rule_citation_excerpt_length_check/i);
    });
  });

  it('accepts INSERT with excerpt exactly 500 chars', async () => {
    const agencySeed = await seedAgencyDerogRule(
      globalThis.__pgAdminPool,
      'FNMA',
      '[2026-01-01,2027-01-01)',
      fnmaForeclosure,
    );
    const seed = await seedTenantWithProgramAndCitation(
      globalThis.__pgPool,
      globalThis.__pgAdminPool,
      agencySeed.agencyRuleVersionId,
    );

    const exactly500 = 'y'.repeat(500);
    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO rule_citation (tenant_id, source_url, excerpt)
         VALUES ($1, 'https://example.com/exactly-500', $2)
         RETURNING id::text`,
        [seed.tenantId, exactly500],
      );
      expect(result.rows).toHaveLength(1);
    });
  });
});
