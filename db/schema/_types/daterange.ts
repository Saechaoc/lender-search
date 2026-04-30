/**
 * daterange — Postgres built-in range type for [start, end) date ranges.
 *
 * Drizzle 0.45 has no native daterange (issue #2647). This customType wraps
 * the type using string literal representation `[2026-01-01,2027-01-01)` —
 * the canonical Postgres input/output format for daterange.
 *
 * Half-open `[start, end)` is the convention: start inclusive, end exclusive
 * (Pitfall A). Phase 2 SC#3 "two overlapping active versions cannot coexist"
 * leans on the half-open shape — adjacent ranges `[a, b) [b, c)` do NOT
 * overlap, so back-to-back versions don't trip the EXCLUDE constraint.
 *
 * Query "active at date X": `WHERE effective_period @> 'X'::date` uses the
 * containment operator. Postgres converts the date to a daterange singleton.
 *
 * Consumers:
 *   - db/schema/program-version.ts (Plan 02-02): effective_period column
 *   - db/schema/agency-rule-version.ts (Plan 02-03): effective_period column
 *
 * Reference: orm.drizzle.team/docs/custom-types
 */
import { customType } from 'drizzle-orm/pg-core';

export const daterange = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'daterange';
  },
  // Postgres returns daterange as the literal string `[start,end)` — pass through.
  fromDriver(value: string): string {
    return value;
  },
  toDriver(value: string): string {
    return value;
  },
});
