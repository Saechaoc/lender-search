/**
 * Phase 3 review BL-01: rule_snapshot read access is system_role-only.
 *
 * Migration 0018 replaced the world-read policy with a system_role-only
 * SELECT policy and revoked SELECT from app_user. Validates two
 * properties:
 *
 *  1. The world-read policy no longer exists.
 *  2. An app_user-role connection cannot SELECT from rule_snapshot.
 *
 * Phase 5+ tenant-readable snapshot work (UI rendering historical rule
 * stack) MUST add an explicit tenant_id column and a per-tenant policy;
 * do not re-introduce the world-read shortcut.
 */
import { describe, expect, it } from 'vitest';

describe('rule_snapshot system-only read (BL-01 / migration 0018)', () => {
  it('rule_snapshot_world_read policy is gone; rule_snapshot_system_read exists', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ policyname: string; roles: string[] }>(
        `SELECT policyname, roles::text[] FROM pg_policies
         WHERE tablename = 'rule_snapshot' AND cmd = 'SELECT'`,
      );
      const names = rows.map((r) => r.policyname);
      expect(names).not.toContain('rule_snapshot_world_read');
      expect(names).toContain('rule_snapshot_system_read');

      // The new policy targets system_role, not public.
      const sysRead = rows.find((r) => r.policyname === 'rule_snapshot_system_read');
      expect(sysRead?.roles).toEqual(['system_role']);
    } finally {
      adminClient.release();
    }
  });

  it('app_user has no SELECT privilege on rule_snapshot', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ has_privilege: boolean }>(
        `SELECT has_table_privilege('app_user', 'rule_snapshot', 'SELECT') AS has_privilege`,
      );
      expect(rows[0]?.has_privilege).toBe(false);
    } finally {
      adminClient.release();
    }
  });

  it('app_user-role connection sees zero rows from rule_snapshot (RLS + GRANT both block)', async () => {
    const tenantClient = await globalThis.__pgPool.connect();
    try {
      // app_user lacks SELECT GRANT — query raises permission_denied.
      // We assert the failure mode rather than a row count: defense-in-depth
      // means the GRANT is the first wall, the policy is the second.
      await expect(
        tenantClient.query(`SELECT id FROM rule_snapshot LIMIT 1`),
      ).rejects.toThrow(/permission denied|policy/i);
    } finally {
      tenantClient.release();
    }
  });
});
