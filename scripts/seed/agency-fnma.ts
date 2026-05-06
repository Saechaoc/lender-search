/**
 * scripts/seed/agency-fnma.ts — FNMA contributor (B1a per-agency registry pattern).
 *
 * Per REVIEWS.md B1a: each agency owns its own contributor file; the central
 *   scripts/seed-agency.ts (Plan 03-01) imports + dispatches them. Plans
 *   03-02..03-05 ship in parallel without editing the same file.
 *
 * Plan 03-01 publishes the SeedDispatcher type and the seedAgencyVersionAndRules
 *   helper. This file consumes them by exporting a single async function that
 *   the aggregator invokes.
 *
 * Plan 03-02 swaps the Wave 0 stub body for the real seed call: pulls the
 *   9-row FNMA B3-5.3-07 derog matrix from lib/agency-seeds/fnma/derog-seasoning.ts
 *   (B2 split: FORECLOSURE encoded as 2 rows for purchase+primary AND limited-
 *   cash-out+all-occupancies) and registers them under FNMA-SEL-2026-04 with
 *   effective_period [2026-01-01,infinity).
 */
import { fnmaDerogSeasoningSeeds } from '../../lib/agency-seeds/fnma/derog-seasoning.js';
import { seedAgencyVersionAndRules } from '../seed-agency.js';

export async function seedFnma(): Promise<void> {
  await seedAgencyVersionAndRules({
    agency: 'FNMA',
    versionLabel: 'FNMA-SEL-2026-04',
    effectivePeriod: '[2026-01-01,infinity)',
    sourceUrl: 'https://selling-guide.fanniemae.com/sel/b3-5.3-07/',
    seeds: fnmaDerogSeasoningSeeds,
  });
}
