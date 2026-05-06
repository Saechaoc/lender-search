/**
 * lib/audit/snapshot-persistence.ts — RuleSnapshot bundle materialization
 * helpers (Phase 3 / Plan 03-01 Task 08 Delta 5 / REVIEWS.md A3a).
 *
 * Public surface:
 *   - captureCurrentBundle(client, tenantId): hydrates a CanonicalBundle
 *     from the live rule tables. Returns the SnapshotInput shape (used by
 *     snapshotId) PLUS the per-rule arrays needed for SC#1 deterministic
 *     replay. tenantId scopes program_version + program_rule +
 *     lender_overlay_rule to the requesting tenant; agency tables are
 *     system-owned and read across tenants by design.
 *   - persistSnapshot(client, bundle): materializes the bundle into
 *     rule_snapshot via INSERT ... ON CONFLICT (sha256_hash) DO UPDATE.
 *     Idempotent — same bundle → same id across runs.
 *   - loadSnapshot(client, hash): re-hydrates a CanonicalBundle from
 *     rule_snapshot.content_jsonb for SC#1 deterministic replay.
 *
 * Phase 4 evaluator's first scenario-replay test asserts the round-trip
 * property: persistSnapshot(content) → loadSnapshot(id) returns the
 * same bundle EVEN IF the live rule tables have been updated since.
 *
 * Per Pitfall PG-3: every recorded_at value is normalized to ISO 8601
 * strings (.toISOString()) before snapshotId() is invoked. The hash is
 * computed over the canonical SnapshotInput shape (sorted by id ASC).
 *
 * Plan 03 review BL-02: the prior implementation only captured (id,
 * recorded_at) pairs of agency_rule_version / program_version /
 * lender_overlay_rule. That broke SC#1: re-evaluating from content_jsonb
 * required JOINing back to live agency_rule / program_rule / etc. tables
 * to get rule bodies, which means an updated rule body produced a
 * different historical decision for the same evaluation_event. This
 * version captures full agency_rule / program_rule / lender_overlay_rule
 * rows so the evaluator can re-evaluate from the bundle alone.
 *
 * Plan 03 review BL-02 #1: the canonical bundle keys also drifted from
 * docs (agency_rule_versions/program_rules/lender_overlay_rules) to impl
 * (agency_versions/program_versions/overlay_versions). This version emits
 * the doc-shape keys.
 *
 * Plan 03 review BL-02 #3: every nested object passes through
 * sortKeysDeep before JSON.stringify, so future field additions cannot
 * silently invalidate previously-computed sha256 hashes via V8 iteration
 * order shifts.
 *
 * Plan 03 review BL-01: captureCurrentBundle now requires a tenantId.
 * Tenant-scoped tables (program_version, program_rule, lender_overlay_rule)
 * are filtered by tenant_id in SQL. agency_rule_version + agency_rule are
 * system-owned and captured cross-tenant by design. Rule_snapshot itself is
 * system_role-only readable (migration 0018) so a tenant cannot extract
 * another tenant's program-rule bodies via the snapshot bundle.
 */
import type { PoolClient } from 'pg';
import { snapshotId, type SnapshotInput } from './snapshotId.js';

/**
 * Full agency_rule_version row in the canonical bundle. Mirrors the on-disk
 * shape (system-owned; no tenant_id column).
 */
export interface BundleAgencyRuleVersion {
  id: string;
  agency: string;
  version_label: string;
  source_url: string | null;
  source_pdf_sha256: string | null;
  effective_period: string;
  recorded_at: string;
  superseded_by: string | null;
  state: string;
  sunset_date: string | null;
  deprecation_reason: string | null;
}

/**
 * Full agency_rule row (system-owned).
 */
export interface BundleAgencyRule {
  id: string;
  agency_rule_version_id: string;
  rule_kind: string;
  rule_body: unknown;
  field_confidence: unknown;
  primary_citation_id: string;
  created_at: string;
}

/**
 * Full program_version row (tenant-scoped). Captured for the requesting
 * tenant only.
 */
export interface BundleProgramVersion {
  id: string;
  tenant_id: string;
  program_id: string;
  agency_rule_version_id: string;
  conforming_loan_limit_version_id: string | null;
  effective_period: string;
  recorded_at: string;
  state: string;
  source_document_fingerprint: string;
}

/**
 * Full program_rule row (tenant-scoped).
 */
