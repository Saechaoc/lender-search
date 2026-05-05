/**
 * FHA Back-to-Work DEPRECATED seed (Phase 3 SC#4 / AGY-04 / D-11 / Pitfall 1.4 / Pattern P5).
 *
 * Per REVIEWS.md B3: Back-to-Work was retired by HUD Mortgagee Letter 2013-26's
 *   own "effective through September 30, 2016" clause. ML 2016-14 is a
 *   LOSS-MITIGATION servicing letter, not the Back-to-Work termination — the
 *   prior plan's citation was wrong. The citation URL points at HUD ML 2013-26
 *   (the document that LAUNCHED Back-to-Work AND defined its sunset date) so a
 *   single source text can support both the rule body AND the deprecation
 *   reason on the parent agency_rule_version row.
 * Per REVIEWS.md B8a: the agency_rule_version row carries explicit
 *   `state='DEPRECATED'`, `sunset_date='2016-09-30'`, and `deprecation_reason`
 *   columns (Plan 03-01 migration 0013 added the columns + enum). Phase 4
 *   evaluator filters on `state='ACTIVE' AND effective_period @> CURRENT_DATE`
 *   so this row exists for historical-scenario replay but never fires for
 *   active eligibility decisions.
 *
 * Citation source: HUD Mortgagee Letter 2013-26.
 *   https://www.hud.gov/sites/documents/13-26ml.pdf
 *
 * Companion file: lib/agency-seeds/fha/derog-seasoning.ts (active HUD 4000.1
 *   matrix). Both seeds are wired through scripts/seed/agency-fha.ts.
 */
import type { DerogSeasoning } from '../../rules/schemas/derog-seasoning.js';
import type { AgencyRuleSeed } from '../types.js';

const FHA_BTW_VERSION_LABEL = 'HUD-4000.1-BTW-DEPRECATED';
const FHA_BTW_CITATION_URL = 'https://www.hud.gov/sites/documents/13-26ml.pdf';

export const fhaBackToWorkDeprecatedSeeds: AgencyRuleSeed<DerogSeasoning>[] = [
  {
    versionLabel: FHA_BTW_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'FORECLOSURE',
      measurement_anchor: 'COMPLETION',
      base_waiting_months: 12,
      extenuating_circumstances_waiting_months: null,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text:
        'Per HUD ML 2013-26 (the document that LAUNCHED Back-to-Work AND defined its sunset date 2016-09-30): borrower must demonstrate Economic Event causing 20% income reduction OR job loss for 6+ months, complete HUD-approved housing counseling, and re-establish 12 months satisfactory credit.',
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['ML-2013-26'],
    },
    citation: {
      sourceUrl: FHA_BTW_CITATION_URL,
      excerpt:
        'Mortgagee Letter 2013-26 (Back to Work — Extenuating Circumstances): The provisions of this Mortgagee Letter are effective for case numbers assigned on or after August 15, 2013, through September 30, 2016. After September 30, 2016, the Back to Work program is no longer available.',
    },
  },
];
