/**
 * reserves_min — minimum required cash reserves at closing. Phase 4
 * evaluator compares scenario reserves (already converted to the
 * rule's unit) against this floor; values below are hard fails.
 *
 * Shape: `{ value: number, unit: 'months' | 'dollars' }`. Two units
 * because lenders express reserves either as months-of-PITIA (typical
 * for primary residence) or dollar amounts (often investor / DSCR).
 * Phase 4 evaluator must convert scenario reserves to the unit on
 * the rule before compare.
 */
import { z } from 'zod';

export const reservesMinSchema = z.object({
  value: z.number().nonnegative(),
  unit: z.enum(['months', 'dollars']),
});
export type ReservesMin = z.infer<typeof reservesMinSchema>;
