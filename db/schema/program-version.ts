/**
 * program_version — bitemporal versioned program record (SCH-09).
 *
 * Per CONTEXT D-15: each program has many versions; only one can have
 * state='active' for a given effective_period (the EXCLUDE constraint in
 * Plan 02-06 enforces this). Older versions persist with state='deprecated'
 * or 'sunset' for historical replay (Phase 4 RuleSnapshot via
 * effective_period @> CURRENT_DATE).
 *
 * Bitemporal model:
 *   - effective_period daterange [valid_time): the period during which this
 *     version was the canonical truth from the LENDER's perspective
 *   - recorded_at timestamptz: when the system recorded this version
 *     (system time; immutable)
 *   - state: program lifecycle (draft → in_review → active → deprecated →
 *     sunset; CHECK constraint in Plan 02-06)
 *
 * Source attribution (SCH-09):
 *   - source_document_fingerprint text NOT NULL: sha256 of source matrix
 *     PDF for extracted programs; canonical hash of hand-authored payload
 *     for Phase 3 seed rows
 *
 * Agency cascade (SCH-09 → Phase 3 AGY-08):
 *   - agency_rule_version_id NOT NULL FK to agency_rule_version(id):
 *     every program inherits from a specific dated agency snapshot. Phase 3
 *     trigger on agency_rule_version INSERT uses superseded_by + this FK to
 *     enqueue per-affected-program review jobs.
 *
 * SCH-11 — eligibility allow/deny lists (text[] arrays, NULL means no
 * positive constraint).
 *
 * SCH-12 — state + county overlay scaffolding (USDA-shape only; Phase 12 v2
 * fully populates).
 *
 * RLS policy filters on tenant_id (Phase 1 canonical pattern). EXCLUDE
 * constraint on (program_id WITH =, effective_period WITH &&) WHERE
 * state='active' lands in Plan 02-06 --custom migration.
 */
import { index, jsonb, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenant } from './tenant.js';
import { program } from './program.js';
import { agencyRuleVersion } from './agency-rule-version.js';
import { daterange } from './_types/daterange.js';

export const programVersion = pgTable(
  'program_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    programId: uuid('program_id')
      .notNull()
      .references(() => program.id),
    agencyRuleVersionId: uuid('agency_rule_version_id')
      .notNull()
      .references(() => agencyRuleVersion.id),
    effectivePeriod: daterange('effective_period').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
    state: text('state').notNull(),
    sourceDocumentFingerprint: text('source_document_fingerprint').notNull(),

    eligibleLoanPurposes: text('eligible_loan_purposes').array(),
    ineligibleLoanPurposes: text('ineligible_loan_purposes').array(),
    eligiblePropertyTypes: text('eligible_property_types').array(),
    ineligiblePropertyTypes: text('ineligible_property_types').array(),
    eligibleOccupancies: text('eligible_occupancies').array(),
    ineligibleOccupancies: text('ineligible_occupancies').array(),
    eligibleDocTypes: text('eligible_doc_types').array(),
    ineligibleDocTypes: text('ineligible_doc_types').array(),

    eligibleStates: text('eligible_states').array(),
    ineligibleStates: text('ineligible_states').array(),
    geoCountyOverlay: jsonb('geo_county_overlay'),
  },
  (t) => [
    index('program_version_tenant_idx').on(t.tenantId),
    index('program_version_agency_rule_version_idx').on(t.agencyRuleVersionId),
    pgPolicy('program_version_tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: 'public',
      using: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
      withCheck: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
    }),
  ],
);

export type ProgramVersion = typeof programVersion.$inferSelect;
export type NewProgramVersion = typeof programVersion.$inferInsert;
