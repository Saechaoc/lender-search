/**
 * ltv_max — maximum loan-to-value percentage. Phase 4 evaluator compares
 * scenario.ltv against this; values above the rule's value are hard fails.
 *
 * Single-value shape: `{ value: 0..100 }`. Phase 2 ships the simplest
 * possible shape; richer constructions (e.g., FICO×LTV grids) are encoded
 * as MULTIPLE program_rule rows with different conditions, not as nested
 * structures inside one rule_body.
 */
import { z } from 'zod';

export const ltvMaxSchema = z.object({
  value: z.number().min(0).max(100),
});
export type LtvMax = z.infer<typeof ltvMaxSchema>;
