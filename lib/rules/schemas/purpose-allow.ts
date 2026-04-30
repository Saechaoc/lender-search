/**
 * purpose_allow — allow-list of permitted loan purposes.
 *
 * Shape: `{ values: PurposeValue[] }`. The enum mirrors `purposeValue` from
 * derog-seasoning.ts so allow-list comparisons stay symmetric with derog
 * `post_event_LTV_caps[].purposeAllowList`.
 *
 * Phase 4 evaluator: scenario.purpose must be in the rule's `values` array.
 * Phase 8 detect_loosenings: overlay's `values` must be a SUBSET of agency's.
 */
import { z } from 'zod';

export const purposeAllowSchema = z.object({
  values: z.array(z.enum([
    'PURCHASE',
    'RATE_TERM_REFI',
    'CASH_OUT_REFI',
    'CONSTRUCTION',
    'CONSTRUCTION_TO_PERM',
    'HELOC',
    'CES_SECOND_LIEN',
  ])),
});
export type PurposeAllow = z.infer<typeof purposeAllowSchema>;
