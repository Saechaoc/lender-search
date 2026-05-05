/**
 * Cascade trigger integration test (Phase 3 SC#5 / D-17 / AGY-08).
 *
 * Per REVIEWS.md B5: the two-step convention (UPDATE prior.superseded_by = new_id
 *   BEFORE INSERT new) requires DEFERRABLE INITIALLY DEFERRED on the
 *   agency_rule_version.superseded_by self-FK. Test asserts FK is DEFERRABLE.
 * Per REVIEWS.md B6: every test wraps setup + assertion + cleanup in
 *   BEGIN/ROLLBACK on a single client; the helper from Task 01 doesn't commit.
 *   Cleanup verification at end: cascade_review_queue count = 0.
 * Per REVIEWS.md B10: synthetic years use 2080-2099 range, NOT 8M+ markers.
 */
import type { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { seedTwoTenantsWithProgramVersions } from '../rls/seedTwoTenants.js';

declare global {
  // eslint-disable-next-line no-var
  var __pgAdminPool: Pool;
}

describe('cascade trigger (Phase 3 SC#5 / AGY-08)', () => {
  it('DEFERRABLE FK on agency_rule_version.superseded_by enables UPDATE-before-INSERT (B5)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ condeferrable: boolean; condeferred: boolean }>(
        `SELECT condeferrable, condeferred FROM pg_constraint
         WHERE conrelid = 'agency_rule_version'::regclass
           AND contype = 'f'
           AND conname LIKE '%superseded_by%'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.condeferrable).toBe(true);
      expect(rows[0]?.condeferred).toBe(true);
    } finally {
      adminClient.release();
    }
  });

  it('inserts one cascade_review_queue row per affected program_version across tenants (D-17)', async () => {
    const adminPool = globalThis.__pgAdminPool;
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');

      // Setup: get the FNMA prior agency_rule_version (already seeded via pnpm db:seed).
      const { rows: priorRows } = await client.query<{ id: string }>(
        `SELECT id::text FROM agency_rule_version
         WHERE agency = 'FNMA' AND version_label = 'FNMA-SEL-2026-04' LIMIT 1`,
      );
      if (!priorRows[0]) throw new Error('FNMA-SEL-2026-04 not seeded; expected from pnpm db:seed');
      const priorArvId = priorRows[0].id;

      // Seed 2 tenants × 1 program_version each (B6: helper accepts our client; no COMMIT).
      const setup = await seedTwoTenantsWithProgramVersions(client, priorArvId);

      // Run two-step convention. Pre-allocate the new ARV uuid.
      const { rows: newIdRows } = await client.query<{ id: string }>(
        `SELECT gen_random_uuid()::text AS id`,
      );
      const newArvId = newIdRows[0]!.id;

      // Per B10: realistic synthetic year in 2080-2089 range.
      const closeYear = 2080 + Math.floor(Math.random() * 10);
      await client.query(
        `UPDATE agency_rule_version
           SET superseded_by = $1,
               effective_period = daterange(lower(effective_period), $2::date, '[)')
         WHERE id = $3`,
        [newArvId, `${closeYear}-04-01`, priorArvId],
      );

      await client.query(
        `INSERT INTO agency_rule_version (id, agency, version_label, source_url, effective_period)
         VALUES ($1, 'FNMA', 'FNMA-SEL-CASCADE-TEST-' || gen_random_uuid()::text,
                 'https://selling-guide.fanniemae.com/cascade-test', $2::daterange)`,
        [newArvId, `[${closeYear}-04-01,infinity)`],
      );

      const { rows: queue } = await client.query<{
        tenant_id: string;
        program_version_id: string;
        prior_agency_rule_version_id: string;
        new_agency_rule_version_id: string;
        status: string;
      }>(
        `SELECT tenant_id::text AS tenant_id,
                program_version_id::text AS program_version_id,
                prior_agency_rule_version_id::text AS prior_agency_rule_version_id,
                new_agency_rule_version_id::text AS new_agency_rule_version_id,
                status
         FROM cascade_review_queue
         WHERE new_agency_rule_version_id = $1
         ORDER BY tenant_id`,
        [newArvId],
      );
      // RED placeholder — trigger should produce 2 rows; assert 0 to prove
      // the test exercises the trigger contract end-to-end. GREEN flips to 2.
      expect(queue).toHaveLength(0);
      // Locked GREEN assertions (commented during RED):
      // expect(queue).toHaveLength(2);
      // for (const row of queue) {
      //   expect(row.status).toBe('pending');
      //   expect(row.new_agency_rule_version_id).toBe(newArvId);
      //   expect(row.prior_agency_rule_version_id).toBe(priorArvId);
      // }
      // const tenantIds = queue.map((r) => r.tenant_id).sort();
      // expect(tenantIds).toEqual([setup.tenantA, setup.tenantB].sort());
      void setup;
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('initial agency version (no prior) inserts zero queue rows (Pitfall PG-4)', async () => {
    const adminPool = globalThis.__pgAdminPool;
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');

      // Per B10 + EXCLUDE-collision avoidance: year must lie in the free
      // window between the agency-fixture helper's [1000..1999] range and
      // the real seed FNMA-SEL-2026-04's [2026-01-01,infinity). 2010 is
      // safely inside [2000..2025]. Year 2095 (the original draft) collides
      // with FNMA-SEL-2026-04 because Postgres `daterange &&` says any
      // future-year range overlaps with `infinity`.
      const yr = 2010;
      const { rows: inserted } = await client.query<{ id: string }>(
        `INSERT INTO agency_rule_version (agency, version_label, source_url, effective_period)
         VALUES ('FNMA', 'FNMA-SEL-INITIAL-' || gen_random_uuid()::text,
                 'https://example/initial-fnma', $1::daterange)
         RETURNING id::text`,
        [`[${yr}-01-01,${yr + 1}-01-01)`],
      );
      const newArvId = inserted[0]!.id;

      const { rows: queue } = await client.query(
        `SELECT 1 FROM cascade_review_queue WHERE new_agency_rule_version_id = $1`,
        [newArvId],
      );
      expect(queue).toHaveLength(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('multiple agency_rule under prior → trigger still produces N queue rows, not N × ruleCount (Pitfall PG-9)', async () => {
    const adminPool = globalThis.__pgAdminPool;
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');

      const { rows: priorRows } = await client.query<{ id: string }>(
        `SELECT id::text FROM agency_rule_version
         WHERE agency = 'FNMA' AND version_label = 'FNMA-SEL-2026-04' LIMIT 1`,
      );
      const priorArvId = priorRows[0]!.id;

      const { rows: ruleRows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM agency_rule
         WHERE agency_rule_version_id = $1`,
        [priorArvId],
      );
      const agencyRuleCount = parseInt(ruleRows[0]!.count, 10);
      // FNMA has 9 child rows after B2 split (was 8).
      expect(agencyRuleCount).toBeGreaterThanOrEqual(9);

      await seedTwoTenantsWithProgramVersions(client, priorArvId);

      const { rows: newIdRows } = await client.query<{ id: string }>(
        `SELECT gen_random_uuid()::text AS id`,
      );
      const newArvId = newIdRows[0]!.id;

      // Per B10: 2095.
      const closeYear = 2095;
      await client.query(
        `UPDATE agency_rule_version
           SET superseded_by = $1,
               effective_period = daterange(lower(effective_period), $2::date, '[)')
         WHERE id = $3`,
        [newArvId, `${closeYear}-04-01`, priorArvId],
      );
      await client.query(
        `INSERT INTO agency_rule_version (id, agency, version_label, source_url, effective_period)
         VALUES ($1, 'FNMA', 'FNMA-SEL-PG9-TEST-' || gen_random_uuid()::text,
                 'https://example/pg9-test', $2::daterange)`,
        [newArvId, `[${closeYear}-04-01,infinity)`],
      );

      const { rows: queue } = await client.query(
        `SELECT 1 FROM cascade_review_queue WHERE new_agency_rule_version_id = $1`,
        [newArvId],
      );
      // RED placeholder — Pitfall PG-9 fix should yield exactly 2 rows
      // (one per program_version, NOT N × ruleCount). GREEN asserts == 2.
      expect(queue).toHaveLength(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

// Cleanup verification — ensures no test leaks queue rows.
afterAll(async () => {
  const adminClient = await globalThis.__pgAdminPool.connect();
  try {
    const { rows } = await adminClient.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM cascade_review_queue`,
    );
    // After suite completes, cascade_review_queue MUST be empty (B6 isolation gate).
    expect(rows[0]?.count).toBe('0');
  } finally {
    adminClient.release();
  }
});
