/**
 * occupancy_allow — allow-list of permitted occupancy types.
 *
 * Shape: `{ values: ('PRIMARY'|'SECOND_HOME'|'INVESTMENT')[] }`. The enum
 * values mirror `occupancyValue` from derog-seasoning.ts so allow-list
 * comparisons stay symmetric with derog `post_event_LTV_caps[].occupancyAllowList`.
 *
 * Phase 4 evaluator: scenario.occupancy must be in the rule's `values` array.
 * Phase 8 detect_loosenings: overlay's `values` must be a SUBSET of agency's.
 */
import { z } from 'zod';

export const occupancyAllowSchema = z.object({
  values: z.array(z.enum(['PRIMARY', 'SECOND_HOME', 'INVESTMENT'])),
});
export type OccupancyAllow = z.infer<typeof occupancyAllowSchema>;
