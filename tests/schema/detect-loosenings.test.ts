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

  it('derog_seasoning: overlay BK7 with shorter wait is NOT cross-paired against FORECLOSURE agency (event_type-scoped)', async () => {
    // Regression for CR-01: the derog_seasoning UNION branch must JOIN on
    // event_type so a BK7 overlay row is only compared against the BK7 agency
    // row, never against the FORECLOSURE agency row (which would Cartesian-
    // explode the JOIN once an agency_rule_version holds multiple
    // derog_seasoning rows). Seeds: agency FORECLOSURE 84mo (via
    // seedAgencyDerogRule + fnmaForeclosure) + agency BK7 48mo + overlay BK7
    // 24mo. Expected: detect_loosenings flags BK7 (24 < 48) exactly once and
    // does NOT also flag the BK7-overlay-vs-FORECLOSURE-agency cross pair.
    const agencySeed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-01-01,2027-01-01)', fnmaForeclosure);
    const seed = await seedTenantWithProgramAndCitation(globalThis.__pgPool, globalThis.__pgAdminPool, agencySeed.agencyRuleVersionId);

    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      // Add a second derog_seasoning row to the SAME agency_rule_version: BK7
      // with a 48-month base wait. This is the realistic Phase 3 shape (one
      // ARV holds many derog_seasoning rows, one per derogEventType).
      await adminClient.query(
        `INSERT INTO agency_rule (agency_rule_version_id, rule_kind, rule_body, primary_citation_id)
         VALUES ($1, 'derog_seasoning', $2::jsonb, $3)`,
        [
          agencySeed.agencyRuleVersionId,
          JSON.stringify({
            event_type: 'BK7',
            measurement_anchor: 'DISCHARGE',
            base_waiting_months: 48,
            extenuating_circumstances_waiting_months: 24,
            post_event_LTV_caps: [],
            reestablished_credit_required: true,
            mortgage_included_in_bk_rule: 'BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED',
            notes_citations: ['FNMA Selling Guide B3-5.3-07'],
          }),
          agencySeed.citationId,
        ],
      );
    } finally {
      adminClient.release();
    }

    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      // Overlay BK7 with 24-month wait — looser than agency BK7 (48mo) but
      // structurally MORE restrictive than FORECLOSURE (84mo). The pre-fix
      // function would Cartesian-pair the overlay against BOTH agency rows
      // and emit zero or two rows depending on which comparison wins; with
      // the event_type qualifier it emits exactly one (BK7-vs-BK7).
      await client.query(
        `INSERT INTO program_rule (tenant_id, program_version_id, layer, rule_kind, rule_body, primary_citation_id)
         VALUES ($1, $2, 'INVESTOR_OVERLAY', 'derog_seasoning', $3::jsonb, $4)`,
        [
          seed.tenantId,
          seed.programVersionId,
          JSON.stringify({
            event_type: 'BK7',
            measurement_anchor: 'DISCHARGE',
            base_waiting_months: 24,
            extenuating_circumstances_waiting_months: 12,
            post_event_LTV_caps: [],
            reestablished_credit_required: true,
            mortgage_included_in_bk_rule: 'BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED',
            notes_citations: ['Lender overlay'],
          }),
          seed.citationId,
        ],
      );

      const { rows } = await client.query(`SELECT * FROM detect_loosenings($1::uuid)`, [seed.programVersionId]);
      const derogRows = rows.filter((r) => r.dimension === 'derog_seasoning');
      // Exactly one row: BK7-overlay-vs-BK7-agency. The overlay is NOT cross-
      // paired against the FORECLOSURE agency row.
      expect(derogRows).toHaveLength(1);
      expect(derogRows[0]!.overlay_value.event_type).toBe('BK7');
      expect(derogRows[0]!.agency_value.event_type).toBe('BK7');
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
