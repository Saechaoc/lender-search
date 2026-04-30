/**
 * tenant table + tenant_kind enum + self-filtering RLS policy.
 *
 * Schema scope per CONTEXT §D-04: the canonical kind enum (locked from
 * PROJECT.md / REQUIREMENTS §SCH-08) and the GUC-gated self-filtering
 * policy per §D-05.
 *
 * Bootstrap pattern (RESEARCH §Pitfall 7): the policy `using id = GUC`
 * means tenant creation requires generating the UUID client-side and
 * setting the GUC to that UUID BEFORE the INSERT. The WITH CHECK clause
 * passes because the new row's id matches the GUC. Plan 06 seedTwoTenants
 * implements this directly via `pg`.
 *
 * FORCE ROW LEVEL SECURITY is NOT declared here (Drizzle 0.45 schema API
 * does not model FORCE). Plan 05 appends it via a `--custom` migration.
 *
 * The `app.tenant_id` GUC literal in the policy expression is canonical;
 * the only other references are lib/tenant/context.ts (the helper) and
 * tests/rls/* (pen tests via `pg`).
 */
import { pgEnum, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * tenant_kind — locked enum per REQUIREMENTS §SCH-08.
 * Order matters for migration stability: keep BROKERAGE first.
 */
export const tenantKind = pgEnum('tenant_kind', [
  'BROKERAGE',
  'RETAIL_LENDER',
  'WHOLESALE_LENDER',
  'SYSTEM',
]);

export const tenant = pgTable(
  'tenant',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: tenantKind('kind').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Self-filtering policy per CONTEXT §D-05.
    // current_setting(..., true) (missing-ok variant) returns NULL when GUC
    // unset; comparison fails; no rows visible. RESEARCH §Pattern 1 + §Pitfall 7.
    pgPolicy('tenant_self_filter', {
      as: 'permissive',
      for: 'all',
      to: 'public',
      using: sql`${t.id} = current_setting('app.tenant_id', true)::uuid`,
      withCheck: sql`${t.id} = current_setting('app.tenant_id', true)::uuid`,
    }),
  ],
);

export type Tenant = typeof tenant.$inferSelect;
export type NewTenant = typeof tenant.$inferInsert;
