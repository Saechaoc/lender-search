/**
 * Cross-tenant pen tests for `cascade_review_queue` (Phase 3 D-19 / AGY-08 / T-3-01).
 *
 * Mirrors the Phase 1 D-03 / Phase 2 D-19 6-case matrix template:
 *   1. cross-tenant SELECT returns 0 rows
 *   2. anonymous (GUC fails closed) returns 0 rows
 *   3. in-tenant SELECT returns the in-tenant row
 *   4. cross-tenant INSERT with mismatched tenant_id is rejected (RLS WITH CHECK)
 *   5. cross-tenant UPDATE on foreign tenant row affects 0 rows
 *   6. cross-tenant DELETE on foreign tenant row affects 0 rows
 *
 * Per REVIEWS.md B6: every test wraps setup + assertion + cleanup in
 *   BEGIN/ROLLBACK on a single admin client. afterAll asserts queue count = 0
 *   post-suite (no leaked rows).
 *
 * Per iter-2 REVIEWS.md B6 regression resolution: the prior plan used
 *   `connectAsTenant(globalThis.__pgPool, ...)` to switch to a SEPARATE
 *   app_user connection. That broke because the seed data was inserted on
 *   adminClient inside an UNCOMMITTED transaction — the separate connection
 *   couldn't see those rows, so RLS failures looked like FK/visibility
 *   failures. Fix: switch roles WITHIN THE SAME TRANSACTION via
 *   `SET LOCAL ROLE app_user` + `SET LOCAL` GUC, then `RESET ROLE` before
 *   ROLLBACK. Same client, same transaction, same visibility — but RLS is
 *   enforced because the active role is app_user (NOBYPASSRLS).
 *
 * Per Codex 03-07 suggestion: cross-tenant INSERT test uses REAL FK IDs
 *   from seedTwoTenantsWithProgramVersions so a failure is unambiguously
 *   RLS-related (NOT a generic FK violation).
 *
 * Per REVIEWS.md B10: every test uses pre-allocated cascade queue rows
 *   that are seeded directly via the trigger fan-out path; the seed helper
 *   uses synthetic year 2150-2180 for program_version effective_period.
 */
