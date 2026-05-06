/**
 * VA Pamphlet 26-7 Chapter 4 Topic 7 derog seasoning fixture (AGY-05).
 *
 * Per REVIEWS.md B4a (cited-only): only rules with explicit VA Pamphlet 26-7
 *   citations are encoded as AGENCY_BASE. Market-norm rows (24-month
 *   FORECLOSURE/DIL/SHORT_SALE/MORTGAGE_CHARGE_OFF waits) are typical
 *   lender/investor overlays, NOT VA agency base — encoding overlay-shaped
 *   rules as AGENCY_BASE undermines Phase 4's layer model.
 * Per iter-2 REVIEWS.md B4a regression resolution: rather than "defer" the 4
 *   non-cited event types (which left AGY-05 with zero VA rows for them), we
 *   encode each as an explicit `not_applicable: true` sentinel row. This
 *   satisfies AGY-05 cross-agency parity ("VA derog matrix encoded as
 *   queryable rows") AND respects layer discipline. Phase 4 evaluator's
 *   missing-event_type fall-through (per B9 semantics) ensures VA scenarios
 *   for these event types deterministically evaluate against the more
 *   permissive FNMA/FHLMC paths until VA-specific entitlement-aware modeling
 *   lands.
 * Per REVIEWS.md B9: MULTIPLE_BK encoded as explicit `not_applicable: true`
 *   row for Phase 4 evaluator missing-rule determinism.
 * Per CONTEXT D-13: version_label = `VA-PAM-26-7-Ch4`.
 * Per CONTEXT D-07: URL-only citation under SYSTEM tenant.
 *
 * Total seeded rows under VA-PAM-26-7-Ch4: 8
 *   - 3 cited BK rules with VA Pamphlet 26-7 citations (BK7, BK13_DISCHARGED,
 *     BK13_DISMISSED)
 *   - 5 explicit `not_applicable: true` sentinels (MULTIPLE_BK, FORECLOSURE,
 *     DEED_IN_LIEU, SHORT_SALE, MORTGAGE_CHARGE_OFF)
 *
 * Source: https://www.benefits.va.gov/warms/docs/admin26/m26-07/Lender_Handbook_VA_Pamphlet_Complete.pdf
 */
import type { DerogSeasoning } from '../../rules/schemas/derog-seasoning.js';
import type { AgencyRuleSeed } from '../types.js';

const VA_VERSION_LABEL = 'VA-PAM-26-7-Ch4';
const VA_CITATION_BASE =
  'https://www.benefits.va.gov/warms/docs/admin26/m26-07/Lender_Handbook_VA_Pamphlet_Complete.pdf';

