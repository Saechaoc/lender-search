/**
 * tests/agency/agency-version-va.test.ts — VA `agency_rule_version` post-seed
 * assertion (AGY-01 / B1a).
 *
 * Per REVIEWS.md B1a: this plan owns its OWN VA-only AGY-01 test file. There
 *   is intentionally no shared `tests/agency/agency-version.test.ts` — every
 *   Wave 1 plan (FNMA / FHLMC / FHA / VA) ships its own per-agency file so
 *   parallel worktrees never collide on the same test source.
 * Per CONTEXT D-13: VA version_label = 'VA-PAM-26-7-Ch4', effective_period
 *   = '[2026-01-01,infinity)'. source_url anchored at benefits.va.gov.
 */
import { describe, expect, it } from 'vitest';

interface AgencyRow {
  version_label: string;
  effective_period: string;
  source_url: string | null;
}

async function fetchAgencyVersion(
  agency: string,
  versionLabel: string,
): Promise<AgencyRow | null> {
  const adminClient = await globalThis.__pgAdminPool.connect();
  try {
    const { rows } = await adminClient.query<AgencyRow>(
      `SELECT version_label, effective_period::text, source_url
       FROM agency_rule_version
       WHERE agency = $1 AND version_label = $2 LIMIT 1`,
      [agency, versionLabel],
    );
    return rows[0] ?? null;
  } finally {
    adminClient.release();
  }
}

describe('agency_rule_version: VA seeded (AGY-01 / D-13)', () => {
  it('VA: VA-PAM-26-7-Ch4 row exists with [2026-01-01,infinity) effective_period', async () => {
    const row = await fetchAgencyVersion('VA', 'VA-PAM-26-7-Ch4');
    expect(row).not.toBeNull();
    expect(row?.effective_period).toBe('[2026-01-01,infinity)');
    expect(row?.source_url).toContain('benefits.va.gov');
  });
});
