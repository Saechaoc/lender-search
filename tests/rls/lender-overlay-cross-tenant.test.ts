/**
 * Cross-tenant pen tests for `lender_overlay_rule` table (D-19 / T-2-01 / Pitfall 3.5).
 *
 * Per CONTEXT D-07: this table ships at Phase 2 even though Phase 12 v2
 * LOV-01..03 brings the brokerage-author UI. The pen tests assert the
 * structural posture is correct now — cross-tenant overlay visibility is
 * the explicit antitrust release-blocker (PROJECT.md §Out of Scope; the
 * October 2025 Optimal Blue class action makes a single cross-tenant leak
 * existentially expensive).
 *
 * Two layers of coverage:
 *
 *   1. D-03 matrix (mirroring program / program_version / etc.):
 *      - in-tenant INSERT with applies_to_program_id NULL succeeds (D-05:
 *        NULL means "all programs at this tenant")
 *      - cross-tenant INSERT with mismatched tenant_id rejected by RLS
 *      - cross-tenant SELECT returns 0 rows (after a B-tenant overlay is
 *        seeded via adminPool to bypass connectAsTenant's ROLLBACK)
 *      - anonymous returns 0 rows
 *
 *   2. FK-to-foreign-program EDGE CASE (Approach (a) per Plan revision
 *      2026-04-30 / Issue W5): tenant B's INSERT with
 *      applies_to_program_id=A_program_id SUCCEEDS — Postgres FK target row
 *      check bypasses RLS by design. The test asserts the OBSERVED success
 *      behavior with `expect(result.rowCount).toBe(1)` (real assertion, NOT
 *      a `typeof boolean` placeholder). The data-integrity gap (B-tenant
 *      overlay binding to A-tenant program) is documented as a Phase 12
 *      LOV-01..03 commit-transaction-level guard requirement.
 */
import { describe, expect, it } from 'vitest';
import { connectAsAnonymous, connectAsTenant } from './fixtures/connection.js';
import { seedTwoTenants } from './seedTwoTenants.js';

