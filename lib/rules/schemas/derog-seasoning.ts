/**
 * DerogRule — structured derogatory-event seasoning.
 * Per Pitfall 1.1 / 1.2 / 1.3 / 1.5 / 1.6.
 *
 * Pitfall 1.1: A boolean "has derog?" loses the long tail. Each derogatory
 * event type carries its own waiting period, anchor, post-event LTV cap
 * window, and reestablished-credit requirement. Encoding this structurally
 * is the wedge: the eligibility-first product cannot triage non-QM scenarios
 * without it.
 *
 * Pitfall 1.2: FNMA post-foreclosure has a 7-year baseline waiting period
 * with a 3-year extenuating-circumstances exception, AND a 3-to-7-year
 * window where 90% LTV is the cap on PURCHASE / RATE_TERM_REFI for a
 * PRIMARY occupancy. `post_event_LTV_caps[]` carries this verbatim.
 *
 * Pitfall 1.3: `measurement_anchor` varies by event type:
 *   - BK7 / BK13_DISCHARGED: DISCHARGE
 *   - BK13_DISMISSED: DISMISSAL
 *   - FORECLOSURE: COMPLETION (or SALE_CONFIRMATION per servicer policy)
 *   - MORTGAGE_CHARGE_OFF: CHARGE_OFF_DATE
 *
 * Pitfall 1.5: MULTIPLE_BK is its own event_type with longer waiting
 * window (FNMA: 5y baseline post-second-discharge).
 *
 * Pitfall 1.6: When a mortgage was INCLUDED in a BK, FNMA's clock can
 * default to the BK_CLOCK if the mortgage was NOT reaffirmed; FHLMC
 * uses FC_CLOCK_ALWAYS. `mortgage_included_in_bk_rule` captures this.
 *
 * Cardinality: one row in agency_rule per (agency_rule_version_id, event_type).
 * SC#2 query: SELECT * FROM agency_rule WHERE rule_kind='derog_seasoning'
 *               AND rule_body->>'event_type' = 'FORECLOSURE'.
 */
import { z } from 'zod';

export const derogEventType = z.enum([
  'BK7',
  'BK13_DISCHARGED',
  'BK13_DISMISSED',
  'MULTIPLE_BK',
  'FORECLOSURE',
  'DEED_IN_LIEU',
  'SHORT_SALE',
  'MORTGAGE_CHARGE_OFF',
  'MOD',
  'FORBEARANCE',
]);

export const measurementAnchor = z.enum([
  'DISCHARGE',
  'DISMISSAL',
  'COMPLETION',
  'SALE_CONFIRMATION',
  'NOTE_DATE',
  'CHARGE_OFF_DATE',
]);

export const occupancyValue = z.enum(['PRIMARY', 'SECOND_HOME', 'INVESTMENT']);

export const purposeValue = z.enum([
  'PURCHASE',
  'RATE_TERM_REFI',
  'CASH_OUT_REFI',
  'CONSTRUCTION',
  'CONSTRUCTION_TO_PERM',
  'HELOC',
  'CES_SECOND_LIEN',
]);

export const postEventLtvCap = z.object({
  months_since_min: z.number().int().nonnegative(),
  months_since_max: z.number().int().nonnegative().nullable(),
  max_LTV: z.number().min(0).max(100),
  max_CLTV: z.number().min(0).max(120).nullable().optional(),
  max_HCLTV: z.number().min(0).max(120).nullable().optional(),
  purposeAllowList: z.array(purposeValue),
  occupancyAllowList: z.array(occupancyValue),
});

export const mortgageIncludedInBkRule = z.enum([
  'NOT_APPLICABLE',
  'BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED',
  'FC_CLOCK_ALWAYS',
]);

/**
 * Phase 3 / Plan 03-01 Task 08 Delta 6 (REVIEWS.md B9 + iter-2 B4a fix +
 * plan-checker BLOCKER #3):
 *
 *   - `base_waiting_months` is nullable to allow `not_applicable: true`
 *     sentinel rows (FHA/VA agencies that do not season FORECLOSURE / DIL /
 *     SHORT_SALE / MORTGAGE_CHARGE_OFF independently of bankruptcy).
 *   - `not_applicable` is an optional boolean discriminator. When true, the
 *     row is a sentinel signaling the agency has no separate seasoning rule
 *     for that event_type (i.e., it inherits from BK7 / BK13 etc.).
 *   - `_seed_key` is the loader-managed dedupe discriminator (Task 08 Delta 7
 *     / REVIEWS.md B2). Fixtures should NEVER set this manually; the loader
 *     injects it from `seedKey ?? event_type` via jsonb_set.
 *   - Refine: when `not_applicable !== true`, `base_waiting_months` MUST be
 *     non-null. This guards against accidental nullability in non-sentinel
 *     rows.
 */
export const derogSeasoningSchema = z.object({
  event_type: derogEventType,
  measurement_anchor: measurementAnchor,
  // Nullable per Task 08 Delta 6 — sentinel rows with not_applicable=true
  // set base_waiting_months: null. The .refine below enforces that
  // not_applicable is the ONLY case where null is permitted.
  base_waiting_months: z.number().int().nonnegative().nullable(),
  extenuating_circumstances_waiting_months: z.number().int().nonnegative().nullable(),
  post_event_LTV_caps: z.array(postEventLtvCap).default([]),
  reestablished_credit_required: z.boolean(),
  reestablishment_criteria_text: z.string().nullable().optional(),
  mortgage_included_in_bk_rule: mortgageIncludedInBkRule,
  notes_citations: z.array(z.string()).default([]),
  // Task 08 Delta 6: sentinel discriminator (REVIEWS.md B9).
  not_applicable: z.boolean().optional(),
  // Task 08 Delta 7: loader-managed dedupe discriminator (REVIEWS.md B2).
  // Reserved field — fixtures must NOT set this manually.
  _seed_key: z.string().optional(),
}).refine(
  (data) => data.not_applicable === true || data.base_waiting_months !== null,
  { message: 'base_waiting_months required when not_applicable is not true' },
);

export type DerogSeasoning = z.infer<typeof derogSeasoningSchema>;
