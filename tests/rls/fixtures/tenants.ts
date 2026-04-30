/**
 * seedTwoTenants — creates two tenants and one canary row each.
 *
 * Implements the bootstrap pattern (RESEARCH §Pitfall 7) because the
 * tenant table's self-filtering policy `using id = current_setting(...)`
 * means a new tenant can only be inserted when the GUC matches the new
 * tenant's id. Pattern:
 *
 *   1. Generate the new tenant's UUID server-side (gen_random_uuid).
 *   2. set_config('app.tenant_id', new_uuid, true).
 *   3. INSERT INTO tenant (id, ...) VALUES (new_uuid, ...).
 *      WITH CHECK passes because id == GUC.
 *   4. INSERT INTO _rls_canary (tenant_id, ...) VALUES (new_uuid, ...).
 *      WITH CHECK passes because tenant_id == GUC.
 *
 * Each tenant is seeded in its OWN transaction so the GUC resets between
 * them — the second tenant cannot see the first via leftover GUC state.
 *
 * This pattern is itself a design proof point: even seed code respects
 * RLS. Phase 6 will replace this with a BYPASSRLS service role for
 * tenant provisioning, but Phase 1 demonstrates the contract works
 * even from a NOBYPASSRLS connection.
 */
import type { Pool } from 'pg';

export interface SeedResult {
  tenantA: string;
  tenantB: string;
  canaryA: string;
  canaryB: string;
}

export async function seedTwoTenants(pool: Pool): Promise<SeedResult> {
  const client = await pool.connect();
  try {
    // --- Tenant A ---
    await client.query('BEGIN');
    // 1. Generate UUID server-side (using Postgres's gen_random_uuid for
    //    consistency with the table default). Returning text to avoid
    //    JS uuid parsing pitfalls.
    const idAResult = await client.query<{ id: string }>(
      `SELECT gen_random_uuid()::text AS id`,
    );
    const idA = idAResult.rows[0]!.id;
    // 2. Set GUC to the new tenant's id BEFORE the INSERT, so the
    //    self-filtering WITH CHECK clause passes.
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [idA]);
    // 3. INSERT the tenant row with id matching the GUC.
    await client.query(
      `INSERT INTO tenant (id, kind, name) VALUES ($1, 'BROKERAGE', 'Tenant A')`,
      [idA],
    );
    // 4. INSERT the canary row; tenant_id matches the GUC.
    const canaryAResult = await client.query<{ id: string }>(
      `INSERT INTO _rls_canary (tenant_id, payload) VALUES ($1, 'A-payload') RETURNING id::text`,
      [idA],
    );
    const canaryA = canaryAResult.rows[0]!.id;
    await client.query('COMMIT');

    // --- Tenant B (separate transaction so the GUC resets) ---
    await client.query('BEGIN');
    const idBResult = await client.query<{ id: string }>(
      `SELECT gen_random_uuid()::text AS id`,
    );
    const idB = idBResult.rows[0]!.id;
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [idB]);
    await client.query(
      `INSERT INTO tenant (id, kind, name) VALUES ($1, 'BROKERAGE', 'Tenant B')`,
      [idB],
    );
    const canaryBResult = await client.query<{ id: string }>(
      `INSERT INTO _rls_canary (tenant_id, payload) VALUES ($1, 'B-payload') RETURNING id::text`,
      [idB],
    );
    const canaryB = canaryBResult.rows[0]!.id;
    await client.query('COMMIT');

    return {
      tenantA: idA,
      tenantB: idB,
      canaryA,
      canaryB,
    };
  } catch (err) {
    // Best-effort rollback if a query failed mid-transaction.
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore — transaction may already be rolled back */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cleanup helper — delete both seeded tenants. Used between describe blocks
 * if a test wants a fresh seed without running globalSetup again.
 *
 * Connects as the migration role (postgres) because deleting from the
 * `tenant` table from app_user requires the GUC to match each row's id,
 * which is impractical for batched cleanup. globalSetup's TRUNCATE handles
 * the suite-level cleanup; this helper is for narrower cases.
 */
export async function deleteAllTenants(adminPool: Pool): Promise<void> {
  const client = await adminPool.connect();
  try {
    await client.query('TRUNCATE TABLE _rls_canary, tenant CASCADE');
  } finally {
    client.release();
  }
}
