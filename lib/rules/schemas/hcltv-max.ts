/**
 * hcltv_max — maximum HELOC combined loan-to-value percentage. HCLTV
 * adds the FULL HELOC line (drawn + undrawn) to the numerator, so it is
 * always >= CLTV when a HELOC is present.
 *
 * Single-value shape: `{ value: 0..120 }`. Same upper bound as CLTV for
 * consistency; agency guidelines pin the practical max well below 100
 * for most products.
 */
import { z } from 'zod';

export const hcltvMaxSchema = z.object({
  value: z.number().min(0).max(120),
});
export type HcltvMax = z.infer<typeof hcltvMaxSchema>;
