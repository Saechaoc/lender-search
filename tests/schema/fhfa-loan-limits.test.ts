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
 *     function — NOT a fragile text-comparison form that casts the daterange
 *     to text and matches the substring 'infinity'.
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

// ---------------------------------------------------------------------------
// Plan 03-06 / Task 03 — FHFA loader idempotency + program_version FK
// dereference smoke tests (Open Question 1 / D-22 / D-23).
// ---------------------------------------------------------------------------

describe('FHFA loader idempotency (Open Question 1 / D-23)', () => {
  it('ON CONFLICT DO NOTHING preserves county row counts on re-INSERT attempt', async () => {
    // The setup beforeAll hook already ran `pnpm db:seed` (which calls the
    // loader twice in CI/local typical flow — once at migrate-time, once at
    // test-setup-time). This test takes one existing seeded county and
    // attempts a duplicate INSERT with bogus values; the ON CONFLICT
    // (limit_version_id, county_fips) DO NOTHING clause must reject it
    // (rowCount=0) AND the original row must remain unchanged.
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows: before } = await adminClient.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM conforming_loan_limit_county
         WHERE limit_version_id = (
           SELECT id FROM conforming_loan_limit_version WHERE year = 2026
         )`,
      );
      const beforeCount = parseInt(before[0]!.count, 10);

      const { rows: pick } = await adminClient.query<{
        county_fips: string;
        state_code: string;
        one_unit: string;
        is_high_cost: boolean;
      }>(
        `SELECT county_fips, state_code, one_unit_baseline::text AS one_unit, is_high_cost
         FROM conforming_loan_limit_county
         WHERE limit_version_id = (
           SELECT id FROM conforming_loan_limit_version WHERE year = 2026
         )
         LIMIT 1`,
      );
      const sampleFips = pick[0]!.county_fips;
      const sampleState = pick[0]!.state_code;
      const originalOneUnit = parseInt(pick[0]!.one_unit, 10);
      const originalHighCost = pick[0]!.is_high_cost;

      // Attempt to INSERT a "different" row for same (limit_version_id,
      // county_fips). ON CONFLICT DO NOTHING should leave the original alone.
      const result = await adminClient.query(
        `INSERT INTO conforming_loan_limit_county (
           limit_version_id, county_fips, state_code, one_unit_baseline, is_high_cost
         )
         VALUES (
           (SELECT id FROM conforming_loan_limit_version WHERE year = 2026),
           $1, $2, 999999, false
         )
         ON CONFLICT (limit_version_id, county_fips) DO NOTHING`,
        [sampleFips, sampleState],
      );
      expect(result.rowCount).toBe(0);

      // Row count unchanged.
      const { rows: after } = await adminClient.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM conforming_loan_limit_county
         WHERE limit_version_id = (
           SELECT id FROM conforming_loan_limit_version WHERE year = 2026
         )`,
      );
      const afterCount = parseInt(after[0]!.count, 10);
      expect(afterCount).toBe(beforeCount);

      // Original row preserved (not overwritten with the bogus 999999 value).
      const { rows: postCheck } = await adminClient.query<{ one_unit: string; is_high_cost: boolean }>(
        `SELECT one_unit_baseline::text AS one_unit, is_high_cost
         FROM conforming_loan_limit_county
         WHERE limit_version_id = (
           SELECT id FROM conforming_loan_limit_version WHERE year = 2026
         )
         AND county_fips = $1`,
        [sampleFips],
      );
      expect(parseInt(postCheck[0]!.one_unit, 10)).toBe(originalOneUnit);
      expect(postCheck[0]?.is_high_cost).toBe(originalHighCost);
    } finally {
      adminClient.release();
    }
  });
});

