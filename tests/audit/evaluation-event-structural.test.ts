/**
 * Structural tests for evaluation_event (AUD-01 / AUD-02 / AUD-03 / D-01 / D-02).
 *
 * Verifies:
 *   - Parent partitioned table exists; 6 forward partitions (May-Oct 2026).
 *   - RLS + FORCE on parent only (Pitfall PG-1).
 *   - REVOKE UPDATE,DELETE on parent + every child partition (Pitfall PG-2).
 *   - Composite PK (id, evaluated_at).
 *   - decision CHECK constraint enumerates exactly 3 values.
 *   - SQL function create_next_evaluation_event_partition() exists.
 *
 * These tests run against the post-migrate DB schema introspection — no per-test
 * fixture seeds.
 */
import { describe, expect, it } from 'vitest';

describe('evaluation_event structural (AUD-01..03 / D-01 / D-02)', () => {
  it('evaluation_event partitioned: 0008 inline partitions still present', async () => {
    // Loosened post-0016 (260505-wp8): IF NOT EXISTS overlap means at least 6
    // partitions exist — the original 6 from 0008 are a guaranteed subset.
    // Migration 0016 inline-creates current month + 6 forward, plus the
    // create_next function ensures current + next month after every cron tick,
    // so the absolute count is environment-dependent (clock-driven).
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ partition_name: string }>(
        `SELECT relid::regclass::text AS partition_name
         FROM pg_partition_tree('evaluation_event'::regclass)
         WHERE level > 0
         ORDER BY relid::regclass::text`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(6);
      const ORIGINAL_6 = [
        'evaluation_event_y2026m05',
        'evaluation_event_y2026m06',
        'evaluation_event_y2026m07',
        'evaluation_event_y2026m08',
        'evaluation_event_y2026m09',
        'evaluation_event_y2026m10',
      ];
      const names = rows.map((r) => r.partition_name);
      for (const expected of ORIGINAL_6) {
        expect(names, `${expected} must be present (0008 inline partition)`).toContain(expected);
      }
    } finally {
      adminClient.release();
    }
  });

  it('evaluation_event has FORCE ROW LEVEL SECURITY on parent', async () => {
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

  it('evaluation_event columns exist with correct types and constraints (AUD-02)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ column_name: string; data_type: string; is_nullable: string }>(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_name = 'evaluation_event'
         ORDER BY column_name`,
      );
      const cols = new Map(rows.map((r) => [r.column_name, r]));
      // AUD-02 columns required.
      for (const required of [
        'id', 'tenant_id', 'user_id', 'scenario_hash', 'scenario_payload',
        'ruleset_snapshot_id', 'program_version_id', 'decision',
        'rule_stack', 'evaluator_version', 'evaluated_at',
      ]) {
        expect(cols.has(required), `column ${required} must exist`).toBe(true);
        expect(cols.get(required)?.is_nullable).toBe('NO');
      }
      // Optional columns per AUD-02.
      expect(cols.has('deciding_rule_id')).toBe(true);
      expect(cols.has('deciding_rule_layer')).toBe(true);
      expect(cols.has('near_miss_delta')).toBe(true);
    } finally {
      adminClient.release();
    }
  });

  it('evaluation_event REVOKE UPDATE,DELETE applied at parent (AUD-03 / D-02)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      // Verify app_user has SELECT and INSERT but NOT UPDATE or DELETE.
      const select = await adminClient.query<{ has_privilege: boolean }>(
        `SELECT has_table_privilege('app_user', 'evaluation_event', 'SELECT') AS has_privilege`,
      );
      expect(select.rows[0]?.has_privilege).toBe(true);
      const insert = await adminClient.query<{ has_privilege: boolean }>(
        `SELECT has_table_privilege('app_user', 'evaluation_event', 'INSERT') AS has_privilege`,
      );
      expect(insert.rows[0]?.has_privilege).toBe(true);
      const update = await adminClient.query<{ has_privilege: boolean }>(
        `SELECT has_table_privilege('app_user', 'evaluation_event', 'UPDATE') AS has_privilege`,
      );
      expect(update.rows[0]?.has_privilege).toBe(false);
      const del = await adminClient.query<{ has_privilege: boolean }>(
        `SELECT has_table_privilege('app_user', 'evaluation_event', 'DELETE') AS has_privilege`,
      );
      expect(del.rows[0]?.has_privilege).toBe(false);

      // system_role: also denied UPDATE/DELETE per D-02 maximalist.
      const sysUpdate = await adminClient.query<{ has_privilege: boolean }>(
        `SELECT has_table_privilege('system_role', 'evaluation_event', 'UPDATE') AS has_privilege`,
      );
      expect(sysUpdate.rows[0]?.has_privilege).toBe(false);
      const sysDelete = await adminClient.query<{ has_privilege: boolean }>(
        `SELECT has_table_privilege('system_role', 'evaluation_event', 'DELETE') AS has_privilege`,
      );
      expect(sysDelete.rows[0]?.has_privilege).toBe(false);
    } finally {
      adminClient.release();
    }
  });

  it('evaluation_event REVOKE inherits to all 6 child partitions (Pitfall PG-2)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const partitions = ['evaluation_event_y2026m05', 'evaluation_event_y2026m06',
        'evaluation_event_y2026m07', 'evaluation_event_y2026m08',
        'evaluation_event_y2026m09', 'evaluation_event_y2026m10'];
      for (const partition of partitions) {
        const { rows } = await adminClient.query<{ has_privilege: boolean }>(
          `SELECT has_table_privilege('app_user', $1, 'UPDATE') AS has_privilege`,
          [partition],
        );
        expect(rows[0]?.has_privilege, `${partition} app_user UPDATE must be revoked`).toBe(false);
        const del = await adminClient.query<{ has_privilege: boolean }>(
          `SELECT has_table_privilege('app_user', $1, 'DELETE') AS has_privilege`,
          [partition],
        );
        expect(del.rows[0]?.has_privilege, `${partition} app_user DELETE must be revoked`).toBe(false);
      }
    } finally {
      adminClient.release();
    }
  });

  it('evaluation_event has composite PK (id, evaluated_at)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ pg_get_constraintdef: string }>(
        `SELECT pg_get_constraintdef(oid) FROM pg_constraint
         WHERE conrelid = 'evaluation_event'::regclass AND contype = 'p'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.pg_get_constraintdef).toMatch(/PRIMARY KEY \(id, evaluated_at\)/);
    } finally {
      adminClient.release();
    }
  });

  it('evaluation_event has decision CHECK constraint enumerating 3 values', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ pg_get_constraintdef: string }>(
        `SELECT pg_get_constraintdef(oid) FROM pg_constraint
         WHERE conrelid = 'evaluation_event'::regclass
           AND contype = 'c'
           AND conname = 'evaluation_event_decision_check'`,
      );
      expect(rows).toHaveLength(1);
      for (const value of ['eligible', 'near_miss', 'ineligible']) {
        expect(rows[0]?.pg_get_constraintdef).toContain(value);
      }
    } finally {
      adminClient.release();
    }
  });

  it('create_next_evaluation_event_partition() function exists (D-01)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ proname: string }>(
        `SELECT proname FROM pg_proc WHERE proname = 'create_next_evaluation_event_partition'`,
      );
      expect(rows).toHaveLength(1);
    } finally {
      adminClient.release();
    }
  });
});
