/**
 * Phase 3 / Plan 03-01 Task 08 Delta 2 (REVIEWS.md B8a).
 *
 * Asserts:
 *   - agency_rule_state enum exists with values ACTIVE | DEPRECATED | RETIRED
 *   - agency_rule_version has 3 new columns (state NOT NULL DEFAULT 'ACTIVE',
 *     sunset_date date NULL, deprecation_reason text NULL)
 *   - INSERT without specifying state defaults to 'ACTIVE'
 */
import { describe, expect, it } from 'vitest';

describe('agency_rule_state enum + columns (B8a / Delta 2)', () => {
  it('agency_rule_state enum exists with the 3 expected values', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ enumlabel: string }>(
        `SELECT enumlabel FROM pg_type t
         JOIN pg_enum e ON e.enumtypid = t.oid
         WHERE t.typname = 'agency_rule_state'
         ORDER BY enumsortorder`,
      );
      expect(rows.map((r) => r.enumlabel)).toEqual(['ACTIVE', 'DEPRECATED', 'RETIRED']);
    } finally {
      adminClient.release();
    }
  });

  it('agency_rule_version has state/sunset_date/deprecation_reason columns', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ column_name: string; is_nullable: string; data_type: string; column_default: string | null }>(
        `SELECT column_name, is_nullable, data_type, column_default
         FROM information_schema.columns
         WHERE table_name = 'agency_rule_version'
           AND column_name IN ('state','sunset_date','deprecation_reason')
         ORDER BY column_name`,
      );
      expect(rows).toHaveLength(3);
      const byName = new Map(rows.map((r) => [r.column_name, r]));
      // state: NOT NULL, USER-DEFINED enum, default 'ACTIVE'
      expect(byName.get('state')?.is_nullable).toBe('NO');
      expect(byName.get('state')?.data_type).toBe('USER-DEFINED');
      expect(byName.get('state')?.column_default).toContain('ACTIVE');
      // sunset_date: NULL, date
      expect(byName.get('sunset_date')?.is_nullable).toBe('YES');
      expect(byName.get('sunset_date')?.data_type).toBe('date');
      // deprecation_reason: NULL, text
      expect(byName.get('deprecation_reason')?.is_nullable).toBe('YES');
      expect(byName.get('deprecation_reason')?.data_type).toBe('text');
    } finally {
      adminClient.release();
    }
  });

  it("default state value is 'ACTIVE' on INSERT without state specified", async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    const yr = 2300 + Math.floor(Math.random() * 50);
    try {
      await adminClient.query('BEGIN');
      const result = await adminClient.query<{ state: string; sunset_date: string | null; deprecation_reason: string | null }>(
        `INSERT INTO agency_rule_version (agency, version_label, source_url, effective_period)
         VALUES ('FHLMC', 'B8A-DEFAULT-' || gen_random_uuid()::text,
                 'https://example/default-state',
                 $1::daterange)
         RETURNING state, sunset_date, deprecation_reason`,
        [`[${yr}-01-01,${yr + 1}-01-01)`],
      );
      expect(result.rows[0]?.state).toBe('ACTIVE');
      expect(result.rows[0]?.sunset_date).toBeNull();
      expect(result.rows[0]?.deprecation_reason).toBeNull();
      await adminClient.query('ROLLBACK');
    } finally {
      adminClient.release();
    }
  });
});
