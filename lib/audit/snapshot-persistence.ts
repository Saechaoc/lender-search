/**
 * lib/audit/snapshot-persistence.ts — RuleSnapshot bundle materialization
 * helpers (Phase 3 / Plan 03-01 Task 08 Delta 5 / REVIEWS.md A3a; tenant
 * scoping applied by quick task 260506-al0 / migration 0022).
 *
 * Public surface (all three REQUIRE tenantId — there is no system-wide
 * snapshot in Option B; rule_snapshot is per-tenant by schema):
 *   - captureCurrentBundle(client, tenantId): hydrates a CanonicalBundle
 *     from the live rule tables. tenant-scoped tables (program_version,
 *     program_rule, lender_overlay_rule) are filtered to tenantId; agency
 *     tables are system-owned and read across tenants by design.
 *   - persistSnapshot(client, tenantId, bundle): materializes the bundle
 *     into rule_snapshot via INSERT (tenant_id, sha256_hash, content_jsonb)
 *     ... ON CONFLICT (tenant_id, sha256_hash) DO UPDATE. Idempotent —
 *     same tenantId+bundle → same id across runs.
 *   - loadSnapshot(client, tenantId, hash): re-hydrates a CanonicalBundle
 *     from rule_snapshot.content_jsonb scoped by (tenant_id, sha256_hash).
 *
 * Phase 4 evaluator's first scenario-replay test asserts the round-trip
 * property: persistSnapshot(content) → loadSnapshot(id) returns the same
 * bundle EVEN IF the live rule tables have been updated since.
 *
 * Per Pitfall PG-3: every recorded_at value is normalized to ISO 8601
 * strings (.toISOString()) before snapshotId() is invoked. The hash is
 * computed over the canonical SnapshotInput shape (sorted by id ASC) PLUS
 * tenantId — see snapshotId.ts for the canonical-input contract.
 *
 * Plan 03 review BL-02: full agency_rule / program_rule / lender_overlay_rule
 * rows are captured (not just id+recorded_at refs) so the evaluator can
 * re-evaluate from the bundle alone. Plan 03 review BL-02 #1: the canonical
 * bundle keys match the migration 0015 header (agency_rule_versions /
 * program_rules / lender_overlay_rules). Plan 03 review BL-02 #3: every
 * nested object passes through sortKeysDeep before JSON.stringify, so future
 * field additions cannot silently invalidate previously-computed sha256
 * hashes via V8 iteration order shifts.
 *
 * 260506-al0 / Option B: rule_snapshot is now tenant-scoped at the schema
 * level. The "no-tenantId baseline-system snapshot" branch (WHERE FALSE on
 * tenant-scoped tables) is gone — every caller must pass tenantId. The
 * persistSnapshot invariant `bundle.tenantId === tenantId` is in place to
 * catch future drift where a stale bundle from one tenant might be passed
 * to persistSnapshot for another (the hash would diverge from the row's
 * tenant_id and break the (tenant_id, sha256_hash) UNIQUE assumption).
 *
 * Phase 4 evaluator MUST connect as `app_user` with `app.tenant_id` set;
 * the tenant_isolation policy on rule_snapshot is the wall (NOT a
 * system_role transition — see migration 0022's header).
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
 * all rows (no tenant filter — they have no tenant_id column). The
 * tenant-scoped tables (program_version, program_rule, lender_overlay_rule)
 * are filtered to rows whose tenant_id matches the requesting tenant.
 *
 * 260506-al0 / Option B: tenantId is REQUIRED. The previous "WHERE FALSE
 * when tenantId omitted" branch is gone — Option B made "baseline-system
 * snapshot with no tenant" incoherent (rule_snapshot.tenant_id is NOT
 * NULL by schema). Phase 4 evaluator persists per-evaluation snapshots
 * inline at request time with the requesting tenant's GUC set.
 */
