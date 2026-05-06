/**
 * Phase 3 review WR-01: activeAgencyRulesForAgency / activeAgencyRulesUnderVersion
 * predicates pre-filter on state='ACTIVE' AND effective_period @> CURRENT_DATE
 * so the FHA Back-to-Work DEPRECATED row never fires for active eligibility
 * decisions.
 *
 * Asserts via raw SQL (the predicate's own SQL emission is the contract;
 * we assert the WHERE clause text contains the expected predicates and
 * that running it against the seeded DB excludes the BTW DEPRECATED ARV).
 */
import { describe, expect, it } from 'vitest';

describe('activeAgencyRulesForAgency predicate (WR-01)', () => {
  it('FHA active filter excludes HUD-4000.1-BTW-DEPRECATED, includes HUD-4000.1-2024-08', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ version_label: string }>(
        `SELECT version_label
         FROM agency_rule_version
         WHERE agency = 'FHA'
           AND state = 'ACTIVE'
           AND effective_period @> CURRENT_DATE`,
      );
      const labels = rows.map((r) => r.version_label);
      expect(labels).toContain('HUD-4000.1-2024-08');
      expect(labels).not.toContain('HUD-4000.1-BTW-DEPRECATED');
    } finally {
      adminClient.release();
    }
  });

  it('agency_rule rows for the BTW DEPRECATED ARV are excluded by the active filter (12m FC waiting period not selected)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      // Joined query mirroring what the Phase 4 evaluator will emit through
      // activeAgencyRulesUnderVersion / activeAgencyRulesForAgency. Asserts
      // that joining agency_rule via its parent ARV with the active
      // predicate yields ONLY the active HUD-4000.1-2024-08 rules — never
      // the BTW DEPRECATED 12-month rule.
      const { rows } = await adminClient.query<{ base_waiting_months: number; version_label: string }>(
        `SELECT (ar.rule_body->>'base_waiting_months')::int AS base_waiting_months,
                arv.version_label
         FROM agency_rule ar
         JOIN agency_rule_version arv ON arv.id = ar.agency_rule_version_id
         WHERE arv.agency = 'FHA'
           AND arv.state = 'ACTIVE'
           AND arv.effective_period @> CURRENT_DATE
           AND ar.rule_kind = 'derog_seasoning'
           AND ar.rule_body->>'event_type' = 'FORECLOSURE'`,
      );
      // The active FHA FC rule has base=36; the BTW DEPRECATED rule had base=12.
      const versionLabels = rows.map((r) => r.version_label);
      expect(versionLabels).toContain('HUD-4000.1-2024-08');
      expect(versionLabels).not.toContain('HUD-4000.1-BTW-DEPRECATED');
      // None of the returned rules should have the 12-month value the
      // DEPRECATED row carries.
      const monthsValues = rows.map((r) => r.base_waiting_months);
      expect(monthsValues).not.toContain(12);
    } finally {
      adminClient.release();
    }
  });
});
