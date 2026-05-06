/**
 * tests/agency/agency-version-fha.test.ts — FHA + FHA-BTW post-seed
 *   `agency_rule_version` assertions (AGY-01 / Phase 3 SC#4 / Plan 03-04
 *   Task 03 / REVIEWS.md B1a).
 *
 * Per REVIEWS.md B1a: each Wave 1 plan owns its own per-agency
 *   agency-version test file (`agency-version-{agency}.test.ts`) instead of
 *   editing a shared `agency-version.test.ts`. This keeps Wave 1 plans
 *   parallel-safe — Plans 03-02 (FNMA), 03-03 (FHLMC), 03-04 (FHA), 03-05
 *   (VA) cannot collide on a shared test file.
 *
 * Coverage:
 *   - FHA active row (HUD-4000.1-2024-08): exists, effective_period
 *     [2026-01-01,infinity), source_url at hud.gov, state='ACTIVE'.
 *   - FHA-BTW deprecated row (HUD-4000.1-BTW-DEPRECATED): exists,
 *     effective_period [2013-08-15,2016-09-30), state='DEPRECATED',
 *     sunset_date='2016-09-30', source_url contains 13-26ml.pdf
 *     (REVIEWS.md B3 + B8a).
 */
import { describe, expect, it } from 'vitest';

interface AgencyRow {
  version_label: string;
  effective_period: string;
  source_url: string | null;
  state: string | null;
  sunset_date: string | null;
}

async function fetchAgencyVersion(agency: string, versionLabel: string): Promise<AgencyRow | null> {
  const adminClient = await globalThis.__pgAdminPool.connect();
  try {
    const { rows } = await adminClient.query<AgencyRow>(
      `SELECT version_label, effective_period::text, source_url, state::text, sunset_date::text
       FROM agency_rule_version
       WHERE agency = $1 AND version_label = $2 LIMIT 1`,
      [agency, versionLabel],
    );
    return rows[0] ?? null;
  } finally {
    adminClient.release();
  }
}

describe('agency_rule_version: FHA + FHA-BTW seeded (AGY-01 / B8a)', () => {
  it('FHA: HUD-4000.1-2024-08 row exists with [2026-01-01,infinity) effective_period and state=ACTIVE', async () => {
    const row = await fetchAgencyVersion('FHA', 'HUD-4000.1-2024-08');
    expect(row).not.toBeNull();
    expect(row?.effective_period).toBe('[2026-01-01,infinity)');
    expect(row?.source_url).toContain('hud.gov');
    expect(row?.state).toBe('ACTIVE');
  });

  it('FHA: HUD-4000.1-BTW-DEPRECATED has state=DEPRECATED and sunset_date=2016-09-30 (B8a)', async () => {
    const row = await fetchAgencyVersion('FHA', 'HUD-4000.1-BTW-DEPRECATED');
    expect(row).not.toBeNull();
    expect(row?.effective_period).toBe('[2013-08-15,2016-09-30)');
    expect(row?.state).toBe('DEPRECATED');
    expect(row?.sunset_date).toBe('2016-09-30');
    expect(row?.source_url).toContain('13-26ml.pdf');
  });
});
