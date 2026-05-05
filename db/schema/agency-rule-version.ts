/**
 * agency_rule_version — system-owned versioned agency rule snapshot.
 *
 * Per CONTEXT D-05: this table is NOT tenant-scoped. It carries no
 * tenant_id column. Cross-tenant readability is achieved via two policies:
 *   - agency_rule_version_world_read: SELECT to 'public' (every authenticated
 *     tenant reads agency rules; the inheritance path for AGENCY_BASE)
 *   - agency_rule_version_system_write: ALL to system_role (only the
 *     migration role / Phase 3 hand-authoring path can INSERT/UPDATE/DELETE)
 *
 * Per CONTEXT D-16: columns are id, agency (text NOT NULL — CHECK in Plan
 * 02-06 constrains to 'FNMA' | 'FHLMC' | 'FHA' | 'VA' | 'USDA'), version_label,
 * source_url NULL, source_pdf_sha256 NULL, effective_period daterange NOT NULL,
 * recorded_at timestamptz NOT NULL DEFAULT now(), superseded_by uuid NULL
 * self-FK.
 *
 * EXCLUDE USING gist (agency WITH =, effective_period WITH &&) lands in
 * Plan 02-06 --custom migration (Pitfall I).
 *
 * Per Phase 3 / Plan 03-01 Task 08 Delta 1 (REVIEWS.md B5): the superseded_by
 * self-FK is `DEFERRABLE INITIALLY DEFERRED` (set in --custom migration 0013).
 * This enables the cascade two-step convention to UPDATE prior.superseded_by =
 * new_id BEFORE INSERT new_id; the FK constraint defers until COMMIT.
 * Drizzle 0.45 cannot model the DEFERRABLE clause; the migration is the
 * source of truth for this property.
 *
 * Per Phase 3 / Plan 03-01 Task 08 Delta 2 (REVIEWS.md B8a): three new columns
 * land via --custom migration 0013:
 *   - state agency_rule_state NOT NULL DEFAULT 'ACTIVE'
 *   - sunset_date date NULL
 *   - deprecation_reason text NULL
 * Phase 3 SC#4 wants DEPRECATED as a first-class queryable state instead of
 * inferring from version_label parsing.
 *
 * The superseded_by self-FK is the integration seam for Phase 3 AGY-08
 * cascade trigger.
 */
import { type AnyPgColumn, date, index, pgEnum, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { systemRole } from './system-role.js';
import { daterange } from './_types/daterange.js';

// Phase 3 Task 08 Delta 2: agency_rule_state enum (REVIEWS.md B8a).
export const agencyRuleStateEnum = pgEnum('agency_rule_state', ['ACTIVE', 'DEPRECATED', 'RETIRED']);

export const agencyRuleVersion = pgTable(
  'agency_rule_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agency: text('agency').notNull(),
    versionLabel: text('version_label').notNull(),
    sourceUrl: text('source_url'),
    sourcePdfSha256: text('source_pdf_sha256'),
    effectivePeriod: daterange('effective_period').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
    supersededBy: uuid('superseded_by').references((): AnyPgColumn => agencyRuleVersion.id),
    // Phase 3 Task 08 Delta 2 (REVIEWS.md B8a): first-class state + sunset
    // metadata. The columns themselves are added by --custom migration 0013.
    state: agencyRuleStateEnum('state').notNull().default('ACTIVE'),
    sunsetDate: date('sunset_date'),
    deprecationReason: text('deprecation_reason'),
  },
  (t) => [
    index('agency_rule_version_agency_idx').on(t.agency),

    pgPolicy('agency_rule_version_world_read', {
      as: 'permissive',
      for: 'select',
      to: 'public',
      using: sql`true`,
    }),

    pgPolicy('agency_rule_version_system_write', {
      as: 'permissive',
      for: 'all',
      to: systemRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);

export type AgencyRuleVersion = typeof agencyRuleVersion.$inferSelect;
export type NewAgencyRuleVersion = typeof agencyRuleVersion.$inferInsert;
