/**
 * lib/audit/snapshot-persistence.ts — RuleSnapshot bundle materialization
 * helpers (Phase 3 / Plan 03-01 Task 08 Delta 5 / REVIEWS.md A3a).
 *
 * Public surface:
 *   - captureCurrentBundle(client): hydrates a SnapshotInput-compatible
 *     bundle from the live rule tables. Returns the canonical
 *     SnapshotInput shape that snapshotId() consumes.
 *   - persistSnapshot(client, bundle): materializes the bundle into
 *     rule_snapshot via INSERT ... ON CONFLICT (sha256_hash) DO UPDATE.
 *     Idempotent — same bundle → same id across runs.
 *   - loadSnapshot(client, hash): re-hydrates a bundle from
 *     rule_snapshot.content_jsonb for SC#1 deterministic replay.
 *
 * Phase 4 evaluator's first scenario-replay test asserts the round-trip
 * property: persistSnapshot(content) → loadSnapshot(id) returns the
 * same bundle.
 *
 * Per Pitfall PG-3: every recorded_at value is normalized to ISO 8601
 * strings (.toISOString()) before snapshotId() is invoked. The hash is
 * computed over the canonical SnapshotInput shape (sorted by id ASC).
 */
import type { PoolClient } from 'pg';
import { snapshotId, type SnapshotInput } from './snapshotId.js';

/**
 * Hydrate a SnapshotInput from the live rule tables. The Wave 0 form
 * captures only agency_rule_version + program_version + lender_overlay_rule
 * id+recorded_at refs (the SnapshotInput shape). Phase 4 evaluator extends
 * this to capture full row contents into rule_snapshot.content_jsonb.
 *
 * The Wave 0 capture is the minimum needed to compute snapshotId. The
 * persistSnapshot function is responsible for serializing the broader
 * canonical bundle (full row arrays per the migration 0015 header).
 */
export async function captureCurrentBundle(client: PoolClient): Promise<SnapshotInput> {
  const arvs = await client.query<{ id: string; recorded_at: Date }>(
    `SELECT id::text, recorded_at FROM agency_rule_version ORDER BY id ASC`,
  );
  const pvs = await client.query<{ id: string; recorded_at: Date }>(
    `SELECT id::text, recorded_at FROM program_version ORDER BY id ASC`,
  );
  const lors = await client.query<{ id: string; created_at: Date }>(
    `SELECT id::text, created_at FROM lender_overlay_rule ORDER BY id ASC`,
  );
  return {
    agencyVersions: arvs.rows.map((r) => ({ id: r.id, recorded_at: r.recorded_at.toISOString() })),
    programVersions: pvs.rows.map((r) => ({ id: r.id, recorded_at: r.recorded_at.toISOString() })),
    overlayVersions: lors.rows.map((r) => ({ id: r.id, recorded_at: r.created_at.toISOString() })),
  };
}

/**
 * Build the canonical content jsonb for the snapshot. The hash is computed
 * via snapshotId(bundle); the content_jsonb mirrors the bundle shape so
 * loadSnapshot can rehydrate without joining live tables. Phase 4 evaluator
 * extends content_jsonb to carry full agency_rule / program_rule rows.
 */
function canonicalize(bundle: SnapshotInput): Record<string, unknown> {
  return {
    schema_version: 1,
    agency_versions: [...bundle.agencyVersions]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((v) => ({ id: v.id, recorded_at: v.recorded_at })),
    program_versions: [...bundle.programVersions]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((v) => ({ id: v.id, recorded_at: v.recorded_at })),
    overlay_versions: [...bundle.overlayVersions]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((v) => ({ id: v.id, recorded_at: v.recorded_at })),
  };
}

/**
 * persistSnapshot — materialize a SnapshotInput bundle into rule_snapshot.
 * Idempotent via UNIQUE on sha256_hash. Returns the snapshot id + hash.
 *
 * Per REVIEWS.md A3a: this is the canonical write path Phase 4 evaluator
 *   uses immediately before writing evaluation_event so the round-trip
 *   replay path is actually exercised.
 *
 * The DO UPDATE clause is a no-op trick to make ON CONFLICT also return
 * the existing id; with DO NOTHING the returning clause produces zero
 * rows when the row already exists.
 */
export async function persistSnapshot(
  client: PoolClient,
  bundle: SnapshotInput,
): Promise<{ id: string; hash: string }> {
  const hash = snapshotId(bundle);
  const canonical = canonicalize(bundle);
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO rule_snapshot (sha256_hash, content_jsonb)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (sha256_hash) DO UPDATE SET sha256_hash = EXCLUDED.sha256_hash
     RETURNING id::text`,
    [hash, JSON.stringify(canonical)],
  );
  return { id: rows[0]!.id, hash };
}

/**
 * loadSnapshot — re-hydrate a SnapshotInput bundle by sha256_hash.
 * Phase 4 evaluator uses this for historical scenario replay (SC#1).
 *
 * Returns null when no row matches. The content_jsonb is parsed back into
 * SnapshotInput shape, dropping schema_version since callers don't need it.
 */
export async function loadSnapshot(
  client: PoolClient,
  hash: string,
): Promise<SnapshotInput | null> {
  const { rows } = await client.query<{ content_jsonb: { agency_versions?: Array<{ id: string; recorded_at: string }>; program_versions?: Array<{ id: string; recorded_at: string }>; overlay_versions?: Array<{ id: string; recorded_at: string }> } }>(
    `SELECT content_jsonb FROM rule_snapshot WHERE sha256_hash = $1 LIMIT 1`,
    [hash],
  );
  if (!rows[0]) return null;
  const content = rows[0].content_jsonb;
  return {
    agencyVersions: (content.agency_versions ?? []).map((v) => ({ id: v.id, recorded_at: v.recorded_at })),
    programVersions: (content.program_versions ?? []).map((v) => ({ id: v.id, recorded_at: v.recorded_at })),
    overlayVersions: (content.overlay_versions ?? []).map((v) => ({ id: v.id, recorded_at: v.recorded_at })),
  };
}
