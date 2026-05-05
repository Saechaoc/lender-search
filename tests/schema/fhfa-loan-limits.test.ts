/**
 * Structural tests for FHFA conforming loan limits (AGY-09 / D-20 / D-22).
 *
 * Verifies:
 *   - conforming_loan_limit_version EXCLUDE on (year WITH =, effective_period WITH &&).
 *   - conforming_loan_limit_county composite PK on (limit_version_id, county_fips).
 *   - program_version.conforming_loan_limit_version_id FK exists and is nullable.
 *
 * Loader idempotency tests land in Plan 03-07 once the FHFA CSV loader exists.
 *
 * Per iter-2 REVIEWS B10 fix: tests use realistic year ranges (2090-2199) not
 * synthetic 5,000,000+ values that overflow Postgres's date max (5874897 AD).
 */
import { describe, expect, it } from 'vitest';

describe('conforming_loan_limit_version EXCLUDE constraint (AGY-09 / D-20)', () => {
  it('blocks two overlapping versions for same year', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    const yr = 2090 + Math.floor(Math.random() * 50); // iter-2 B10 fix: realistic years (2090-2139)
    try {
      await adminClient.query('BEGIN');
      await adminClient.query(
        `INSERT INTO conforming_loan_limit_version (year, effective_period, source_url)
         VALUES ($1, $2::daterange, 'https://example/a')`,
        [yr, `[${yr}-01-01,${yr + 1}-01-01)`],
      );
      await adminClient.query('SAVEPOINT before_overlap');
      await expect(
        adminClient.query(
          `INSERT INTO conforming_loan_limit_version (year, effective_period, source_url)
           VALUES ($1, $2::daterange, 'https://example/b')`,
          [yr, `[${yr}-06-01,${yr + 1}-06-01)`],
        ),
      ).rejects.toThrow(/conflicting key value violates exclusion constraint/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT before_overlap');
      await adminClient.query('ROLLBACK');
    } finally {
      adminClient.release();
    }
  });

  it('allows non-overlapping ranges for different years', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    const yr = 2150 + Math.floor(Math.random() * 50); // iter-2 B10 fix: realistic years (2150-2199)
    try {
      await adminClient.query('BEGIN');
      await adminClient.query(
        `INSERT INTO conforming_loan_limit_version (year, effective_period, source_url)
         VALUES ($1, $2::daterange, 'https://example/y1')`,
        [yr, `[${yr}-01-01,${yr + 1}-01-01)`],
      );
      const result = await adminClient.query(
        `INSERT INTO conforming_loan_limit_version (year, effective_period, source_url)
         VALUES ($1, $2::daterange, 'https://example/y2')
         RETURNING id::text`,
        [yr + 1, `[${yr + 1}-01-01,${yr + 2}-01-01)`],
      );
      expect(result.rows).toHaveLength(1);
      await adminClient.query('ROLLBACK');
    } finally {
      adminClient.release();
    }
  });
});

describe('conforming_loan_limit_county composite PK (AGY-09 / D-20)', () => {
  it('has composite PK on (limit_version_id, county_fips)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ pg_get_constraintdef: string }>(
        `SELECT pg_get_constraintdef(oid) FROM pg_constraint
         WHERE conrelid = 'conforming_loan_limit_county'::regclass AND contype = 'p'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.pg_get_constraintdef).toMatch(/PRIMARY KEY \(limit_version_id, county_fips\)/);
    } finally {
      adminClient.release();
    }
  });
});

describe('program_version conforming FK (AGY-09 / D-22)', () => {
  it('program_version.conforming_loan_limit_version_id exists and is nullable', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ is_nullable: string; data_type: string }>(
        `SELECT is_nullable, data_type FROM information_schema.columns
         WHERE table_name = 'program_version'
           AND column_name = 'conforming_loan_limit_version_id'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.is_nullable).toBe('YES');
      expect(rows[0]?.data_type).toBe('uuid');
    } finally {
      adminClient.release();
    }
  });

  it('FK points at conforming_loan_limit_version(id)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint
         WHERE conrelid = 'program_version'::regclass
           AND contype = 'f'
           AND conname LIKE '%conforming%'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.def).toMatch(/REFERENCES conforming_loan_limit_version\(id\)/);
    } finally {
      adminClient.release();
    }
  });
});
