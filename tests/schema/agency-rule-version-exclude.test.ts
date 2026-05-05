/**
 * Schema constraint: agency_rule_version EXCLUDE (D-16 / D-20.4).
 *
 * Uses random unique year ranges per test so the EXCLUDE doesn't trip on
 * leftover data from prior runs. seedAgencyDerogRule's COMMITted seeds
 * persist across test runs (no truncate); each test picks a year far from
 * the seed pool (3000+/4000+ vs seed pool's 2100+ random).
 */
import { describe, expect, it } from 'vitest';

describe('agency_rule_version EXCLUDE constraint (D-20.4)', () => {
  it('blocks two overlapping versions for same agency', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    const yr = 3000000 + Math.floor(Math.random() * 100000);
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
    const yr = 4000000 + Math.floor(Math.random() * 100000);
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