describe('RLS: cross-tenant access on lender_overlay_rule table (D-19 / T-2-01 / Pitfall 3.5)', () => {
  it('connectAsAnonymous returns 0 rows (table empty + RLS)', async () => {
    await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsAnonymous(globalThis.__pgPool, async (client) => {
      const { rows } = await client.query(`SELECT id::text FROM lender_overlay_rule`);
      expect(rows).toHaveLength(0);
    });
  });

  it('in-tenant INSERT succeeds with applies_to_program_id NULL (D-05: applies to all programs)', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO lender_overlay_rule (
           tenant_id, applies_to_program_id, rule_kind, rule_body, primary_citation_id
         ) VALUES ($1, NULL, 'fico_min', '{"value": 720}'::jsonb, $2)
         RETURNING id::text`,
        [seed.tenantA, seed.citationA],
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.id).toMatch(/^[0-9a-f-]{36}$/i);
      // connectAsTenant rolls back so the row does not persist.
    });
  });

  it('cross-tenant INSERT with mismatched tenant_id is rejected by RLS', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await expect(
      connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
        await client.query(
          `INSERT INTO lender_overlay_rule (
             tenant_id, applies_to_program_id, rule_kind, rule_body, primary_citation_id
           ) VALUES ($1, NULL, 'fico_min', '{"value": 720}'::jsonb, $2)`,
          [seed.tenantB, seed.citationA],
        );
      }),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it("cross-tenant SELECT returns 0 rows after a B-tenant overlay is admin-inserted", async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);

    // Admin INSERT a B-tenant overlay so it COMMITs (connectAsTenant rolls
    // back, which would void the row before A's assertion). adminPool
    // connects as postgres (BYPASSRLS), so the WITH CHECK clause is not
    // evaluated — the row lands directly. We clean up at the end of the
    // test so it doesn't leak into the FK-to-foreign-program test below.
    let bOverlayId: string | null = null;
    {
      const adminClient = await globalThis.__pgAdminPool.connect();
      try {
        const result = await adminClient.query<{ id: string }>(
          `INSERT INTO lender_overlay_rule (
             tenant_id, applies_to_program_id, rule_kind, rule_body, primary_citation_id
           ) VALUES ($1, NULL, 'fico_min', '{"value": 740}'::jsonb, $2)
           RETURNING id::text`,
          [seed.tenantB, seed.citationB],
        );
        bOverlayId = result.rows[0]!.id;
      } finally {
        adminClient.release();
      }
    }

    try {
      // Tenant A's GUC; B's overlay must be invisible.
      await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
        const { rows } = await client.query(
          `SELECT id::text FROM lender_overlay_rule`,
        );
        expect(rows).toHaveLength(0);
      });
    } finally {
      // Cleanup: drop B's seeded overlay so it doesn't pollute later tests.
      if (bOverlayId) {
        const cleanupClient = await globalThis.__pgAdminPool.connect();
        try {
          await cleanupClient.query(
            `DELETE FROM lender_overlay_rule WHERE id = $1::uuid`,
            [bOverlayId],
          );
        } finally {
          cleanupClient.release();
        }
      }
    }
  });

  /**
   * FK-to-foreign-program edge case (Approach (a) per Plan revision
   * 2026-04-30 / Issue W5).
   *
   * Postgres FK target row check is enforced at the system level — it walks
   * pg_class directly to verify the target row exists, bypassing the RLS
   * policy that would otherwise hide tenant A's program from tenant B.
   * This is documented Postgres behavior, not a bug.
   *
   * Result: tenant B can reference tenant A's program_id via
   * lender_overlay_rule.applies_to_program_id, creating a tenant boundary
   * inconsistency at the data layer (a B-tenant overlay row pointing at an
   * A-tenant program). RLS still prevents B from SEEING A's program; the
   * inconsistency is purely structural — B's overlay row references a
   * program it cannot read.
   *
   * This test asserts the OBSERVED Postgres behavior (INSERT succeeds with
   * rowCount=1). Why a real assertion rather than `typeof insertSucceeded ===
   * 'boolean'`-style documentation theater: a real assertion catches future
   * Postgres patches that might propagate RLS into FK target checks (a
   * future Postgres patch could silently flip this from SUCCESS to FAILURE
   * without us noticing).
   *
   * The data-integrity gap is documented for Phase 12:
   *   - Phase 12 LOV-01..03 commit transaction MUST add an application-layer
   *     check: when validating applies_to_program_id, verify that
   *     program.tenant_id = current_setting('app.tenant_id', true)::uuid
   *     before allowing the overlay to commit.
   *   - This boundary is tracked in 02-CONTEXT.md `<deferred>` section under
   *     "Brokerage LENDER_OVERLAY author UI — Phase 12 v2 (LOV-01..03)".
   *
   * Pitfall 3.5 (tenant isolation breached by shared overlay) is a stronger
   * variant of this — the Phase 12 commit guard closes both.
   */
  it('FK-to-foreign-program: tenant B INSERT with applies_to_program_id=A_program SUCCEEDS — Phase 12 LOV must add app-layer guard', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);

    await connectAsTenant(globalThis.__pgPool, seed.tenantB, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO lender_overlay_rule (
           tenant_id, applies_to_program_id, rule_kind, rule_body, primary_citation_id
         ) VALUES ($1, $2, 'fico_min', '{"value": 740}'::jsonb, $3)
         RETURNING id::text`,
        [seed.tenantB, seed.programA, seed.citationB],
      );
      // Postgres FK bypasses RLS for the target row check. The INSERT
      // succeeds, creating a B-tenant overlay row that references
      // A-tenant's program. connectAsTenant rolls back, so the row does
      // not persist past this test.
      expect(result.rowCount).toBe(1);
      expect(result.rows[0]!.id).toMatch(/^[0-9a-f-]{36}$/i);
    });
  });
});
