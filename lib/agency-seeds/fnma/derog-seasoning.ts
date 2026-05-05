/**
 * FNMA B3-5.3-07 derog seasoning fixture (AGY-02 / Phase 3 SC#3).
 *
 * Per CONTEXT D-11: 8 event types — BK7, BK13_DISCHARGED, BK13_DISMISSED,
 *   MULTIPLE_BK, FORECLOSURE, DEED_IN_LIEU, SHORT_SALE, MORTGAGE_CHARGE_OFF.
 * Per REVIEWS.md B2: FORECLOSURE is encoded as TWO rows reflecting FNMA's
 *   actual conditional structure during the 3-to-7-year EC window:
 *     row A: PURCHASE on PRIMARY only (FNMA limits purchase EC to principal residence)
 *     row B: RATE_TERM_REFI on PRIMARY/SECOND_HOME/INVESTMENT (FNMA permits
 *            limited cash-out for all eligible occupancy types)
 *   This brings the total agency_rule rows under FNMA-SEL-2026-04 to 9.
 *   Distinct `seedKey` ('FORECLOSURE_PURCHASE' / 'FORECLOSURE_LCOR') is
 *   required so the loader's COALESCE(_seed_key, event_type) dedupe predicate
 *   does NOT collapse the two rows into one.
 * Per CONTEXT D-07: URL-only citations under SYSTEM tenant.
 * Per CONTEXT D-13: version_label = FNMA-SEL-2026-04 (agency-document-id).
 *
 * Pitfall 1.2: FNMA FORECLOSURE 3-to-7-year window 90% LTV cap; B2 split
 *   ensures the cap correctly applies to PURCHASE+PRIMARY only and to
 *   RATE_TERM_REFI for all eligible occupancies.
 * Pitfall 1.3: measurement_anchor varies by event type (DISCHARGE / DISMISSAL /
 *   COMPLETION / SALE_CONFIRMATION / CHARGE_OFF_DATE).
 * Pitfall 1.5: MULTIPLE_BK = 60m base / 36m EC, anchored to most recent discharge.
 * Pitfall 1.6: MORTGAGE_CHARGE_OFF carries
 *   mortgage_included_in_bk_rule='BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED'.
 *
 * Source: https://selling-guide.fanniemae.com/sel/b3-5.3-07/significant-derogatory-credit-events-waiting-periods-and-re-establishing-credit
 */
import type { DerogSeasoning } from '../../rules/schemas/derog-seasoning.js';
import type { AgencyRuleSeed } from '../types.js';

const FNMA_VERSION_LABEL = 'FNMA-SEL-2026-04';
const FNMA_CITATION_BASE = 'https://selling-guide.fanniemae.com/sel/b3-5.3-07/';

