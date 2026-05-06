/**
 * scripts/seed/agency-fha.ts — FHA contributor (B1a per-agency registry pattern).
 *
 * Phase 3 / Plan 03-04 / SC#4 / AGY-04.
 *
 * Two seed calls: active HUD 4000.1 + Back-to-Work DEPRECATED. Plan 03-01
 *   shipped this file as a no-op stub so Wave 0 typecheck/db:seed succeeded;
 *   Plan 03-04 swaps in the real body (REVIEWS.md B1a regression fix iter-2).
 *
 * The DEPRECATED row carries explicit `state='DEPRECATED'` /
 *   `sunset_date='2016-09-30'` / `deprecation_reason` columns per REVIEWS.md
 *   B8a. Plan 03-01 migration 0013 added the columns + enum; the loader's
 *   SeedAgencyVersionInput threads these into the `agency_rule_version`
 *   INSERT.
 *
 * The DEPRECATED `effective_period='[2013-08-15,2016-09-30)'` does not
 *   overlap the active `[2026-01-01,infinity)` period, so the
 *   agency_rule_version_no_overlap EXCLUDE constraint (migration 0004)
 *   does not fire. Phase 4 evaluator filters on `state='ACTIVE' AND
 *   effective_period @> CURRENT_DATE` so the DEPRECATED row is queryable
 *   for historical-scenario replay but never fires for active eligibility
 *   decisions.
 *
 * Citation URLs:
 *   - Active: https://www.hud.gov/sites/dfiles/SFH/documents/4000.1hsgh.pdf
 *   - Deprecated: https://www.hud.gov/sites/documents/13-26ml.pdf
 *     (HUD ML 2013-26 — the document that LAUNCHED Back-to-Work AND defined
 *     its sunset date 2016-09-30; per REVIEWS.md B3 this is the correct
 *     citation, NOT ML 2016-14 which is a loss-mitigation servicing letter).
 */
import { fhaDerogSeasoningSeeds } from '../../lib/agency-seeds/fha/derog-seasoning.js';
import { fhaBackToWorkDeprecatedSeeds } from '../../lib/agency-seeds/fha/back-to-work-deprecated.js';
import { seedAgencyVersionAndRules } from '../seed-agency.js';

export async function seedFha(): Promise<void> {
  // FHA HUD 4000.1 active.
  await seedAgencyVersionAndRules({
    agency: 'FHA',
    versionLabel: 'HUD-4000.1-2024-08',
    effectivePeriod: '[2026-01-01,infinity)',
    state: 'ACTIVE',
    sunsetDate: null,
    deprecationReason: null,
    sourceUrl: 'https://www.hud.gov/sites/dfiles/SFH/documents/4000.1hsgh.pdf',
    seeds: fhaDerogSeasoningSeeds,
  });

  // FHA Back-to-Work DEPRECATED (REVIEWS.md B3 + B8a + Phase 3 SC#4).
  // state='DEPRECATED', sunset_date='2016-09-30', deprecation_reason cites ML 2013-26.
  await seedAgencyVersionAndRules({
    agency: 'FHA',
    versionLabel: 'HUD-4000.1-BTW-DEPRECATED',
    effectivePeriod: '[2013-08-15,2016-09-30)',
    state: 'DEPRECATED',
    sunsetDate: '2016-09-30',
    deprecationReason: 'Effective through 2016-09-30 per HUD Mortgagee Letter 2013-26',
    sourceUrl: 'https://www.hud.gov/sites/documents/13-26ml.pdf',
    seeds: fhaBackToWorkDeprecatedSeeds,
  });
}
