/**
 * property_type_allow — allow-list of permitted property types.
 *
 * Shape: `{ values: PropertyTypeValue[] }`. Values cover the standard
 * underwriter taxonomy: SFR (single-family residence), 2-4 unit, condo
 * (warrantable vs non-warrantable per FNMA project review), co-op (NY-heavy),
 * PUD (planned unit development), manufactured.
 *
 * Phase 4 evaluator: scenario.property_type must be in the rule's `values`.
 * Phase 8 detect_loosenings: overlay's `values` must be a SUBSET of agency's.
 */
import { z } from 'zod';

export const propertyTypeAllowSchema = z.object({
  // Default to [] for consistency with sibling schemas (see occupancy-allow.ts
  // header for the full rationale). Missing `values` parses to an empty
  // allow-list rather than throwing.
  values: z.array(z.enum([
    'SFR',
    'TWO_TO_FOUR_UNIT',
    'CONDO_WARRANTABLE',
    'CONDO_NON_WARRANTABLE',
    'CO_OP',
    'PUD',
    'MANUFACTURED',
  ])).default([]),
});
export type PropertyTypeAllow = z.infer<typeof propertyTypeAllowSchema>;
