/**
 * geo_county — county-level eligibility scaffolding (USDA-shape only at
 * Phase 2 per SCH-12; full USDA encoding is Phase 12 v2 COV-v2-01).
 *
 * Shape: array of entries each with `state` (2-letter code), `fips` (5-digit
 * state+county FIPS), and `allowed: boolean`. The boolean lets a single rule
 * encode either "only these counties allowed" (most entries allowed=true) or
 * "these counties forbidden" (entries allowed=false) without needing two
 * separate columns.
 *
 * Phase 4 evaluator: scenario.subject_county_fips must match an entry where
 *   `allowed=true` AND `state` matches scenario.subject_state.
 */
import { z } from 'zod';

export const geoCountySchema = z.object({
  entries: z.array(z.object({
    state: z.string().length(2).regex(/^[A-Z]{2}$/),
    fips: z.string().regex(/^\d{5}$/),  // 5-digit FIPS code (state+county)
    allowed: z.boolean(),
  })).default([]),
});
export type GeoCounty = z.infer<typeof geoCountySchema>;
