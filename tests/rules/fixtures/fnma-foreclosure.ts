/**
 * fnmaForeclosure — FNMA post-foreclosure 3-to-7-year window fixture (SC#2).
 *
 * The structured DerogRule encoding the FNMA Selling Guide B3-5.3-07
 * derogatory waiting period for FORECLOSURE: 7-year baseline, 3-year w/
 * extenuating circumstances, 90% LTV cap on the 3-to-7-year band for
 * PRIMARY purchase or RT-refi only (Pitfall 1.2).
 *
 * Phase 2 SC#2 acceptance: queryable by event_type='FORECLOSURE' returning
 * structured post_event_LTV_caps[].
 *
 * Used by:
 *   - tests/rules/derog-seasoning.test.ts (parse-good fixture)
 *   - tests/schema/derog-rule-roundtrip.test.ts (Plan 02-08; Drizzle round-trip)
 *
 * Per RESEARCH Open Question Q4: ephemeral test fixture only. Phase 3 owns
 * full FNMA hand-authoring transaction.
 */
import type { DerogSeasoning } from '../../../lib/rules/schemas/derog-seasoning.js';

export const fnmaForeclosure: DerogSeasoning = {
  event_type: 'FORECLOSURE',
  measurement_anchor: 'COMPLETION',
  base_waiting_months: 84,
  extenuating_circumstances_waiting_months: 36,
  post_event_LTV_caps: [
    {
      months_since_min: 36,
      months_since_max: 84,
      max_LTV: 90,
      purposeAllowList: ['PURCHASE', 'RATE_TERM_REFI'],
      occupancyAllowList: ['PRIMARY'],
    },
  ],
  reestablished_credit_required: true,
  mortgage_included_in_bk_rule: 'BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED',
  notes_citations: ['FNMA Selling Guide B3-5.3-07'],
};