export interface BundleProgramRule {
  id: string;
  tenant_id: string;
  program_version_id: string;
  layer: string;
  rule_kind: string;
  rule_body: unknown;
  field_confidence: unknown;
  primary_citation_id: string;
  extraction_run_id: string | null;
  created_at: string;
}

/**
 * Full lender_overlay_rule row (tenant-scoped).
 */
export interface BundleLenderOverlayRule {
  id: string;
  tenant_id: string;
  applies_to_program_id: string | null;
  rule_kind: string;
  rule_body: unknown;
  field_confidence: unknown;
  primary_citation_id: string;
  created_at: string;
}

/**
 * The canonical bundle persisted into rule_snapshot.content_jsonb. The
 * key names mirror the migration 0015 header AND the schema doc comment
 * AND the SC#1 contract Phase 4 evaluator depends on. Per-rule arrays
 * are present so the evaluator can rehydrate without re-resolving through
 * live tables.
 */
export interface CanonicalBundle extends SnapshotInput {
  schema_version?: number;
  agencyRuleVersionRows: BundleAgencyRuleVersion[];
  agencyRuleRows: BundleAgencyRule[];
  programVersionRows: BundleProgramVersion[];
  programRuleRows: BundleProgramRule[];
  lenderOverlayRuleRows: BundleLenderOverlayRule[];
}

/**
 * Recursively sort object keys so JSON.stringify produces deterministic
 * output regardless of property-iteration-order quirks. Arrays are
 * preserved in their existing order — caller is responsible for sorting
 * arrays by a stable key (id ASC).
 *
 * Per BL-02 #3: future field additions to BundleAgencyRule / etc. cannot
 * silently invalidate previously-stored sha256 hashes because every nested
 * object goes through this sort.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return value;
}

function dateToIsoString(d: Date | string): string {
  if (typeof d === 'string') return d;
  return d.toISOString();
}

/**
 * Hydrate a CanonicalBundle from the live rule tables for `tenantId`.
 *
 * agency_rule_version + agency_rule are system-owned and captured across
 * all rows (no tenant filter required — they are not tenant-scoped). The
 * tenant-scoped tables (program_version, program_rule, lender_overlay_rule)
 * are filtered to rows whose tenant_id matches the requesting tenant.
 *
 * BL-01: previously this function had no tenant filter on program_version
 * + lender_overlay_rule, so the resulting bundle leaked references across
 * tenant boundaries when persisted into the world-readable rule_snapshot
 * table. Migration 0018 also tightens the read policy to system_role-only;
 * tenant-scoped rule snapshots will be wired by Phase 4 evaluator (one
 * snapshot per tenant per evaluation).
 */
