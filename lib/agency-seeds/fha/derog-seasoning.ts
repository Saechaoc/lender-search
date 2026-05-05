/**
 * lib/agency-seeds/fha/derog-seasoning.ts — FHA HUD Handbook 4000.1 §II.A.5.b
 *   derog-event seasoning matrix (active rules under HUD-4000.1-2024-08).
 *
 * Phase 3 / Plan 03-04 / SC#4 / AGY-04.
 *
 * Per RESEARCH §"Per-agency content matrix" §FHA HUD 4000.1: FHA's shorter
 *   timings vs FNMA/FHLMC. BK7 24m base / 12m EC; foreclosure / DIL /
 *   short-sale / charge-off all 36m base / 12m EC (FHA standard EC active);
 *   anchor varies per event (DISCHARGE / DISMISSAL / COMPLETION /
 *   SALE_CONFIRMATION / CHARGE_OFF_DATE).
 *
 * Total active agency_rule rows = 8 (7 standard event types per HUD 4000.1
 *   + 1 explicit MULTIPLE_BK not_applicable=true row per REVIEWS.md B9).
 *
 * REVIEWS.md B9 fix: MULTIPLE_BK is encoded as an explicit `not_applicable=true`
 *   sentinel row instead of being silently absent. FHA HUD 4000.1 does not
 *   separately specify a multi-filing bankruptcy waiting period; encoding the
 *   absence as a first-class row gives the Phase 4 evaluator a deterministic
 *   "fall back to single-BK" semantic instead of a "missing row →
 *   undefined-behavior" path. The Zod schema's optional `not_applicable: boolean`
 *   field (Plan 03-01 Task 08 Delta 6) and nullable `base_waiting_months`
 *   support this sentinel pattern.
 *
 * Citation source: HUD Handbook 4000.1 §II.A.5.b.
 *   https://www.hud.gov/sites/dfiles/SFH/documents/4000.1hsgh.pdf
 *
 * The companion Back-to-Work DEPRECATED fixture lives in a separate file
 *   (lib/agency-seeds/fha/back-to-work-deprecated.ts) so a second
 *   agency_rule_version row can be seeded with `state='DEPRECATED'` and
 *   `sunset_date='2016-09-30'` per REVIEWS.md B8a.
 */
import type { DerogSeasoning } from '../../rules/schemas/derog-seasoning.js';
import type { AgencyRuleSeed } from '../types.js';

const FHA_VERSION_LABEL = 'HUD-4000.1-2024-08';
const FHA_SOURCE_BASE = 'https://www.hud.gov/sites/dfiles/SFH/documents/4000.1hsgh.pdf';