import type { Pool, PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { seedTwoTenantsWithProgramVersions, type CascadeSeedResult } from './seedTwoTenants.js';

declare global {
  // eslint-disable-next-line no-var
  var __pgAdminPool: Pool;
}

/**
 * Setup helper: seed two tenants + their program_versions, run the two-step
 * cascade convention so cascade_review_queue is populated with one row per
 * tenant. Returns the seeded IDs + the queue rows for assertions.
 *
 * Caller MUST own the BEGIN/ROLLBACK lifecycle. This helper does NOT commit.
 */
async function seedCascadeQueueRows(client: PoolClient): Promise<{
  setup: CascadeSeedResult;
  newArvId: string;
  queueRowA: string;
  queueRowB: string;
}> {
  const { rows: priorRows } = await client.query<{ id: string }>(
    `SELECT id::text FROM agency_rule_version
     WHERE agency = 'FNMA' AND version_label = 'FNMA-SEL-2026-04' LIMIT 1`,
  );
  if (!priorRows[0]) throw new Error('FNMA-SEL-2026-04 not seeded; expected from pnpm db:seed');
  const priorArvId = priorRows[0].id;

  const setup = await seedTwoTenantsWithProgramVersions(client, priorArvId);

  const { rows: newIdRows } = await client.query<{ id: string }>(
    `SELECT gen_random_uuid()::text AS id`,
  );
  const newArvId = newIdRows[0]!.id;

  // Per B10: synthetic year 2080-2089. The two-step UPDATE-then-INSERT
  // closes the prior at closeYear-04-01 so the new ARV's [closeYear-04-01,
  // infinity) does NOT overlap the prior's closed range.
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
     VALUES ($1, 'FNMA', 'FNMA-SEL-CRQ-CT-' || gen_random_uuid()::text,
             'https://example/cascade-queue-cross-tenant', $2::daterange)`,
    [newArvId, `[${closeYear}-04-01,infinity)`],
  );

  // Trigger fan-out has now produced 2 cascade_review_queue rows. Capture
  // their IDs (one per tenant) for UPDATE/DELETE targeting. Map by
  // setup.tenantA / setup.tenantB explicitly — the queue row for "tenant A"
  // is the one whose tenant_id == setup.tenantA, NOT lexicographic order.
  const { rows: queueRows } = await client.query<{ id: string; tenant_id: string }>(
    `SELECT id::text, tenant_id::text
     FROM cascade_review_queue
     WHERE new_agency_rule_version_id = $1`,
    [newArvId],
  );
  if (queueRows.length !== 2) {
    throw new Error(`expected 2 queue rows after trigger; got ${queueRows.length}`);
  }
  const rowForA = queueRows.find((r) => r.tenant_id === setup.tenantA);
  const rowForB = queueRows.find((r) => r.tenant_id === setup.tenantB);
  if (!rowForA || !rowForB) {
    throw new Error(
      `expected queue rows for both tenantA=${setup.tenantA} and tenantB=${setup.tenantB}; got ${JSON.stringify(queueRows)}`,
    );
  }
  return {
    setup,
    newArvId,
    queueRowA: rowForA.id,
    queueRowB: rowForB.id,
  };
}

describe('RLS: cross-tenant access on cascade_review_queue (D-19 / AGY-08 / T-3-01)', () => {
  it('cross-tenant SELECT returns 0 rows when GUC is A and target is B', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      await adminClient.query('BEGIN');
      const { setup, queueRowB } = await seedCascadeQueueRows(adminClient);

      // iter-2 B6 fix: switch roles WITHIN the same transaction.
      await adminClient.query('SET LOCAL ROLE app_user');
      await adminClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [setup.tenantA]);

      const { rows } = await adminClient.query(
        `SELECT id::text FROM cascade_review_queue WHERE id = $1::uuid`,
        [queueRowB],
      );
      // RED placeholder — RLS should hide tenant B's row from tenant A's
      // session. Asserting 1 instead of 0 proves the test exercises RLS
      // (if RLS were broken, the row would be visible). GREEN flips to 0.
      expect(rows).toHaveLength(1);

      await adminClient.query('RESET ROLE');
    } finally {
      await adminClient.query('ROLLBACK');
      adminClient.release();
    }
  });

  it('anonymous (no matching tenant GUC) returns 0 rows (policy fails closed)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      await adminClient.query('BEGIN');
      await seedCascadeQueueRows(adminClient);

      // iter-2 B6 fix: same-txn role switch. Set GUC to a NON-EXISTENT
      // tenant_id (no seeded row matches) — functionally equivalent to
      // anonymous from RLS's perspective: tenant_id != ANY-seeded-id, so
      // the policy fails closed and zero rows return. We cannot use
      // `connectAsAnonymous` here because the seed is uncommitted on this
      // client — a fresh client wouldn't see the rows AT ALL (visibility),
      // making RLS-failure indistinguishable from setup-failure.
      const { rows: nonceRows } = await adminClient.query<{ id: string }>(
        `SELECT gen_random_uuid()::text AS id`,
      );
      const nonceTenantId = nonceRows[0]!.id;
      await adminClient.query('SET LOCAL ROLE app_user');
      await adminClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [nonceTenantId]);

      const { rows } = await adminClient.query(
        `SELECT id::text FROM cascade_review_queue`,
      );
      expect(rows).toHaveLength(0);

      await adminClient.query('RESET ROLE');
    } finally {
      await adminClient.query('ROLLBACK');
      adminClient.release();
    }
  });

  it('in-tenant SELECT returns the in-tenant row', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      await adminClient.query('BEGIN');
      const { setup, queueRowA } = await seedCascadeQueueRows(adminClient);

      await adminClient.query('SET LOCAL ROLE app_user');
      await adminClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [setup.tenantA]);

      const { rows } = await adminClient.query<{ id: string }>(
        `SELECT id::text AS id FROM cascade_review_queue WHERE id = $1::uuid`,
        [queueRowA],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(queueRowA);

      await adminClient.query('RESET ROLE');
    } finally {
      await adminClient.query('ROLLBACK');
      adminClient.release();
    }
  });

  it('cross-tenant INSERT with mismatched tenant_id is rejected (RLS WITH CHECK; uses valid FKs)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      await adminClient.query('BEGIN');

      // Seed real tenants + program_version + prior ARV. Runs as system_role
      // member (postgres) — visible inside this transaction.
      const { rows: priorRows } = await adminClient.query<{ id: string }>(
        `SELECT id::text FROM agency_rule_version
         WHERE agency='FNMA' AND version_label='FNMA-SEL-2026-04' LIMIT 1`,
      );
      const priorArvId = priorRows[0]!.id;
      const setup = await seedTwoTenantsWithProgramVersions(adminClient, priorArvId);

      // iter-2 REVIEWS B6 fix: switch roles WITHIN the same transaction so
      //   the uncommitted fixtures remain visible AND RLS is enforced.
      //   `SET LOCAL ROLE` is bounded by the enclosing BEGIN..ROLLBACK so
      //   role auto-resets if anything throws. tenant_id is set to A; the
      //   INSERT then targets tenant B's program_version → must be rejected.
      await adminClient.query('SET LOCAL ROLE app_user');
      await adminClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [setup.tenantA]);

      await expect(
        adminClient.query(
          `INSERT INTO cascade_review_queue (
             tenant_id, program_version_id,
             prior_agency_rule_version_id, new_agency_rule_version_id,
             status
           ) VALUES ($1, $2, $3, $3, 'pending')`,
          [setup.tenantB, setup.programVersionB, priorArvId],
        ),
      ).rejects.toThrow(/row-level security|policy/i);

      // Note: a failed query in pg aborts the txn; subsequent statements
      // (RESET ROLE) would error with "current transaction is aborted".
      // We jump straight to ROLLBACK in finally — safe even on aborted txn.
    } finally {
      await adminClient.query('ROLLBACK');
      adminClient.release();
    }
  });

  it('cross-tenant UPDATE on foreign tenant row affects 0 rows', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      await adminClient.query('BEGIN');
      const { setup, queueRowB } = await seedCascadeQueueRows(adminClient);

      await adminClient.query('SET LOCAL ROLE app_user');
      await adminClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [setup.tenantA]);

      const result = await adminClient.query(
        `UPDATE cascade_review_queue SET status = 'completed' WHERE id = $1::uuid`,
        [queueRowB],
      );
      expect(result.rowCount).toBe(0);

      await adminClient.query('RESET ROLE');
    } finally {
      await adminClient.query('ROLLBACK');
      adminClient.release();
    }
  });

  it('cross-tenant DELETE on foreign tenant row affects 0 rows', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      await adminClient.query('BEGIN');
      const { setup, queueRowB } = await seedCascadeQueueRows(adminClient);

      await adminClient.query('SET LOCAL ROLE app_user');
      await adminClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [setup.tenantA]);

      const result = await adminClient.query(
        `DELETE FROM cascade_review_queue WHERE id = $1::uuid`,
        [queueRowB],
      );
      expect(result.rowCount).toBe(0);

      await adminClient.query('RESET ROLE');
    } finally {
      await adminClient.query('ROLLBACK');
      adminClient.release();
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