export const fnmaDerogSeasoningSeeds: AgencyRuleSeed<DerogSeasoning>[] = [
  {
    versionLabel: FNMA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'BK7',
      measurement_anchor: 'DISCHARGE',
      base_waiting_months: 48,
      extenuating_circumstances_waiting_months: 24,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text: 'Per FNMA Selling Guide B3-5.3-07: re-established credit required after BK7 discharge.',
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['B3-5.3-07#BK_CHAPTER_7'],
    },
    citation: {
      sourceUrl: `${FNMA_CITATION_BASE}#BK_CHAPTER_7`,
      excerpt: 'Bankruptcy (Chapter 7 or 11): A four-year waiting period is required, measured from the discharge or dismissal date of the bankruptcy action. A two-year waiting period is permitted with documented extenuating circumstances.',
    },
  },
  {
    versionLabel: FNMA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'BK13_DISCHARGED',
      measurement_anchor: 'DISCHARGE',
      base_waiting_months: 24,
      extenuating_circumstances_waiting_months: null,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text: null,
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['B3-5.3-07#BK_CHAPTER_13'],
    },
    citation: {
      sourceUrl: `${FNMA_CITATION_BASE}#BK_CHAPTER_13`,
      excerpt: 'Bankruptcy (Chapter 13): A two-year waiting period is permitted, measured from the discharge date.',
    },
  },
  {
    versionLabel: FNMA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'BK13_DISMISSED',
      measurement_anchor: 'DISMISSAL',
      base_waiting_months: 48,
      extenuating_circumstances_waiting_months: 24,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text: null,
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['B3-5.3-07#BK_CHAPTER_13'],
    },
    citation: {
      sourceUrl: `${FNMA_CITATION_BASE}#BK_CHAPTER_13_DISMISSED`,
      excerpt: 'Bankruptcy (Chapter 13): A four-year waiting period is required, measured from the dismissal date. A two-year waiting period is permitted with documented extenuating circumstances.',
    },
  },
  {
    versionLabel: FNMA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'MULTIPLE_BK',
      measurement_anchor: 'DISCHARGE',
      base_waiting_months: 60,
      extenuating_circumstances_waiting_months: 36,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text: 'Per FNMA: most recent filing must be the result of extenuating circumstances (not the original filing).',
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['B3-5.3-07#MULTIPLE_BK'],
    },
    citation: {
      sourceUrl: `${FNMA_CITATION_BASE}#MULTIPLE_BK`,
      excerpt: 'Multiple Bankruptcy Filings: A five-year waiting period is required, measured from the most recent dismissal or discharge date. The most recent bankruptcy filing must be the result of extenuating circumstances.',
    },
  },
  // FORECLOSURE row A — PURCHASE on PRIMARY only (B2 split #1).
  //   seedKey: 'FORECLOSURE_PURCHASE' — required iter-2 REVIEWS B2 fix so the
  //   loader's dedupe key distinguishes this from row B (which shares event_type).
  {
    versionLabel: FNMA_VERSION_LABEL,
    seedKey: 'FORECLOSURE_PURCHASE',
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'FORECLOSURE',
      measurement_anchor: 'COMPLETION',
      base_waiting_months: 84,
      extenuating_circumstances_waiting_months: 36,
      post_event_LTV_caps: [
        {
          months_since_min: 36,
          months_since_max: 84,
          max_LTV: 90,
          max_CLTV: 90,
          max_HCLTV: 90,
          purposeAllowList: ['PURCHASE'],
          occupancyAllowList: ['PRIMARY'],
        },
      ],
      reestablished_credit_required: true,
      reestablishment_criteria_text: 'B2 split row A: FNMA limits PURCHASE during the foreclosure 3-7 year EC window to principal residence only.',
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['B3-5.3-07#FORECLOSURE', 'REVIEWS.md#B2-row-A'],
    },
    citation: {
      sourceUrl: `${FNMA_CITATION_BASE}#FORECLOSURE_PURCHASE_PRIMARY`,
      excerpt: 'Foreclosure: A seven-year waiting period is required. A three-year waiting period is permitted with extenuating circumstances, with the maximum LTV/CLTV/HCLTV ratios of the lesser of 90% or transaction limits, principal residence purchase only.',
    },
  },
  // FORECLOSURE row B — RATE_TERM_REFI on all eligible occupancies (B2 split #2).
  //   seedKey: 'FORECLOSURE_LCOR' — distinct from row A's seedKey so dedupe
  //   permits both rows to coexist under the same event_type='FORECLOSURE'.
  {
    versionLabel: FNMA_VERSION_LABEL,
    seedKey: 'FORECLOSURE_LCOR',
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'FORECLOSURE',
      measurement_anchor: 'COMPLETION',
      base_waiting_months: 84,
      extenuating_circumstances_waiting_months: 36,
      post_event_LTV_caps: [
        {
          months_since_min: 36,
          months_since_max: 84,
          max_LTV: 90,
          max_CLTV: 90,
          max_HCLTV: 90,
          purposeAllowList: ['RATE_TERM_REFI'],
          occupancyAllowList: ['PRIMARY', 'SECOND_HOME', 'INVESTMENT'],
        },
      ],
      reestablished_credit_required: true,
      reestablishment_criteria_text: 'B2 split row B: FNMA permits limited cash-out refinances for all eligible occupancy types during the foreclosure 3-7 year EC window.',
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['B3-5.3-07#FORECLOSURE', 'REVIEWS.md#B2-row-B'],
    },
    citation: {
      sourceUrl: `${FNMA_CITATION_BASE}#FORECLOSURE_LIMITED_CASH_OUT`,
      excerpt: 'Foreclosure: During the three-to-seven-year window with extenuating circumstances, limited cash-out refinances are permitted for all eligible occupancy types (principal residence, second home, investment property), subject to the 90% LTV/CLTV/HCLTV cap.',
    },
  },
  {
    versionLabel: FNMA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'DEED_IN_LIEU',
      measurement_anchor: 'COMPLETION',
      base_waiting_months: 48,
      extenuating_circumstances_waiting_months: 24,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text: null,
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['B3-5.3-07#DIL_PFS'],
    },
    citation: {
      sourceUrl: `${FNMA_CITATION_BASE}#DIL_PFS`,
      excerpt: 'Deed-in-Lieu of Foreclosure, Preforeclosure Sale, or Charge-Off of Mortgage Account: A four-year waiting period is required. A two-year waiting period is permitted with extenuating circumstances.',
    },
  },
  {
    versionLabel: FNMA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'SHORT_SALE',
      measurement_anchor: 'SALE_CONFIRMATION',
      base_waiting_months: 48,
      extenuating_circumstances_waiting_months: 24,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text: null,
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['B3-5.3-07#DIL_PFS_SHORT_SALE'],
    },
    citation: {
      sourceUrl: `${FNMA_CITATION_BASE}#SHORT_SALE`,
      excerpt: 'Preforeclosure Sale (short sale): A four-year waiting period from the date of sale completion. A two-year waiting period is permitted with extenuating circumstances.',
    },
  },
  {
    versionLabel: FNMA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'MORTGAGE_CHARGE_OFF',
      measurement_anchor: 'CHARGE_OFF_DATE',
      base_waiting_months: 48,
      extenuating_circumstances_waiting_months: 24,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text: null,
      mortgage_included_in_bk_rule: 'BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED',
      notes_citations: ['B3-5.3-07#MORTGAGE_CHARGE_OFF', 'B3-5.3-07#MORTGAGE_INCLUDED_IN_BK'],
    },
    citation: {
      sourceUrl: `${FNMA_CITATION_BASE}#MORTGAGE_CHARGE_OFF`,
      excerpt: 'Charge-Off of Mortgage Account: A four-year waiting period from charge-off date; two-year waiting period with extenuating circumstances. If a mortgage debt was discharged through bankruptcy, the bankruptcy waiting periods may be applied if the mortgage was not reaffirmed.',
    },
  },
];
