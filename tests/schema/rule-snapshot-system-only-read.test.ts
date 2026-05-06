/**
 * Phase 3 review BL-01 -> 260506-al0 (Option B): rule_snapshot tenant_isolation.
 *
 * Migration 0022 dropped the role-gated policies (rule_snapshot_system_read +
 * rule_snapshot_system_write) installed by 0019 and replaced them with a
 * single tenant_isolation policy whose shape mirrors program_version /
 * evaluation_event / lender_overlay_rule. Validates four properties:
 *
 *  1. The role-gated policies are gone.
 *  2. The tenant_isolation policy exists with the expected USING clause.
 *  3. app_user with app.tenant_id=A reads tenant A rows; app.tenant_id=B
 *     does not see tenant A rows (the canonical Option B isolation proof).
 *  4. INSERT WITH CHECK rejects a tenant_id that does not match
 *     current_setting('app.tenant_id').
 */
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let fixtureTenantId: string;

declare global {
  // setup.ts assigns these.
  // eslint-disable-next-line no-var
  var __pgAdminPool: Pool;
  // eslint-disable-next-line no-var
  var __pgPool: Pool;
}

beforeAll(async () => {
  const admin = await globalThis.__pgAdminPool.connect();
  try {
    const ts = Date.now();
    const t = await admin.query<{ id: string }>(
      `INSERT INTO tenant (kind, name) VALUES ('BROKERAGE', $1) RETURNING id::text`,
      [`260506-al0-rls-fixture-${ts}`],
    );
    fixtureTenantId = t.rows[0]!.id;
  } finally {
    admin.release();
  }
});

afterAll(async () => {
  if (!fixtureTenantId) return;
  const admin = await globalThis.__pgAdminPool.connect();
  try {
    await admin.query(`DELETE FROM rule_snapshot WHERE tenant_id = $1::uuid`, [fixtureTenantId]);
    await admin.query(`DELETE FROM tenant WHERE id = $1::uuid`, [fixtureTenantId]);
  } finally {
    admin.release();
  }
});

