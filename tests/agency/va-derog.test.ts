/**
 * tests/agency/va-derog.test.ts — VA Pamphlet 26-7 Chapter 4 Topic 7 derog
 * structural assertions + golden snapshot (Phase 3 SC#5 / AGY-05 / B1a).
 *
 * Per REVIEWS.md B1a: this plan owns its OWN VA test file; it does NOT modify
 *   any shared `tests/agency/agency-version.test.ts` (which would conflict
 *   with sibling Wave 1 plans 03-02/03/04 running in parallel worktrees).
 * Per REVIEWS.md B4a: every VA agency_rule row's primary_citation_id MUST
 *   resolve to a citation URL containing `benefits.va.gov`. Asserted by the
 *   "strict citation gate" test below.
 * Per REVIEWS.md B9: MULTIPLE_BK is encoded as an explicit `not_applicable=true`
 *   sentinel row instead of being silently absent — gives Phase 4 evaluator
 *   deterministic missing-rule semantics.
 * Per iter-2 REVIEWS.md B4a regression resolution: FORECLOSURE / DEED_IN_LIEU
 *   / SHORT_SALE / MORTGAGE_CHARGE_OFF are also encoded as explicit
 *   `not_applicable=true` sentinels (8 total rows under VA-PAM-26-7-Ch4 =
 *   3 cited BK + 5 sentinels). This deviates from the plan's stale "deferred
 *   event types absent" acceptance criterion (which was inherited from the
 *   pre-iter-2 cited-only-defer draft). The iter-2 fixture is the source of
 *   truth: AGY-05 cross-agency parity demands all 8 derog event types be
 *   queryable as VA rows; the sentinel pattern satisfies this without
 *   violating layer discipline.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const VA_VERSION_LABEL = 'VA-PAM-26-7-Ch4';

interface DerogRuleRow {
  rule_body: {
    event_type: string;
    measurement_anchor: string;
    base_waiting_months: number | null;
    extenuating_circumstances_waiting_months: number | null;
    reestablished_credit_required: boolean;
    mortgage_included_in_bk_rule: string;
    not_applicable?: boolean;
    _seed_key?: string;
    [key: string]: unknown;
  };
}

async function fetchVaDerogRule(eventType: string): Promise<DerogRuleRow | null> {
  const adminClient = await globalThis.__pgAdminPool.connect();
  try {
    const { rows } = await adminClient.query<DerogRuleRow>(
      `SELECT rule_body FROM agency_rule
       WHERE rule_kind = 'derog_seasoning'
         AND rule_body->>'event_type' = $1
         AND agency_rule_version_id = (
           SELECT id FROM agency_rule_version
           WHERE agency = 'VA' AND version_label = $2
         )
       LIMIT 1`,
      [eventType, VA_VERSION_LABEL],
    );
    return rows[0] ?? null;
  } finally {
    adminClient.release();
  }
}

/**
 * Recipe: sort rows by event_type, then sort each row's keys alphabetically
 * (recursive) before JSON.stringify. This matches Postgres jsonb's
 * deterministic key ordering on read-back, making the hash stable across
 * runs and Postgres versions.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/**
 * Locked golden hash computed from the iter-2 fixture (8 rows: 3 BK + 5
 * sentinels) under the sortKeysDeep + JSON.stringify recipe. If the
 * fixture's rule_body shape changes intentionally, recompute and update.
 */
const EXPECTED_GOLDEN_HASH = 'a6a5974b45e6548558d9ddbcbf84ae53b6c7438362c08bcb85227230e7e909bb';

