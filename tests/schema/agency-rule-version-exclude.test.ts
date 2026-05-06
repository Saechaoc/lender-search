/**
 * Schema constraint: agency_rule_version EXCLUDE (D-16 / D-20.4).
 *
 * Uses random unique year ranges per test so the EXCLUDE doesn't trip on
 * leftover data from prior runs. seedAgencyDerogRule's COMMITted seeds
 * persist across test runs (no truncate).
 *
 * Phase 3 / Plan 03-02 [Rule 1 - Bug] regression fix: Wave 1 plans seed
 * real agency_rule_version rows with `effective_period =
 * '[2026-01-01,infinity)'` per CONTEXT D-13. Postgres `daterange &&`
 * says any future-year range overlaps with `infinity`, so test ranges
 * MUST be anchored pre-2026 to avoid colliding with the real seed
 * rows. Picks year [1500..1750] for "blocks overlap" and [1800..1900]
 * for "different agencies" — each window is wide and disjoint so the
 * two tests don't collide with each other either.
 */
import { describe, expect, it } from 'vitest';

describe('agency_rule_version EXCLUDE constraint (D-20.4)', () => {
  it('blocks two overlapping versions for same agency', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    const yr = 1500 + Math.floor(Math.random() * 250);
    try {
      await adminClient.query('BEGIN');
      await adminClient.query(
        `INSERT INTO agency_rule_version (agency, version_label, source_url, effective_period)
         VALUES ('FNMA', 'SEL-XCL-A-' || gen_random_uuid()::text, 'https://example/a', $1::daterange)`,
        [`[${yr}-04-01,${yr + 1}-04-01)`],
      );

      await adminClient.query('SAVEPOINT before_overlap');
      await expect(
        adminClient.query(
          `INSERT INTO agency_rule_version (agency, version_label, source_url, effective_period)
           VALUES ('FNMA', 'SEL-XCL-B-' || gen_random_uuid()::text, 'https://example/b', $1::daterange)`,
          [`[${yr}-10-01,${yr + 1}-10-01)`],
        ),
      ).rejects.toThrow(/conflicting key value violates exclusion constraint/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT before_overlap');
      await adminClient.query('ROLLBACK');
    } finally {
      adminClient.release();
    }
  });

  it('allows overlapping ranges for different agencies', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    const yr = 1800 + Math.floor(Math.random() * 100);
    try {
      await adminClient.query('BEGIN');
      await adminClient.query(
        `INSERT INTO agency_rule_version (agency, version_label, effective_period)
         VALUES ('FNMA', 'SEL-XCL-C-' || gen_random_uuid()::text, $1::daterange)`,
        [`[${yr}-04-01,${yr + 1}-04-01)`],
      );
      const result = await adminClient.query(
        `INSERT INTO agency_rule_version (agency, version_label, effective_period)
         VALUES ('FHLMC', 'F-XCL-D-' || gen_random_uuid()::text, $1::daterange)
         RETURNING id::text`,
        [`[${yr}-04-01,${yr + 1}-04-01)`],
      );
      expect(result.rows).toHaveLength(1);
      await adminClient.query('ROLLBACK');
    } finally {
      adminClient.release();
    }
  });
});
