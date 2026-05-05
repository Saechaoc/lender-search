/**
 * FNMA B3-5.3-07 derog matrix structural assertions (Phase 3 SC#3 / AGY-02).
 *
 * Per CONTEXT D-08: one Vitest test per Phase 3 SC#3 line item +
 * per-agency golden snapshot.
 * Per REVIEWS.md B2: FORECLOSURE encoded as 2 rows reflecting FNMA's actual
 * conditional structure during the 3-to-7-year EC window.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

interface FnmaRuleBody {
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

async function fetchFnmaRules(eventType: string): Promise<FnmaRuleBody[]> {
  const adminClient = await globalThis.__pgAdminPool.connect();
  try {
    const { rows } = await adminClient.query<{ rule_body: FnmaRuleBody }>(
      `SELECT rule_body FROM agency_rule
        WHERE rule_kind = 'derog_seasoning'
          AND rule_body->>'event_type' = $1
          AND agency_rule_version_id = (
            SELECT id FROM agency_rule_version
            WHERE agency = 'FNMA' AND version_label = 'FNMA-SEL-2026-04'
            LIMIT 1
          )`,
      [eventType],
    );
    return rows.map((r) => r.rule_body);
  } finally {
    adminClient.release();
  }
}

async function fetchFnmaRule(eventType: string): Promise<FnmaRuleBody> {
  const rows = await fetchFnmaRules(eventType);
  if (rows.length !== 1) {
    throw new Error(`Expected 1 FNMA ${eventType} row, got ${rows.length}`);
  }
  return rows[0]!;
}

describe('FNMA derog matrix (Phase 3 SC#3 / AGY-02)', () => {
  it('BK7: 48m base, 24m EC, anchor=DISCHARGE', async () => {
    const body = await fetchFnmaRule('BK7');
    expect(body.base_waiting_months).toBe(48);
    expect(body.extenuating_circumstances_waiting_months).toBe(24);
    expect(body.measurement_anchor).toBe('DISCHARGE');
  });

  it('BK13_DISCHARGED: 24m base, no EC, anchor=DISCHARGE', async () => {
    const body = await fetchFnmaRule('BK13_DISCHARGED');
    expect(body.base_waiting_months).toBe(24);
    expect(body.extenuating_circumstances_waiting_months).toBeNull();
    expect(body.measurement_anchor).toBe('DISCHARGE');
  });

  it('BK13_DISMISSED: 48m base, 24m EC, anchor=DISMISSAL', async () => {
    const body = await fetchFnmaRule('BK13_DISMISSED');
    expect(body.base_waiting_months).toBe(48);
    expect(body.extenuating_circumstances_waiting_months).toBe(24);
    expect(body.measurement_anchor).toBe('DISMISSAL');
  });

  it('MULTIPLE_BK: 60m base, 36m EC, anchor=DISCHARGE (Pitfall 1.5)', async () => {
    const body = await fetchFnmaRule('MULTIPLE_BK');
    expect(body.base_waiting_months).toBe(60);
    expect(body.extenuating_circumstances_waiting_months).toBe(36);
    expect(body.measurement_anchor).toBe('DISCHARGE');
  });

  it('FORECLOSURE: encoded as TWO rows per B2 (purchase+primary AND limited-cash-out+all-occupancies)', async () => {
    const rows = await fetchFnmaRules('FORECLOSURE');
    expect(rows).toHaveLength(2);
    // Both rows: 84m base, 36m EC, COMPLETION anchor
    for (const body of rows) {
      expect(body.base_waiting_months).toBe(84);
      expect(body.extenuating_circumstances_waiting_months).toBe(36);
      expect(body.measurement_anchor).toBe('COMPLETION');
      expect(body.post_event_LTV_caps).toHaveLength(1);
      expect(body.post_event_LTV_caps[0]?.max_LTV).toBe(90);
      expect(body.post_event_LTV_caps[0]?.months_since_min).toBe(36);
      expect(body.post_event_LTV_caps[0]?.months_since_max).toBe(84);
    }
  });

  it('FORECLOSURE row A: PURCHASE on PRIMARY only (B2 split — FNMA principal-residence-only constraint)', async () => {
    const rows = await fetchFnmaRules('FORECLOSURE');
    const purchaseRow = rows.find(
      (r) => r.post_event_LTV_caps[0]?.purposeAllowList.includes('PURCHASE'),
    );
    expect(purchaseRow).toBeDefined();
    expect(purchaseRow!.post_event_LTV_caps[0]!.purposeAllowList).toEqual(['PURCHASE']);
    expect(purchaseRow!.post_event_LTV_caps[0]!.occupancyAllowList).toEqual(['PRIMARY']);
  });

  it('FORECLOSURE row B: RATE_TERM_REFI permitted for all eligible occupancies (B2 split — FNMA permits non-primary for LCOR)', async () => {
    const rows = await fetchFnmaRules('FORECLOSURE');
    const lcorRow = rows.find(
      (r) => r.post_event_LTV_caps[0]?.purposeAllowList.includes('RATE_TERM_REFI'),
    );
    expect(lcorRow).toBeDefined();
    expect(lcorRow!.post_event_LTV_caps[0]!.purposeAllowList).toEqual(['RATE_TERM_REFI']);
    expect(lcorRow!.post_event_LTV_caps[0]!.occupancyAllowList.slice().sort()).toEqual(
      ['INVESTMENT', 'PRIMARY', 'SECOND_HOME'].sort(),
    );
  });

  it('FORECLOSURE: SQL query for B2 returns BOTH rows (limited cash-out + investment is permitted)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{
        event_type: string;
        purposes: string[];
        occupancies: string[];
      }>(
        `SELECT rule_body->>'event_type' AS event_type,
                rule_body->'post_event_LTV_caps'->0->'purposeAllowList' AS purposes,
                rule_body->'post_event_LTV_caps'->0->'occupancyAllowList' AS occupancies
         FROM agency_rule
         WHERE rule_kind = 'derog_seasoning'
           AND rule_body->>'event_type' = 'FORECLOSURE'
           AND agency_rule_version_id = (
             SELECT id FROM agency_rule_version
             WHERE agency='FNMA' AND version_label='FNMA-SEL-2026-04'
           )
         ORDER BY rule_body->'post_event_LTV_caps'->0->>'purposeAllowList'`,
      );
      expect(rows).toHaveLength(2);
      // Verify limited-cash-out row includes INVESTMENT (the explicit B2 acceptance criterion)
      const lcorOccupancies = rows.find(
        (r) => Array.isArray(r.purposes) && r.purposes.includes('RATE_TERM_REFI'),
      )?.occupancies;
      expect(lcorOccupancies).toContain('INVESTMENT');
    } finally {
      adminClient.release();
    }
  });

  it('DEED_IN_LIEU: 48m base, 24m EC, anchor=COMPLETION', async () => {
    const body = await fetchFnmaRule('DEED_IN_LIEU');
    expect(body.base_waiting_months).toBe(48);
    expect(body.extenuating_circumstances_waiting_months).toBe(24);
    expect(body.measurement_anchor).toBe('COMPLETION');
  });

  it('SHORT_SALE: 48m base, 24m EC, anchor=SALE_CONFIRMATION', async () => {
    const body = await fetchFnmaRule('SHORT_SALE');
    expect(body.base_waiting_months).toBe(48);
    expect(body.extenuating_circumstances_waiting_months).toBe(24);
    expect(body.measurement_anchor).toBe('SALE_CONFIRMATION');
  });

  it('MORTGAGE_CHARGE_OFF: 48m base, 24m EC, anchor=CHARGE_OFF_DATE', async () => {
    const body = await fetchFnmaRule('MORTGAGE_CHARGE_OFF');
    expect(body.base_waiting_months).toBe(48);
    expect(body.extenuating_circumstances_waiting_months).toBe(24);
    expect(body.measurement_anchor).toBe('CHARGE_OFF_DATE');
  });

  it('MORTGAGE_CHARGE_OFF: mortgage_included_in_bk_rule = BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED (Pitfall 1.6)', async () => {
    const body = await fetchFnmaRule('MORTGAGE_CHARGE_OFF');
    expect(body.mortgage_included_in_bk_rule).toBe('BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED');
  });

  it('FNMA derog bundle matches golden snapshot (regression detection)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ rule_body: Record<string, unknown> }>(
        `SELECT rule_body FROM agency_rule
          WHERE rule_kind = 'derog_seasoning'
            AND agency_rule_version_id = (
              SELECT id FROM agency_rule_version
              WHERE agency = 'FNMA' AND version_label = 'FNMA-SEL-2026-04'
            )
          ORDER BY rule_body->>'event_type', rule_body->'post_event_LTV_caps'->0->>'purposeAllowList'`,
      );
      expect(rows).toHaveLength(9);
      const sortedBodies = rows.map((r) => r.rule_body);
      const hash = createHash('sha256')
        .update(JSON.stringify(sortedBodies))
        .digest('hex');
      // First-author runs the test once with placeholder, captures actual computed
      // hash from the failure message, then commits it here. The golden hash is
      // updated only on intentional rule-content changes (regression sentry).
      expect(hash).toBe('TBD-LOCK-ON-FIRST-COMMIT');
    } finally {
      adminClient.release();
    }
  });
});