describe('VA Pamphlet 26-7 derog structural assertions (AGY-05 / B4a / B9)', () => {
  it('BK7: 24m base / 12m EC / DISCHARGE anchor', async () => {
    const row = await fetchVaDerogRule('BK7');
    expect(row).not.toBeNull();
    expect(row?.rule_body.base_waiting_months).toBe(24);
    expect(row?.rule_body.extenuating_circumstances_waiting_months).toBe(12);
    expect(row?.rule_body.measurement_anchor).toBe('DISCHARGE');
    expect(row?.rule_body.reestablished_credit_required).toBe(true);
    expect(row?.rule_body.not_applicable).toBeFalsy();
  });

  it('BK13_DISCHARGED: 24m base / DISCHARGE anchor', async () => {
    const row = await fetchVaDerogRule('BK13_DISCHARGED');
    expect(row).not.toBeNull();
    expect(row?.rule_body.base_waiting_months).toBe(24);
    expect(row?.rule_body.measurement_anchor).toBe('DISCHARGE');
    expect(row?.rule_body.not_applicable).toBeFalsy();
  });

  it('BK13_DISMISSED: 24m base / 12m EC / DISMISSAL anchor', async () => {
    const row = await fetchVaDerogRule('BK13_DISMISSED');
    expect(row).not.toBeNull();
    expect(row?.rule_body.base_waiting_months).toBe(24);
    expect(row?.rule_body.extenuating_circumstances_waiting_months).toBe(12);
    expect(row?.rule_body.measurement_anchor).toBe('DISMISSAL');
    expect(row?.rule_body.not_applicable).toBeFalsy();
  });

  it('MULTIPLE_BK encoded as explicit not_applicable=true row per B9', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{
        rule_body: { not_applicable?: boolean; base_waiting_months: number | null };
      }>(
        `SELECT rule_body FROM agency_rule
         WHERE rule_kind = 'derog_seasoning'
           AND rule_body->>'event_type' = 'MULTIPLE_BK'
           AND agency_rule_version_id = (
             SELECT id FROM agency_rule_version
             WHERE agency='VA' AND version_label='VA-PAM-26-7-Ch4'
           )`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.rule_body.not_applicable).toBe(true);
      expect(rows[0]?.rule_body.base_waiting_months).toBeNull();
    } finally {
      adminClient.release();
    }
  });

  it('every VA agency_rule has an explicit VA Pamphlet 26-7 citation URL (B4a strict citation gate)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM agency_rule ar
         JOIN rule_citation rc ON rc.id = ar.primary_citation_id
         WHERE ar.agency_rule_version_id = (
           SELECT id FROM agency_rule_version
           WHERE agency='VA' AND version_label='VA-PAM-26-7-Ch4'
         )
           AND rc.source_url NOT LIKE '%benefits.va.gov%'`,
      );
      expect(rows[0]?.count).toBe('0');
    } finally {
      adminClient.release();
    }
  });

  it('iter-2 sentinel coverage: FORECLOSURE / DEED_IN_LIEU / SHORT_SALE / MORTGAGE_CHARGE_OFF are queryable as not_applicable=true rows (AGY-05 cross-agency parity)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{
        event_type: string;
        not_applicable: boolean | null;
        base_waiting_months: number | null;
      }>(
        `SELECT
           rule_body->>'event_type' AS event_type,
           (rule_body->>'not_applicable')::boolean AS not_applicable,
           NULLIF(rule_body->>'base_waiting_months','')::int AS base_waiting_months
         FROM agency_rule
         WHERE agency_rule_version_id = (
           SELECT id FROM agency_rule_version WHERE agency='VA' AND version_label='VA-PAM-26-7-Ch4'
         )
           AND rule_body->>'event_type' IN ('FORECLOSURE','DEED_IN_LIEU','SHORT_SALE','MORTGAGE_CHARGE_OFF')
         ORDER BY rule_body->>'event_type'`,
      );
      // All 4 must exist (iter-2 AGY-05 cross-agency parity).
      expect(rows).toHaveLength(4);
      // All 4 must be not_applicable=true sentinels per iter-2 B4a.
      for (const row of rows) {
        expect(row.not_applicable).toBe(true);
        expect(row.base_waiting_months).toBeNull();
      }
      const observed = rows.map((r) => r.event_type).sort();
      expect(observed).toEqual([
        'DEED_IN_LIEU',
        'FORECLOSURE',
        'MORTGAGE_CHARGE_OFF',
        'SHORT_SALE',
      ]);
    } finally {
      adminClient.release();
    }
  });

  it('VA derog bundle matches golden snapshot (8 rows: 3 BK + 5 sentinels)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ rule_body: Record<string, unknown> }>(
        `SELECT rule_body FROM agency_rule
         WHERE rule_kind = 'derog_seasoning'
           AND agency_rule_version_id = (
             SELECT id FROM agency_rule_version
             WHERE agency='VA' AND version_label='VA-PAM-26-7-Ch4'
           )`,
      );
      // iter-2 row count: 3 cited BK + 5 sentinels = 8 (AGY-05 cross-agency parity).
      expect(rows).toHaveLength(8);

      const bodies = rows.map((r) => r.rule_body);
      const sorted = [...bodies]
        .sort((a, b) =>
          String(a.event_type ?? '').localeCompare(String(b.event_type ?? '')),
        )
        .map(sortKeysDeep);

      const hash = createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
      expect(hash).toBe(EXPECTED_GOLDEN_HASH);
    } finally {
      adminClient.release();
    }
  });
});
