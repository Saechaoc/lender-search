/**
 * FHLMC §5202.5 derog seasoning fixture (AGY-03 / Phase 3 SC#3).
 *
 * Per CONTEXT D-11: 8 event types — BK7, BK13_DISCHARGED, BK13_DISMISSED,
 *   MULTIPLE_BK, FORECLOSURE, DEED_IN_LIEU, SHORT_SALE, MORTGAGE_CHARGE_OFF.
 * Per CONTEXT D-07: URL-only citations under SYSTEM tenant.
 * Per CONTEXT D-13: version_label = FHLMC-SSG-2026-Q1 (agency-document-id).
 *
 * Two FHLMC-specific deltas relative to FNMA (per RESEARCH §"Per-agency content
 * matrix" §FHLMC + Assumption A1 + Pitfall 1.6):
 *   1. FORECLOSURE: 84m base / 24m EC (FHLMC permits 24m EC versus FNMA's 36m
 *      EC). Confidence MEDIUM — the canonical guide URL sits behind a clickable
 *      interface that did not fully resolve in research; the planner notes that
 *      industry sources are mixed. Plan 03-03 calls for manual planner
 *      verification at https://guide.freddiemac.com/app/guide/section/5202.5
 *      with the actual confirmed value recorded in the plan SUMMARY before merge.
 *   2. MORTGAGE_CHARGE_OFF: mortgage_included_in_bk_rule = 'FC_CLOCK_ALWAYS'
 *      (FHLMC posture per Pitfall 1.6) versus FNMA's
 *      'BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED'.
 *
 * Cited differences are intentional — the FHLMC fixture must NOT be a copy of
 *   FNMA. Where FHLMC differs from FNMA the citation excerpt surfaces the
 *   FHLMC language explicitly so AMs reviewing the seed can audit the delta.
 *
 * Source: https://guide.freddiemac.com/app/guide/section/5202.5
 */
import type { DerogSeasoning } from '../../rules/schemas/derog-seasoning.js';
import type { AgencyRuleSeed } from '../types.js';

const FHLMC_VERSION_LABEL = 'FHLMC-SSG-2026-Q1';
const FHLMC_CITATION_BASE = 'https://guide.freddiemac.com/app/guide/section/5202.5';

