/**
 * _rls_canary — permanent regression smoke table (CONTEXT §D-04).
 *
 * The leading underscore is a visual signal in `\dt` output that this is a
 * test fixture, not a domain object. The table is referenced by the pen-test
 * suite (Plans 06-07) and stays in the schema forever — every later phase's
 * pen tests reuse it as the canonical "is RLS still on?" smoke target.
 *
 * Schema scope:
 *   - tenant_id (uuid, NOT NULL, FK → tenant.id) so cross-tenant attempts
 *     can target a real foreign-tenant row
 *   - tenant_id is indexed (TNT-03 + CONTEXT §D-06); Plan 07 index-scan.test
 *     asserts EXPLAIN uses the index
 *   - payload (text, optional) so seeding can identify which tenant's row
 *     we're looking at without needing additional columns
 *
 * RLS policy: filters on tenant_id (NOT id like tenant.ts) because tenant_id
 * is the foreign key — every row belongs to exactly one tenant by design.
 * Both USING and WITH CHECK reference the GUC (Pitfall 6).
 */
import { index, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenant } from './tenant.js';

export const rlsCanary = pgTable(
  '_rls_canary',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    payload: text('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // TNT-03: tenant_id indexed. Plan 07 index-scan.test asserts EXPLAIN
    // uses Index Scan (with `SET LOCAL enable_seqscan = off` for tiny test data).
    index('rls_canary_tenant_idx').on(t.tenantId),

    // RLS policy filters on tenant_id (the FK column).
    pgPolicy('canary_tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: 'public',
      using: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
      withCheck: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
    }),
  ],
);

export type RlsCanary = typeof rlsCanary.$inferSelect;
export type NewRlsCanary = typeof rlsCanary.$inferInsert;
