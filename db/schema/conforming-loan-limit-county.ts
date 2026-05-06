/**
 * conforming_loan_limit_county — per-county loan limits for one FHFA year (AGY-09 / D-20).
 *
 * Composite PK (limit_version_id, county_fips) — first composite PK in repo.
 * county_fips is text(5) preserving leading zeros (Pitfall PG-7).
 * is_high_cost stored at load time per Open Question 7 (load-time threshold = FHFA baseline).
 */
import { boolean, char, numeric, pgPolicy, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { systemRole } from './system-role.js';
import { conformingLoanLimitVersion } from './conforming-loan-limit-version.js';

export const conformingLoanLimitCounty = pgTable(
  'conforming_loan_limit_county',
  {
    limitVersionId: uuid('limit_version_id').notNull().references(() => conformingLoanLimitVersion.id),
    countyFips: text('county_fips').notNull(),
    stateCode: char('state_code', { length: 2 }).notNull(),
    oneUnitBaseline: numeric('one_unit_baseline').notNull(),
    twoUnitBaseline: numeric('two_unit_baseline'),
    threeUnitBaseline: numeric('three_unit_baseline'),
    fourUnitBaseline: numeric('four_unit_baseline'),
    oneUnitHighBalance: numeric('one_unit_high_balance'),
    twoUnitHighBalance: numeric('two_unit_high_balance'),
    threeUnitHighBalance: numeric('three_unit_high_balance'),
    fourUnitHighBalance: numeric('four_unit_high_balance'),
    isHighCost: boolean('is_high_cost').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.limitVersionId, t.countyFips] }),
    pgPolicy('conforming_loan_limit_county_world_read', {
      as: 'permissive',
      for: 'select',
      to: 'public',
      using: sql`true`,
    }),
    pgPolicy('conforming_loan_limit_county_system_write', {
      as: 'permissive',
      for: 'all',
      to: systemRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);

export type ConformingLoanLimitCounty = typeof conformingLoanLimitCounty.$inferSelect;
export type NewConformingLoanLimitCounty = typeof conformingLoanLimitCounty.$inferInsert;
