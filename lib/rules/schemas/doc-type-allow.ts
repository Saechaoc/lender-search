/**
 * doc_type_allow — allow-list of permitted documentation types.
 *
 * Shape: `{ values: DocTypeValue[] }`. The enum mirrors the `method` enum on
 * IncomeDocMethod (Pitfall 1.8) so a program that allows multiple
 * documentation types lists them once here. The structured shape per
 * IncomeDocMethod still applies when a specific doc type is in use.
 *
 * Phase 4 evaluator: scenario.doc_type must be in the rule's `values`.
 * Phase 8 detect_loosenings: overlay's `values` must be a SUBSET of agency's.
 */
import { z } from 'zod';

export const docTypeAllowSchema = z.object({
  values: z.array(z.enum([
    'FULL_DOC',
    'BANK_STATEMENT_12MO',
    'BANK_STATEMENT_24MO',
    'P_AND_L_ONLY',
    'WVOE',
    'ASSET_DEPLETION',
    'NO_DOC',
    '1099_ONLY',
  ])),
});
export type DocTypeAllow = z.infer<typeof docTypeAllowSchema>;
