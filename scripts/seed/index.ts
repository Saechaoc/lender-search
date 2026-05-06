/**
 * scripts/seed/index.ts — Phase 3 seed aggregator (B1a fix from REVIEWS.md
 * iter-2).
 *
 * The aggregator dispatches each per-agency contributor in turn, then runs
 * the USDA inline stub + FHFA loader. Wave 0 (Plan 03-01) ships the stub
 * contributors at scripts/seed/agency-*.ts. Wave 1 plans 03-02..03-05 swap
 * each stub body with the real seed call. Wave 2 (Plan 03-07) wires the
 * FHFA seedFhfaYear() body.
 *
 * This file is the entrypoint for `pnpm db:seed` (package.json scripts).
 *
 * Per CONTEXT D-12: USDA is always seeded (one row only) so pnpm db:seed
 * always produces deterministic state regardless of Wave 1 progress.
 *
 * 260506-al0 (Option B): the seed no longer writes a baseline rule_snapshot.
 * rule_snapshot is now per-tenant scoped (migration 0022); "baseline-system
 * snapshot with no tenant" no longer has a coherent owner. Phase 4 evaluator
 * persists per-evaluation snapshots inline at request time. See
 * .planning/quick/260506-al0-fix-p1-cross-tenant-rule-snapshot-leak-p/deferred-items.md.
 */
import { join } from 'node:path';
import { pool, seedAgencyVersionAndRules, seedFhfaYear } from '../seed-agency.js';
import { seedFnma } from './agency-fnma.js';
import { seedFhlmc } from './agency-fhlmc.js';
import { seedFha } from './agency-fha.js';
import { seedVa } from './agency-va.js';

async function main(): Promise<void> {
  // Wave 1 plans 03-02..03-05 swap stub bodies with real seed code.
  await seedFnma();
  await seedFhlmc();
  await seedFha();
  await seedVa();

  // D-12: USDA stub (always seeded; one row only).
  await seedAgencyVersionAndRules({
    agency: 'USDA',
    versionLabel: 'USDA-SFH-7-CFR-3555',
    effectivePeriod: '[2026-01-01,infinity)',
    sourceUrl: 'https://www.rd.usda.gov/programs-services/single-family-housing-programs',
    seeds: [],
  });

  // FHFA loan limits — Plan 03-07 wires the real CSV path; Wave 0 stub no-ops.
  const csvPath = join(process.cwd(), 'lib', 'agency-seeds', 'fhfa', '2026-conforming-limit-values-by-county.csv');
  await seedFhfaYear(2026, csvPath);

  await pool.end();
}

// Plan 03 review WR-05: previously pool.end() was called as a floating
// promise immediately followed by process.exit(1). On Node 18+ that closes
// pg sockets mid-flight before they drain, leaving server-side transactions
// hanging until Postgres detects the abrupt disconnect. Awaiting the pool
// close lets pg flush its outstanding queries cleanly. Wrap in try/catch so
// a pool.end failure cannot mask the original seed failure.
main().catch(async (err) => {
  console.error('seed-agency failed:', err);
  try {
    await pool.end();
  } catch (closeErr) {
    console.error('pool close also failed:', closeErr);
  }
  process.exit(1);
});
