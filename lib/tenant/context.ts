/**
 * setTenantContext — the canonical RLS GUC primitive (TNT-02).
 *
 * Calls Postgres `set_config('app.tenant_id', $tenantId, true)` so RLS policies
 * filter on `current_setting('app.tenant_id', true)::uuid`. The third argument
 * `true` (is_local) scopes the GUC to the current transaction — it dies on
 * COMMIT or ROLLBACK. This is non-negotiable: `is_local=false` would persist
 * the GUC across pooled-connection reuse and cause cross-tenant leaks
 * (RESEARCH §Pitfall 3).
 *
 * Single source of truth for the GUC name 'app.tenant_id'. The literal string
 * appears in exactly three places in the codebase:
 *   1. This file (the primitive).
 *   2. db/schema/*.ts pgPolicy() declarations (Plan 04).
 *   3. tests/rls/* pen tests (Plans 06-07; tests use `pg` directly per Pitfall 5).
 * Any other reference to that literal is a smell.
 *
 * Phase 1 / Phase 6 contract:
 *   - Phase 1 (this file): primitive only. Pen tests call set_config directly
 *     via `pg` to exercise the SQL contract; they do NOT import this helper.
 *   - Phase 6: a `withTenantContext({ tenantId, fn })` middleware wraps every
 *     server action / route handler, opens a Drizzle transaction, calls
 *     setTenantContext, then runs the user code.
 *
 * Bootstrap pattern for tenant creation (RESEARCH §Pitfall 7):
 *   The self-filtering policy on the `tenant` table requires the row's id to
 *   match the GUC. New-tenant creation must (a) generate the UUID client-side,
 *   (b) call setTenantContext with the new UUID, (c) INSERT the row with that
 *   same UUID. The WITH CHECK clause then passes because id == GUC. Plan 06
 *   `seedTwoTenants` implements this pattern directly via `pg`.
 *
 * Reference:
 *   - postgresql.org/docs/16/runtime-config-custom.html (placeholder GUCs)
 *   - postgresql.org/docs/16/config-setting.html (set_config semantics)
 */
import { sql } from 'drizzle-orm';
import type { PgDatabase, PgTransaction } from 'drizzle-orm/pg-core';

/**
 * Set the per-transaction tenant context for RLS.
 *
 * MUST be called inside a transaction. Calling on a top-level connection is
 * a Postgres warning (no error) but the GUC will not be transaction-scoped.
 *
 * @param tx Drizzle transaction or DB handle (typed for forward-compat with Phase 6)
 * @param tenantId UUID string identifying the tenant; passed as a parameter
 *                 (never interpolated) so SQL injection is structurally impossible.
 */
// The `any` triplets in the union below are deliberate: Drizzle 0.45's
// PgDatabase<TQueryResult, TFullSchema, TSchema> and PgTransaction generics
// each take three type parameters, and the helper is intentionally generic
// over all three so Phase 6's `withTenantContext` middleware can pass a
// typed Drizzle handle without rewriting the signature. typescript-eslint's
// `no-explicit-any` is correct in general but wrong for forward-compat seam
// types like this — see Plan 03 SUMMARY §Decisions Made.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function setTenantContext(
  tx: PgTransaction<any, any, any> | PgDatabase<any, any, any>,
  tenantId: string,
): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * The canonical GUC name. Exported for documentation purposes ONLY — code
 * that needs to reference the GUC name should call setTenantContext or
 * read the constant from this module, never hard-code the string.
 */
export const TENANT_GUC_NAME = 'app.tenant_id';
