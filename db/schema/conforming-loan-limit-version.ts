/**
 * conforming_loan_limit_version — system-owned versioned FHFA loan limit set (AGY-09 / D-20).
 *
 * One row per FHFA publication year. EXCLUDE on (year WITH =, effective_period WITH &&)
 * lands in --custom migration 0011_conforming_loan_limit.sql per Pattern from
 * 0004_program_constraints.sql:93-95.
 *
 * Two-policy shape: world_read SELECT + system_role write.
 */
import { index, integer, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { systemRole } from './system-role.js';
import { daterange } from './_types/daterange.js';

export const conformingLoanLimitVersion = pgTable(
  'conforming_loan_limit_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    year: integer('year').notNull(),
    effectivePeriod: daterange('effective_period').notNull(),
    sourceUrl: text('source_url').notNull(),
    sourcePdfSha256: text('source_pdf_sha256'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('conforming_loan_limit_version_year_idx').on(t.year),
    pgPolicy('conforming_loan_limit_version_world_read', {
      as: 'permissive',
      for: 'select',
      to: 'public',
      using: sql`true`,
    }),
    pgPolicy('conforming_loan_limit_version_system_write', {
      as: 'permissive',
      for: 'all',
      to: systemRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);

export type ConformingLoanLimitVersion = typeof conformingLoanLimitVersion.$inferSelect;
export type NewConformingLoanLimitVersion = typeof conformingLoanLimitVersion.$inferInsert;
