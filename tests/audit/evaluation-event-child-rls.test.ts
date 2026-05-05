/**
 * Phase 3 / Plan 03-01 Task 08 Delta 3 (REVIEWS.md B7b option b).
 *
 * Asserts:
 *   - Parent + every child partition has relrowsecurity=t AND relforcerowsecurity=t
 *   - Each child has a *_tenant_isolation policy
 *   - The create_next_evaluation_event_partition() function applies RLS+FORCE
 *     to a synthetically-created future partition
 */
import { describe, expect, it } from 'vitest';

const CHILDREN = [
  'evaluation_event_y2026m05',
  'evaluation_event_y2026m06',
  'evaluation_event_y2026m07',
  'evaluation_event_y2026m08',
  'evaluation_event_y2026m09',
  'evaluation_event_y2026m10',
];

describe('evaluation_event child partition RLS+FORCE (B7b / Delta 3)', () => {
  it('parent has RLS+FORCE', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'evaluation_event'`,
      );
      expect(rows[0]?.relrowsecurity).toBe(true);
      expect(rows[0]?.relforcerowsecurity).toBe(true);
    } finally {
      adminClient.release();
    }
  });

  it('every child partition has RLS+FORCE', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      for (const child of CHILDREN) {
        const { rows } = await adminClient.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
          `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`,
          [child],
        );
        expect(rows[0]?.relrowsecurity, `${child} relrowsecurity`).toBe(true);
        expect(rows[0]?.relforcerowsecurity, `${child} relforcerowsecurity`).toBe(true);
      }
    } finally {
      adminClient.release();
    }
  });

  it('every child has a *_tenant_isolation policy', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      for (const child of CHILDREN) {
        const { rows } = await adminClient.query<{ policyname: string }>(
          `SELECT policyname FROM pg_policies
           WHERE tablename = $1 AND policyname = $2`,
          [child, `${child}_tenant_isolation`],
        );
        expect(rows.length, `${child} should have ${child}_tenant_isolation policy`).toBeGreaterThanOrEqual(1);
      }
    } finally {
      adminClient.release();
    }
  });

  it('create_next_evaluation_event_partition() applies RLS+FORCE to a synthetic future partition', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      // Invoke the function — it creates next-month partition if not present.
      await adminClient.query(`SELECT create_next_evaluation_event_partition()`);

      // The function targets next month relative to now(); compute the expected name.
      const now = new Date();
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const partitionName = `evaluation_event_y${nextMonth.getFullYear()}m${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;

      const { rows } = await adminClient.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`,
        [partitionName],
      );
      expect(rows.length, `${partitionName} should exist after invoking partition creator`).toBe(1);
      expect(rows[0]?.relrowsecurity).toBe(true);
      expect(rows[0]?.relforcerowsecurity).toBe(true);
    } finally {
      adminClient.release();
    }
  });
});
