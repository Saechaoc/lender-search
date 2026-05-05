/**
 * geo_state — state-level eligibility (allow-list and/or deny-list of
 * two-letter US state codes).
 *
 * Shape: `{ allowList: string[2][], denyList: string[2][] }`. AM commit
 * SHOULD enforce the two lists are mutually exclusive (no state appears in
 * both); structural enforcement of mutual exclusivity is NOT in this Zod
 * schema because both arrays default to [] and a brand-new program may
 * have neither populated. AM commit (Phase 8) is the boundary that asserts
 * non-overlap when both are non-empty.
 *
 * Phase 4 evaluator: scenario.subject_state must satisfy:
 *   - if allowList non-empty: state ∈ allowList
 *   - if denyList non-empty: state ∉ denyList
 */
import { z } from 'zod';

/** Two-letter US state code; allow-list and deny-list are mutually exclusive at AM commit time. */
const stateCode = z.string().length(2).regex(/^[A-Z]{2}$/);

export const geoStateSchema = z.object({
  allowList: z.array(stateCode).default([]),
  denyList: z.array(stateCode).default([]),
});
export type GeoState = z.infer<typeof geoStateSchema>;
