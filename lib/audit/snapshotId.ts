/**
 * snapshotId — deterministic content-addressed identifier for a hydrated
 * RuleSnapshot bundle (D-04 / Pattern P2 / AUD-04).
 *
 * Phase 3 / Phase 4 contract:
 *   - Phase 3 (this file): primitive only; tests/audit/snapshot-id.test.ts
 *     asserts the four-assertion determinism contract (A1/A2/A3/A4).
 *   - Phase 4: evaluator imports unchanged as the canonical writer of
 *     evaluation_event.ruleset_snapshot_id.
 *
 * Per Pitfall PG-3: `recorded_at` is `string` only. Caller normalizes
 * Date -> ISO 8601 with .toISOString(). Type-enforced.
 *
 * Returns 64-char lowercase hex sha256 (Claude's Discretion: hex over
 * base64url for grep-ability in audit log queries).
 */
import { createHash } from 'node:crypto';

export interface VersionRef {
  id: string;
  recorded_at: string;
}

export interface SnapshotInput {
  agencyVersions: VersionRef[];
  programVersions: VersionRef[];
  overlayVersions: VersionRef[];
}

export function snapshotId(input: SnapshotInput): string {
  const canonical = {
    agency_versions: [...input.agencyVersions]
      .map((v) => ({ id: v.id, recorded_at: v.recorded_at }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    program_versions: [...input.programVersions]
      .map((v) => ({ id: v.id, recorded_at: v.recorded_at }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    overlay_versions: [...input.overlayVersions]
      .map((v) => ({ id: v.id, recorded_at: v.recorded_at }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
