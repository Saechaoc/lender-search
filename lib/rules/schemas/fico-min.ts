/**
 * fico_min — minimum FICO score floor. Phase 4 evaluator compares
 * scenario.fico against this; values below are hard fails.
 *
 * Single-value shape: `{ value: int(300..850) }`. FICO scoring range is
 * 300-850 (true range; very-low scores below ~500 are rare in practice
 * but the floor is structurally enforced). Integer per scoring convention.
 */
import { z } from 'zod';

export const ficoMinSchema = z.object({
  value: z.number().int().min(300).max(850),
});
export type FicoMin = z.infer<typeof ficoMinSchema>;