describe('program_version FK dereference smoke test (AGY-09 / D-22)', () => {
  it('a program_version row with conforming_loan_limit_version_id set INSERTS successfully + JOINs to year=2026', async () => {
    // REVIEWS.md B10: realistic synthetic future year 2090 — within
    // PostgreSQL date type bounds (max = 5874897 AD). We avoid 5,000,000+
    // markers used in earlier plan iterations because they cause silent
    // overflow / rejection at the daterange constructor.
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      await adminClient.query('BEGIN');

      const tenant = await adminClient.query<{ id: string }>(
        `SELECT id::text FROM tenant WHERE kind = 'SYSTEM' LIMIT 1`,
      );
      const tenantId = tenant.rows[0]!.id;
      await adminClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

      const program = await adminClient.query<{ id: string }>(
        `INSERT INTO program (tenant_id, lender, channel, name)
         VALUES ($1, 'FK Test Lender', 'wholesale', 'FK Test Program')
         RETURNING id::text`,
        [tenantId],
      );

      const arv = await adminClient.query<{ id: string }>(
        `SELECT id::text FROM agency_rule_version
         WHERE agency = 'FNMA' AND version_label = 'FNMA-SEL-2026-04' LIMIT 1`,
      );
      const fhfa = await adminClient.query<{ id: string }>(
        `SELECT id::text FROM conforming_loan_limit_version WHERE year = 2026 LIMIT 1`,
      );
      expect(arv.rows[0]?.id).toBeDefined();
      expect(fhfa.rows[0]?.id).toBeDefined();

      const pv = await adminClient.query<{ id: string }>(
        `INSERT INTO program_version (
           tenant_id, program_id, agency_rule_version_id,
           conforming_loan_limit_version_id,
           effective_period, state, source_document_fingerprint
         ) VALUES ($1, $2, $3, $4, '[2090-01-01,2091-01-01)', 'draft', 'sha256:fk-test')
         RETURNING id::text`,
        [tenantId, program.rows[0]!.id, arv.rows[0]!.id, fhfa.rows[0]!.id],
      );
      expect(pv.rows[0]!.id).toBeDefined();

      // Dereference the FK back to the year 2026.
      const { rows: deref } = await adminClient.query<{ year: number }>(
        `SELECT cllv.year
         FROM program_version pv
         JOIN conforming_loan_limit_version cllv ON cllv.id = pv.conforming_loan_limit_version_id
         WHERE pv.id = $1`,
        [pv.rows[0]!.id],
      );
      expect(deref).toHaveLength(1);
      expect(deref[0]?.year).toBe(2026);

      await adminClient.query('ROLLBACK');
    } finally {
      adminClient.release();
    }
  });

  it('a program_version row with conforming_loan_limit_version_id = NULL INSERTS successfully (D-22 nullable)', async () => {
    // D-22: the FK is nullable so non-QM and non-conforming programs that
    // never pin to FHFA limits don't need a synthetic version row. REVIEWS.md
    // B10: realistic future year 2090, NOT 6,000,000.
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      await adminClient.query('BEGIN');

      const tenant = await adminClient.query<{ id: string }>(
        `SELECT id::text FROM tenant WHERE kind = 'SYSTEM' LIMIT 1`,
      );
      const tenantId = tenant.rows[0]!.id;
      await adminClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

      const program = await adminClient.query<{ id: string }>(
        `INSERT INTO program (tenant_id, lender, channel, name)
         VALUES ($1, 'NQ Lender', 'wholesale', 'Non-QM DSCR')
         RETURNING id::text`,
        [tenantId],
      );

      const arv = await adminClient.query<{ id: string }>(
        `SELECT id::text FROM agency_rule_version
         WHERE agency = 'FNMA' AND version_label = 'FNMA-SEL-2026-04' LIMIT 1`,
      );

      const pv = await adminClient.query<{ id: string; conforming_loan_limit_version_id: string | null }>(
        `INSERT INTO program_version (
           tenant_id, program_id, agency_rule_version_id,
           effective_period, state, source_document_fingerprint
         ) VALUES ($1, $2, $3, '[2090-01-01,2091-01-01)', 'draft', 'sha256:fk-null')
         RETURNING id::text, conforming_loan_limit_version_id::text`,
        [tenantId, program.rows[0]!.id, arv.rows[0]!.id],
      );
      expect(pv.rows[0]!.id).toBeDefined();
      expect(pv.rows[0]!.conforming_loan_limit_version_id).toBeNull();

      await adminClient.query('ROLLBACK');
    } finally {
      adminClient.release();
    }
  });
});
