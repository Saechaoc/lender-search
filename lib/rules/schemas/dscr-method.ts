/**
 * DscrMethod — typed DSCR (debt-service coverage ratio) method per program.
 * Per Pitfall 1.9.
 *
 * DSCR programs vary substantively in numerator rule (gross rents vs net
 * operating income vs market rent / lease comparison), denominator rule
 * (note-rate PITIA vs fully-amortized qualifying), short-term rental
 * eligibility, IO handling, and no-ratio fallback options. Like Pitfall 1.8,
 * a flat label loses this — the structured shape lets Phase 4 evaluator
 * compute DSCR the way the rule prescribes, not the way the input data
 * happens to be shaped.
 *
 * D-11: Persisted in rule_body when rule_kind='dscr_method'. NOT a separate
 * table — one row per DSCR program in program_rule.
 *
 * `min_dscr_by_ltv_tier` lets the rule encode the standard DSCR-x-LTV grid
 * (e.g., 1.0 DSCR allowed up to 75% LTV, 0.75 DSCR allowed up to 65% LTV)
 * without exploding into multiple program_rule rows.
 */
import { z } from 'zod';

export const dscrLtvTier = z.object({
  ltv_max: z.number().min(0).max(120),
  min_dscr: z.number().min(0),
});

export const dscrMethodSchema = z.object({
  numerator_rule: z.enum([
    'LOWER_OF_LEASE_AND_MARKET',
    'HIGHER_OF_LEASE_AND_MARKET',
    'LEASE_ONLY',
    'MARKET_ONLY',
    'LEASE_WITH_MARKET_FALLBACK',
  ]),
  short_term_rental_allowed: z.boolean(),
  short_term_rental_seasoning_months: z.number().int().nonnegative().nullable().optional(),
  denominator_method: z.enum([
    'NOTE_RATE_PITIA',
    'NOTE_RATE_ITIA_FOR_IO',
    'FULLY_AMORTIZED_QUALIFYING',
    'INDEX_PLUS_MARGIN',
    'INDEX_PLUS_MARGIN_PLUS_2',
  ]),
  min_dscr_by_ltv_tier: z.array(dscrLtvTier).default([]),
  no_ratio_option: z.boolean(),
  no_ratio_max_ltv: z.number().min(0).max(120).nullable().optional(),
});
export type DscrMethod = z.infer<typeof dscrMethodSchema>;
