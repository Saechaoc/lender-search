/**
 * program — parent table for indexed lender programs.
 *
 * One row per (tenant, lender, program_name). The bitemporal body lives in
 * program_version (which references this table by FK). Rationale: a single
 * program can have many versions over time (state transitions, matrix
 * re-uploads, agency-rule cascades); the parent table is the stable
 * identity, the version is the time-bounded record.
 *
 * Schema scope:
 *   - tenant_id (FK to tenant.id; indexed; RLS-policed)
 *   - lender (text NOT NULL): wholesale lender name (e.g., "PennyMac TPO")
 *   - channel (text NOT NULL): "wholesale" | "retail" | "broker" — locked
 *     at the application layer; Phase 8 lifecycle UI sets it
 *   - name (text NOT NULL): the lender's program name (e.g., "Bank Statement
 *     24-mo DSCR")
 *   - created_at, updated_at: standard audit timestamps
 *
 * RLS policy filters on tenant_id (canonical Phase 1 pattern).
 *
 * Phase 4 evaluator does not directly query `program` — it walks
 * program_version → program_rule → rule_citation. This table is the join
 * target for "list all programs visible to this tenant" surfaces (Phase 8
 * AM lifecycle, Phase 11 GTM exit-gate counting).
 */
import { index, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenant } from './tenant.js';

export const program = pgTable(
  'program',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    lender: text('lender').notNull(),
    channel: text('channel').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('program_tenant_idx').on(t.tenantId),
    pgPolicy('program_tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: 'public',
      using: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
      withCheck: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
    }),
  ],
);

export type Program = typeof program.$inferSelect;
export type NewProgram = typeof program.$inferInsert;
