/**
 * Phase 3 / Plan 03-01 Task 08 Delta 1 (REVIEWS.md B5).
 *
 * Asserts:
 *   - agency_rule_version.superseded_by FK is condeferrable=t AND condeferred=t
 *   - The two-step cascade convention (UPDATE prior.superseded_by = new_id
 *     BEFORE INSERT new_id) succeeds inside a single transaction.
 */
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

describe('agency_rule_version.superseded_by DEFERRABLE FK (B5 / Delta 1)', () => {
  it('FK is condeferrable=t AND condeferred=t', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ condeferrable: boolean; condeferred: boolean }>(
        `SELECT condeferrable, condeferred
         FROM pg_constraint
         WHERE conrelid='agency_rule_version'::regclass
           AND conname LIKE '%superseded_by%'`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]?.condeferrable).toBe(true);
      expect(rows[0]?.condeferred).toBe(true);
    } finally {
      adminClient.release();
    }
  });

  it('two-step cascade convention succeeds inside a single transaction', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    // Phase 3 / Plan 03-02 [Rule 1 - Bug] regression fix: Wave 1 plans seed
    // real FNMA `[2026-01-01,infinity)` rows; range MUST be anchored
    // pre-2026 to avoid `agency_rule_version_no_overlap` EXCLUDE collision
    // (Postgres `daterange &&` says future years overlap with `infinity`).
    // Picks year [1700..1750] — far below 2026 and disjoint from the
    // seedAgencyVersion fixture's [800..1499] window so cleanup of the
    // prior+new pair (DELETE at end of test) doesn't race on collision.
    const yearStart = 1700 + Math.floor(Math.random() * 50);
    const newId = randomUUID();
    try {
      await adminClient.query('BEGIN');

      // 1. Insert PRIOR ARV.
      const prior = await adminClient.query<{ id: string }>(
        `INSERT INTO agency_rule_version (agency, version_label, source_url, effective_period)
         VALUES ('FNMA', 'B5-DEFERRABLE-PRIOR-' || gen_random_uuid()::text,
                 'https://example/prior',
                 $1::daterange)
         RETURNING id::text`,
        [`[${yearStart}-01-01,${yearStart + 1}-01-01)`],
      );
      const priorId = prior.rows[0]!.id;

      // 2. UPDATE prior.superseded_by = new_id BEFORE INSERT new_id.
      // Without DEFERRABLE this fails immediately (no row with id=newId yet).
      // With DEFERRABLE INITIALLY DEFERRED the FK validation defers to COMMIT.
      await adminClient.query(
        `UPDATE agency_rule_version SET superseded_by = $1 WHERE id = $2`,
        [newId, priorId],
      );

      // 3. INSERT NEW ARV with the pre-allocated id.
      // Use a non-overlapping daterange so the EXCLUDE constraint doesn't fire.
      await adminClient.query(
        `INSERT INTO agency_rule_version (id, agency, version_label, source_url, effective_period)
         VALUES ($1, 'FNMA', 'B5-DEFERRABLE-NEW-' || gen_random_uuid()::text,
                 'https://example/new',
                 $2::daterange)`,
        [newId, `[${yearStart + 1}-01-01,${yearStart + 2}-01-01)`],
      );

      // COMMIT validates deferred FK; both rows now exist; FK satisfied.
      await adminClient.query('COMMIT');

      // Cleanup — DELETE the rows so they don't leak into other tests.
      await adminClient.query(
        `DELETE FROM agency_rule_version WHERE id IN ($1, $2)`,
        [priorId, newId],
      );
    } catch (err) {
      try { await adminClient.query('ROLLBACK'); } catch { /* swallow */ }
      throw err;
    } finally {
      adminClient.release();
    }
  });
});
