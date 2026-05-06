/**
 * Quick task 260505-wp8 — guards the P2.b code-review time-bomb.
 *
 * Migration 0008 inline-created partitions only for May-Oct 2026, and the
 * original create_next_evaluation_event_partition() created the *next* month
 * only. After 2026-10-31, a fresh DB had no partition matching now() and an
 * `INSERT INTO evaluation_event ... DEFAULT now()` raised
 * `no partition of relation "evaluation_event" found for row`.
 *
 * Migration 0016 fixes this:
 *   - Inline-creates current calendar month + 6 forward partitions
 *     (CREATE TABLE IF NOT EXISTS — overlap with 0008's May-Oct 2026 set is harmless)
 *   - CREATE OR REPLACEs the function to a 2-month idempotent loop (current + next)
 *
 * These tests assert:
 *   1. The current calendar month partition exists post-migrate (the regression
 *      that 0016 closes).
 *   2. create_next_evaluation_event_partition() is idempotent — invoking it twice
 *      in a row produces no error and no duplicate partitions.
 *   3. Every newly-created child (current and next month, both derived from JS
 *      `new Date()` at test-run time) has RLS+FORCE+*_tenant_isolation policy.
 *
 * Mirrors the globalThis.__pgAdminPool.connect() + try/finally release pattern
 * from tests/audit/evaluation-event-structural.test.ts.
 */
import { describe, expect, it } from 'vitest';

describe('evaluation_event partition coverage (P2.b / 260505-wp8)', () => {
  it('current-month partition exists after migrate (the time-bomb regression)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const now = new Date();
      const currentName = `evaluation_event_y${now.getFullYear()}m${String(now.getMonth() + 1).padStart(2, '0')}`;

      const { rows } = await adminClient.query<{ relname: string }>(
        `SELECT relname FROM pg_class WHERE relname = $1`,
        [currentName],
      );
      expect(
        rows.length,
        `current-month partition ${currentName} must exist post-migrate (P2.b)`,
      ).toBe(1);
    } finally {
      adminClient.release();
    }
  });

  it('create_next_evaluation_event_partition() is idempotent across two calls', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      // First call — should be a no-op since 0016 backfill already created
      // current + next month, but if it weren't, this is the call that creates them.
      await adminClient.query(`SELECT create_next_evaluation_event_partition()`);

      const { rows: afterFirst } = await adminClient.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM pg_partition_tree('evaluation_event'::regclass)
         WHERE level > 0`,
      );
      const countAfterFirst = afterFirst[0]?.count;

      // Second call — must not raise and must not change the count.
      await expect(
        adminClient.query(`SELECT create_next_evaluation_event_partition()`),
      ).resolves.toBeDefined();

      const { rows: afterSecond } = await adminClient.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM pg_partition_tree('evaluation_event'::regclass)
         WHERE level > 0`,
      );
      expect(
        afterSecond[0]?.count,
        'partition count must not change between consecutive calls (idempotency)',
      ).toBe(countAfterFirst);
    } finally {
      adminClient.release();
    }
  });

  it('every newly-created child (current + next month) has RLS+FORCE+policy', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const now = new Date();
      const currentName = `evaluation_event_y${now.getFullYear()}m${String(now.getMonth() + 1).padStart(2, '0')}`;
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const nextName = `evaluation_event_y${nextMonth.getFullYear()}m${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;

      for (const partition of [currentName, nextName]) {
        const { rows: pgClassRows } = await adminClient.query<{
          relrowsecurity: boolean;
          relforcerowsecurity: boolean;
        }>(
          `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`,
          [partition],
        );
        expect(pgClassRows.length, `${partition} must exist in pg_class`).toBe(1);
        expect(pgClassRows[0]?.relrowsecurity, `${partition} relrowsecurity`).toBe(true);
        expect(pgClassRows[0]?.relforcerowsecurity, `${partition} relforcerowsecurity`).toBe(true);

        const { rows: pgPolicyRows } = await adminClient.query<{ policyname: string }>(
          `SELECT policyname FROM pg_policies
           WHERE tablename = $1 AND policyname = $2`,
          [partition, `${partition}_tenant_isolation`],
        );
        expect(
          pgPolicyRows.length,
          `${partition} should have ${partition}_tenant_isolation policy`,
        ).toBeGreaterThanOrEqual(1);
      }
    } finally {
      adminClient.release();
    }
  });
});
