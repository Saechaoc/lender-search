/**
 * dti_max — maximum debt-to-income ratio (percentage). Phase 4 evaluator
 * compares scenario.dti against this; values above the rule's value are
 * hard fails.
 *
 * Single-value shape: `{ value: 0..100 }`. DTI is conventionally expressed
 * as a percentage; >100 is technically possible (debts exceed income) but
 * agency products cap at the 50% range, so 100 is a generous structural
 * upper bound.
 */
import { z } from 'zod';

export const dtiMaxSchema = z.object({
  value: z.number().min(0).max(100),
});
export type DtiMax = z.infer<typeof dtiMaxSchema>;