export const fhaDerogSeasoningSeeds: AgencyRuleSeed<DerogSeasoning>[] = [
  // ----- BK7 (Chapter 7 Bankruptcy) -----
  // FHA HUD 4000.1 §II.A.5.b.iv: 2-year base, 12-month extenuating circumstances.
  // Anchor: DISCHARGE date.
  {
    versionLabel: FHA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'BK7',
      measurement_anchor: 'DISCHARGE',
      base_waiting_months: 24,
      extenuating_circumstances_waiting_months: 12,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text:
        'Per HUD 4000.1 §II.A.5.b.iv: borrower must demonstrate satisfactory credit since discharge. With extenuating circumstances (12-month minimum), borrower must provide written explanation and documentation of the EC.',
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['HUD-4000.1#II.A.5.b.iv'],
    },
    citation: {
      sourceUrl: `${FHA_SOURCE_BASE}#II.A.5.b.iv.BK7`,
      excerpt:
        'A Borrower is generally not eligible for a new FHA-insured Mortgage if, during the 2-year period prior to case number assignment, the Borrower had a Chapter 7 bankruptcy discharged. Less than 2 years, but no fewer than 12 months, may be acceptable for an FHA-insured Mortgage if the Borrower can document that the bankruptcy was caused by extenuating circumstances and has since exhibited a documented ability to manage their financial affairs.',
    },
  },

  // ----- BK13_DISCHARGED (Chapter 13 Bankruptcy — discharged) -----
  // FHA HUD 4000.1 §II.A.5.b.iv: post-discharge variant. 24-month seasoning
  // post-discharge. The in-plan-with-court-approval variant (12m payout +
  // trustee approval) is a separate evaluation path per HUD 4000.1; Phase 3
  // ships the post-discharge variant. Anchor: DISCHARGE date.
  {
    versionLabel: FHA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'BK13_DISCHARGED',
      measurement_anchor: 'DISCHARGE',
      base_waiting_months: 24,
      extenuating_circumstances_waiting_months: null,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text:
        'Per HUD 4000.1 §II.A.5.b.iv: A Chapter 13 bankruptcy does not disqualify the Borrower from obtaining an FHA-insured Mortgage if the Borrower has completed making all payments under the bankruptcy or, if the Borrower is currently in payout, the court approves the new Mortgage. The post-discharge path requires demonstrated satisfactory credit since discharge.',
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['HUD-4000.1#II.A.5.b.iv.BK13_DISCHARGED'],
    },
    citation: {
      sourceUrl: `${FHA_SOURCE_BASE}#II.A.5.b.iv.BK13_DISCHARGED`,
      excerpt:
        'A Chapter 13 bankruptcy does not disqualify the Borrower if at least 12 months of the pay-out period under the bankruptcy has elapsed and the Borrower\'s payment performance has been satisfactory. The Borrower must receive written permission from the Court to enter into the Mortgage transaction.',
    },
  },

  // ----- BK13_DISMISSED (Chapter 13 Bankruptcy — dismissed) -----
  // FHA HUD 4000.1 §II.A.5.b.iv: 24-month base / 12-month EC. Anchor:
  // DISMISSAL date (per Pitfall 1.3 — measurement_anchor varies per event).
  {
    versionLabel: FHA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'BK13_DISMISSED',
      measurement_anchor: 'DISMISSAL',
      base_waiting_months: 24,
      extenuating_circumstances_waiting_months: 12,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text:
        'Per HUD 4000.1 §II.A.5.b.iv: 24 months from dismissal date, with 12-month minimum under documented extenuating circumstances. Borrower must demonstrate ability to manage financial affairs since dismissal.',
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['HUD-4000.1#II.A.5.b.iv.BK13_DISMISSED'],
    },
    citation: {
      sourceUrl: `${FHA_SOURCE_BASE}#II.A.5.b.iv.BK13_DISMISSED`,
      excerpt:
        'For a Chapter 13 bankruptcy that has been dismissed, the Mortgagee must determine that the cause of the bankruptcy is unlikely to recur. The 24-month seasoning runs from the dismissal date.',
    },
  },

  // ----- MULTIPLE_BK (REVIEWS.md B9 — explicit not_applicable=true sentinel) -----
  // MULTIPLE_BK encoded as explicit not_applicable per REVIEWS.md B9.
  // FHA does not separately specify multi-filing waiting periods; this row
  // gives Phase 4 evaluator a deterministic "absent → fall back to single-BK"
  // semantic instead of a missing-row → undefined-behavior path.
  {
    versionLabel: FHA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'MULTIPLE_BK',
      measurement_anchor: 'DISCHARGE',
      base_waiting_months: null,
      extenuating_circumstances_waiting_months: null,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text:
        'Per REVIEWS.md B9: FHA does not separately specify MULTIPLE_BK waiting periods; Phase 4 evaluator falls back to single-BK rule. Encoded as not_applicable=true to make the absence explicit and deterministic.',
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      not_applicable: true,
      notes_citations: ['REVIEWS.md#B9', 'HUD-4000.1#II.A.5.b#MULTIPLE_BK_NOT_SEPARATELY_SPECIFIED'],
    },
    citation: {
      sourceUrl: 'https://www.hud.gov/sites/dfiles/SFH/documents/4000.1hsgh.pdf#II.A.5.b.MULTIPLE_BK',
      excerpt:
        'HUD 4000.1 §II.A.5.b does not separately specify multi-filing bankruptcy waiting periods. Per REVIEWS.md B9 we encode this absence explicitly with not_applicable=true so Phase 4 evaluator can deterministically fall back to single-BK seasoning.',
    },
  },

  // ----- FORECLOSURE -----
  // FHA HUD 4000.1 §II.A.5.b.iii: 36-month base / 12-month EC (FHA standard
  // extenuating-circumstances provision is active). Anchor: COMPLETION date.
  {
    versionLabel: FHA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'FORECLOSURE',
      measurement_anchor: 'COMPLETION',
      base_waiting_months: 36,
      extenuating_circumstances_waiting_months: 12,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text:
        'Per HUD 4000.1 §II.A.5.b.iii: Borrower is generally not eligible for a new FHA-insured Mortgage if the Borrower had a foreclosure, deed-in-lieu of foreclosure, or short sale within the previous 3 years. Less than 3 years, but no fewer than 12 months, may be acceptable if the Borrower can document that the foreclosure was caused by extenuating circumstances and has since exhibited a documented ability to manage their financial affairs.',
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['HUD-4000.1#II.A.5.b.iii'],
    },
    citation: {
      sourceUrl: `${FHA_SOURCE_BASE}#II.A.5.b.iii.FORECLOSURE`,
      excerpt:
        'A Borrower is generally not eligible for a new FHA-insured Mortgage if the Borrower had a foreclosure or a deed-in-lieu of foreclosure in the 3-year period prior to the date of case number assignment. Less than 3 years, but no fewer than 12 months, may be acceptable if the foreclosure was caused by extenuating circumstances.',
    },
  },

  // ----- DEED_IN_LIEU -----
  // FHA HUD 4000.1 §II.A.5.b.iii: 36-month base / 12-month EC. Anchor:
  // COMPLETION date (DIL completion date).
  {
    versionLabel: FHA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'DEED_IN_LIEU',
      measurement_anchor: 'COMPLETION',
      base_waiting_months: 36,
      extenuating_circumstances_waiting_months: 12,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text:
        'Per HUD 4000.1 §II.A.5.b.iii: Same 3-year seasoning as foreclosure. 12-month minimum under documented extenuating circumstances.',
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['HUD-4000.1#II.A.5.b.iii'],
    },
    citation: {
      sourceUrl: `${FHA_SOURCE_BASE}#II.A.5.b.iii.DIL`,
      excerpt:
        'A Borrower is generally not eligible for a new FHA-insured Mortgage if the Borrower had a deed-in-lieu of foreclosure in the 3-year period prior to the date of case number assignment.',
    },
  },

  // ----- SHORT_SALE -----
  // FHA HUD 4000.1 §II.A.5.b.v: 36-month base / 12-month EC. Anchor:
  // SALE_CONFIRMATION date (per Pitfall 1.3 — short-sale anchor differs from
  // foreclosure / DIL completion anchor).
  {
    versionLabel: FHA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'SHORT_SALE',
      measurement_anchor: 'SALE_CONFIRMATION',
      base_waiting_months: 36,
      extenuating_circumstances_waiting_months: 12,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text:
        'Per HUD 4000.1 §II.A.5.b.v: Borrower is generally not eligible for a new FHA-insured Mortgage if the Borrower had a pre-foreclosure sale (short sale) in the 3-year period prior to the date of case number assignment. Less than 3 years, but no fewer than 12 months, may be acceptable if caused by extenuating circumstances.',
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['HUD-4000.1#II.A.5.b.v'],
    },
    citation: {
      sourceUrl: `${FHA_SOURCE_BASE}#II.A.5.b.v.SHORT_SALE`,
      excerpt:
        'A Borrower is generally not eligible for a new FHA-insured Mortgage if the Borrower relinquished a property through a short sale in the 3-year period prior to the date of case number assignment.',
    },
  },

  // ----- MORTGAGE_CHARGE_OFF -----
  // FHA HUD 4000.1 §II.A.5.b.iii: 36-month base / 12-month EC. Anchor:
  // CHARGE_OFF_DATE (per Pitfall 1.3).
  {
    versionLabel: FHA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'MORTGAGE_CHARGE_OFF',
      measurement_anchor: 'CHARGE_OFF_DATE',
      base_waiting_months: 36,
      extenuating_circumstances_waiting_months: 12,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text:
        'Per HUD 4000.1 §II.A.5.b.iii: A mortgage charge-off is treated similarly to foreclosure. 36-month base seasoning from the charge-off date, with a 12-month minimum under documented extenuating circumstances.',
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['HUD-4000.1#II.A.5.b.iii.MORTGAGE_CHARGE_OFF'],
    },
    citation: {
      sourceUrl: `${FHA_SOURCE_BASE}#II.A.5.b.iii.MORTGAGE_CHARGE_OFF`,
      excerpt:
        'A mortgage charge-off in the 3-year period prior to the date of case number assignment generally disqualifies the Borrower from a new FHA-insured Mortgage. Less than 3 years, but no fewer than 12 months, may be acceptable under documented extenuating circumstances.',
    },
  },
];
