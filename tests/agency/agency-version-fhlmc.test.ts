/**
 * FHLMC `agency_rule_version` post-seed assertion (AGY-01 / B1a).
 *
 * Per REVIEWS.md B1a: each Wave 1 plan owns its own per-agency assertion file
 *   (tests/agency/agency-version-{fnma,fhlmc,fha,va}.test.ts). The cross-cutting
 *   AGY-01 coverage emerges from the union of the four files; no shared file
 *   means zero merge conflict between parallel Wave 1 plans.
 */
import { describe, expect, it } from 'vitest';

interface AgencyRow {
  version_label: string;
  effective_period: string;
  source_url: string | null;
}

async function fetchAgencyVersion(agency: string, versionLabel: string): Promise<AgencyRow | null> {
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

describe('agency_rule_version: FHLMC seeded (AGY-01 / D-13)', () => {
  it('FHLMC: FHLMC-SSG-2026-Q1 row exists with [2026-01-01,infinity) effective_period', async () => {
    const row = await fetchAgencyVersion('FHLMC', 'FHLMC-SSG-2026-Q1');
    expect(row).not.toBeNull();
    expect(row?.effective_period).toBe('[2026-01-01,infinity)');
    expect(row?.source_url).toContain('guide.freddiemac.com');
  });
});
