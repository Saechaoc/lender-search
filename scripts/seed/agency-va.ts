/**
 * scripts/seed/agency-va.ts — VA contributor (B1a per-agency registry pattern).
 *
 * Phase 3 Wave 0 (Plan 03-01) shipped this file as a no-op stub so the
 * aggregator import resolved. Phase 3 Wave 1 (Plan 03-05) replaces the body
 * with the real VA Pamphlet 26-7 Chapter 4 Topic 7 seed call.
 *
 * Per REVIEWS.md B1a: this plan introduces ZERO edits to shared
 *   `scripts/seed-agency.ts` or `scripts/seed/index.ts` — only this
 *   per-agency contributor's body changes. Wave 1 sibling plans
 *   (03-02/03/04) own their own contributors and run in parallel.
 *
 * Per CONTEXT D-13: version_label = `VA-PAM-26-7-Ch4`,
 *   effective_period = `[2026-01-01,infinity)`.
 *
 * Post-seed: 1 VA agency_rule_version row + 8 child agency_rule rows
 *   (3 cited BK rules + 5 not_applicable=true sentinels per iter-2 REVIEWS
 *   B4a + B9).
 */
import { vaDerogSeasoningSeeds } from '../../lib/agency-seeds/va/derog-seasoning.js';
import { seedAgencyVersionAndRules } from '../seed-agency.js';

export async function seedVa(): Promise<void> {
  await seedAgencyVersionAndRules({
    agency: 'VA',
    versionLabel: 'VA-PAM-26-7-Ch4',
    effectivePeriod: '[2026-01-01,infinity)',
    sourceUrl:
      'https://www.benefits.va.gov/warms/docs/admin26/m26-07/Lender_Handbook_VA_Pamphlet_Complete.pdf',
    seeds: vaDerogSeasoningSeeds,
  });
}
