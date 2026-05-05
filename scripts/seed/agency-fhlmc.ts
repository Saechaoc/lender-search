/**
 * scripts/seed/agency-fhlmc.ts — FHLMC contributor (B1a per-agency registry pattern).
 *
 * Per REVIEWS.md B1a: each agency owns its own contributor file; the central
 *   scripts/seed-agency.ts (Plan 03-01) imports + dispatches them via
 *   scripts/seed/index.ts. Plans 03-02..03-05 ship in parallel without
 *   editing the same shared aggregator file.
 *
 * Plan 03-01 published the seedAgencyVersionAndRules helper. This file
 *   consumes it by exporting a single async function that the aggregator
 *   invokes after seedFnma.
 *
 * Plan 03-03 swaps Plan 03-01's no-op stub body with this real seed call.
 */
import { fhlmcDerogSeasoningSeeds } from '../../lib/agency-seeds/fhlmc/derog-seasoning.js';
import { seedAgencyVersionAndRules } from '../seed-agency.js';

export async function seedFhlmc(): Promise<void> {
  await seedAgencyVersionAndRules({
    agency: 'FHLMC',
    versionLabel: 'FHLMC-SSG-2026-Q1',
    effectivePeriod: '[2026-01-01,infinity)',
    sourceUrl: 'https://guide.freddiemac.com/app/guide/section/5202.5',
    seeds: fhlmcDerogSeasoningSeeds,
  });
}
