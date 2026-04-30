/**
 * lender_overlay_rule — tenant-scoped lender-overlay rule rows.
 *
 * Per CONTEXT D-05: tenant-scoped (RLS-policed); LENDER_OVERLAY layer is
 * implicit on this table (no `layer` column). Phase 4 evaluator UNIONs
 * agency_rule (AGENCY_BASE) + program_rule (INVESTOR_OVERLAY +
 * PRODUCT_FEATURE) + this table (LENDER_OVERLAY) to assemble the
 * rule_stack per dimension.
 *
 * Per CONTEXT D-07: this table ships at Phase 2 EVEN THOUGH no UI
 * populates it. Adding the table later (after Phase 4 evaluator hardens
 * against the rule shape) would force a schema migration with cascading
 * impact (Pitfall 4.1: schema instability cascades).
 *
 * Phase 12 v2 LOV-01..03 brings the brokerage-author three-pane review UI.
 *
 * Per CONTEXT D-05: applies_to_program_id uuid NULL FK to program(id).
 * NULL means "applies to all programs at this brokerage tenant".
 *
 * Per CONTEXT D-01 / SCH-13: primary_citation_id uuid NOT NULL FK to
 * rule_citation(id). Same structural guarantee.
 *
 * RLS policy: tenant isolation. Cross-tenant overlay visibility is a
 * release-blocker (PROJECT.md §Out of Scope; Pitfall 3.5).
 */
import { index, jsonb, pgPolicy, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenant } from './tenant.js';
import { program } from './program.js';
import { ruleCitation } from './rule-citation.js';
import { ruleKind } from './program-rule.js';

export const lenderOverlayRule = pgTable(
  'lender_overlay_rule',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    appliesToProgramId: uuid('applies_to_program_id').references(() => program.id),
    ruleKind: ruleKind('rule_kind').notNull(),
    ruleBody: jsonb('rule_body').notNull(),
    fieldConfidence: jsonb('field_confidence').notNull().default(sql`'{}'::jsonb`),
    primaryCitationId: uuid('primary_citation_id')
      .notNull()
      .references(() => ruleCitation.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('lender_overlay_rule_tenant_idx').on(t.tenantId),

    pgPolicy('lender_overlay_rule_tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: 'public',
      using: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
      withCheck: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
    }),
  ],
);

export type LenderOverlayRule = typeof lenderOverlayRule.$inferSelect;
export type NewLenderOverlayRule = typeof lenderOverlayRule.$inferInsert;