export async function captureCurrentBundle(
  client: PoolClient,
  tenantId?: string,
): Promise<CanonicalBundle> {
  // System-owned tables: agency_rule_version + agency_rule. Capture all rows.
  const arvRows = await client.query<{
    id: string;
    agency: string;
    version_label: string;
    source_url: string | null;
    source_pdf_sha256: string | null;
    effective_period: string;
    recorded_at: Date;
    superseded_by: string | null;
    state: string;
    sunset_date: string | null;
    deprecation_reason: string | null;
  }>(
    `SELECT id::text, agency, version_label, source_url, source_pdf_sha256,
            effective_period::text AS effective_period, recorded_at,
            superseded_by::text AS superseded_by,
            state::text AS state,
            sunset_date::text AS sunset_date,
            deprecation_reason
     FROM agency_rule_version
     ORDER BY id ASC`,
  );
  const arRows = await client.query<{
    id: string;
    agency_rule_version_id: string;
    rule_kind: string;
    rule_body: unknown;
    field_confidence: unknown;
    primary_citation_id: string;
    created_at: Date;
  }>(
    `SELECT id::text, agency_rule_version_id::text, rule_kind::text,
            rule_body, field_confidence, primary_citation_id::text, created_at
     FROM agency_rule
     ORDER BY id ASC`,
  );

  // Tenant-scoped tables: empty when tenantId omitted (e.g. baseline-system
  // snapshot from pnpm db:seed where there is no single requesting tenant).
  // Phase 4 evaluator MUST pass tenantId so program-rule bodies are
  // captured for replay.
  const tenantArgs = tenantId ? [tenantId] : [];
  const tenantClause = tenantId ? 'WHERE tenant_id = $1' : 'WHERE FALSE';

  const pvRows = await client.query<{
    id: string;
    tenant_id: string;
    program_id: string;
    agency_rule_version_id: string;
    conforming_loan_limit_version_id: string | null;
    effective_period: string;
    recorded_at: Date;
    state: string;
    source_document_fingerprint: string;
  }>(
    `SELECT id::text, tenant_id::text, program_id::text,
            agency_rule_version_id::text,
            conforming_loan_limit_version_id::text AS conforming_loan_limit_version_id,
            effective_period::text AS effective_period,
            recorded_at, state, source_document_fingerprint
     FROM program_version ${tenantClause}
     ORDER BY id ASC`,
    tenantArgs,
  );
  const prRows = await client.query<{
    id: string;
    tenant_id: string;
    program_version_id: string;
    layer: string;
    rule_kind: string;
    rule_body: unknown;
    field_confidence: unknown;
    primary_citation_id: string;
    extraction_run_id: string | null;
    created_at: Date;
  }>(
    `SELECT id::text, tenant_id::text, program_version_id::text, layer::text,
            rule_kind::text, rule_body, field_confidence,
            primary_citation_id::text, extraction_run_id::text AS extraction_run_id,
            created_at
     FROM program_rule ${tenantClause}
     ORDER BY id ASC`,
    tenantArgs,
  );
  const lorRows = await client.query<{
    id: string;
    tenant_id: string;
    applies_to_program_id: string | null;
    rule_kind: string;
    rule_body: unknown;
    field_confidence: unknown;
    primary_citation_id: string;
    created_at: Date;
  }>(
    `SELECT id::text, tenant_id::text,
            applies_to_program_id::text AS applies_to_program_id,
            rule_kind::text, rule_body, field_confidence,
            primary_citation_id::text, created_at
     FROM lender_overlay_rule ${tenantClause}
     ORDER BY id ASC`,
    tenantArgs,
  );

  return {
    // Legacy SnapshotInput shape (id+recorded_at refs) preserved so callers
    // computing snapshotId(bundle) keep working.
    agencyVersions: arvRows.rows.map((r) => ({
      id: r.id,
      recorded_at: dateToIsoString(r.recorded_at),
    })),
    programVersions: pvRows.rows.map((r) => ({
      id: r.id,
      recorded_at: dateToIsoString(r.recorded_at),
    })),
    overlayVersions: lorRows.rows.map((r) => ({
      id: r.id,
      recorded_at: dateToIsoString(r.created_at),
    })),
    // BL-02: full per-rule rows for SC#1 deterministic replay.
    agencyRuleVersionRows: arvRows.rows.map((r) => ({
      id: r.id,
      agency: r.agency,
      version_label: r.version_label,
      source_url: r.source_url,
      source_pdf_sha256: r.source_pdf_sha256,
      effective_period: r.effective_period,
      recorded_at: dateToIsoString(r.recorded_at),
      superseded_by: r.superseded_by,
      state: r.state,
      sunset_date: r.sunset_date,
      deprecation_reason: r.deprecation_reason,
    })),
    agencyRuleRows: arRows.rows.map((r) => ({
      id: r.id,
      agency_rule_version_id: r.agency_rule_version_id,
      rule_kind: r.rule_kind,
      rule_body: r.rule_body,
      field_confidence: r.field_confidence,
      primary_citation_id: r.primary_citation_id,
      created_at: dateToIsoString(r.created_at),
    })),
    programVersionRows: pvRows.rows.map((r) => ({
      id: r.id,
      tenant_id: r.tenant_id,
      program_id: r.program_id,
      agency_rule_version_id: r.agency_rule_version_id,
      conforming_loan_limit_version_id: r.conforming_loan_limit_version_id,
      effective_period: r.effective_period,
      recorded_at: dateToIsoString(r.recorded_at),
      state: r.state,
      source_document_fingerprint: r.source_document_fingerprint,
    })),
    programRuleRows: prRows.rows.map((r) => ({
      id: r.id,
      tenant_id: r.tenant_id,
      program_version_id: r.program_version_id,
      layer: r.layer,
      rule_kind: r.rule_kind,
      rule_body: r.rule_body,
      field_confidence: r.field_confidence,
      primary_citation_id: r.primary_citation_id,
      extraction_run_id: r.extraction_run_id,
      created_at: dateToIsoString(r.created_at),
    })),
    lenderOverlayRuleRows: lorRows.rows.map((r) => ({
      id: r.id,
      tenant_id: r.tenant_id,
      applies_to_program_id: r.applies_to_program_id,
      rule_kind: r.rule_kind,
      rule_body: r.rule_body,
      field_confidence: r.field_confidence,
      primary_citation_id: r.primary_citation_id,
      created_at: dateToIsoString(r.created_at),
    })),
  };
}

