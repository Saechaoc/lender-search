/**
 * FHLMC §5202.5 derog matrix structural assertions (Phase 3 SC#3 / AGY-03).
 *
 * Per CONTEXT D-08: one Vitest test per Phase 3 SC#3 line item +
 * per-agency golden snapshot.
 * Per RESEARCH §"Per-agency content matrix" §FHLMC + Assumption A1:
 *   FHLMC FORECLOSURE EC = 24m (vs FNMA's 36m). Planner-verified before merge.
 * Per Pitfall 1.6: FHLMC MORTGAGE_CHARGE_OFF mortgage_included_in_bk_rule
 *   = 'FC_CLOCK_ALWAYS' (vs FNMA's 'BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED').
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

interface FhlmcRuleBody {
  event_type: string;
  measurement_anchor: string;
  base_waiting_months: number;
  extenuating_circumstances_waiting_months: number | null;
  post_event_LTV_caps: Array<{
    months_since_min: number;
    months_since_max: number | null;
    max_LTV: number;
    purposeAllowList: string[];
    occupancyAllowList: string[];
  }>;
  mortgage_included_in_bk_rule: string;
}

async function fetchFhlmcRule(eventType: string): Promise<FhlmcRuleBody> {
  const adminClient = await globalThis.__pgAdminPool.connect();
  try {
    const { rows } = await adminClient.query<{ rule_body: FhlmcRuleBody }>(
      `SELECT rule_body FROM agency_rule
        WHERE rule_kind = 'derog_seasoning'
          AND rule_body->>'event_type' = $1
          AND agency_rule_version_id = (
            SELECT id FROM agency_rule_version
            WHERE agency = 'FHLMC' AND version_label = 'FHLMC-SSG-2026-Q1'
            LIMIT 1
          )`,
      [eventType],
    );
    if (rows.length !== 1) {
      throw new Error(`Expected 1 FHLMC ${eventType} row, got ${rows.length}`);
    }
    return rows[0]!.rule_body;
  } finally {
    adminClient.release();
  }
}

describe('FHLMC derog matrix (Phase 3 SC#3 / AGY-03)', () => {
  it('BK7: 48m base, 24m EC, anchor=DISCHARGE', async () => {
    const body = await fetchFhlmcRule('BK7');
    expect(body.base_waiting_months).toBe(48);
    expect(body.extenuating_circumstances_waiting_months).toBe(24);
    expect(body.measurement_anchor).toBe('DISCHARGE');
  });

  it('BK13_DISCHARGED: 24m base, no EC, anchor=DISCHARGE', async () => {
    const body = await fetchFhlmcRule('BK13_DISCHARGED');
    expect(body.base_waiting_months).toBe(24);
    expect(body.extenuating_circumstances_waiting_months).toBeNull();
    expect(body.measurement_anchor).toBe('DISCHARGE');
  });

  it('BK13_DISMISSED: 48m base, 24m EC, anchor=DISMISSAL', async () => {
    const body = await fetchFhlmcRule('BK13_DISMISSED');
    expect(body.base_waiting_months).toBe(48);
    expect(body.extenuating_circumstances_waiting_months).toBe(24);
    expect(body.measurement_anchor).toBe('DISMISSAL');
  });

  it('MULTIPLE_BK: 60m base, 36m EC, anchor=DISCHARGE (Pitfall 1.5)', async () => {
    const body = await fetchFhlmcRule('MULTIPLE_BK');
    expect(body.base_waiting_months).toBe(60);
    expect(body.extenuating_circumstances_waiting_months).toBe(36);
    expect(body.measurement_anchor).toBe('DISCHARGE');
  });

  it('FORECLOSURE: 84m base, 24m EC (FHLMC delta vs FNMA 36m EC; Assumption A1), anchor=COMPLETION', async () => {
    const body = await fetchFhlmcRule('FORECLOSURE');
    expect(body.base_waiting_months).toBe(84);
    expect(body.extenuating_circumstances_waiting_months).toBe(24);
    expect(body.measurement_anchor).toBe('COMPLETION');
  });

  it('DEED_IN_LIEU: 48m base, 24m EC, anchor=COMPLETION', async () => {
    const body = await fetchFhlmcRule('DEED_IN_LIEU');
    expect(body.base_waiting_months).toBe(48);
    expect(body.extenuating_circumstances_waiting_months).toBe(24);
    expect(body.measurement_anchor).toBe('COMPLETION');
  });

  it('SHORT_SALE: 48m base, 24m EC, anchor=SALE_CONFIRMATION', async () => {
    const body = await fetchFhlmcRule('SHORT_SALE');
    expect(body.base_waiting_months).toBe(48);
    expect(body.extenuating_circumstances_waiting_months).toBe(24);
    expect(body.measurement_anchor).toBe('SALE_CONFIRMATION');
  });

  it('MORTGAGE_CHARGE_OFF: 48m base, 24m EC, anchor=CHARGE_OFF_DATE', async () => {
    const body = await fetchFhlmcRule('MORTGAGE_CHARGE_OFF');
    expect(body.base_waiting_months).toBe(48);
    expect(body.extenuating_circumstances_waiting_months).toBe(24);
    expect(body.measurement_anchor).toBe('CHARGE_OFF_DATE');
  });

  it('MORTGAGE_CHARGE_OFF: mortgage_included_in_bk_rule = FC_CLOCK_ALWAYS (FHLMC delta vs FNMA; Pitfall 1.6)', async () => {
    const body = await fetchFhlmcRule('MORTGAGE_CHARGE_OFF');
    expect(body.mortgage_included_in_bk_rule).toBe('FC_CLOCK_ALWAYS');
  });

  it('FHLMC derog bundle matches golden snapshot (regression detection)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ rule_body: Record<string, unknown> }>(
        `SELECT rule_body FROM agency_rule
          WHERE rule_kind = 'derog_seasoning'
            AND agency_rule_version_id = (
              SELECT id FROM agency_rule_version
              WHERE agency = 'FHLMC' AND version_label = 'FHLMC-SSG-2026-Q1'
            )
          ORDER BY rule_body->>'event_type'`,
      );
      expect(rows).toHaveLength(8);
      const sortedBodies = rows.map((r) => r.rule_body);
      const hash = createHash('sha256')
        .update(JSON.stringify(sortedBodies))
        .digest('hex');
      // Golden snapshot regression hash. Bumped Plan 03 review BL-03 fix:
      // FHLMC BK13_DISCHARGED + BK13_DISMISSED now cite distinct anchors
      // (#BK_CHAPTER_13_DISCHARGED / #BK_CHAPTER_13_DISMISSED) instead of
      // both pointing at #BK_CHAPTER_13. The notes_citations array values
      // changed accordingly, flipping this hash. Originally locked during
      // Plan 03-03 Task 3 GREEN at 'e69f8f8c...febb2e'. If this assertion
      // fails again, an edit to lib/agency-seeds/fhlmc/derog-seasoning.ts
      // has changed the seeded bundle — re-run, inspect the diff, and bump
      // the hash deliberately.
      expect(hash).toBe('64a87b54b4fe810d4f325a17fb3a9afc7e2adb0f68cc7a61d7875c9b1a82fd98');
    } finally {
      adminClient.release();
    }
  });
});
