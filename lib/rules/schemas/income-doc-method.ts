/**
 * IncomeDocMethod — typed income documentation method per program.
 * Per Pitfall 1.8.
 *
 * A flat `documentation_type: text` label loses the substantive variation
 * across non-QM bank-statement programs: 12 vs 24 month statement periods,
 * personal vs business account treatment, expense factor source (CPA letter,
 * P&L reconciliation, fixed percentage, borrower attestation), comingled-
 * account treatment, NSF treatment, qualifying-period seasoning. The Zod
 * shape captures all of these so Phase 4 evaluator can compare scenario
 * documentation against rule expectations without fuzzy string matching.
 *
 * D-11: Persisted in rule_body when rule_kind='income_doc_method'. NOT a
 * separate table — one row per program per method in program_rule.
 */
import { z } from 'zod';

export const incomeDocMethodSchema = z.object({
  method: z.enum([
    'FULL_DOC',
    'BANK_STATEMENT_12MO',
    'BANK_STATEMENT_24MO',
    'P_AND_L_ONLY',
    'WVOE',
    'ASSET_DEPLETION',
    'NO_DOC',
    '1099_ONLY',
  ]),
  // Bank-statement specific (apply when method ∈ BANK_STATEMENT_*)
  account_type: z.enum(['PERSONAL', 'BUSINESS', 'EITHER']).nullable().optional(),
  expense_factor: z.number().min(0).max(1).nullable().optional(),
  expense_factor_source: z.enum([
    'FIXED_PERCENTAGE',
    'CPA_LETTER',
    'P_AND_L_RECONCILIATION',
    'BORROWER_ATTESTATION',
  ]).nullable().optional(),
  exclude_transfers: z.boolean().nullable().optional(),
  max_nsf_per_period: z.number().int().nonnegative().nullable().optional(),
  comingling_treatment: z.enum(['ALLOWED', 'DISALLOWED', 'SEASONED']).nullable().optional(),
  qualifying_deposit_seasoning: z.string().nullable().optional(),
  qualifying_period_months: z.number().int().nonnegative().nullable().optional(),
});
export type IncomeDocMethod = z.infer<typeof incomeDocMethodSchema>;
