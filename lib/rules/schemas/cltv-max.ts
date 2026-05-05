/**
 * cltv_max — maximum combined loan-to-value percentage (first + subordinate
 * liens / total appraised value). CLTV ceiling is typically higher than LTV
 * because the combined denominator includes second mortgages or HELOCs.
 *
 * Single-value shape: `{ value: 0..120 }`. CLTV can exceed 100 in scenarios
 * with negative-equity refis (rare; FNMA HARP-era) or piggyback structures.
 */
import { z } from 'zod';

export const cltvMaxSchema = z.object({
  value: z.number().min(0).max(120),
});
export type CltvMax = z.infer<typeof cltvMaxSchema>;
