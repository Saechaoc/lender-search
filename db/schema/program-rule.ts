/**
 * program_rule — tenant-scoped rule rows; SCH-01 + SCH-13 keystone table.
 *
 * One row per (program_version, layer, rule_kind) combination. Phase 4
 * evaluator UNIONs across `agency_rule` (AGENCY_BASE), this table
 * (INVESTOR_OVERLAY + PRODUCT_FEATURE), and `lender_overlay_rule`
 * (LENDER_OVERLAY) to assemble the rule_stack per dimension.
 *
 * Per CONTEXT D-05: layer enum is constrained to `INVESTOR_OVERLAY` |
 * `PRODUCT_FEATURE` only — AGENCY_BASE NEVER appears here (programs
 * reference agency by FK on program_version.agency_rule_version_id;
 * embedding agency rules per program is Anti-Pattern 1).
 *
 * Per CONTEXT D-09: rule_kind enum has 17 values matching
 * lib/rules/schemas/index.ts ruleKinds verbatim.
 *
 * Per CONTEXT D-01 / SCH-13: primary_citation_id uuid NOT NULL FK to
 * rule_citation(id). Citation discipline as schema constraint (Pitfall 2.8).
 *
 * Per CONTEXT D-10: field_confidence jsonb NOT NULL DEFAULT '{}'::jsonb;
 * the min_confidence numeric GENERATED STORED column lands in Plan 02-06's
 * --custom migration via the immutable wrapper jsonb_min_numeric (Pitfall C).
 *
 * SCH-14: extraction_run_id uuid NULL plain column at Phase 2; Phase 7 adds
 * FK to staging.extraction_run(id) via --custom migration.
 *
 * Indexes:
 *   - tenant_id index (TNT-03 / RLS hot path)
 *   - composite (program_version_id, layer, rule_kind) for Phase 4
 *     evaluator's rule_stack assembly (CONTEXT Claude's Discretion)
 */
import { index, jsonb, pgEnum, pgPolicy, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenant } from './tenant.js';
import { programVersion } from './program-version.js';
import { ruleCitation } from './rule-citation.js';

export const programRuleLayer = pgEnum('program_rule_layer', [
  'INVESTOR_OVERLAY',
  'PRODUCT_FEATURE',
]);

export const ruleKind = pgEnum('rule_kind', [
  'ltv_max',
  'cltv_max',
  'hcltv_max',
  'fico_min',
  'dti_max',
  'reserves_min',
  'derog_seasoning',
  'income_doc_method',
  'dscr_method',
  'geo_state',
  'geo_county',
  'occupancy_allow',
  'purpose_allow',
  'property_type_allow',
  'doc_type_allow',
  'mi_required',
  'manual_uw_path',
]);

export const programRule = pgTable(
  'program_rule',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    programVersionId: uuid('program_version_id')
      .notNull()
      .references(() => programVersion.id),
    layer: programRuleLayer('layer').notNull(),
    ruleKind: ruleKind('rule_kind').notNull(),
    ruleBody: jsonb('rule_body').notNull(),
    fieldConfidence: jsonb('field_confidence').notNull().default(sql`'{}'::jsonb`),
    primaryCitationId: uuid('primary_citation_id')
      .notNull()
      .references(() => ruleCitation.id),
    extractionRunId: uuid('extraction_run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('program_rule_tenant_idx').on(t.tenantId),
    index('program_rule_version_layer_kind_idx').on(t.programVersionId, t.layer, t.ruleKind),
    pgPolicy('program_rule_tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: 'public',
      using: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
      withCheck: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
    }),
  ],
);

export type ProgramRule = typeof programRule.$inferSelect;
export type NewProgramRule = typeof programRule.$inferInsert;