export async function captureCurrentBundle(
  client: PoolClient,
  tenantId: string,
): Promise<CanonicalBundle> {
  // agency_rule_version + agency_rule are SYSTEM-GLOBAL by schema (no
  // tenant_id column). Every tenant sees the same point-in-time agency
  // baseline. Do NOT add a tenant filter to these queries — they have no
  // tenant_id column to filter on.
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
  // agency_rule_version + agency_rule are SYSTEM-GLOBAL by schema (no
  // tenant_id column). Every tenant sees the same point-in-time agency
  // baseline. Do NOT add a tenant filter to these queries — they have no
  // tenant_id column to filter on.
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

  // Tenant-scoped tables: WHERE tenant_id = $1. Defense-in-depth alongside
  // the tenant_isolation RLS policies on each of these tables (and on
  // rule_snapshot itself, post-0022).
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
     FROM program_version WHERE tenant_id = $1
     ORDER BY id ASC`,
    [tenantId],
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
     FROM program_rule WHERE tenant_id = $1
     ORDER BY id ASC`,
    [tenantId],
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
     FROM lender_overlay_rule WHERE tenant_id = $1
     ORDER BY id ASC`,
    [tenantId],
  );

  return {
    // 260506-al0: tenantId is part of the canonical SnapshotInput shape;
    // mixed into the snapshotId() hash via snapshotId.ts.
    tenantId,
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
 * Idempotent via UNIQUE on (tenant_id, sha256_hash). Returns the snapshot
 * id + hash.
 *
 * Per REVIEWS.md A3a: this is the canonical write path Phase 4 evaluator
 *   uses immediately before writing evaluation_event so the round-trip
 *   replay path is actually exercised.
 *
 * 260506-al0 / Option B: tenantId is REQUIRED. The invariant
 * `bundle.tenantId === tenantId` is enforced — a stale bundle from
 * another tenant would otherwise compute a different snapshotId (since
 * tenantId is in the canonical hash input) than the row's tenant_id,
 * breaking the (tenant_id, sha256_hash) UNIQUE assumption.
 *
 * The DO UPDATE clause is a no-op trick to make ON CONFLICT also return
 * the existing id; with DO NOTHING the returning clause produces zero
 * rows when the row already exists.
 */
export async function persistSnapshot(
  client: PoolClient,
  tenantId: string,
  bundle: CanonicalBundle,
): Promise<{ id: string; hash: string }> {
  if (bundle.tenantId !== tenantId) {
    throw new Error(
      `persistSnapshot: bundle.tenantId (${bundle.tenantId}) does not match tenantId param (${tenantId}). The hash and the row's tenant_id would diverge.`,
    );
  }
  const hash = snapshotId(bundle);
  const canonical = canonicalize(bundle);
  // BL-02 #3: stringify with the sorted-key form so output bytes are stable.
  const bodyJson = JSON.stringify(canonical);
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO rule_snapshot (tenant_id, sha256_hash, content_jsonb)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (tenant_id, sha256_hash) DO UPDATE
       SET sha256_hash = EXCLUDED.sha256_hash
     RETURNING id::text`,
    [tenantId, hash, bodyJson],
  );
  return { id: rows[0]!.id, hash };
}

/**
 * loadSnapshot — re-hydrate a CanonicalBundle by (tenant_id, sha256_hash).
 * Phase 4 evaluator uses this for historical scenario replay (SC#1).
 *
 * Returns null when no row matches. The content_jsonb is parsed back into
 * the CanonicalBundle shape, including the per-rule arrays needed to
 * re-evaluate without reading live rule tables.
 *
 * 260506-al0 / Option B: tenantId is REQUIRED. The WHERE clause
 * (tenant_id = $1 AND sha256_hash = $2) is defense-in-depth alongside
 * the tenant_isolation policy — even if RLS were bypassed (admin pool
 * during fixture setup), the filter alone returns zero rows.
 */
export async function loadSnapshot(
  client: PoolClient,
  tenantId: string,
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
    `SELECT content_jsonb FROM rule_snapshot
     WHERE tenant_id = $1 AND sha256_hash = $2 LIMIT 1`,
    [tenantId, hash],
  );
  if (!rows[0]) return null;
  const c = rows[0].content_jsonb;
  const agencyRuleVersionRows = c.agency_rule_versions ?? [];
  const agencyRuleRows = c.agency_rules ?? [];
  const programVersionRows = c.program_versions ?? [];
  const programRuleRows = c.program_rules ?? [];
  const lenderOverlayRuleRows = c.lender_overlay_rules ?? [];
  return {
    // 260506-al0: tenantId on the rehydrated bundle so callers calling
    // snapshotId(loaded) recompute the same hash.
    tenantId,
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