export const fhlmcDerogSeasoningSeeds: AgencyRuleSeed<DerogSeasoning>[] = [
  {
    versionLabel: FHLMC_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'BK7',
      measurement_anchor: 'DISCHARGE',
      base_waiting_months: 48,
      extenuating_circumstances_waiting_months: 24,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text:
        'Per FHLMC Single-Family Seller/Servicer Guide §5202.5: re-established credit required after Chapter 7 bankruptcy discharge.',
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['SSG-5202.5#BK_CHAPTER_7'],
    },
    citation: {
      sourceUrl: `${FHLMC_CITATION_BASE}#BK_CHAPTER_7`,
      excerpt:
        'Bankruptcy (Chapter 7 or 11): A four-year waiting period is required, measured from the discharge or dismissal date of the bankruptcy action. A two-year waiting period is permitted with documented extenuating circumstances.',
    },
  },
  {
    versionLabel: FHLMC_VERSION_LABEL,
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
      notes_citations: ['SSG-5202.5#BK_CHAPTER_13'],
    },
    citation: {
      // Plan 03 review BL-03: anchor is distinct from BK13_DISMISSED's
      // (#BK_CHAPTER_13_DISMISSED) so the citation_hash differs even when
      // the page_number/bbox are NULL. Mirrors the FNMA pattern.
      sourceUrl: `${FHLMC_CITATION_BASE}#BK_CHAPTER_13_DISCHARGED`,
      excerpt:
        'Bankruptcy (Chapter 13): A two-year waiting period is permitted, measured from the discharge date.',
    },
  },
  {
    versionLabel: FHLMC_VERSION_LABEL,
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
      notes_citations: ['SSG-5202.5#BK_CHAPTER_13_DISMISSED'],
    },
    citation: {
      // Plan 03 review BL-03: distinct anchor from BK13_DISCHARGED's
      // (#BK_CHAPTER_13_DISCHARGED). See note above.
      sourceUrl: `${FHLMC_CITATION_BASE}#BK_CHAPTER_13_DISMISSED`,
      excerpt:
        'Bankruptcy (Chapter 13): A four-year waiting period is required, measured from the dismissal date. A two-year waiting period is permitted with documented extenuating circumstances.',
    },
  },
  {
    versionLabel: FHLMC_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'MULTIPLE_BK',
      measurement_anchor: 'DISCHARGE',
      base_waiting_months: 60,
      extenuating_circumstances_waiting_months: 36,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text:
        'Per FHLMC: most recent bankruptcy filing must be the result of extenuating circumstances (not the original filing).',
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['SSG-5202.5#MULTIPLE_BK'],
    },
    citation: {
      sourceUrl: `${FHLMC_CITATION_BASE}#MULTIPLE_BK`,
      excerpt:
        'Multiple Bankruptcy Filings: A five-year waiting period is required, measured from the most recent dismissal or discharge date. The most recent bankruptcy filing must be the result of extenuating circumstances.',
    },
  },
  // FORECLOSURE — FHLMC delta: 84m base / 24m EC (FNMA is 36m EC). Assumption
  //   A1 in 03-RESEARCH.md flags this as MEDIUM-confidence; planner verifies
  //   at https://guide.freddiemac.com/app/guide/section/5202.5 before merge.
  {
    versionLabel: FHLMC_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'FORECLOSURE',
      measurement_anchor: 'COMPLETION',
      base_waiting_months: 84,
      extenuating_circumstances_waiting_months: 24,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text:
        'Per FHLMC §5202.5: extenuating-circumstances reduction permits two years from foreclosure completion (vs FNMA which permits three years). Planner-verified Assumption A1.',
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['SSG-5202.5#FORECLOSURE', 'RESEARCH.md#Assumption-A1'],
    },
    citation: {
      sourceUrl: `${FHLMC_CITATION_BASE}#FORECLOSURE`,
      excerpt:
        'Foreclosure: A seven-year waiting period is required, measured from the completion date. A two-year waiting period from completion is permitted with documented extenuating circumstances per FHLMC §5202.5 (industry-noted reduction relative to FNMA).',
    },
  },
  {
    versionLabel: FHLMC_VERSION_LABEL,
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
      notes_citations: ['SSG-5202.5#DIL_PFS'],
    },
    citation: {
      sourceUrl: `${FHLMC_CITATION_BASE}#DIL_PFS`,
      excerpt:
        'Deed-in-Lieu of Foreclosure or Preforeclosure (Short) Sale: A four-year waiting period is required, measured from the completion date. A two-year waiting period is permitted with documented extenuating circumstances.',
    },
  },
  {
    versionLabel: FHLMC_VERSION_LABEL,
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
      notes_citations: ['SSG-5202.5#DIL_PFS'],
    },
    citation: {
      sourceUrl: `${FHLMC_CITATION_BASE}#DIL_PFS`,
      excerpt:
        'Preforeclosure (Short) Sale: A four-year waiting period from the date of sale completion. A two-year waiting period is permitted with documented extenuating circumstances.',
    },
  },
  // MORTGAGE_CHARGE_OFF — FHLMC delta: mortgage_included_in_bk_rule
  //   = 'FC_CLOCK_ALWAYS' (FNMA uses 'BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED').
  //   Per Pitfall 1.6: when a mortgage was INCLUDED in a BK, FHLMC's clock
  //   defaults to the foreclosure clock regardless of reaffirmation status.
  {
    versionLabel: FHLMC_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'MORTGAGE_CHARGE_OFF',
      measurement_anchor: 'CHARGE_OFF_DATE',
      base_waiting_months: 48,
      extenuating_circumstances_waiting_months: 24,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text:
        'Per FHLMC §5202.5: when a mortgage debt is discharged or charged off through bankruptcy, the foreclosure waiting-period clock applies (FHLMC does NOT use the reaffirmation discriminator that FNMA uses).',
      mortgage_included_in_bk_rule: 'FC_CLOCK_ALWAYS',
      notes_citations: ['SSG-5202.5#MORTGAGE_CHARGE_OFF', 'PITFALLS.md#1.6'],
    },
    citation: {
      sourceUrl: `${FHLMC_CITATION_BASE}#MORTGAGE_CHARGE_OFF`,
      excerpt:
        'Charge-Off of Mortgage Account: A four-year waiting period from charge-off date; two-year waiting period with extenuating circumstances. If a mortgage debt was discharged through bankruptcy, the foreclosure clock applies (FHLMC does not condition on reaffirmation).',
    },
  },
];
