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
 * Plan 03 review WR-09: two cross-engine determinism guards.
 *   1. Top-level object keys go through JSON.stringify with the keys
 *      replacer-array sorted alphabetically. ES2015 fixes string-key
 *      iteration order (insertion order) on V8, but the language spec is
 *      "implementation-defined" in some traversal edge cases — passing the
 *      sorted key list as the second arg to JSON.stringify locks the
 *      output regardless of engine. The array elements are already sorted
 *      by id and contain only the two-key shape {id, recorded_at} that we
 *      control, so engine-specific iteration of those inner objects
 *      cannot move.
 *   2. Reject any recorded_at that does not match the strict ISO 8601
 *      shape `YYYY-MM-DDTHH:mm:ss.sssZ`. `new Date().toISOString()` always
 *      emits this exact form; hand-built strings missing millis (e.g.
 *      `2026-05-01T00:00:00Z`) would otherwise produce a different hash
 *      for the same logical timestamp. Reject at the boundary so the
 *      "same logical bundle → same hash" property holds for every caller.
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
  // 260506-al0 / Option B: tenantId is now part of the canonical hash input.
  // Tenant-scoped UUIDs in programVersionRows / overlayVersions already make
  // collisions structurally impossible by-construction (UUID v4 namespace
  // separation). Mixing tenantId at the schema level is the explicit
  // guarantee that survives any future regression — if a code path ever
  // forgot to filter by tenant_id, this layer still hashes differently for
  // bundles from different tenants, so an evaluation_event row referencing
  // a hash from another tenant cannot collide with our own.
  tenantId: string;
  agencyVersions: VersionRef[];
  programVersions: VersionRef[];
  overlayVersions: VersionRef[];
}

// WR-09 #2: lock the ISO 8601 with-millis shape. `new Date().toISOString()`
// always emits this form, so well-behaved callers keep passing.
const ISO_8601_MS_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function assertIso8601(label: string, value: string): void {
  if (!ISO_8601_MS_REGEX.test(value)) {
    throw new Error(
      `snapshotId: ${label}.recorded_at must match YYYY-MM-DDTHH:mm:ss.sssZ; got ${JSON.stringify(value)}`,
    );
  }
}

export function snapshotId(input: SnapshotInput): string {
  // WR-09 #2: reject malformed recorded_at strings up front so the hash
  // contract ("same logical bundle → same hash") survives hand-built inputs.
  for (const v of input.agencyVersions) assertIso8601('agencyVersions', v.recorded_at);
  for (const v of input.programVersions) assertIso8601('programVersions', v.recorded_at);
  for (const v of input.overlayVersions) assertIso8601('overlayVersions', v.recorded_at);

  const canonical = {
    // 260506-al0 / Option B: tenant_id is mixed into the canonical hash
    // input alongside the version-ref arrays. Sister-tenant bundles whose
    // bodies happened to be byte-identical at the version-ref layer (e.g.
    // both empty, both pointing at the same system-owned agency refs)
    // would otherwise collide on hash. Mixing tenantId at this layer is
    // the structural guarantee that an evaluation_event row referencing
    // a hash from another tenant cannot match our own.
    tenant_id: input.tenantId,
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
  // WR-09 #1: top-level keys sorted alphabetically via JSON.stringify
  // replacer-array form so output is independent of engine iteration order.
  // The replacer-array also locks the inner object keys ('id', 'recorded_at')
  // when JSON.stringify recurses. Listing every key the canonical shape can
  // contain is required because the replacer is applied uniformly at every
  // depth of the tree.
  // 260506-al0: 'tenant_id' added to the emit set so the new canonical key
  // actually serializes through the replacer.
  const keysToEmit = ['agency_versions', 'id', 'overlay_versions', 'program_versions', 'recorded_at', 'tenant_id'];
  return createHash('sha256').update(JSON.stringify(canonical, keysToEmit)).digest('hex');
}