describe('rule_snapshot tenant_isolation (BL-01 -> 260506-al0 / migration 0022)', () => {
  it('rule_snapshot_system_read and rule_snapshot_system_write are gone; rule_snapshot_tenant_isolation exists', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ policyname: string; roles: string[]; qual: string | null }>(
        `SELECT policyname, roles::text[], qual FROM pg_policies
         WHERE tablename = 'rule_snapshot'`,
      );
      const names = rows.map((r) => r.policyname);
      expect(names).not.toContain('rule_snapshot_world_read');
      expect(names).not.toContain('rule_snapshot_system_read');
      expect(names).not.toContain('rule_snapshot_system_write');
      expect(names).toContain('rule_snapshot_tenant_isolation');

      // The new policy targets `public` (not system_role) and uses the
      // standard app.tenant_id GUC clause.
      const policy = rows.find((r) => r.policyname === 'rule_snapshot_tenant_isolation');
      expect(policy?.roles).toEqual(['public']);
      expect(policy?.qual).toMatch(/tenant_id = .*current_setting.*app\.tenant_id/i);
    } finally {
      adminClient.release();
    }
  });

  it('app_user has SELECT and INSERT privileges on rule_snapshot', async () => {
    // 260506-al0: 0019 revoked SELECT from app_user. 0022 re-grants
    // SELECT and INSERT because the per-tenant policy (not the GRANT) is
    // the wall.
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ has_select: boolean; has_insert: boolean }>(
        `SELECT has_table_privilege('app_user', 'rule_snapshot', 'SELECT') AS has_select,
                has_table_privilege('app_user', 'rule_snapshot', 'INSERT') AS has_insert`,
      );
      expect(rows[0]?.has_select).toBe(true);
      expect(rows[0]?.has_insert).toBe(true);
    } finally {
      adminClient.release();
    }
  });

  it('app_user with matching app.tenant_id reads its rows; mismatched app.tenant_id sees zero', async () => {
    // Setup: under the admin pool, INSERT a fixture rule_snapshot row for
    // fixtureTenantId.
    const admin = await globalThis.__pgAdminPool.connect();
    let fixtureRowId: string;
    try {
      const result = await admin.query<{ id: string }>(
        `INSERT INTO rule_snapshot (tenant_id, sha256_hash, content_jsonb)
         VALUES ($1, $2, $3::jsonb)
         RETURNING id::text`,
        [
          fixtureTenantId,
          // Synthetic 64-char hex hash unique to this test (does not collide
          // with any real snapshotId() output for an empty bundle).
          'fixture260506al0deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
          JSON.stringify({ schema_version: 2, fixture: '260506-al0' }),
        ],
      );
      fixtureRowId = result.rows[0]!.id;
    } finally {
      admin.release();
    }

    try {
      // app_user with matching app.tenant_id: sees the row.
      const matching = await globalThis.__pgPool.connect();
      try {
        await matching.query('BEGIN');
        await matching.query(`SELECT set_config('app.tenant_id', $1, true)`, [fixtureTenantId]);
        const { rows: visibleRows } = await matching.query<{ id: string }>(
          `SELECT id::text FROM rule_snapshot WHERE id = $1::uuid`,
          [fixtureRowId],
        );
        expect(visibleRows).toHaveLength(1);
        await matching.query('ROLLBACK');
      } finally {
        matching.release();
      }

      // app_user with mismatched app.tenant_id: sees zero rows.
      const mismatched = await globalThis.__pgPool.connect();
      try {
        await mismatched.query('BEGIN');
        // Use a tenant id that doesn't match (and doesn't need to exist
        // in tenant — RLS just compares).
        await mismatched.query(
          `SELECT set_config('app.tenant_id', $1, true)`,
          ['99999999-9999-9999-9999-999999999999'],
        );
        const { rows: invisibleRows } = await mismatched.query<{ id: string }>(
          `SELECT id::text FROM rule_snapshot WHERE id = $1::uuid`,
          [fixtureRowId],
        );
        expect(invisibleRows).toHaveLength(0);
        await mismatched.query('ROLLBACK');
      } finally {
        mismatched.release();
      }
    } finally {
      // Cleanup the fixture row (afterAll's tenant DELETE depends on
      // ON DELETE RESTRICT not firing, so the row must be gone first).
      const cleanup = await globalThis.__pgAdminPool.connect();
      try {
        await cleanup.query(`DELETE FROM rule_snapshot WHERE id = $1::uuid`, [fixtureRowId]);
      } finally {
        cleanup.release();
      }
    }
  });

  it('INSERT WITH CHECK rejects mismatched tenant_id', async () => {
    // 260506-al0: under app_user with app.tenant_id = X, attempting to
    // INSERT a row with tenant_id = Y (Y != X) fails with the standard
    // row-level-security violation.
    const tenantClient = await globalThis.__pgPool.connect();
    try {
      await tenantClient.query('BEGIN');
      await tenantClient.query(
        `SELECT set_config('app.tenant_id', $1, true)`,
        [fixtureTenantId],
      );
      await expect(
        tenantClient.query(
          `INSERT INTO rule_snapshot (tenant_id, sha256_hash, content_jsonb)
           VALUES ($1, $2, $3::jsonb)`,
          [
            // Different tenant id than the GUC.
            '99999999-9999-9999-9999-999999999999',
            'fixture260506al0reject0000000000000000000000000000000000000000ff',
            JSON.stringify({ fixture: 'reject' }),
          ],
        ),
      ).rejects.toThrow(/row-level security|policy/i);
      await tenantClient.query('ROLLBACK');
    } catch (err) {
      try {
        await tenantClient.query('ROLLBACK');
      } catch {
        /* swallow */
      }
      throw err;
    } finally {
      tenantClient.release();
    }
  });
});
