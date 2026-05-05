/**
 * scripts/seed/index.ts — Phase 3 seed aggregator (B1a fix from REVIEWS.md
 * iter-2).
 *
 * The aggregator dispatches each per-agency contributor in turn, then runs
 * the USDA inline stub + FHFA loader + (Task 08 Delta 5 / A3a) writes a
 * baseline rule_snapshot for SC#1 deterministic-replay round-trip proof.
 *
 * Wave 0 (Plan 03-01) ships the stub contributors at scripts/seed/agency-*.ts.
 * Wave 1 plans 03-02..03-05 swap each stub body with the real seed call.
 * Wave 2 (Plan 03-07) wires the FHFA seedFhfaYear() body.
 *
 * This file is the entrypoint for `pnpm db:seed` (package.json scripts).
 *
 * Per CONTEXT D-12: USDA is always seeded (one row only) so pnpm db:seed
 * always produces deterministic state regardless of Wave 1 progress.
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

  // Task 08 Delta 5 / REVIEWS.md A3a: write baseline rule_snapshot for SC#1
  // deterministic-replay round-trip proof. The migration 0015 + the
  // persistSnapshot helper land in Task 08; this call site is the
  // forward-compat seam. Until Task 08, the call path is wired but takes the
  // empty-bundle path (zero ARVs) so the function exits cleanly.
  try {
    const { captureCurrentBundle, persistSnapshot } = await import('../../lib/audit/snapshot-persistence.js');
    const adminClient = await pool.connect();
    try {
      const baselineBundle = await captureCurrentBundle(adminClient);
      const { id, hash } = await persistSnapshot(adminClient, baselineBundle);
      console.log(`Baseline rule_snapshot persisted: id=${id}, hash=${hash}`);
    } finally {
      adminClient.release();
    }
  } catch (err) {
    // Wave 0 / Task 04 has not yet shipped 0015_rule_snapshot.sql.
    // Task 08 Delta 5 lands the migration AND the snapshot-persistence helper.
    // Until both are present, log but do not fail the seed.
    const msg = (err as Error).message ?? String(err);
    if (msg.includes('snapshot-persistence') || msg.includes('rule_snapshot')) {
      console.log('rule_snapshot infrastructure not yet present (pre-Task 08); skipping baseline snapshot.');
    } else {
      throw err;
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error('seed-agency failed:', err);
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  pool.end();
  process.exit(1);
});
