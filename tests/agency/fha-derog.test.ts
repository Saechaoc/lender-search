/**
 * tests/agency/fha-derog.test.ts — FHA HUD 4000.1 + Back-to-Work DEPRECATED
 *   structural + filter test (Phase 3 SC#4 / AGY-04 / Plan 03-04 Task 03).
 *
 * Coverage:
 *   - 7 standard active-EC rule assertions (BK7, BK13_DISCHARGED,
 *     BK13_DISMISSED, FORECLOSURE, DEED_IN_LIEU, SHORT_SALE,
 *     MORTGAGE_CHARGE_OFF) at FHA's shorter timings.
 *   - 1 explicit MULTIPLE_BK not_applicable=true sentinel (REVIEWS.md B9).
 *   - 4 Back-to-Work DEPRECATED filter/structural assertions:
 *       - Existence with effective_period='[2013-08-15,2016-09-30)'.
 *       - state='DEPRECATED' AND sunset_date='2016-09-30' (REVIEWS.md B8a).
 *       - source_url contains 13-26ml.pdf AND does NOT contain 16-14ml.pdf
 *         (REVIEWS.md B3 citation correction).
 *       - Excluded from `effective_period @> CURRENT_DATE` filter.
 *       - Retrievable by direct version_label lookup.
 *   - 1 golden snapshot — sha256 of canonical (sorted) rule_body bundle for
 *     the 8 HUD-4000.1-2024-08 rules; locks the matrix against accidental
 *     mutation across CI runs.
 *
 * Total: 14 tests.
 *
 * Pattern source: tests/schema/agency-rule-state.test.ts (admin-pool
 *   introspection) + tests/_shared/agency-fixture.ts (SYSTEM tenant context).
 *   The schema setup at tests/schema/setup.ts seeds via `pnpm db:seed`
 *   beforeAll, so Tasks 01+02's seeds are already loaded when these tests
 *   run.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

interface DerogRow {
  event_type: string;
  measurement_anchor: string;
  base_waiting_months: number | null;
  extenuating_circumstances_waiting_months: number | null;
  reestablished_credit_required: boolean;
  mortgage_included_in_bk_rule: string;
  not_applicable?: boolean;
  notes_citations?: string[];
}

async function fetchFhaActiveRule(eventType: string): Promise<DerogRow | null> {
  const adminClient = await globalThis.__pgAdminPool.connect();
  try {
    const { rows } = await adminClient.query<{ rule_body: DerogRow }>(
      `SELECT rule_body FROM agency_rule
        WHERE rule_kind = 'derog_seasoning'
          AND rule_body->>'event_type' = $1
          AND agency_rule_version_id = (
            SELECT id FROM agency_rule_version
            WHERE agency = 'FHA' AND version_label = 'HUD-4000.1-2024-08'
          )`,
      [eventType],
    );
    return rows[0]?.rule_body ?? null;
  } finally {
    adminClient.release();
  }
}

describe('FHA HUD 4000.1 standard EC active matrix (AGY-04 / Plan 03-04 Task 01)', () => {
  it('BK7: 24m base, 12m EC, anchor=DISCHARGE', async () => {
    const row = await fetchFhaActiveRule('BK7');
    expect(row).not.toBeNull();
    expect(row?.measurement_anchor).toBe('DISCHARGE');
    expect(row?.base_waiting_months).toBe(24);
    expect(row?.extenuating_circumstances_waiting_months).toBe(12);
    expect(row?.reestablished_credit_required).toBe(true);
  });

  it('BK13_DISCHARGED: 24m base, anchor=DISCHARGE (no separate EC)', async () => {
    const row = await fetchFhaActiveRule('BK13_DISCHARGED');
    expect(row).not.toBeNull();
    expect(row?.measurement_anchor).toBe('DISCHARGE');
    expect(row?.base_waiting_months).toBe(24);
    // Per HUD 4000.1 §II.A.5.b.iv post-discharge variant: no separate
    // dischargeable-EC short-cut; the 12m in-plan-with-trustee path is a
    // distinct evaluation (not encoded as derog_seasoning EC).
    expect(row?.extenuating_circumstances_waiting_months).toBeNull();
    expect(row?.reestablished_credit_required).toBe(true);
  });

  it('BK13_DISMISSED: 24m base, 12m EC, anchor=DISMISSAL', async () => {
    const row = await fetchFhaActiveRule('BK13_DISMISSED');
    expect(row).not.toBeNull();
    expect(row?.measurement_anchor).toBe('DISMISSAL');
    expect(row?.base_waiting_months).toBe(24);
    expect(row?.extenuating_circumstances_waiting_months).toBe(12);
  });

  it('FORECLOSURE: 36m base, 12m EC, anchor=COMPLETION (FHA standard EC active)', async () => {
    const row = await fetchFhaActiveRule('FORECLOSURE');
    expect(row).not.toBeNull();
    expect(row?.measurement_anchor).toBe('COMPLETION');
    expect(row?.base_waiting_months).toBe(36);
    expect(row?.extenuating_circumstances_waiting_months).toBe(12);
  });

  it('DEED_IN_LIEU: 36m base, 12m EC, anchor=COMPLETION', async () => {
    const row = await fetchFhaActiveRule('DEED_IN_LIEU');
    expect(row).not.toBeNull();
    expect(row?.measurement_anchor).toBe('COMPLETION');
    expect(row?.base_waiting_months).toBe(36);
    expect(row?.extenuating_circumstances_waiting_months).toBe(12);
  });

  it('SHORT_SALE: 36m base, 12m EC, anchor=SALE_CONFIRMATION', async () => {
    const row = await fetchFhaActiveRule('SHORT_SALE');
    expect(row).not.toBeNull();
    expect(row?.measurement_anchor).toBe('SALE_CONFIRMATION');
    expect(row?.base_waiting_months).toBe(36);
    expect(row?.extenuating_circumstances_waiting_months).toBe(12);
  });

  it('MORTGAGE_CHARGE_OFF: 36m base, 12m EC, anchor=CHARGE_OFF_DATE', async () => {
    const row = await fetchFhaActiveRule('MORTGAGE_CHARGE_OFF');
    expect(row).not.toBeNull();
    expect(row?.measurement_anchor).toBe('CHARGE_OFF_DATE');
    expect(row?.base_waiting_months).toBe(36);
    expect(row?.extenuating_circumstances_waiting_months).toBe(12);
  });

  it('MULTIPLE_BK: encoded as explicit not_applicable=true row per B9 (NOT absent)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ rule_body: { not_applicable?: boolean; base_waiting_months: number | null } }>(
        `SELECT rule_body FROM agency_rule
          WHERE rule_kind = 'derog_seasoning'
            AND rule_body->>'event_type' = 'MULTIPLE_BK'
            AND agency_rule_version_id = (
              SELECT id FROM agency_rule_version
              WHERE agency = 'FHA' AND version_label = 'HUD-4000.1-2024-08'
            )`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.rule_body.not_applicable).toBe(true);
      expect(rows[0]?.rule_body.base_waiting_months).toBeNull();
    } finally {
      adminClient.release();
    }
  });
});

describe('FHA Back-to-Work DEPRECATED queryable + filtered (AGY-04 / Phase 3 SC#4)', () => {
  it('Back-to-Work agency_rule_version row exists with effective_period [2013-08-15,2016-09-30)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ effective_period: string }>(
        `SELECT effective_period::text
         FROM agency_rule_version
         WHERE agency = 'FHA' AND version_label = 'HUD-4000.1-BTW-DEPRECATED'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.effective_period).toBe('[2013-08-15,2016-09-30)');
    } finally {
      adminClient.release();
    }
  });

  it('Back-to-Work has state=DEPRECATED and sunset_date=2016-09-30 (B8a first-class state column)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ state: string; sunset_date: string; deprecation_reason: string }>(
        `SELECT state, sunset_date::text, deprecation_reason
         FROM agency_rule_version
         WHERE agency = 'FHA' AND version_label = 'HUD-4000.1-BTW-DEPRECATED'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.state).toBe('DEPRECATED');
      expect(rows[0]?.sunset_date).toBe('2016-09-30');
      expect(rows[0]?.deprecation_reason).toContain('HUD Mortgagee Letter 2013-26');
    } finally {
      adminClient.release();
    }
  });

  it('Back-to-Work citation URL points at HUD ML 2013-26 (B3 — not the wrong ML 2016-14)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ source_url: string }>(
        `SELECT rc.source_url
         FROM agency_rule ar
         JOIN rule_citation rc ON rc.id = ar.primary_citation_id
         WHERE ar.agency_rule_version_id = (
           SELECT id FROM agency_rule_version
           WHERE agency = 'FHA' AND version_label = 'HUD-4000.1-BTW-DEPRECATED'
         )`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.source_url).toContain('13-26ml.pdf');
      expect(rows[0]?.source_url).not.toContain('16-14ml.pdf');
    } finally {
      adminClient.release();
    }
  });

  it('Back-to-Work is excluded from effective_period @> CURRENT_DATE active filter', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ version_label: string }>(
        `SELECT version_label
         FROM agency_rule_version
         WHERE agency = 'FHA' AND effective_period @> CURRENT_DATE`,
      );
      const labels = rows.map((r) => r.version_label);
      expect(labels).toContain('HUD-4000.1-2024-08');
      expect(labels).not.toContain('HUD-4000.1-BTW-DEPRECATED');
    } finally {
      adminClient.release();
    }
  });

  it('Back-to-Work child agency_rule has base_waiting_months=12 (reduced post-FC waiting period)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ rule_body: DerogRow }>(
        `SELECT rule_body FROM agency_rule
          WHERE agency_rule_version_id = (
            SELECT id FROM agency_rule_version
            WHERE agency = 'FHA' AND version_label = 'HUD-4000.1-BTW-DEPRECATED'
          )`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.rule_body.event_type).toBe('FORECLOSURE');
      expect(rows[0]?.rule_body.base_waiting_months).toBe(12);
      expect(rows[0]?.rule_body.measurement_anchor).toBe('COMPLETION');
    } finally {
      adminClient.release();
    }
  });
});

describe('FHA derog golden snapshot (regression gate / D5 determinism)', () => {
  it('FHA HUD-4000.1-2024-08 bundle matches golden sha256', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ rule_body: Record<string, unknown> }>(
        `SELECT rule_body FROM agency_rule
          WHERE rule_kind = 'derog_seasoning'
            AND agency_rule_version_id = (
              SELECT id FROM agency_rule_version
              WHERE agency = 'FHA' AND version_label = 'HUD-4000.1-2024-08'
            )
          ORDER BY rule_body->>'event_type'`,
      );
      // Strip loader-managed _seed_key field before hashing — that's a
      // dedupe discriminator owned by the loader, not part of the
      // semantic rule_body. Otherwise the hash is bound to the loader's
      // internal bookkeeping rather than the matrix content.
      const sanitized = rows.map((r) => {
        const body = { ...r.rule_body };
        delete body._seed_key;
        return body;
      });
      // Canonical JSON: deep key-sort, no whitespace.
      const canonical = JSON.stringify(sanitized, Object.keys(sanitized[0] ?? {}).sort());
      const hash = createHash('sha256').update(canonical).digest('hex');
      // GREEN-locked hash captured during first RED run on Plan 03-04.
      // Mutating any of the 8 HUD-4000.1-2024-08 rule_body shapes (event_type,
      // measurement_anchor, base_waiting_months, EC months, anchor) flips this
      // hash and the test fails — that's the regression gate. Bumping requires
      // an intentional rule-body change paired with a fresh hash capture.
      expect(hash).toBe('67dbe97368740c3a73e0aaf3513250edde1c884af3b449d5ee86aa3bcbe26a60');
    } finally {
      adminClient.release();
    }
  });
});
