/**
 * Structural tests for FHFA conforming loan limits (AGY-09 / D-20 / D-22).
 *
 * Verifies:
 *   - conforming_loan_limit_version EXCLUDE on (year WITH =, effective_period WITH &&).
 *   - conforming_loan_limit_county composite PK on (limit_version_id, county_fips).
 *   - program_version.conforming_loan_limit_version_id FK exists and is nullable.
 *   - Plan 03-06: seedFhfaYear loader populates ~3,200 county rows for year 2026
 *     with FIPS leading zeros preserved + is_high_cost derived against the
 *     $832,750 baseline + idempotent re-runs (Open Question 7 / D-23).
 *   - Plan 03-06 / REVIEWS.md B10: open-ended versions detected via
 *     `upper_inf(effective_period)` — the canonical PostgreSQL daterange
 *     function — NOT `upper(effective_period::text) = 'infinity'` text
 *     comparison.
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

// ---------------------------------------------------------------------------
// Plan 03-06 / Task 02 — FHFA 2026 loader behavior tests.
//
// The setup beforeAll hook in tests/schema/setup.ts runs `pnpm db:seed`, which
// invokes seedFhfaYear(2026, …) against the committed CSV at
// lib/agency-seeds/fhfa/2026-conforming-limit-values-by-county.csv. These tests
// assert the seeded state.
//
// While seedFhfaYear is a no-op (Wave 0 scaffold) these tests fail RED.
// Plan 03-06 Task 02 GREEN replaces the body and the tests turn green.
// ---------------------------------------------------------------------------

describe('FHFA 2026 loader produces expected row counts (AGY-09)', () => {
  it('seeds exactly 1 conforming_loan_limit_version row for year 2026 with unbounded upper', async () => {
    // REVIEWS.md B10: the canonical text form for a daterange with truly
    // unbounded upper (the form for which upper_inf=true) is `[2026-01-01,)`,
    // NOT `[2026-01-01,infinity)`. The two forms are semantically distinct:
    //   `[2026-01-01,infinity)` = upper bounded by the date type's +infinity
    //                              sentinel; upper_inf returns false
    //   `[2026-01-01,)`         = unbounded upper; upper_inf returns true
    // The FHFA loader emits the unbounded form so the B10 mandate (next test)
    // can hold.
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ count: string; effective_period: string }>(
        `SELECT count(*)::text AS count, MIN(effective_period::text) AS effective_period
         FROM conforming_loan_limit_version WHERE year = 2026`,
      );
      expect(rows[0]?.count).toBe('1');
      expect(rows[0]?.effective_period).toBe('[2026-01-01,)');
    } finally {
      adminClient.release();
    }
  });

  it('upper_inf(effective_period) correctly identifies the open-ended 2026 version (REVIEWS B10)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ year: number; is_open_ended: boolean }>(
        `SELECT year, upper_inf(effective_period) AS is_open_ended
         FROM conforming_loan_limit_version WHERE year = 2026`,
      );
      expect(rows[0]?.year).toBe(2026);
      expect(rows[0]?.is_open_ended).toBe(true);
    } finally {
      adminClient.release();
    }
  });

  it('seeds 3,000-3,300 conforming_loan_limit_county rows for 2026', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM conforming_loan_limit_county
         WHERE limit_version_id = (
           SELECT id FROM conforming_loan_limit_version WHERE year = 2026
         )`,
      );
      const count = parseInt(rows[0]!.count, 10);
      expect(count).toBeGreaterThanOrEqual(3000);
      expect(count).toBeLessThanOrEqual(3300);
    } finally {
      adminClient.release();
    }
  });

  it('preserves FIPS leading zeros (Pitfall PG-7) — Alabama county_fips starts with 01', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ county_fips: string; state_code: string }>(
        `SELECT county_fips, state_code FROM conforming_loan_limit_county
          WHERE state_code = 'AL'
          ORDER BY county_fips
          LIMIT 1`,
      );
      expect(rows[0]?.county_fips).toMatch(/^01\d{3}$/);
    } finally {
      adminClient.release();
    }
  });

  it('spot-checks Los Angeles County (06037 / one_unit=1,249,125 / high-cost)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ one_unit: string; is_high_cost: boolean; state: string }>(
        `SELECT one_unit_baseline::text AS one_unit, is_high_cost, state_code AS state
         FROM conforming_loan_limit_county
         WHERE county_fips = '06037'
           AND limit_version_id = (
             SELECT id FROM conforming_loan_limit_version WHERE year = 2026
           )`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.state).toBe('CA');
      expect(parseInt(rows[0]!.one_unit, 10)).toBe(1249125);
      expect(rows[0]?.is_high_cost).toBe(true);
    } finally {
      adminClient.release();
    }
  });

  it('spot-checks Autauga County AL (01001 / one_unit=832,750 / NOT high-cost)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ one_unit: string; is_high_cost: boolean; state: string }>(
        `SELECT one_unit_baseline::text AS one_unit, is_high_cost, state_code AS state
         FROM conforming_loan_limit_county
         WHERE county_fips = '01001'
           AND limit_version_id = (
             SELECT id FROM conforming_loan_limit_version WHERE year = 2026
           )`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.state).toBe('AL');
      expect(parseInt(rows[0]!.one_unit, 10)).toBe(832750);
      expect(rows[0]?.is_high_cost).toBe(false);
    } finally {
      adminClient.release();
    }
  });

  it('spot-checks Honolulu County HI (15003 / one_unit=1,249,125 / high-cost)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ one_unit: string; is_high_cost: boolean; state: string }>(
        `SELECT one_unit_baseline::text AS one_unit, is_high_cost, state_code AS state
         FROM conforming_loan_limit_county
         WHERE county_fips = '15003'
           AND limit_version_id = (
             SELECT id FROM conforming_loan_limit_version WHERE year = 2026
           )`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.state).toBe('HI');
      expect(parseInt(rows[0]!.one_unit, 10)).toBe(1249125);
      expect(rows[0]?.is_high_cost).toBe(true);
    } finally {
      adminClient.release();
    }
  });

  it('is_high_cost derived at load time (Open Question 7); ≥50 high-cost counties exist', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ high_cost_count: string; max_one_unit: string }>(
        `SELECT
           count(*) FILTER (WHERE is_high_cost = true)::text AS high_cost_count,
           max(one_unit_baseline)::text AS max_one_unit
         FROM conforming_loan_limit_county
         WHERE limit_version_id = (
           SELECT id FROM conforming_loan_limit_version WHERE year = 2026
         )`,
      );
      expect(parseInt(rows[0]!.high_cost_count, 10)).toBeGreaterThanOrEqual(50);
      expect(parseInt(rows[0]!.max_one_unit, 10)).toBeGreaterThan(1000000);
    } finally {
      adminClient.release();
    }
  });

  it('is_high_cost is FALSE when one_unit_baseline = 832750 (national baseline)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ is_high_cost: boolean }>(
        `SELECT is_high_cost FROM conforming_loan_limit_county
          WHERE one_unit_baseline = 832750
          LIMIT 1`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]?.is_high_cost).toBe(false);
    } finally {
      adminClient.release();
    }
  });
});