/**
 * Build the canonical content_jsonb for the snapshot. The hash is computed
 * via snapshotId(bundle); the content_jsonb mirrors the bundle shape so
 * loadSnapshot can rehydrate WITHOUT joining live tables (SC#1 contract).
 *
 * BL-02 #1: keys match migration 0015 header
 *   agency_rule_versions[], agency_rules[], program_versions[],
 *   program_rules[], lender_overlay_rules[]
 *
 * BL-02 #3: sortKeysDeep applied to every row so V8 iteration order
 * cannot silently shift the hash when fields are added.
 */
function canonicalize(bundle: CanonicalBundle): Record<string, unknown> {
  const sorted = {
    schema_version: 2,
    agency_rule_versions: [...bundle.agencyRuleVersionRows]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => sortKeysDeep(r)),
    agency_rules: [...bundle.agencyRuleRows]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => sortKeysDeep(r)),
    program_versions: [...bundle.programVersionRows]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => sortKeysDeep(r)),
    program_rules: [...bundle.programRuleRows]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => sortKeysDeep(r)),
    lender_overlay_rules: [...bundle.lenderOverlayRuleRows]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => sortKeysDeep(r)),
  };
  return sorted;
}

/**
 * persistSnapshot — materialize a CanonicalBundle into rule_snapshot.
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
  bundle: CanonicalBundle,
): Promise<{ id: string; hash: string }> {
  const hash = snapshotId(bundle);
  const canonical = canonicalize(bundle);
  // BL-02 #3: stringify with the sorted-key form so output bytes are stable.
  const bodyJson = JSON.stringify(canonical);
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO rule_snapshot (sha256_hash, content_jsonb)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (sha256_hash) DO UPDATE SET sha256_hash = EXCLUDED.sha256_hash
     RETURNING id::text`,
    [hash, bodyJson],
  );
  return { id: rows[0]!.id, hash };
}

/**
 * loadSnapshot — re-hydrate a CanonicalBundle by sha256_hash. Phase 4
 * evaluator uses this for historical scenario replay (SC#1).
 *
 * Returns null when no row matches. The content_jsonb is parsed back into
 * the CanonicalBundle shape, including the per-rule arrays needed to
 * re-evaluate without reading live rule tables.
 */
export async function loadSnapshot(
  client: PoolClient,
  hash: string,
): Promise<CanonicalBundle | null> {
  const { rows } = await client.query<{
    content_jsonb: {
      schema_version?: number;
      agency_rule_versions?: BundleAgencyRuleVersion[];
      agency_rules?: BundleAgencyRule[];
      program_versions?: BundleProgramVersion[];
      program_rules?: BundleProgramRule[];
      lender_overlay_rules?: BundleLenderOverlayRule[];
    };
  }>(
    `SELECT content_jsonb FROM rule_snapshot WHERE sha256_hash = $1 LIMIT 1`,
    [hash],
  );
  if (!rows[0]) return null;
  const c = rows[0].content_jsonb;
  const agencyRuleVersionRows = c.agency_rule_versions ?? [];
  const agencyRuleRows = c.agency_rules ?? [];
  const programVersionRows = c.program_versions ?? [];
  const programRuleRows = c.program_rules ?? [];
  const lenderOverlayRuleRows = c.lender_overlay_rules ?? [];
  return {
    // Reconstruct legacy SnapshotInput refs so callers calling
    // snapshotId(loaded) recompute the same hash.
    agencyVersions: agencyRuleVersionRows.map((r) => ({
      id: r.id,
      recorded_at: r.recorded_at,
    })),
    programVersions: programVersionRows.map((r) => ({
      id: r.id,
      recorded_at: r.recorded_at,
    })),
    overlayVersions: lenderOverlayRuleRows.map((r) => ({
      id: r.id,
      recorded_at: r.created_at,
    })),
    schema_version: c.schema_version,
    agencyRuleVersionRows,
    agencyRuleRows,
    programVersionRows,
    programRuleRows,
    lenderOverlayRuleRows,
  };
}
