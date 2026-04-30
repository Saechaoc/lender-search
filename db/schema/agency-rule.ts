/**
 * agency_rule — system-owned agency-baseline rule rows (SCH-04 + SCH-13).
 *
 * Per CONTEXT D-05: NOT tenant-scoped. AGENCY_BASE layer is implicit on
 * this table (no `layer` column). Cross-tenant readability via the
 * agency_rule_world_read policy; only system_role writes.
 *
 * Per CONTEXT D-09 + Claude's Discretion: structured DerogRule rows
 * (SCH-04 / SCH-05 / SC#2) live HERE with `rule_kind='derog_seasoning'`
 * and a structured `rule_body` per the derogSeasoningSchema Zod schema.
 * The SC#2 acceptance query is supported by the partial expression index
 * in Plan 02-06.
 *
 * Per CONTEXT D-01 / SCH-13: primary_citation_id uuid NOT NULL FK to
 * rule_citation(id). Same structural guarantee as program_rule. Even
 * agency rules carry the citation discipline.
 *
 * Per CONTEXT D-10: field_confidence jsonb NOT NULL DEFAULT '{}'.
 *
 * The ruleKind pgEnum is REUSED from db/schema/program-rule.ts.
 */
import { index, jsonb, pgPolicy, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { systemRole } from './system-role.js';
import { agencyRuleVersion } from './agency-rule-version.js';
import { ruleCitation } from './rule-citation.js';
import { ruleKind } from './program-rule.js';

export const agencyRule = pgTable(
  'agency_rule',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agencyRuleVersionId: uuid('agency_rule_version_id')
      .notNull()
      .references(() => agencyRuleVersion.id),
    ruleKind: ruleKind('rule_kind').notNull(),
    ruleBody: jsonb('rule_body').notNull(),
    fieldConfidence: jsonb('field_confidence').notNull().default(sql`'{}'::jsonb`),
    primaryCitationId: uuid('primary_citation_id')
      .notNull()
      .references(() => ruleCitation.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('agency_rule_version_kind_idx').on(t.agencyRuleVersionId, t.ruleKind),

    pgPolicy('agency_rule_world_read', {
      as: 'permissive',
      for: 'select',
      to: 'public',
      using: sql`true`,
    }),

    pgPolicy('agency_rule_system_write', {
      as: 'permissive',
      for: 'all',
      to: systemRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);

export type AgencyRule = typeof agencyRule.$inferSelect;
export type NewAgencyRule = typeof agencyRule.$inferInsert;
