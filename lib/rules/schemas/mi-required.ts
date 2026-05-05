/**
 * mi_required — mortgage insurance required + permissible providers.
 *
 * Shape: `{ required: boolean, providers: string[] }`. When `required=true`,
 * `providers` enumerates which MI carriers are eligible (e.g., MGIC, Radian,
 * Genworth, National MI, Essent, Arch). Empty `providers` array is allowed
 * (means "any agency-approved MI"). Phase 13 PRC-05 may extend with per-MI
 * pricing; Phase 2 ships the structural shape only.
 */
import { z } from 'zod';

export const miRequiredSchema = z.object({
  required: z.boolean(),
  providers: z.array(z.string()).default([]),
});
export type MiRequired = z.infer<typeof miRequiredSchema>;