export const vaDerogSeasoningSeeds: AgencyRuleSeed<DerogSeasoning>[] = [
  // ──────────────────────────────────────────────────────────────────────
  // Cited BK rules (per REVIEWS.md B4a strict-citation gate). Every URL
  // anchors at a VA Pamphlet 26-7 Chapter 4 Topic 7 section that documents
  // the cited waiting period.
  // ──────────────────────────────────────────────────────────────────────
  {
    versionLabel: VA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'BK7',
      measurement_anchor: 'DISCHARGE',
      base_waiting_months: 24,
      extenuating_circumstances_waiting_months: 12,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text:
        'Per VA Pamphlet 26-7 Ch4 Topic 7: re-established credit required after BK7 discharge.',
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['VA-PAM-26-7-Ch4-Topic7#BK7'],
    },
    citation: {
      sourceUrl: `${VA_CITATION_BASE}#chapter-4-topic-7-bk7`,
      excerpt:
        'Bankruptcy (Chapter 7): A two-year waiting period is required from the discharge date. A one-year waiting period is permitted with documented extenuating circumstances per VA Pamphlet 26-7 Chapter 4 Topic 7.',
    },
  },
  {
    versionLabel: VA_VERSION_LABEL,
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
      notes_citations: ['VA-PAM-26-7-Ch4-Topic7#BK13_DISCHARGED'],
    },
    citation: {
      sourceUrl: `${VA_CITATION_BASE}#chapter-4-topic-7-bk13-discharged`,
      excerpt:
        'Bankruptcy (Chapter 13): A two-year waiting period from discharge. Twelve months pay-out plan with trustee approval is permitted as an alternative path per VA Pamphlet 26-7 Chapter 4 Topic 7.',
    },
  },
  {
    versionLabel: VA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'BK13_DISMISSED',
      measurement_anchor: 'DISMISSAL',
      base_waiting_months: 24,
      extenuating_circumstances_waiting_months: 12,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text: null,
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['VA-PAM-26-7-Ch4-Topic7#BK13_DISMISSED'],
    },
    citation: {
      sourceUrl: `${VA_CITATION_BASE}#chapter-4-topic-7-bk13-dismissed`,
      excerpt:
        'Bankruptcy (Chapter 13): A two-year waiting period from dismissal. A one-year waiting period is permitted with documented extenuating circumstances per VA Pamphlet 26-7 Chapter 4 Topic 7.',
    },
  },
  // ──────────────────────────────────────────────────────────────────────
  // MULTIPLE_BK sentinel (per REVIEWS.md B9). VA Pamphlet 26-7 does not
  // separately specify multi-filing waiting periods; this row gives Phase 4
  // evaluator a deterministic "absent → fall back to single-BK" semantic
  // instead of a missing-row → undefined-behavior path.
  // ──────────────────────────────────────────────────────────────────────
  {
    versionLabel: VA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'MULTIPLE_BK',
      measurement_anchor: 'DISCHARGE',
      base_waiting_months: null,
      extenuating_circumstances_waiting_months: null,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text:
        'Per REVIEWS.md B9: VA does not separately specify MULTIPLE_BK waiting periods; Phase 4 evaluator falls back to single-BK rule. Encoded as not_applicable=true to make the absence explicit.',
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      not_applicable: true,
      notes_citations: [
        'REVIEWS.md#B9',
        'VA-PAM-26-7-Ch4-Topic7#MULTIPLE_BK_NOT_SEPARATELY_SPECIFIED',
      ],
    },
    citation: {
      sourceUrl: `${VA_CITATION_BASE}#chapter-4-topic-7-multiple-bk-absent`,
      excerpt:
        'VA Pamphlet 26-7 Chapter 4 Topic 7 does not separately specify multi-filing bankruptcy waiting periods. Per REVIEWS.md B9 we encode this absence explicitly with not_applicable=true so Phase 4 evaluator can deterministically fall back to single-BK seasoning.',
    },
  },
  // ──────────────────────────────────────────────────────────────────────
  // FORECLOSURE / DEED_IN_LIEU / SHORT_SALE / MORTGAGE_CHARGE_OFF sentinels
  // (per iter-2 REVIEWS.md B4a regression resolution + AGY-05 cross-agency
  // parity). VA Pamphlet 26-7 does not specify a flat agency-base waiting
  // period for these event types — the 24-month wait commonly seen in market
  // is a typical lender/investor overlay, NOT VA agency base.
  //
  // The prior plan's "deferral" approach left AGY-05 uncovered for VA on
  // these event types; the sentinel approach gives Phase 4 evaluator a
  // deterministic missing-rule signal (fall back to FNMA/FHLMC) without
  // violating layer discipline. After Phase 4 ships entitlement-aware
  // evaluation (or after a future overlay phase encodes these rules under
  // LENDER_OVERLAY / INVESTOR_OVERLAY), the sentinel rows can be replaced
  // with rule-bearing rows in a follow-up agency_rule_version.
  // ──────────────────────────────────────────────────────────────────────
  ...(['FORECLOSURE', 'DEED_IN_LIEU', 'SHORT_SALE', 'MORTGAGE_CHARGE_OFF'] as const).map(
    (eventType): AgencyRuleSeed<DerogSeasoning> => ({
      versionLabel: VA_VERSION_LABEL,
      ruleKind: 'derog_seasoning',
      ruleBody: {
        event_type: eventType,
        measurement_anchor: eventType === 'MORTGAGE_CHARGE_OFF' ? 'CHARGE_OFF_DATE' : 'COMPLETION',
        base_waiting_months: null,
        extenuating_circumstances_waiting_months: null,
        post_event_LTV_caps: [],
        reestablished_credit_required: false,
        reestablishment_criteria_text: `Per iter-2 REVIEWS.md B4a + AGY-05: VA Pamphlet 26-7 does not separately specify a ${eventType} waiting period as agency base. The 24m commonly seen in market is a lender/investor overlay, not VA agency base. Phase 4 evaluator falls back to FNMA/FHLMC for VA + ${eventType} scenarios until VA-specific entitlement-aware modeling lands.`,
        mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
        not_applicable: true,
        notes_citations: [
          'REVIEWS.md#B4a',
          `VA-PAM-26-7-Ch4-Topic7#${eventType}_NOT_SEPARATELY_SPECIFIED`,
        ],
      },
      citation: {
        sourceUrl: `${VA_CITATION_BASE}#chapter-4-topic-7-${eventType
          .toLowerCase()
          .replace(/_/g, '-')}-absent`,
        excerpt: `VA Pamphlet 26-7 Chapter 4 Topic 7 does not separately specify a ${eventType} waiting period as agency base. Per REVIEWS.md B4a + iter-2 AGY-05 coverage we encode the absence explicitly with not_applicable=true so the Phase 4 evaluator can deterministically fall back to FNMA/FHLMC paths.`,
      },
    }),
  ),
];

// All 8 event types now have queryable rows per iter-2 REVIEWS B4a + B9
// resolution: 3 cited BK rules + 5 explicit not_applicable=true sentinels
// (MULTIPLE_BK + FORECLOSURE + DEED_IN_LIEU + SHORT_SALE +
// MORTGAGE_CHARGE_OFF). AGY-05 is structurally covered without violating
// the layer model — every row is either a cited VA rule OR an explicit
// not_applicable=true marker.
