/**
 * manual_uw_path — manual underwriting path allowed + compensating factors.
 *
 * Shape: `{ allowed: boolean, compensatingFactors: string[] }`. When
 * `allowed=true`, `compensatingFactors` is a free-text list of acceptable
 * mitigations (e.g., "12 months reserves", "reduced LTV", "documented
 * extenuating circumstance"). Phase 4 evaluator may surface these as a
 * "near-miss path" when a scenario fails AUS but the manual UW gate is
 * open. Free-text on purpose — agency / overlay text varies too much to
 * pre-enumerate at Phase 2.
 */
import { z } from 'zod';

export const manualUwPathSchema = z.object({
  allowed: z.boolean(),
  compensatingFactors: z.array(z.string()).default([]),
});
export type ManualUwPath = z.infer<typeof manualUwPathSchema>;
