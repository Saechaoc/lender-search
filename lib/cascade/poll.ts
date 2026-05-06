/**
 * pollAgencyPublications — Phase 3 stub; Phase 6 implements (D-17 / AGY-07).
 *
 * Phase 3 / Phase 6 contract:
 *   - Phase 3 (this file): typed handler stub returning empty array.
 *     Integration test at tests/cascade/cascade-trigger.test.ts (Plan 03-08)
 *     exercises the consumer side (the trigger fan-out) — Phase 3 ships
 *     the producer signature only.
 *   - Phase 6: lands real HTTP fetch + sha256-diff + Vercel Cron wiring
 *     (CFG-01) + Inngest worker pool consumer (CFG-04) reading
 *     cascade_review_queue with SKIP LOCKED.
 */
export interface PollResult {
  agency: 'FNMA' | 'FHLMC' | 'FHA' | 'VA' | 'USDA';
  versionLabel: string;
  sourceUrl: string;
  sourcePdfSha256: string | null;
  changeDetected: boolean;
}

export async function pollAgencyPublications(): Promise<PollResult[]> {
  return [];
}
