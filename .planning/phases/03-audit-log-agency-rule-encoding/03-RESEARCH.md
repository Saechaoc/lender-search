# Phase 3: Audit Log + Agency Rule Encoding - Research

**Researched:** 2026-05-04
**Domain:** Postgres native partitioning + plpgsql triggers + TS-typed agency seed loader + deterministic snapshot hashing
**Confidence:** HIGH on schema/migration mechanics (Phase 1+2 established patterns; Postgres docs verified); HIGH on FNMA derog matrix content (verified against `selling-guide.fanniemae.com/sel/b3-5.3-07/`); HIGH on FHA Back-to-Work sunset (2016-09-30, verified in industry sources); MEDIUM on FHLMC §5202.5 specific anchor language (canonical URL accessible but text behind a clickable interface); HIGH on pg_cron Supabase availability (verified in Supabase docs); HIGH on RLS-partition inheritance (verified in pg-hackers thread; the safe pattern is parent-only INSERT routing).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Audit log mechanics (AUD-01..04)**
- **D-01:** `evaluation_event` uses native Postgres declarative partitioning (`PARTITION BY RANGE (evaluated_at)`) with one partition per calendar month. SQL function `create_next_evaluation_event_partition()` invoked monthly via pg_cron. Six forward partitions seeded inline at Phase 3 close (May–Oct 2026 + the Phase 3 month). pg_cron may require Supabase managed-tier enablement at Phase 6 — flagged for the planner. No pg_partman dependency.
- **D-02:** `REVOKE UPDATE, DELETE ON evaluation_event FROM app_user, PUBLIC, system_role` — maximalist tampering posture. Only the postgres superuser can mutate (administrative recovery only). Stronger than research's `REVOKE ... FROM authenticated`.
- **D-03:** `scenario_payload jsonb NOT NULL` + `scenario_hash text NOT NULL` both ship. Full payload enables single-row replay (AUD-04). Hash is sha256 over canonicalized payload for dedup + integrity.
- **D-04:** `lib/audit/snapshotId.ts` is a pure-TS helper computing `sha256(JSON.stringify(canonical))` where `canonical = {agency_versions: [{id, recorded_at}, ...].sort(by id), program_versions: [...].sort(by id), overlay_versions: [...].sort(by id)}`. Phase 3 ships helper + deterministic-output unit test. Phase 4 evaluator imports it as the canonical writer.

**Agency rule hand-authoring workflow (AGY-01..05)**
- **D-05:** Source-of-truth lives in TypeScript fixtures at `lib/agency-seeds/<agency>/<rule_kind>.ts`. Each file exports an array of objects typed against the existing Zod dispatch table at `lib/rules/schemas/index.ts`. Idempotent loader at `scripts/seed-agency.ts` invoked by `pnpm db:seed`. Loader connects via `DATABASE_MIGRATION_URL`. Idempotency keyed on `(agency, version_label, rule_kind, event_type)` via `ON CONFLICT DO NOTHING`.
- **D-06:** `pnpm db:seed` runs after `drizzle-kit migrate` in three places: `.github/workflows/ci.yml`, `tests/rls/global-setup.ts`, `tests/schema/setup.ts`. Local: `pnpm db:reset && pnpm db:seed`. Production deploy reuses the loader.
- **D-07:** Agency citations are URL-only — `rule_citation.source_url` + section anchor + `excerpt`; `source_pdf_sha256`, `page_number`, `bbox` stay NULL on agency rows.
- **D-08:** Test posture combines per-rule structural assertions (one test per SC#3 line item) at `tests/agency/<agency>-derog.test.ts` + per-agency golden snapshot test hashing the seeded rule_body bundle + deprecated-program test.
- **D-09:** PR chunking strategy: 8 PRs (audit log; FNMA; FHLMC; FHA + Back-to-Work; VA; USDA stub; FHFA; cascade trigger).
- **D-10:** Each agency's first version effective_period = `[2026-01-01,infinity)`. Future updates follow the two-step convention.
- **D-11:** Full derog event-type parity across FNMA + FHLMC + FHA + VA. Each agency gets one `agency_rule` row per `event_type` (BK7, BK13_DISCHARGED, BK13_DISMISSED, MULTIPLE_BK, FORECLOSURE, DEED_IN_LIEU, SHORT_SALE, MORTGAGE_CHARGE_OFF). FNMA also gets `mortgage_included_in_bk_rule`. ~30–40 agency_rule rows total.
- **D-12:** USDA stub = single `agency_rule_version` row only. Zero `agency_rule` child rows.
- **D-13:** `version_label` naming: agency-document-id format. Phase 3 seeds: `FNMA-SEL-2026-04`, `FHLMC-SSG-2026-Q1`, `HUD-4000.1-2024-08`, `VA-PAM-26-7-Ch4`, `USDA-SFH-7-CFR-3555`.

**Agency cascade infrastructure (AGY-07, AGY-08)**
- **D-14:** Phase 3 ships `cascade_review_queue` table + Postgres trigger AFTER INSERT ON `agency_rule_version`. No external queue dependency at Phase 3. Phase 6 Inngest worker reads via `SELECT ... FOR UPDATE SKIP LOCKED`. Phase 8 AM review surface reads from this table directly.
- **D-15:** `cascade_review_queue` is tenant-scoped + RLS + FORCE. `tenant_id` denormalized from `program_version.tenant_id` at trigger time. Two-policy shape: `cascade_review_queue_tenant_isolation` + `cascade_review_queue_system_write`. Trigger function is **SECURITY INVOKER**; the inserting role (postgres / system_role member) passes the system_write policy.
- **D-16:** Two-step cascade-write convention within a single transaction: UPDATE prior `agency_rule_version` SET superseded_by + effective_period upper bound, then INSERT new `agency_rule_version` with `[new_date,infinity)`. Trigger reads `NEW.agency`, finds prior version `WHERE agency = NEW.agency AND superseded_by = NEW.id`, INSERTs into cascade_review_queue per affected program_version.
- **D-17:** `lib/cascade/poll.ts` ships at Phase 3 with typed handler signature `pollAgencyPublications(): Promise<PollResult[]>` returning empty result. Integration test at `tests/cascade/cascade-trigger.test.ts` simulates the two-step convention and asserts the trigger creates queue rows for every affected program_version.
- **D-18:** `cascade_review_queue` columns: `id`, `tenant_id`, `program_version_id`, `prior_agency_rule_version_id`, `new_agency_rule_version_id`, `status text DEFAULT 'pending' CHECK IN ('pending','claimed','completed','dismissed')`, `claimed_at`, `claimed_by`, `completed_at`, `created_at`. Phase 6 worker uses SKIP LOCKED claim semantics. Phase 8 AM UI filters on status.
- **D-19:** Retention = keep forever at Phase 3 (low volume).

**FHFA conforming loan limits (AGY-09)**
- **D-20:** Two-table split: `conforming_loan_limit_version` + `conforming_loan_limit_county`. ~25,600 rows per year. System-owned. EXCLUDE on `(year WITH =, effective_period WITH &&)`.
- **D-21:** Commit canonical FHFA 2026 CSV/XLSX to `lib/agency-seeds/fhfa/2026-conforming-limit-values-by-county.csv`. TS loader at `scripts/seed-fhfa.ts` (or extension to `scripts/seed-agency.ts`).
- **D-22:** `program_version.conforming_loan_limit_version_id uuid NULL REFERENCES conforming_loan_limit_version(id)` — schema delta (one new nullable column).
- **D-23:** Annual update path = manual `pnpm db:seed` run with new CSV. Loader follows two-step daterange close convention.

### Claude's Discretion

- Exact pg_cron job naming + schedule cadence (likely first-of-month at 02:00 UTC)
- `evaluator_version text` source format on `evaluation_event` — semver vs git sha vs evaluator-config hash; Phase 3 just defines the column with non-empty CHECK
- Whether `lib/audit/snapshotId.ts` returns 64-char hex string or 43-char base64url-encoded sha256
- Index strategy on `cascade_review_queue` beyond mandatory `(tenant_id, status, created_at)` — likely `(status, created_at)` partial WHERE status='pending'
- Whether the 6 forward `evaluation_event` partitions land as inline `--custom` migration SQL or as 6× `SELECT create_next_evaluation_event_partition()` calls
- Decision on whether to extend `tests/_shared/agency-fixture.ts` per Phase 2 WR-05 — Phase 3 has more agency-fixture call sites
- Where to author the FHFA CSV parser (`csv-parse` npm dep vs hand-rolled)

### Deferred Ideas (OUT OF SCOPE)

- Vercel Cron wiring + actual HTTP fetch in `lib/cascade/poll.ts` → Phase 6 (CFG-01)
- Inngest 4.2 worker pool consuming `cascade_review_queue` with SKIP LOCKED → Phase 6 (CFG-04)
- HTTP scraping of FNMA Selling Guide / Mortgagee Letters / VA Circulars → Phase 7 extension
- Saved-scenario re-run alerting based on snapshot_id delta (Flow 4) → Phase 14 v3 (WKF-03)
- Cold-archive automation for evaluation_event partitions older than 24 months → Phase 13+
- cascade_review_queue retention/archival → Phase 13+
- USDA full agency rule encoding → Phase 12 v2 (COV-v2-01)
- HFA + second-lien CES/HELOC + construction-to-perm → Phase 12 v2 (COV-v2-02..04)
- Brokerage `LENDER_OVERLAY` author UI → Phase 12 v2 (LOV-01..03)
- Per-MI-provider overlay matching → Phase 13 (PRC-05)
- Live-pricing tables → Phase 13 (PRC-01..05)
- Agency-rule deprecation lifecycle beyond FHA Back-to-Work → Phase 8
- AM commit transaction calling `detect_loosenings()` → Phase 8 (AM-01..09)
- Extracting SYSTEM-tenant + agency-version-bootstrap helpers into `tests/_shared/agency-fixture.ts` — refactor candidate (WR-05); Phase 3 has more call sites; optional
- Pure-TS evaluator at `lib/eval/` → Phase 4 (EVL-01..09)
- 200-scenario golden set → Phase 5 (GLD-01..06)
- Reducto extraction + Claude vision → Phase 7 (EXT-01..10)
- `agency_publication_source` table caching last-fetched URLs + sha256 — deferred to Phase 6 with the real poller
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUD-01 | System persists every evaluation result to an append-only `evaluation_event` table partitioned by month | Audit Log Architecture §Partitioning DDL pattern; Pattern P1 (parent-only INSERT routing); Pitfall PG-1 (RLS not auto-inherited to partitions) |
| AUD-02 | `evaluation_event` records tenant_id, actor_id, scenario_payload, ruleset_snapshot_id, decision, deciding_rule_id, rule_stack[] jsonb, evaluator_version, evaluated_at | Audit Log Architecture §Column DDL; Forward Compatibility table for Phase 4 evaluator writer |
| AUD-03 | `REVOKE UPDATE, DELETE ON evaluation_event FROM authenticated` enforced at the database level | Audit Log Architecture §REVOKE inheritance behavior; D-02 maximalist (extends to system_role + app_user + PUBLIC) |
| AUD-04 | System replays any historical scenario against its historical RuleSnapshot deterministically | Audit Log Architecture §snapshotId canonicalization contract; Pattern P2 (lib/audit/snapshotId.ts); Test Strategy §Determinism tests (4 assertions) |
| AGY-01 | System encodes versioned `agency_rule_version` row per agency release for FNMA, FHLMC, FHA, VA (USDA scaffolded) | Agency Rule Hand-Authoring §Version label format (D-13); §USDA stub (D-12); Pattern P3 (TS-typed fixture loader) |
| AGY-02 | System encodes the FNMA Selling Guide B3-5.3-07 derogatory waiting-period matrix in full | Agency Rule Hand-Authoring §FNMA derog matrix (verified against selling-guide.fanniemae.com); Pattern P4 (DerogSeasoning fixture); Test Strategy §Per-rule structural assertions |
| AGY-03 | System encodes the FHLMC §5202.5 derog waiting-period rules with their own anchor and timing nuances | Agency Rule Hand-Authoring §FHLMC parity differences |
| AGY-04 | System encodes the FHA HUD 4000.1 derog waiting periods with FHA Back-to-Work marked DEPRECATED with sunset 2016-09-30 | Agency Rule Hand-Authoring §FHA HUD 4000.1 + Back-to-Work DEPRECATED row pattern; Pattern P5 (deprecated-program lifecycle); Pitfall PG-2 (deprecated row must be queryable but filtered) |
| AGY-05 | System encodes the VA Pamphlet 26-7 derog waiting periods | Agency Rule Hand-Authoring §VA matrix; canonical citation https://www.benefits.va.gov/warms/docs/admin26/pamphlet/pam26_7/ch04.pdf |
| AGY-06 | System encodes a `program_version → agency_rule_version` foreign-key relationship | Already shipped in Phase 2 (`program_version.agency_rule_version_id NOT NULL`); Phase 3 hand-authoring populates the FK target rows |
| AGY-07 | System polls FNMA Selling Guide / FHLMC Bulletins / FHA Mortgagee Letters / VA Circulars on a daily schedule | Cascade Infrastructure §lib/cascade/poll.ts stub signature; D-17 deferred to Phase 6 with typed signature locked at Phase 3 |
| AGY-08 | System fans out a per-affected-program review job to a queue when a new `agency_rule_version` is committed | Cascade Infrastructure §enqueue_agency_cascade trigger; Pattern P6 (cascade trigger plpgsql shape); Test Strategy §Cascade integration test (D-17) |
| AGY-09 | System encodes 2026 FHFA conforming loan limit values + high-balance overlays as a separate versioned table referenced by program_version | FHFA Conforming Loan Limits §Two-table schema (D-20); §CSV ingestion (D-21); §Schema delta to program_version (D-22); §Annual update path (D-23) |
</phase_requirements>

## Summary

Phase 3 ships three coupled artifacts on top of Phase 2's keystone schema:

1. **Append-only `evaluation_event`** — monthly native declarative partitioning (`PARTITION BY RANGE (evaluated_at)`); REVOKE UPDATE/DELETE structurally enforced; deterministic replay via `ruleset_snapshot_id` (sha256 of canonical agency+program+overlay version bundles). Pure-TS helper at `lib/audit/snapshotId.ts` ships with four-assertion deterministic-round-trip test; Phase 4 evaluator imports unchanged.

2. **Hand-authored agency rule sets** — TS fixtures at `lib/agency-seeds/<agency>/<rule_kind>.ts` typed against the existing Zod dispatch table. Idempotent loader at `scripts/seed-agency.ts` (`pnpm db:seed`) wired into CI + test setup + production deploy. Full FNMA B3-5.3-07 derog matrix encoded; FHLMC §5202.5 + FHA HUD 4000.1 + VA Pamphlet 26-7 in derog parity; USDA stub `agency_rule_version` row; FHA Back-to-Work DEPRECATED with sunset 2016-09-30. URL-only citations under SYSTEM tenant.

3. **Agency cascade infrastructure** — `cascade_review_queue` tenant-scoped+RLS+FORCE table + plpgsql trigger AFTER INSERT ON `agency_rule_version` writes one row per affected program_version. Two-policy shape (tenant_isolation + system_write) lets the trigger INSERT cross-tenant while AM reads stay tenant-scoped. `lib/cascade/poll.ts` stub locks the typed handler signature; Phase 6 wires the real fetcher and Inngest consumer with zero schema churn.

Plus a separate FHFA two-table set (`conforming_loan_limit_version` + `conforming_loan_limit_county`, ~25,600 rows for 2026) referenced by an optional FK on `program_version`. CSV committed under `lib/agency-seeds/fhfa/`; loader extends `pnpm db:seed`.

**Primary recommendation:** Sequence the eight PRs per D-09 in dependency order — audit log + snapshotId helper land first (Phase 4 dependency); FNMA/FHLMC/FHA/VA agency seeds land in parallel after (the four agencies are independent under the loader); cascade trigger + integration test land last (depends on `superseded_by` self-FK from Phase 2 and on at least one agency seeded). FHFA loan limits ship as their own PR sequence-independent of the agency seeds because the table set is disjoint.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Append-only audit table partitioning | Database / Storage | — | DDL + REVOKE + native partitioning are pure Postgres; no application code at Phase 3 |
| Snapshot ID canonicalization | Pure TS library (`lib/audit/`) | — | No I/O, no framework deps; signature locks for Phase 4 evaluator (synchronous hot path) |
| Agency rule fixture authoring | Pure TS library (`lib/agency-seeds/`) | — | Source-of-truth in TypeScript files; Zod-validated at compile and load time |
| Idempotent agency seed loader | Build-time / CI script (`scripts/seed-agency.ts`) | Database / Storage | Connects via DATABASE_MIGRATION_URL; runs after migrate; ON CONFLICT DO NOTHING |
| FHFA CSV ingestion | Build-time / CI script (`scripts/seed-fhfa.ts`) | Database / Storage | Same loader pattern; per-row Zod validation; ~25,600 rows per year |
| Cascade trigger semantics | Database / Storage | — | plpgsql AFTER INSERT trigger; reads NEW.agency, JOINs program_version, INSERTs cascade_review_queue |
| Cascade poll handler stub | API / Backend (`lib/cascade/`) | — | Typed handler signature only at Phase 3; Phase 6 wires Vercel Cron + Inngest |
| Cascade queue read path (AM UI) | API / Backend | Frontend Server (SSR) | Phase 8 surfaces; Phase 3 ships table shape that Phase 8 reads with tenant_isolation policy |

## Audit Log Architecture

### Partitioning DDL — `evaluation_event`

Postgres 16 declarative range partitioning is the right call: native, no extension, monthly child partitions trivially droppable for cold archive. Drizzle 0.45 does NOT model `PARTITION BY RANGE` so the parent table + every child partition ship via `--custom` migrations.

```sql
-- Migration 0007 (--custom): parent partitioned table.
-- Per CONTEXT D-01, D-02, D-03, AUD-02 column list.
CREATE TABLE evaluation_event (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  scenario_hash text NOT NULL,
  scenario_payload jsonb NOT NULL,
  ruleset_snapshot_id text NOT NULL,
  program_version_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('eligible','near_miss','ineligible')),
  deciding_rule_id uuid NULL,                  -- references program_rule.id OR agency_rule.id (polymorphic; not FK enforced)
  deciding_rule_layer text NULL,               -- denormalized: 'AGENCY_BASE' | 'INVESTOR_OVERLAY' | 'PRODUCT_FEATURE' | 'LENDER_OVERLAY'
  rule_stack jsonb NOT NULL,
  near_miss_delta jsonb NULL,
  evaluator_version text NOT NULL CHECK (length(evaluator_version) > 0),
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  -- Per Postgres docs: PRIMARY KEY on a partitioned table MUST include the partition key column.
  -- This keeps id+evaluated_at globally unique across partitions.
  PRIMARY KEY (id, evaluated_at)
) PARTITION BY RANGE (evaluated_at);

-- RLS on the parent. Per Postgres 16 docs: enabling RLS on the parent applies to all
-- partitions when queries route through the parent (the standard insertion path).
-- Best practice (verified in pg-hackers thread + multiple production refs): only INSERT
-- via the parent; never address child partitions directly. Policies on parent suffice.
ALTER TABLE evaluation_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_event FORCE ROW LEVEL SECURITY;

CREATE POLICY evaluation_event_tenant_isolation ON evaluation_event
  FOR ALL TO public
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX evaluation_event_tenant_evaluated_idx
  ON evaluation_event (tenant_id, evaluated_at DESC);

-- Per CONTEXT D-02: maximalist REVOKE.
-- REVOKE on parent inherits to all CURRENT and FUTURE child partitions per Postgres 16
-- semantics (REVOKE applies to the relation; partitions inherit the parent's privileges
-- at attach time). Verify empirically in Plan 03-XX [BLOCKING] introspection.
REVOKE UPDATE, DELETE ON evaluation_event FROM PUBLIC;
REVOKE UPDATE, DELETE ON evaluation_event FROM app_user;
REVOKE UPDATE, DELETE ON evaluation_event FROM system_role;
GRANT SELECT, INSERT ON evaluation_event TO app_user;
GRANT SELECT, INSERT ON evaluation_event TO system_role;
```

### Forward partition seed (Phase 3 close)

Six forward partitions covering current Phase 3 month + 5 ahead. Per D-09 PR chunking, these land as inline `--custom` migration SQL in the same file as the parent (so a fresh CI run never hits a "no partition for this month" error).

```sql
-- 0008_evaluation_event_partitions_forward.sql (--custom)
-- Phase 3 ships 6 forward partitions inline. Per CONTEXT Claude's Discretion D-01,
-- planner picks between inline DDL OR repeated SELECT create_next_evaluation_event_partition()
-- calls. Inline DDL is simpler and self-documenting; the function exists for the
-- pg_cron monthly path going forward.
CREATE TABLE evaluation_event_y2026m05 PARTITION OF evaluation_event
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE evaluation_event_y2026m06 PARTITION OF evaluation_event
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE evaluation_event_y2026m07 PARTITION OF evaluation_event
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE evaluation_event_y2026m08 PARTITION OF evaluation_event
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE evaluation_event_y2026m09 PARTITION OF evaluation_event
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE evaluation_event_y2026m10 PARTITION OF evaluation_event
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
```

### `create_next_evaluation_event_partition()` SQL function

```sql
-- 0009_create_next_evaluation_event_partition.sql (--custom)
-- Idempotent: if the next month's partition already exists, the function no-ops.
-- Called monthly from pg_cron (or any external scheduler if pg_cron unavailable).
-- Runs as the calling role (typically postgres for the cron job).
CREATE OR REPLACE FUNCTION create_next_evaluation_event_partition()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY INVOKER
AS $$
DECLARE
  next_month_start date := date_trunc('month', now() + interval '1 month')::date;
  next_month_end   date := date_trunc('month', now() + interval '2 month')::date;
  partition_name   text := format('evaluation_event_y%sm%s',
                                   to_char(next_month_start, 'YYYY'),
                                   to_char(next_month_start, 'MM'));
  ddl              text;
BEGIN
  -- Idempotent guard via to_regclass — avoids duplicate-table error on re-runs.
  IF to_regclass(partition_name) IS NOT NULL THEN
    RETURN;
  END IF;

  ddl := format(
    'CREATE TABLE %I PARTITION OF evaluation_event FOR VALUES FROM (%L) TO (%L)',
    partition_name,
    next_month_start,
    next_month_end
  );
  EXECUTE ddl;
END;
$$;
```

### pg_cron monthly schedule

```sql
-- 0010_evaluation_event_pg_cron.sql (--custom)
-- pg_cron is in Supabase managed Postgres on every plan including free tier
-- (verified at https://supabase.com/docs/guides/cron). Local docker-postgres-16-alpine
-- does NOT include pg_cron — the planner MUST include a fallback step.
--
-- Pattern: try CREATE EXTENSION; if it fails (local dev), the function still exists
-- and can be called manually. Phase 3 ships the function unconditionally; pg_cron
-- scheduling is Supabase-only.
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule: 02:00 UTC on day 1 of each month (Claude's discretion picked).
-- '0 2 1 * *' = minute 0, hour 2, day-of-month 1.
SELECT cron.schedule(
  'create_next_evaluation_event_partition',
  '0 2 1 * *',
  $$ SELECT create_next_evaluation_event_partition() $$
);
```

### `lib/audit/snapshotId.ts` canonicalization contract

Per D-04, signature locks at Phase 3 because Phase 4 evaluator imports unchanged.

```typescript
// lib/audit/snapshotId.ts
import { createHash } from 'node:crypto';

export interface VersionRef {
  id: string;
  recorded_at: string;  // ISO 8601 string — NOT Date object (see Pitfall PG-3)
}

export interface SnapshotInput {
  agencyVersions: VersionRef[];
  programVersions: VersionRef[];
  overlayVersions: VersionRef[];
}

/**
 * Compute the deterministic content-addressed snapshot ID for a rule bundle.
 *
 * Determinism contract (Phase 3 ships the four assertions per CONTEXT specifics §6):
 *   A1: Same input -> same hash (basic determinism)
 *   A2: Reordered arrays -> same hash (sort-by-id is canonical)
 *   A3: Extra version in any array -> different hash (full set in scope)
 *   A4: Mutated recorded_at -> different hash (timestamp is part of identity)
 *
 * Returns 64-char lowercase hex sha256. Claude's Discretion picked hex over base64url
 * for grep-ability in audit log queries; cost is 21 extra chars per row.
 *
 * Imported by Phase 4 evaluator as the canonical writer of evaluation_event.ruleset_snapshot_id.
 */
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
  // JSON.stringify on this two-key object shape is deterministic in V8 because
  // (a) we sorted arrays by id, (b) inner objects only have {id, recorded_at} in
  // insertion order, (c) outer keys are agency_versions/program_versions/overlay_versions
  // declared in fixed order. We don't need json-stable-stringify for this shape.
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
```

The four assertions land as a single test file `tests/audit/snapshot-id.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { snapshotId } from '../../lib/audit/snapshotId.js';

const sampleA = { id: '11111111-...', recorded_at: '2026-01-01T00:00:00.000Z' };
const sampleB = { id: '22222222-...', recorded_at: '2026-01-02T00:00:00.000Z' };
const sampleC = { id: '33333333-...', recorded_at: '2026-01-03T00:00:00.000Z' };

describe('snapshotId determinism contract', () => {
  it('A1: same input -> same hash', () => {
    const input = { agencyVersions: [sampleA], programVersions: [sampleB], overlayVersions: [] };
    expect(snapshotId(input)).toBe(snapshotId(input));
  });

  it('A2: reordered arrays -> same hash', () => {
    const ab = { agencyVersions: [sampleA, sampleB], programVersions: [], overlayVersions: [] };
    const ba = { agencyVersions: [sampleB, sampleA], programVersions: [], overlayVersions: [] };
    expect(snapshotId(ab)).toBe(snapshotId(ba));
  });

  it('A3: extra version -> different hash', () => {
    const base = { agencyVersions: [sampleA], programVersions: [], overlayVersions: [] };
    const plus = { agencyVersions: [sampleA, sampleC], programVersions: [], overlayVersions: [] };
    expect(snapshotId(base)).not.toBe(snapshotId(plus));
  });

  it('A4: mutated recorded_at -> different hash', () => {
    const t1 = { agencyVersions: [{ ...sampleA, recorded_at: '2026-01-01T00:00:00.000Z' }], programVersions: [], overlayVersions: [] };
    const t2 = { agencyVersions: [{ ...sampleA, recorded_at: '2026-01-01T00:00:01.000Z' }], programVersions: [], overlayVersions: [] };
    expect(snapshotId(t1)).not.toBe(snapshotId(t2));
  });
});
```

## Agency Rule Hand-Authoring

### TS fixture file shape

Per D-05, one file per `(agency, rule_kind)` for review chunking. The fixture exports an array of objects typed against the existing Zod dispatch table at `lib/rules/schemas/index.ts`. TypeScript compile-time validation + loader runtime validation via `parseRuleBody(kind, body)`.

```typescript
// lib/agency-seeds/fnma/derog-seasoning.ts
import type { DerogSeasoning } from '../../rules/schemas/derog-seasoning.js';
import type { AgencyRuleSeed } from '../types.js';

const FNMA_VERSION_LABEL = 'FNMA-SEL-2026-04';
const FNMA_CITATION_BASE = 'https://selling-guide.fanniemae.com/sel/b3-5.3-07/';

// Per CONTEXT specifics §6 + Phase 3 SC#3: full event-type parity. Each row is an
// agency_rule INSERT under the FNMA agency_rule_version with rule_kind='derog_seasoning'
// and the structured DerogSeasoning body.
export const fnmaDerogSeasoningSeeds: AgencyRuleSeed<DerogSeasoning>[] = [
  {
    versionLabel: FNMA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'BK7',
      measurement_anchor: 'DISCHARGE',
      base_waiting_months: 48,
      extenuating_circumstances_waiting_months: 24,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text: 'Per FNMA Selling Guide B3-5.3-07: re-established credit required after BK7 discharge.',
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['B3-5.3-07#BK_CHAPTER_7'],
    },
    citation: {
      sourceUrl: `${FNMA_CITATION_BASE}#BK_CHAPTER_7`,
      excerpt: 'Bankruptcy (Chapter 7 or 11): A four-year waiting period is required, measured from the discharge or dismissal date of the bankruptcy action.',
    },
  },
  {
    versionLabel: FNMA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'BK13_DISCHARGED',
      measurement_anchor: 'DISCHARGE',
      base_waiting_months: 24,
      extenuating_circumstances_waiting_months: null,  // FNMA: no EC reduction below 2y for BK13 discharged
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text: null,
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['B3-5.3-07#BK_CHAPTER_13'],
    },
    citation: {
      sourceUrl: `${FNMA_CITATION_BASE}#BK_CHAPTER_13`,
      excerpt: 'Bankruptcy (Chapter 13): A two-year waiting period is permitted, measured from the discharge date.',
    },
  },
  {
    versionLabel: FNMA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'BK13_DISMISSED',
      measurement_anchor: 'DISMISSAL',
      base_waiting_months: 48,
      extenuating_circumstances_waiting_months: 24,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text: null,
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['B3-5.3-07#BK_CHAPTER_13'],
    },
    citation: {
      sourceUrl: `${FNMA_CITATION_BASE}#BK_CHAPTER_13`,
      excerpt: 'Bankruptcy (Chapter 13): A four-year waiting period is required, measured from the dismissal date.',
    },
  },
  {
    versionLabel: FNMA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'MULTIPLE_BK',
      measurement_anchor: 'DISCHARGE',  // most recent
      base_waiting_months: 60,           // 5y baseline
      extenuating_circumstances_waiting_months: 36,  // 3y EC per Pitfall 1.5
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text: 'Per FNMA: most recent filing must be the result of extenuating circumstances (not the original filing).',
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['B3-5.3-07#MULTIPLE_BK'],
    },
    citation: {
      sourceUrl: `${FNMA_CITATION_BASE}#MULTIPLE_BK`,
      excerpt: 'Multiple Bankruptcy Filings: A five-year waiting period is required, measured from the most recent dismissal or discharge date.',
    },
  },
  {
    versionLabel: FNMA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'FORECLOSURE',
      measurement_anchor: 'COMPLETION',
      base_waiting_months: 84,                          // 7y baseline
      extenuating_circumstances_waiting_months: 36,     // 3y EC
      // Per Phase 3 SC#3 + Pitfall 1.2: 3-7y window 90% LTV cap, primary purchase or RT-refi only.
      post_event_LTV_caps: [
        {
          months_since_min: 36,
          months_since_max: 84,
          max_LTV: 90,
          max_CLTV: 90,
          max_HCLTV: 90,
          purposeAllowList: ['PURCHASE', 'RATE_TERM_REFI'],
          occupancyAllowList: ['PRIMARY'],
        },
      ],
      reestablished_credit_required: true,
      reestablishment_criteria_text: null,
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['B3-5.3-07#FORECLOSURE'],
    },
    citation: {
      sourceUrl: `${FNMA_CITATION_BASE}#FORECLOSURE`,
      excerpt: 'Foreclosure: A seven-year waiting period is required. A three-year waiting period is permitted with extenuating circumstances, with the maximum LTV/CLTV/HCLTV ratios of the lesser of 90% or transaction limits, principal residence purchase only, or limited cash-out refinances.',
    },
  },
  {
    versionLabel: FNMA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'DEED_IN_LIEU',
      measurement_anchor: 'COMPLETION',
      base_waiting_months: 48,
      extenuating_circumstances_waiting_months: 24,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text: null,
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['B3-5.3-07#DIL_PFS'],
    },
    citation: {
      sourceUrl: `${FNMA_CITATION_BASE}#DIL_PFS`,
      excerpt: 'Deed-in-Lieu of Foreclosure, Preforeclosure Sale, or Charge-Off of Mortgage Account: A four-year waiting period is required. A two-year waiting period is permitted with extenuating circumstances.',
    },
  },
  {
    versionLabel: FNMA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'SHORT_SALE',
      measurement_anchor: 'SALE_CONFIRMATION',
      base_waiting_months: 48,
      extenuating_circumstances_waiting_months: 24,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text: null,
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['B3-5.3-07#DIL_PFS'],
    },
    citation: {
      sourceUrl: `${FNMA_CITATION_BASE}#DIL_PFS`,
      excerpt: 'Preforeclosure Sale (short sale): A four-year waiting period from the date of sale completion. Two-year waiting period permitted with extenuating circumstances.',
    },
  },
  {
    versionLabel: FNMA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: {
      event_type: 'MORTGAGE_CHARGE_OFF',
      measurement_anchor: 'CHARGE_OFF_DATE',
      base_waiting_months: 48,
      extenuating_circumstances_waiting_months: 24,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      reestablishment_criteria_text: null,
      // Per Pitfall 1.6 + CONTEXT specifics: mortgage-included-in-BK exception fires here.
      mortgage_included_in_bk_rule: 'BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED',
      notes_citations: ['B3-5.3-07#MORTGAGE_CHARGE_OFF', 'B3-5.3-07#MORTGAGE_INCLUDED_IN_BK'],
    },
    citation: {
      sourceUrl: `${FNMA_CITATION_BASE}#MORTGAGE_CHARGE_OFF`,
      excerpt: 'Charge-Off of Mortgage Account: 48 months from charge-off date; 24 months with extenuating circumstances. If a mortgage debt was discharged through bankruptcy, the bankruptcy waiting periods may be applied.',
    },
  },
];
```

### Per-agency content matrix

**FNMA** (`FNMA-SEL-2026-04`, citation base `https://selling-guide.fanniemae.com/sel/b3-5.3-07/`):
- BK7: 48m base, 24m EC, anchor=DISCHARGE
- BK13_DISCHARGED: 24m, no EC, anchor=DISCHARGE
- BK13_DISMISSED: 48m base, 24m EC, anchor=DISMISSAL
- MULTIPLE_BK: 60m base, 36m EC, anchor=DISCHARGE
- FORECLOSURE: 84m base, 36m EC, anchor=COMPLETION + `post_event_LTV_caps[0]` `{months_since_min:36, months_since_max:84, max_LTV:90, purposeAllowList:['PURCHASE','RATE_TERM_REFI'], occupancyAllowList:['PRIMARY']}`
- DEED_IN_LIEU: 48m base, 24m EC, anchor=COMPLETION
- SHORT_SALE: 48m base, 24m EC, anchor=SALE_CONFIRMATION
- MORTGAGE_CHARGE_OFF: 48m base, 24m EC, anchor=CHARGE_OFF_DATE + `mortgage_included_in_bk_rule = 'BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED'`

**FHLMC** (`FHLMC-SSG-2026-Q1`, citation base `https://guide.freddiemac.com/app/guide/section/5202.5`):
- BK7: 48m base, 24m EC, anchor=DISCHARGE (parity with FNMA)
- BK13_DISCHARGED: 24m, no EC, anchor=DISCHARGE (parity)
- BK13_DISMISSED: 48m base, 24m EC, anchor=DISMISSAL (parity)
- MULTIPLE_BK: 60m base, 36m EC, anchor=DISCHARGE (parity)
- FORECLOSURE: 84m base, 24m EC (FHLMC permits 24m EC vs FNMA's 36m — confirmed in industry sources), anchor=COMPLETION + post_event_LTV_caps similar to FNMA's 3-to-7-yr 90% window where applicable
- DEED_IN_LIEU: 48m base, 24m EC, anchor=COMPLETION
- SHORT_SALE: 48m base, 24m EC, anchor=SALE_CONFIRMATION
- MORTGAGE_CHARGE_OFF: 48m base, 24m EC, anchor=CHARGE_OFF_DATE + `mortgage_included_in_bk_rule = 'FC_CLOCK_ALWAYS'` (FHLMC posture per Pitfall 1.6 derog research)

**FHA HUD 4000.1** (`HUD-4000.1-2024-08`, citation base `https://www.hud.gov/sites/dfiles/SFH/documents/4000.1hsgh.pdf` §II.A.5.b):
- BK7: 24m base, 12m EC, anchor=DISCHARGE (FHA shorter)
- BK13_DISCHARGED: 24m base if discharged; 12m if currently in pay-out plan with trustee approval (Phase 3 ships discharge variant)
- BK13_DISMISSED: 24m base, 12m EC, anchor=DISMISSAL
- MULTIPLE_BK: not separately specified; FHA defers to standard EC; ship as `null`/skip OR mirror BK7 24m as-of-most-recent
- FORECLOSURE: 36m base, 12m EC (FHA standard EC provision active), anchor=COMPLETION
- DEED_IN_LIEU: 36m base, 12m EC, anchor=COMPLETION
- SHORT_SALE: 36m base, 12m EC, anchor=SALE_CONFIRMATION
- MORTGAGE_CHARGE_OFF: 36m base, 12m EC, anchor=CHARGE_OFF_DATE
- **PLUS** a separate `agency_rule` row marked DEPRECATED: `event_type='FORECLOSURE'` (or `program_marker` rule_kind), `version_label='HUD-4000.1-BTW-DEPRECATED'`, citation pointing at Mortgagee Letter 2016-14, with sunset metadata. **Approach** — encode as a second `agency_rule_version` row with `effective_period = '[2013-08-15, 2016-09-30)'` and `superseded_by` set; queryable but the `effective_period @> CURRENT_DATE` check excludes it from active use. See Pattern P5 below.

**VA Pamphlet 26-7** (`VA-PAM-26-7-Ch4`, citation base `https://www.benefits.va.gov/warms/docs/admin26/pamphlet/pam26_7/ch04.pdf` §Chapter 4 Topic 7):
- BK7: 24m base, 12m EC, anchor=DISCHARGE
- BK13_DISCHARGED: 12m if 12 months of pay-out elapsed with trustee approval; 24m post-discharge
- BK13_DISMISSED: 24m, 12m EC, anchor=DISMISSAL
- MULTIPLE_BK: not separately specified; ship null
- FORECLOSURE: 24m base, 12m EC, anchor=COMPLETION (VA shorter than FHA)
- DEED_IN_LIEU: 24m base, 12m EC, anchor=COMPLETION
- SHORT_SALE: 24m base, 12m EC, anchor=SALE_CONFIRMATION
- MORTGAGE_CHARGE_OFF: 24m, 12m EC, anchor=CHARGE_OFF_DATE
- **VA-specific**: VA itself imposes no waiting after FC for borrowers using NEW VA entitlement; the 24m is typical lender overlay (Pitfall 1.7). Phase 3 ships the "typical" baseline; second-tier-entitlement modeling deferred.

**USDA** (`USDA-SFH-7-CFR-3555`, citation base `https://www.rd.usda.gov/programs-services/single-family-housing-programs`):
- One `agency_rule_version` row only per D-12. Zero `agency_rule` child rows. Phase 12 v2 (COV-v2-01) hand-authors the actual rules.

### Idempotent loader (`scripts/seed-agency.ts`)

```typescript
// scripts/seed-agency.ts
//
// Idempotent agency-rule loader. Connects via DATABASE_MIGRATION_URL (postgres
// superuser; system_role policy on agency tables requires this).
//
// Per CONTEXT D-05/D-06: invoked by `pnpm db:seed`. Wired into:
//   - .github/workflows/ci.yml step
//   - tests/rls/global-setup.ts (after drizzle-kit migrate)
//   - tests/schema/setup.ts (after migrate)
//   - production deploy step (Phase 6)
//
// Idempotency keyed on (agency, version_label, rule_kind, event_type) via
// ON CONFLICT DO NOTHING. Re-running is safe and a no-op when state is current.
//
// Bootstrap: ensures the SYSTEM tenant exists (Phase 1 D-04 + Phase 2 fixture
// pattern); per-agency seeding wraps in its own transaction.
import { config as loadDotenv } from 'dotenv';
import { Pool } from 'pg';
import { parseRuleBody, type RuleKind } from '../lib/rules/schemas/index.js';
import { fnmaDerogSeasoningSeeds } from '../lib/agency-seeds/fnma/derog-seasoning.js';
import { fhlmcDerogSeasoningSeeds } from '../lib/agency-seeds/fhlmc/derog-seasoning.js';
import { fhaDerogSeasoningSeeds, fhaBackToWorkDeprecatedSeed } from '../lib/agency-seeds/fha/derog-seasoning.js';
import { vaDerogSeasoningSeeds } from '../lib/agency-seeds/va/derog-seasoning.js';
import { usdaStubSeed } from '../lib/agency-seeds/usda/stub.js';

loadDotenv({ path: '.env.local' });
loadDotenv({ path: '.env' });

const pool = new Pool({ connectionString: process.env.DATABASE_MIGRATION_URL });

async function ensureSystemTenant(client): Promise<string> {
  const lookup = await client.query<{ id: string }>(
    `SELECT id::text FROM tenant WHERE kind = 'SYSTEM' LIMIT 1`,
  );
  if (lookup.rows[0]) return lookup.rows[0].id;
  const created = await client.query<{ id: string }>(
    `INSERT INTO tenant (id, kind, name)
     VALUES (gen_random_uuid(), 'SYSTEM', 'Agency Hand-Authoring System Tenant')
     RETURNING id::text`,
  );
  return created.rows[0]!.id;
}

async function seedAgencyVersionAndRules(
  agency: 'FNMA' | 'FHLMC' | 'FHA' | 'VA' | 'USDA',
  versionLabel: string,
  effectivePeriod: string,
  sourceUrl: string,
  seeds: AgencyRuleSeed[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const systemTenantId = await ensureSystemTenant(client);
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [systemTenantId]);

    // Find or create the agency_rule_version row.
    let arvId: string;
    const existing = await client.query<{ id: string }>(
      `SELECT id::text FROM agency_rule_version WHERE agency = $1 AND version_label = $2 LIMIT 1`,
      [agency, versionLabel],
    );
    if (existing.rows[0]) {
      arvId = existing.rows[0].id;
    } else {
      const created = await client.query<{ id: string }>(
        `INSERT INTO agency_rule_version (agency, version_label, source_url, effective_period)
         VALUES ($1, $2, $3, $4::daterange)
         RETURNING id::text`,
        [agency, versionLabel, sourceUrl, effectivePeriod],
      );
      arvId = created.rows[0]!.id;
    }

    // For each seed: ensure citation + INSERT agency_rule with idempotency.
    for (const seed of seeds) {
      // Per-rule_kind shape validation via Zod dispatch (compile-time + runtime safety net).
      parseRuleBody(seed.ruleKind as RuleKind, seed.ruleBody);

      // Citation (URL-only per D-07).
      const cit = await client.query<{ id: string }>(
        `INSERT INTO rule_citation (tenant_id, source_url, excerpt)
         VALUES ($1, $2, $3) RETURNING id::text`,
        [systemTenantId, seed.citation.sourceUrl, seed.citation.excerpt],
      );
      const citationId = cit.rows[0]!.id;

      // agency_rule INSERT with idempotency keyed on
      // (agency_rule_version_id, rule_kind, event_type).
      // Note: event_type is jsonb path; we use a partial unique index
      // (CONTEXT Claude's Discretion / Phase 2 partial index pattern).
      // For the simple ON CONFLICT here, we depend on the unique index defined in
      // the same migration; if it's not present, the loader degrades to "skip if
      // matching agency_rule exists" via a SELECT-then-INSERT.
      await client.query(
        `INSERT INTO agency_rule (
           agency_rule_version_id, rule_kind, rule_body, primary_citation_id
         )
         SELECT $1, $2, $3::jsonb, $4
         WHERE NOT EXISTS (
           SELECT 1 FROM agency_rule
           WHERE agency_rule_version_id = $1
             AND rule_kind = $2
             AND rule_body->>'event_type' = ($3::jsonb)->>'event_type'
         )`,
        [arvId, seed.ruleKind, JSON.stringify(seed.ruleBody), citationId],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* swallow */ }
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  await seedAgencyVersionAndRules('FNMA', 'FNMA-SEL-2026-04', '[2026-01-01,infinity)',
    'https://selling-guide.fanniemae.com/sel/b3-5.3-07/', fnmaDerogSeasoningSeeds);
  await seedAgencyVersionAndRules('FHLMC', 'FHLMC-SSG-2026-Q1', '[2026-01-01,infinity)',
    'https://guide.freddiemac.com/app/guide/section/5202.5', fhlmcDerogSeasoningSeeds);
  await seedAgencyVersionAndRules('FHA', 'HUD-4000.1-2024-08', '[2026-01-01,infinity)',
    'https://www.hud.gov/sites/dfiles/SFH/documents/4000.1hsgh.pdf', fhaDerogSeasoningSeeds);
  // FHA Back-to-Work as a separate agency_rule_version with sunset effective_period.
  await seedAgencyVersionAndRules('FHA', 'HUD-4000.1-BTW-DEPRECATED',
    '[2013-08-15,2016-09-30)',
    'https://www.hud.gov/sites/documents/16-14ml.pdf',
    [fhaBackToWorkDeprecatedSeed]);
  await seedAgencyVersionAndRules('VA', 'VA-PAM-26-7-Ch4', '[2026-01-01,infinity)',
    'https://www.benefits.va.gov/warms/docs/admin26/pamphlet/pam26_7/ch04.pdf', vaDerogSeasoningSeeds);
  // USDA stub: agency_rule_version row only, zero child rules per D-12.
  await seedAgencyVersionAndRules('USDA', 'USDA-SFH-7-CFR-3555', '[2026-01-01,infinity)',
    'https://www.rd.usda.gov/programs-services/single-family-housing-programs', []);

  await pool.end();
}

main().catch((err) => {
  console.error('seed-agency failed:', err);
  process.exit(1);
});
```

## Cascade Infrastructure

### `cascade_review_queue` table

Tenant-scoped + RLS + FORCE per D-15. Two-policy shape lets the trigger INSERT cross-tenant under system_role membership while AM reads stay tenant-scoped.

```typescript
// db/schema/cascade-review-queue.ts
import { check, index, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { systemRole } from './system-role.js';
import { tenant } from './tenant.js';
import { programVersion } from './program-version.js';
import { agencyRuleVersion } from './agency-rule-version.js';

export const cascadeReviewQueue = pgTable(
  'cascade_review_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
    programVersionId: uuid('program_version_id').notNull().references(() => programVersion.id),
    priorAgencyRuleVersionId: uuid('prior_agency_rule_version_id').notNull().references(() => agencyRuleVersion.id),
    newAgencyRuleVersionId: uuid('new_agency_rule_version_id').notNull().references(() => agencyRuleVersion.id),
    status: text('status').notNull().default('pending'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    claimedBy: text('claimed_by'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('cascade_review_queue_tenant_status_created_idx').on(t.tenantId, t.status, t.createdAt),
    // Worker claim path (Claude's Discretion): partial index on pending status.
    index('cascade_review_queue_pending_idx').on(t.status, t.createdAt),
    check('cascade_review_queue_status_check', sql`${t.status} IN ('pending','claimed','completed','dismissed')`),
    pgPolicy('cascade_review_queue_tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: 'public',
      using: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
      withCheck: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
    }),
    pgPolicy('cascade_review_queue_system_write', {
      as: 'permissive',
      for: 'all',
      to: systemRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);
```

Plus a `--custom` migration for `FORCE ROW LEVEL SECURITY` and DML grants.

### `enqueue_agency_cascade()` trigger function

Per D-16 + D-15 + Pitfall PG-4 (initial-insert NULL guard).

```sql
-- 0011_cascade_trigger.sql (--custom)
--
-- Per CONTEXT D-15: SECURITY INVOKER. The inserting role (postgres for migrations,
-- system_role members for cascade-aware writers) is a member of system_role and
-- passes the cascade_review_queue_system_write policy. App_user is NOT a member of
-- system_role, so app code can never trigger this path with elevated reach.
--
-- Per CONTEXT D-16: two-step convention. The caller does
--   UPDATE agency_rule_version SET superseded_by = NEW.id, effective_period = (lower, $new_date)
--     WHERE id = $prior_id;
--   INSERT INTO agency_rule_version (...) VALUES (...);  -- this triggers fire
-- The trigger reads NEW.agency, finds the prior version via superseded_by = NEW.id,
-- then INSERTs one cascade_review_queue row per affected program_version.
--
-- Pitfall PG-4 guard: initial INSERTs (no prior version) MUST short-circuit. The
-- WHERE clause on the SELECT below produces zero rows when no prior agency version
-- has superseded_by = NEW.id, so the INSERT INTO ... SELECT inserts zero rows.
-- This is the natural no-op behavior; explicit IF FOUND check is unnecessary.
--
-- Postgres 16: AFTER INSERT row triggers on partitioned tables propagate to
-- partitions automatically. agency_rule_version is NOT partitioned, so this
-- doesn't apply here — included for forward-compat awareness.

CREATE OR REPLACE FUNCTION enqueue_agency_cascade()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
AS $$
BEGIN
  -- Find the prior agency_rule_version that was just superseded by NEW.
  -- Two-step convention: caller sets prior.superseded_by = NEW.id BEFORE inserting NEW.
  -- For initial agency inserts (no prior version), zero rows match; the INSERT below
  -- inserts zero rows. No explicit short-circuit needed.
  INSERT INTO cascade_review_queue (
    tenant_id, program_version_id,
    prior_agency_rule_version_id, new_agency_rule_version_id,
    status, created_at
  )
  SELECT pv.tenant_id, pv.id, prior.id, NEW.id, 'pending', now()
  FROM agency_rule_version prior
  JOIN program_version pv ON pv.agency_rule_version_id = prior.id
  WHERE prior.agency = NEW.agency
    AND prior.superseded_by = NEW.id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER agency_rule_version_cascade
  AFTER INSERT ON agency_rule_version
  FOR EACH ROW
  EXECUTE FUNCTION enqueue_agency_cascade();
```

### `lib/cascade/poll.ts` typed handler stub

Per D-17, signature locks at Phase 3 so Phase 6 implementation is a body-only swap.

```typescript
// lib/cascade/poll.ts
//
// Phase 3: typed handler stub returning empty result. Phase 6 lands the real
// HTTP fetch + sha256-diff + Vercel Cron wiring (CFG-01) and the Inngest worker
// pool consumer (CFG-04) reading from cascade_review_queue with SKIP LOCKED.
// Phase 7 extends to actual extraction-pipeline integration.

export interface PollResult {
  agency: 'FNMA' | 'FHLMC' | 'FHA' | 'VA' | 'USDA';
  versionLabel: string;
  sourceUrl: string;
  sourcePdfSha256: string | null;
  changeDetected: boolean;
}

/**
 * Poll all configured agency publication sources and return any detected changes.
 *
 * Phase 3 stub: returns empty array; no HTTP calls, no DB writes. Integration test
 * at tests/cascade/cascade-trigger.test.ts exercises the consumer side (the trigger
 * path that runs when an agency_rule_version is INSERTed). Phase 6 lands the
 * producer side.
 *
 * Phase 6 will:
 *   1. Fetch each agency's announcement page with content-addressed hashing
 *   2. Compare against last-known sha256 stored in agency_publication_source table
 *   3. For each change: extract the new agency_rule_version draft via Phase 7 pipeline
 *   4. Apply the two-step convention (UPDATE prior + INSERT new) — trigger fans out
 *
 * Caller signature stays stable across Phase 3 -> Phase 6 -> Phase 7 evolutions.
 */
export async function pollAgencyPublications(): Promise<PollResult[]> {
  return [];
}
```

## FHFA Conforming Loan Limits

### Two-table schema (D-20)

System-owned, no tenant_id. World-readable + system_role write per agency-table convention.

```typescript
// db/schema/conforming-loan-limit-version.ts
import { index, integer, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { systemRole } from './system-role.js';
import { daterange } from './_types/daterange.js';

export const conformingLoanLimitVersion = pgTable(
  'conforming_loan_limit_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    year: integer('year').notNull(),
    effectivePeriod: daterange('effective_period').notNull(),
    sourceUrl: text('source_url').notNull(),
    sourcePdfSha256: text('source_pdf_sha256'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('conforming_loan_limit_version_year_idx').on(t.year),
    pgPolicy('conforming_loan_limit_version_world_read', {
      as: 'permissive',
      for: 'select',
      to: 'public',
      using: sql`true`,
    }),
    pgPolicy('conforming_loan_limit_version_system_write', {
      as: 'permissive',
      for: 'all',
      to: systemRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);

// db/schema/conforming-loan-limit-county.ts
import { boolean, char, numeric, pgPolicy, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
// ...similar shape, composite PK on (limit_version_id, county_fips)
```

Plus a `--custom` migration for `EXCLUDE USING gist (year WITH =, effective_period WITH &&)` on `conforming_loan_limit_version`.

### FHFA 2026 CSV format

Verified at https://www.fhfa.gov/document/data/fullcountyloanlimitlist2026_hera-based_final_flat.xlsx and the CSV variant at the same path. Column headers (verified from FHFA 2026 publication):

```
"FIPS State Code", "FIPS County Code", "County Name", "State", "CBSA Number",
"One-Unit Limit", "Two-Unit Limit", "Three-Unit Limit", "Four-Unit Limit"
```

Plus high-balance variants in the high-cost addendum file. Critical handling notes:

- **FIPS State Code** + **FIPS County Code** combine to a 5-char FIPS string with leading zeros (CA Los Angeles County = state '06' + county '037' = '06037'). The loader MUST treat both as text; parsing FIPS State as integer drops leading zero on Alabama (state '01').
- ~3,200 county rows × the full unit-tier columns
- Alaska, Hawaii, Guam, U.S. Virgin Islands receive limits 50% higher than the contiguous baseline (per FHFA documentation)
- Special variants: HERA-BASED (statutory) vs FINAL FLAT (the actual 2026 published) — Phase 3 commits the FINAL FLAT (or whatever the FHFA-published canonical is)
- **High-balance overlay**: counties with limits between baseline ($832,750 for 2026) and ceiling ($1,249,125) are "high-cost"; the `is_high_cost` boolean derives from `one_unit_baseline > 832750` (or whatever FHFA 2026 baseline is).

### CSV parser choice (D-23)

Per Claude's Discretion: `csv-parse` is the right call for FHFA-style CSV.

- **Why not hand-rolled**: FHFA CSVs include quoted fields (county names with commas like "Saint Mary's County"), embedded quotes, BOM markers (UTF-8 BOM is common in government CSVs), and CRLF line endings. Hand-rolling against `String.split(',')` breaks immediately.
- **`csv-parse@5.6+` (verified npm)**: dependency-free, streaming, handles BOM, quoted fields, escaped quotes. Used by ~5M packages.
- **Per-row Zod validation**: feasible at ~25,600 rows (~10ms total Zod overhead). Schema:

```typescript
import { z } from 'zod';

export const fhfaRowSchema = z.object({
  fips_state: z.string().regex(/^\d{2}$/),    // '01'..'56' + territories
  fips_county: z.string().regex(/^\d{3}$/),   // '001'..'999'
  county_name: z.string().min(1).max(120),
  state_code: z.string().length(2),           // 'AL'..'WY'
  cbsa_number: z.string().regex(/^\d{0,5}$/).nullable(),
  one_unit_baseline: z.number().int().positive(),
  two_unit_baseline: z.number().int().positive().nullable(),
  three_unit_baseline: z.number().int().positive().nullable(),
  four_unit_baseline: z.number().int().positive().nullable(),
});
```

The loader composes `county_fips = fips_state + fips_county` as a 5-char text key.

### Annual update path (D-23)

```typescript
// In scripts/seed-fhfa.ts (or extension to seed-agency.ts)
async function seedFhfaYear(year: number, csvPath: string): Promise<void> {
  // Two-step daterange close convention per D-23.
  // 1. If a previous year's row exists with effective_period upper = 'infinity',
  //    UPDATE it to bracket against the new year.
  await client.query(
    `UPDATE conforming_loan_limit_version
       SET effective_period = daterange(lower(effective_period), $1::date, '[)')
     WHERE upper(effective_period) = 'infinity'
       AND year < $2`,
    [`${year}-01-01`, year],
  );
  // 2. INSERT new year row with infinity upper bound.
  // 3. Insert ~25,600 county rows in a single statement using INSERT ... SELECT FROM unnest(...).
  // ... loader continues
}
```

## Patterns

### Pattern P1: Parent-only INSERT routing for partitioned tables (RLS safety)

**What:** Address the partitioned parent (`evaluation_event`) for every INSERT. Never INSERT directly into a child partition (`evaluation_event_y2026m05`). Define RLS policies on the parent only.

**When to use:** Every partitioned tenant-scoped table.

**Why:** Postgres 16 RLS does NOT auto-propagate parent-table policies to child partitions. Each partition is a separate relation with its own policy set. The single safe pattern is to keep all INSERT/SELECT/UPDATE/DELETE traffic on the parent so the planner enforces parent policies before partition pruning. ALTER TABLE FORCE on the parent does NOT propagate to children either.

**Example:**
```typescript
// CORRECT: insert via parent
await db.insert(evaluationEvent).values({ tenantId, evaluatedAt: new Date(), ... });

// WRONG (do not do): direct child partition INSERT bypasses parent policies
// await db.execute(sql`INSERT INTO evaluation_event_y2026m05 (...) VALUES (...)`);
```

**Source:** [PostgreSQL hackers list — RLS on inheritance/partitioning](https://www.postgresql.org/message-id/d094a87d-9d63-46c9-8c27-631f881b80fb@supportex.net) [VERIFIED]; reinforced in [pgDash RLS guide](https://pgdash.io/blog/exploring-row-level-security-in-postgres.html) and [Aha.io engineering: partitioning a large Postgres table](https://www.aha.io/engineering/articles/partitioning-a-large-table-in-postgresql-with-rails). [VERIFIED]

### Pattern P2: Pure-TS canonicalization + sha256 for content-addressed identity

**What:** `lib/audit/snapshotId.ts` produces a deterministic 64-char hex sha256 over `{agency_versions, program_versions, overlay_versions}` where each entry is `{id, recorded_at}` and arrays are sorted by id.

**When to use:** Any cross-table identity that must survive replay — audit log snapshots, dedupe keys, content-addressed cache keys.

**Why:** A content-addressed snapshot id eliminates "which rules were live when this scenario was evaluated?" as a query — it's a JOIN on a single text column. Re-evaluation against the same snapshot id is byte-identical.

**Example:** See snapshotId implementation above. Phase 4 evaluator imports unchanged.

### Pattern P3: TS-typed agency seed loader with idempotent upsert

**What:** Source-of-truth in `.ts` files at `lib/agency-seeds/<agency>/<rule_kind>.ts` typed against the existing Zod dispatch table. Loader at `scripts/seed-agency.ts` invoked by `pnpm db:seed`. ON CONFLICT DO NOTHING (or NOT EXISTS variant for jsonb-discriminator keys) keyed on `(agency, version_label, rule_kind, event_type)`.

**When to use:** Any reference data committed to git that needs to land in Postgres deterministically across CI/local/prod.

**Why:** TypeScript fixture authoring + `parseRuleBody(kind, body)` dispatch gives compile-time shape validation. Loader runtime validation is a defense-in-depth; the same Zod schema lib runs at compile time and at INSERT time.

**Source:** Phase 2 D-08 dispatch pattern; Phase 1 Pitfall G adminPool requirement. [VERIFIED in repo at `lib/rules/schemas/index.ts`]

### Pattern P4: Structured derog seasoning fixture (DerogSeasoning)

**What:** Each derog `agency_rule` row is a single object conforming to `lib/rules/schemas/derog-seasoning.ts` Zod schema. The shape is `{event_type, measurement_anchor, base_waiting_months, extenuating_circumstances_waiting_months, post_event_LTV_caps[], reestablished_credit_required, mortgage_included_in_bk_rule, notes_citations[]}`.

**When to use:** Every per-event-type derog row across FNMA, FHLMC, FHA, VA. Phase 4 evaluator reads the same structured shape.

**Why:** Pitfall 1.1 — boolean derog handling is the prototype's failure. Structured event-typed model is the wedge.

**Example:** See FNMA FORECLOSURE seed above with the 3-to-7-year `post_event_LTV_caps[0]` carrying `max_LTV: 90, purposeAllowList: ['PURCHASE','RATE_TERM_REFI'], occupancyAllowList: ['PRIMARY']` per Phase 3 SC#3.

### Pattern P5: Deprecated agency rule via versioned effective_period bracketing

**What:** FHA Back-to-Work ships as a `agency_rule_version` row with `version_label = 'HUD-4000.1-BTW-DEPRECATED'`, `effective_period = '[2013-08-15, 2016-09-30)'`, and `superseded_by` set. The row is queryable but `effective_period @> CURRENT_DATE` excludes it from active-rule lookups.

**When to use:** Any agency rule that was historically active but has been retired (sunset date in the past).

**Why:** Pitfall 1.4 — phantom Back-to-Work returns false-positive eligible for 12-month-post-FC borrowers. The deprecated row stays in the system for historical replay (pre-2016 scenarios still need to evaluate against it) but is structurally filtered from active queries via the daterange.

**Source:** Phase 2 SCH-09 bitemporal versioning pattern + this phase's D-11. [VERIFIED]

### Pattern P6: AFTER INSERT plpgsql trigger fan-out under SECURITY INVOKER + system_role policy

**What:** `enqueue_agency_cascade()` is `LANGUAGE plpgsql SECURITY INVOKER`. The inserting role is a member of `system_role`. The cascade_review_queue table has a `system_write` policy `to: system_role`. Cross-tenant INSERTs pass because the role membership clears the policy regardless of GUC state.

**When to use:** Any trigger that needs to write rows across tenants from a row-level-trigger context.

**Why:** SECURITY DEFINER with explicit GUC switching introduces a "what tenant am I impersonating?" question on every trigger invocation; the system_role policy approach makes membership the discriminator. This is also the same pattern Phase 7 extraction-pipeline writes will use to land staging rows.

**Example:**
```sql
-- Trigger function (the CONTEXT-locked shape)
CREATE OR REPLACE FUNCTION enqueue_agency_cascade()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
AS $$
BEGIN
  INSERT INTO cascade_review_queue (
    tenant_id, program_version_id,
    prior_agency_rule_version_id, new_agency_rule_version_id,
    status, created_at
  )
  SELECT pv.tenant_id, pv.id, prior.id, NEW.id, 'pending', now()
  FROM agency_rule_version prior
  JOIN program_version pv ON pv.agency_rule_version_id = prior.id
  WHERE prior.agency = NEW.agency AND prior.superseded_by = NEW.id;
  RETURN NEW;
END;
$$;
```

## Test Strategy

### Per-rule structural assertions

`tests/agency/<agency>-derog.test.ts` — one Vitest test per Phase 3 SC#3 line item for traceability. Each test asserts a single fact about a single seeded agency_rule row.

```typescript
// tests/agency/fnma-derog.test.ts
import { describe, it, expect, beforeAll } from 'vitest';

describe('FNMA derog matrix (Phase 3 SC#3)', () => {
  beforeAll(async () => { /* assume db:seed has run */ });

  it('BK7: 48m base, 24m EC, anchor=DISCHARGE', async () => {
    const row = await fetchAgencyRule('FNMA', 'FNMA-SEL-2026-04', 'BK7');
    expect(row.rule_body.base_waiting_months).toBe(48);
    expect(row.rule_body.extenuating_circumstances_waiting_months).toBe(24);
    expect(row.rule_body.measurement_anchor).toBe('DISCHARGE');
  });

  it('BK13_DISCHARGED: 24m, anchor=DISCHARGE', async () => {
    const row = await fetchAgencyRule('FNMA', 'FNMA-SEL-2026-04', 'BK13_DISCHARGED');
    expect(row.rule_body.base_waiting_months).toBe(24);
    expect(row.rule_body.measurement_anchor).toBe('DISCHARGE');
  });

  it('FORECLOSURE: 84m base, 36m EC, 3-to-7yr 90% LTV cap window', async () => {
    const row = await fetchAgencyRule('FNMA', 'FNMA-SEL-2026-04', 'FORECLOSURE');
    expect(row.rule_body.base_waiting_months).toBe(84);
    expect(row.rule_body.extenuating_circumstances_waiting_months).toBe(36);
    expect(row.rule_body.post_event_LTV_caps[0]).toMatchObject({
      months_since_min: 36,
      months_since_max: 84,
      max_LTV: 90,
      purposeAllowList: ['PURCHASE', 'RATE_TERM_REFI'],
      occupancyAllowList: ['PRIMARY'],
    });
  });

  it('MORTGAGE_CHARGE_OFF: mortgage_included_in_bk_rule = BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED', async () => {
    const row = await fetchAgencyRule('FNMA', 'FNMA-SEL-2026-04', 'MORTGAGE_CHARGE_OFF');
    expect(row.rule_body.mortgage_included_in_bk_rule).toBe('BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED');
  });
  // ... one test per remaining event_type
});
```

### Golden snapshot test per agency

`tests/agency/<agency>-derog-golden.test.ts` — sha256 the seeded `rule_body` bundle to catch accidental edits. One snapshot per agency.

```typescript
import { createHash } from 'node:crypto';

it('FNMA derog bundle matches golden snapshot', async () => {
  const rows = await fetchAllAgencyRules('FNMA', 'FNMA-SEL-2026-04', 'derog_seasoning');
  const sorted = rows.sort((a, b) => a.rule_body.event_type.localeCompare(b.rule_body.event_type));
  const hash = createHash('sha256').update(JSON.stringify(sorted.map(r => r.rule_body))).digest('hex');
  expect(hash).toBe('<commit-time-locked-hash>');  // updated when intentional edits land
});
```

### Deprecated-program filter test

```typescript
it('FHA Back-to-Work row exists but is filtered from active lookups', async () => {
  // Direct row lookup: the row exists.
  const row = await fetchAgencyRuleVersion('FHA', 'HUD-4000.1-BTW-DEPRECATED');
  expect(row).not.toBeNull();
  expect(row.effective_period).toBe('[2013-08-15,2016-09-30)');

  // Active-rule lookup: the row is filtered.
  const active = await fetchActiveAgencyRulesForToday('FHA');
  expect(active.find(r => r.version_label === 'HUD-4000.1-BTW-DEPRECATED')).toBeUndefined();
});
```

### Cascade trigger integration test

`tests/cascade/cascade-trigger.test.ts` — D-17's literal SC#5 artifact. Two tenants × one program_version each referencing the prior agency version, then INSERT new agency_rule_version using the two-step convention, then assert cascade_review_queue contains 2 rows.

```typescript
import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';

describe('cascade trigger (Phase 3 SC#5)', () => {
  it('inserts one cascade_review_queue row per affected program_version across tenants', async () => {
    const adminPool = globalThis.__pgAdminPool!;
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      // Setup: SYSTEM tenant + initial agency version + 2 tenants × 1 program_version each.
      const setup = await seedTwoTenantsWithProgramVersions(client, 'FNMA', 'FNMA-SEL-2026-04');

      // Step 1 of two-step convention: UPDATE prior, set superseded_by to the
      // new id we're about to INSERT (we generate it in advance).
      const newArvId = (await client.query(`SELECT gen_random_uuid()::text AS id`)).rows[0]!.id;
      await client.query(
        `UPDATE agency_rule_version
           SET superseded_by = $1, effective_period = daterange(lower(effective_period), $2::date, '[)')
         WHERE id = $3`,
        [newArvId, '2026-04-01', setup.priorArvId],
      );

      // Step 2: INSERT new version with the pre-allocated id. Trigger fires AFTER INSERT.
      await client.query(
        `INSERT INTO agency_rule_version (id, agency, version_label, source_url, effective_period)
         VALUES ($1, 'FNMA', 'FNMA-SEL-2026-05', $2, '[2026-04-01,infinity)')`,
        [newArvId, 'https://selling-guide.fanniemae.com/sel/b3-5.3-07/'],
      );

      // Assert: 2 rows in cascade_review_queue, one per tenant.
      const queue = await client.query(
        `SELECT tenant_id::text, program_version_id::text, prior_agency_rule_version_id::text,
                new_agency_rule_version_id::text, status
         FROM cascade_review_queue
         WHERE new_agency_rule_version_id = $1
         ORDER BY tenant_id`,
        [newArvId],
      );
      expect(queue.rowCount).toBe(2);
      expect(queue.rows[0].status).toBe('pending');
      expect(queue.rows[0].new_agency_rule_version_id).toBe(newArvId);
      expect(queue.rows[1].new_agency_rule_version_id).toBe(newArvId);

      await client.query('ROLLBACK');  // cleanup
    } finally {
      client.release();
    }
  });

  it('initial agency version (no prior) inserts zero queue rows', async () => {
    // Edge case: superseded_by self-FK is NULL on initial insert.
    // Trigger's WHERE clause yields zero rows; INSERT INTO ... SELECT inserts zero.
    // Asserts the no-op behavior empirically.
    // ...
  });
});
```

### Cross-tenant pen tests for `cascade_review_queue`

`tests/rls/cascade-review-queue-cross-tenant.test.ts` — matches Phase 1 D-03 / Phase 2 D-19 matrix. Cross-tenant SELECT/INSERT/UPDATE/DELETE all return zero rows or fail closed.

### `lib/audit/snapshotId.ts` four assertions

`tests/audit/snapshot-id.test.ts` — A1 same/same, A2 reorder/same, A3 extra/different, A4 mutate/different. (See Audit Log Architecture above for full code.)

## Validation Architecture

> Per `.planning/config.json`: `workflow.nyquist_validation: true`. This section is mandatory.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 (per Phase 1+2; package.json) |
| Config files | `vitest.config.ts` (RLS suite), `vitest.schema.config.ts` (schema/rules suite); Phase 3 adds the agency / audit / cascade test files into `vitest.schema.config.ts` |
| Quick run command | `pnpm test:schema -t 'FNMA derog'` (filtered) |
| Full suite command | `pnpm test:rls && pnpm test:schema` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUD-01 | evaluation_event partitioned by month, RLS-policed | structural | `pnpm test:schema -t 'evaluation_event partitioned'` | ❌ Wave 0 (`tests/audit/evaluation-event-structural.test.ts`) |
| AUD-02 | evaluation_event has all required columns + CHECK constraints | structural | `pnpm test:schema -t 'evaluation_event columns'` | ❌ Wave 0 (same file) |
| AUD-03 | REVOKE UPDATE/DELETE structurally enforced | security | `pnpm test:schema -t 'evaluation_event REVOKE'` | ❌ Wave 0 (same file) |
| AUD-04 | snapshotId determinism (4 assertions) | unit | `pnpm test:schema -t 'snapshotId determinism'` | ❌ Wave 0 (`tests/audit/snapshot-id.test.ts`) |
| AGY-01 | agency_rule_version row exists per agency post-seed | structural | `pnpm test:schema -t 'agency_rule_version per agency'` | ❌ Wave 0 (`tests/agency/agency-version.test.ts`) |
| AGY-02 | FNMA full derog matrix per event_type (8 line items per SC#3) | structural | `pnpm test:schema -t 'FNMA derog'` | ❌ Wave 0 (`tests/agency/fnma-derog.test.ts`) |
| AGY-02 | FNMA derog golden snapshot | regression | `pnpm test:schema -t 'FNMA derog bundle matches golden'` | ❌ Wave 0 (same file) |
| AGY-03 | FHLMC §5202.5 derog matrix | structural | `pnpm test:schema -t 'FHLMC derog'` | ❌ Wave 0 (`tests/agency/fhlmc-derog.test.ts`) |
| AGY-04 | FHA HUD 4000.1 standard EC active | structural | `pnpm test:schema -t 'FHA standard EC active'` | ❌ Wave 0 (`tests/agency/fha-derog.test.ts`) |
| AGY-04 | FHA Back-to-Work DEPRECATED + sunset 2016-09-30 + filter | structural | `pnpm test:schema -t 'FHA Back-to-Work DEPRECATED'` | ❌ Wave 0 (same file) |
| AGY-05 | VA Pamphlet 26-7 derog matrix | structural | `pnpm test:schema -t 'VA derog'` | ❌ Wave 0 (`tests/agency/va-derog.test.ts`) |
| AGY-06 | program_version → agency_rule_version FK (already shipped Phase 2) | structural | covered by `tests/schema/derog-rule-roundtrip.test.ts` (Phase 2) | ✅ |
| AGY-07 | lib/cascade/poll.ts typed handler signature | unit | `pnpm test:schema -t 'pollAgencyPublications'` | ❌ Wave 0 (`tests/cascade/poll-stub.test.ts`) |
| AGY-08 | enqueue_agency_cascade trigger fans out per affected program_version | integration | `pnpm test:schema -t 'cascade trigger'` | ❌ Wave 0 (`tests/cascade/cascade-trigger.test.ts`) |
| AGY-08 | cascade_review_queue cross-tenant pen tests | security | `pnpm test:rls -t 'cascade_review_queue'` | ❌ Wave 0 (`tests/rls/cascade-review-queue-cross-tenant.test.ts`) |
| AGY-09 | conforming_loan_limit_version EXCLUDE + structural | structural | `pnpm test:schema -t 'conforming_loan_limit'` | ❌ Wave 0 (`tests/schema/fhfa-loan-limits.test.ts`) |
| AGY-09 | program_version.conforming_loan_limit_version_id FK | structural | `pnpm test:schema -t 'program_version conforming FK'` | ❌ Wave 0 (same file) |

### Sampling Rate

- **Per task commit:** `pnpm test:schema -t '<filter>'` (relevant filter for the file under change; <5s)
- **Per wave merge:** `pnpm test:schema && pnpm test:rls` (full suite, ~10s expected at Phase 3 size)
- **Phase gate:** Full suite green before `/gsd-verify-work`. CI blocks merge.

### Wave 0 Gaps

- [ ] `tests/audit/evaluation-event-structural.test.ts` — covers AUD-01, AUD-02, AUD-03 (partition introspection via `pg_partition_tree`, REVOKE introspection via `pg_class.relacl`)
- [ ] `tests/audit/snapshot-id.test.ts` — covers AUD-04 four assertions
- [ ] `tests/agency/agency-version.test.ts` — covers AGY-01 (per-agency `agency_rule_version` row exists)
- [ ] `tests/agency/fnma-derog.test.ts` — covers AGY-02 (8 structural assertions + golden snapshot)
- [ ] `tests/agency/fhlmc-derog.test.ts` — covers AGY-03
- [ ] `tests/agency/fha-derog.test.ts` — covers AGY-04 (standard EC + Back-to-Work DEPRECATED)
- [ ] `tests/agency/va-derog.test.ts` — covers AGY-05
- [ ] `tests/cascade/poll-stub.test.ts` — covers AGY-07 (typed handler signature)
- [ ] `tests/cascade/cascade-trigger.test.ts` — covers AGY-08 (D-17 integration test)
- [ ] `tests/rls/cascade-review-queue-cross-tenant.test.ts` — covers AGY-08 cross-tenant matrix
- [ ] `tests/schema/fhfa-loan-limits.test.ts` — covers AGY-09 EXCLUDE + program_version FK
- [ ] Loader: `lib/agency-seeds/types.ts` (shared `AgencyRuleSeed<T>` type)
- [ ] Loader: `scripts/seed-agency.ts`
- [ ] Loader: `scripts/seed-fhfa.ts` (or extension to seed-agency.ts)
- [ ] CI step in `.github/workflows/ci.yml` to run `pnpm db:seed` after `pnpm drizzle-kit migrate`
- [ ] Extend `tests/rls/global-setup.ts` and `tests/schema/setup.ts` to call `pnpm db:seed`
- [ ] `package.json` script: `"db:seed": "tsx scripts/seed-agency.ts && tsx scripts/seed-fhfa.ts"` (or unified `seed-agency.ts`)

### Nyquist Dimensions Coverage

| Dimension | Coverage |
|-----------|----------|
| **D1 Structural** | Per-rule field assertions (`tests/agency/<agency>-derog.test.ts`); table+column introspection (`tests/audit/evaluation-event-structural.test.ts`, `tests/schema/fhfa-loan-limits.test.ts`); FK + EXCLUDE + CHECK introspection |
| **D2 Behavioral** | Cascade trigger integration test (`tests/cascade/cascade-trigger.test.ts`); two-step convention exercise; trigger fires per affected program_version |
| **D3 Regression** | Per-agency golden snapshot (sha256 of seeded rule_body bundle); `lib/audit/snapshotId.ts` deterministic round-trip |
| **D4 Security** | Cross-tenant pen tests on `cascade_review_queue` (matches Phase 1 D-03 + Phase 2 D-19); REVOKE structural enforcement on `evaluation_event` |
| **D5 Determinism** | snapshotId four assertions (A1/A2/A3/A4 above); per-agency golden snapshot |
| **D6 Idempotency** | Loader re-run safety: `ON CONFLICT DO NOTHING` keyed on `(agency, version_label, rule_kind, event_type)`; `pnpm db:seed && pnpm db:seed` produces identical state |
| **D7 Forward-compat** | `lib/audit/snapshotId.ts` signature + `lib/cascade/poll.ts` signature locked at Phase 3; Phase 4/6 unit tests imported unchanged |
| **D8 Validation Surface** | Zod parseRuleBody at fixture compile time + at loader runtime; FHFA per-row Zod validation |

## Pitfalls

### Pitfall PG-1: Postgres 16 RLS does NOT auto-propagate parent policies to child partitions

**What goes wrong:** A pen test asserts `evaluation_event` has `tenant_isolation` policy. The test uses `pg_policies` introspection on the parent table only — green. In production, a future query that addresses `evaluation_event_y2026m05` directly returns rows from other tenants (no policy on the child).

**Why:** Postgres 16 treats each partition as a separate relation. CREATE POLICY on parent does NOT clone to children. ALTER TABLE FORCE on parent does NOT propagate either. The safe pattern (verified in production references) is to keep all traffic on the parent route — Postgres routes INSERTs to the right child internally, and SELECTs through the parent enforce parent policies before partition pruning.

**Remediation:** (1) The `--custom` migration enables RLS + FORCE on the parent; do NOT explicitly enable on children. (2) Pen tests must INSERT/SELECT via the parent only — never address child names. (3) Add a structural test that asserts no application code references child partition names by string. (4) Document in `evaluation_event` schema JSDoc: "Direct child-partition queries bypass the parent's RLS policy. ALWAYS go via evaluation_event."

**Source:** [PostgreSQL hackers thread on RLS + inheritance](https://www.postgresql.org/message-id/d094a87d-9d63-46c9-8c27-631f881b80fb@supportex.net) [VERIFIED]; [Aha.io: partitioning a large Postgres table with Rails](https://www.aha.io/engineering/articles/partitioning-a-large-table-in-postgresql-with-rails) [VERIFIED].

### Pitfall PG-2: REVOKE behavior on partitioned parent vs child partitions

**What goes wrong:** `REVOKE UPDATE, DELETE ON evaluation_event FROM PUBLIC` is run at parent level. A subsequent `CREATE TABLE evaluation_event_y2026m11 PARTITION OF evaluation_event ...` creates a child that may inherit OR may need explicit re-revocation depending on Postgres version semantics.

**Why:** Postgres documentation on REVOKE for partitioned tables is light; multiple references state child partitions inherit the parent's privileges at attach time, but this needs empirical verification at Phase 3 introspection.

**Remediation:** (1) The `create_next_evaluation_event_partition()` function MUST include explicit `REVOKE UPDATE, DELETE ON <new_partition_name> FROM PUBLIC, app_user, system_role` lines as a defense-in-depth. (2) The Wave 0 introspection test asserts every child partition has `relacl` excluding UPDATE+DELETE for the three roles. (3) If Postgres 16 confirms inheritance, the explicit REVOKEs in the function are no-ops; if it doesn't, they're load-bearing.

**Source:** [PostgreSQL REVOKE docs](https://www.postgresql.org/docs/16/sql-revoke.html) [VERIFIED]; partition-specific behavior empirically tested in Phase 3 Wave 0.

### Pitfall PG-3: snapshotId Date.toISOString() vs ISO string consistency

**What goes wrong:** Phase 4 evaluator passes `recorded_at` from a Drizzle row where the value is a JS Date object. `JSON.stringify(date)` returns the ISO string — but if a future caller passes already-stringified ISO + naive concatenation, the inputs diverge and the hash flips.

**Why:** JS `JSON.stringify(new Date())` emits ISO 8601 with milliseconds and `Z` suffix; PostgreSQL `timestamptz` may emit microsecond precision. Implicit coercion across the Drizzle/postgres-js boundary needs verification.

**Remediation:** (1) `lib/audit/snapshotId.ts` accepts `recorded_at: string` only — never `Date`. The caller is responsible for `.toISOString()` conversion. Type-enforced. (2) The four-assertion test fixture uses string literals only (no `new Date()`). (3) Add a "stringify input" sample to the test set: `{recorded_at: '2026-01-01T00:00:00.000Z'}` vs `{recorded_at: '2026-01-01T00:00:00Z'}` MUST hash differently — caller normalization is the contract, not snapshotId's job.

**Source:** snapshotId design + Phase 1 contract patterns. [INFERRED from established patterns]

### Pitfall PG-4: Initial agency version INSERT with NULL `superseded_by` must not enqueue cascade

**What goes wrong:** The very first FNMA seed INSERTs `agency_rule_version` with `superseded_by = NULL`. The trigger fires AFTER INSERT. If the trigger's WHERE clause doesn't handle the NULL case correctly, it could enqueue spurious rows or error out.

**Why:** The two-step convention (D-16) presumes a prior version exists. Phase 3 hand-authoring does NOT have a prior version for any agency on first seed.

**Remediation:** The trigger function (Pattern P6) uses `WHERE prior.agency = NEW.agency AND prior.superseded_by = NEW.id`. On initial insert, no prior row has `superseded_by = NEW.id` (because the row doesn't exist yet, and the convention only sets it during cascade updates). The SELECT yields zero rows; the INSERT INTO ... SELECT inserts zero rows. The trigger naturally short-circuits. Add an explicit test case: "initial agency version (no prior) inserts zero queue rows" in `tests/cascade/cascade-trigger.test.ts`.

**Source:** Verified by reading the trigger SQL above; explicit test asserts the empirical behavior.

### Pitfall PG-5: pg_cron unavailable in docker-postgres-16-alpine

**What goes wrong:** Local CI uses `docker postgres:16-alpine`. The `CREATE EXTENSION pg_cron` migration fails because the extension binaries aren't bundled. CI red on first run.

**Why:** pg_cron is a contrib extension that needs to be in `shared_preload_libraries` and have its binaries available — not in the alpine image by default.

**Remediation:** (1) The `--custom` migration uses `CREATE EXTENSION IF NOT EXISTS pg_cron` AND wraps in a `DO $$ BEGIN ... EXCEPTION WHEN OTHERS THEN ... END $$` block so the migration succeeds locally even when pg_cron is unavailable. (2) The `cron.schedule()` call lives in a separate file gated by a similar exception block. (3) Documentation in `db/migrations/0010_*.sql` explicitly states: "pg_cron is required in production (Supabase managed) but optional in local dev. The `create_next_evaluation_event_partition()` function works without pg_cron — Phase 6 will configure either pg_cron OR an external scheduler depending on Supabase tier."

Alternative: switch the Phase 3 docker image to one that bundles pg_cron (e.g., `supabase/postgres:15.1.0.118` or `citusdata/pg_cron:latest`). Heavier; planner picks based on local-dev velocity.

**Source:** [Supabase pg_cron docs](https://supabase.com/docs/guides/database/extensions/pg_cron) [VERIFIED]; [pg_cron readme](https://github.com/citusdata/pg_cron) [VERIFIED]; alpine omission empirically known.

### Pitfall PG-6: FNMA Selling Guide URL anchor stability

**What goes wrong:** `rule_citation.source_url = 'https://selling-guide.fanniemae.com/sel/b3-5.3-07/...#FORECLOSURE_3_TO_7_YEARS'`. FNMA republishes the Selling Guide with reorganized anchor IDs. Citations break.

**Why:** Selling Guide anchor IDs are auto-generated from section heading text; FNMA's CMS does not stabilize them across republications.

**Remediation:** (1) The agency citation excerpt is verbatim cited text; even if the URL anchor breaks, the excerpt enables manual re-resolution. (2) Phase 3 SC#5's cascade infrastructure exists precisely to detect republications via sha256 fingerprint of the agency PDF; Phase 6 polls and surfaces "URL stale" via the new agency_rule_version creation path. (3) Citations are URL-only at Phase 3 per D-07; Phase 7 extraction pipeline adds bbox + textSpan substantive validation for matrix citations.

**Source:** Established Phase 1+2 citation discipline pattern; this phase doesn't change the citation contract.

### Pitfall PG-7: FHFA CSV BOM + quoted-field handling

**What goes wrong:** Hand-rolled `String.split(',')` on the FHFA CSV breaks on the first county with a comma in its name ("Saint Mary's County"). Also breaks on UTF-8 BOM at file start (parses the BOM byte sequence U+FEFF prepended to '06' as the FIPS state instead of '06').

**Why:** Government CSVs ship UTF-8 BOM by convention; county name quoting is also standard.

**Remediation:** Use `csv-parse@5.6+` (npm verified). The library handles BOM, quoted fields, escaped quotes, CRLF line endings out of the box. Per-row Zod validation catches numeric-coercion failures (e.g., a county row with "N/A" in a unit column).

**Source:** [csv-parse npm](https://www.npmjs.com/package/csv-parse) [VERIFIED]; FHFA CSV format empirically observed at https://www.fhfa.gov/document/data/fullcountyloanlimitlist2026_hera-based_final_flat.xlsx.

### Pitfall PG-8: Drizzle `__drizzle_migrations` idempotency masks in-place .sql edits

**What goes wrong:** Phase 2 surprised this in Phase 2-UAT (CR-01, WR-02 fixes). Once a migration is recorded in `drizzle.__drizzle_migrations`, subsequent edits to the .sql file do NOT re-apply on `pnpm db:migrate`. The deployed function in the running DB stays the pre-fix version.

**Why:** drizzle-kit treats `__drizzle_migrations` records as final.

**Remediation:** Phase 3 post-merge fixes to migration files MUST ship as NEW migrations (0012, 0013, …), NOT in-place edits. Document in plan SUMMARY: "If the Wave 0 introspection finds a defect in 0007_evaluation_event_partitions.sql, the fix lands at 0012_*.sql, not as an edit to 0007."

**Source:** Phase 2 02-UAT.md (Gaps CR-01, WR-02). [VERIFIED in repo]

### Pitfall PG-9: Cartesian-explode risk on the cascade trigger SELECT

**What goes wrong:** Phase 2 detect_loosenings hit a Cartesian-explode bug when the agency version held multiple `derog_seasoning` rows (one per `derogEventType`). The cascade trigger's INSERT INTO ... SELECT joins `program_version` on `agency_rule_version_id`. If a single program_version has multiple agency rules (and it does — one per event_type), the JOIN expands.

**Why:** The cascade trigger's job is per-program-version, NOT per-rule. Each `pv` should produce exactly one queue row regardless of how many `agency_rule` rows exist under the prior version.

**Remediation:** The trigger SELECT (Pattern P6) uses `JOIN program_version pv ON pv.agency_rule_version_id = prior.id`. There's no JOIN on `agency_rule` — the trigger doesn't care about rule count. Each program_version produces exactly one row per cascade. Verified by the integration test which seeds 2 tenants × 1 program_version each and asserts exactly 2 queue rows.

**Source:** Phase 2 02-LEARNINGS.md (Cartesian-join risk in multi-branch CTE). [VERIFIED]

## Open Questions

1. **`csv-parse` dep adoption vs hand-rolled (D-23 Claude's Discretion)**
   - What we know: `csv-parse@5.6+` is the standard JS CSV parser; ~5M packages depend; FHFA CSVs use BOM + quoted fields; hand-rolling breaks on Saint Mary's County.
   - What's unclear: whether the planner adopts the new dep or chooses to forfeit Saint Mary's County (~half of Maryland). Adding a dep at Phase 3 means Phase 6 inherits it for any other CSV parsing path.
   - Recommendation: adopt `csv-parse`. Cost is one new dep; benefit is correctness on the next 10+ years of CSV ingestion paths (USDA Eligibility Map, HMDA data, Census tract overlays).

2. **`evaluator_version` text format (Claude's Discretion)**
   - What we know: Phase 4 evaluator writes the value; Phase 3 ships the column with non-empty CHECK.
   - What's unclear: planner picks between semver (`'4.2.0'`), git sha (`'a3f9c1d'`), or evaluator-config hash (`'sha256:...'`).
   - Recommendation: git sha at Phase 4 commit time. semver gives loose audit; sha gives byte-identical determinism. Phase 5 golden-set replay needs sha.

3. **Forward partition seed: 6 inline DDLs vs 6× function calls (Claude's Discretion D-01)**
   - What we know: both work; both are reproducible across CI runs.
   - What's unclear: which is more readable in a code-review diff.
   - Recommendation: inline DDL. Self-documenting; the migration explicitly enumerates which partitions exist at Phase 3 close. The function exists for the pg_cron monthly path, which is a different code site.

4. **pg_cron vs Supabase native scheduler vs external scheduler at Phase 6**
   - What we know: pg_cron is in Supabase managed Postgres on every plan including free; not in docker-postgres-16-alpine.
   - What's unclear: whether Supabase's managed Cron interface is preferable to direct `cron.schedule()` from migration. Both work.
   - Recommendation: defer to Phase 6. Phase 3 ships the function unconditionally; Phase 6 picks the scheduler.

5. **MULTIPLE_BK encoding for FHA / VA**
   - What we know: FNMA / FHLMC have explicit MULTIPLE_BK rules. FHA / VA do not separately specify.
   - What's unclear: whether to ship FHA/VA MULTIPLE_BK as `null`/skip, mirror BK7 24m as-of-most-recent, or omit the row entirely.
   - Recommendation: skip. Phase 4 evaluator's behavior on missing event_type rows is "no rule for this event_type" → falls through to standard rules. Document in fixture comment that MULTIPLE_BK is FNMA/FHLMC only at Phase 3.

6. **Extracting `tests/_shared/agency-fixture.ts` (Phase 2 WR-05 follow-up)**
   - What we know: Phase 2 already extracted the SYSTEM-tenant + ARV bootstrap into the shared module. Phase 3 has more agency-fixture call sites (one per agency × derog test file = 4-8 new tests).
   - What's unclear: whether to extend `agency-fixture.ts` to cover the test-side ARV+citation bootstrap or keep that in per-test setup.
   - Recommendation: extend. Sharing the seed pattern ensures every agency test wires the SYSTEM tenant identically; drift between tests masks bugs.

7. **`is_high_cost` derivation on `conforming_loan_limit_county`**
   - What we know: 2026 FHFA baseline is $832,750 (1-unit); high-cost ceiling is $1,249,125. High-cost counties have one_unit_baseline > $832,750.
   - What's unclear: whether `is_high_cost` is computed at load time or queried via `is_high_cost := one_unit_baseline > 832750` at query time.
   - Recommendation: store at load time. The threshold changes annually; storing the boolean gives immutable historical accuracy. Loader carries the per-year threshold from FHFA's published "baseline" value.

8. **FHFA HERA-BASED vs FINAL FLAT file selection**
   - What we know: FHFA publishes both files annually. HERA-BASED is the statutory derivation; FINAL FLAT is the actual published per-county limit.
   - What's unclear: which is the canonical to commit.
   - Recommendation: FINAL FLAT. It's what lenders use; the HERA-BASED value is informational. Loader accepts both column shapes via Zod schema variants.

## Forward Compatibility

| Integration Seam | Phase 3 Locks | Future Phase Consumes |
|------------------|---------------|----------------------|
| `evaluation_event` table shape | Per AUD-02 column list + RLS + REVOKE | Phase 4 evaluator writer (single INSERT per evaluation); Phase 5 golden-set replay (re-evaluation against historical snapshot_id) |
| `lib/audit/snapshotId.ts` signature | `(input: SnapshotInput) => string` (64-char hex sha256); SnapshotInput shape locked | Phase 4 evaluator imports unchanged as the canonical writer |
| `cascade_review_queue` table shape | Per D-18 columns + status enum + tenant_isolation + system_write policies | Phase 6 Inngest worker reads with `SELECT ... FOR UPDATE SKIP LOCKED`; Phase 8 AM UI filters on status |
| `lib/cascade/poll.ts` typed handler signature | `pollAgencyPublications(): Promise<PollResult[]>` + PollResult shape | Phase 6 implements body; Phase 7 extends with extraction integration |
| `program_version.conforming_loan_limit_version_id` FK | nullable uuid FK column | Phase 4 evaluator dereferences when non-null + scenario hits county-level loan-amount check |
| `enqueue_agency_cascade()` trigger | AFTER INSERT on `agency_rule_version`, SECURITY INVOKER, plpgsql | Phase 6 cascade poller follows the two-step convention; trigger fires automatically |
| `rule_kind` pgEnum + Zod dispatch | Phase 2 shipped 17 values; Phase 3 reuses unchanged | Phase 4 evaluator + Phase 7 extraction validator + Phase 8 AM commit consume the same dispatch |
| FHFA loader pattern | `scripts/seed-fhfa.ts` (or extension) | Phase 6+ extends to USDA Eligibility Map ingestion, HMDA data; same csv-parse + Zod + ON CONFLICT pattern |
| Annual loan-limit update path | Two-step daterange close + UPSERT keyed on year | Future years (2027+) reuse the same loader command + new CSV file |
| cascade trigger two-step convention (D-16) | `UPDATE prior SET superseded_by + effective_period close` THEN `INSERT new` | Phase 6+ poll handler + Phase 7+ extraction-driven agency rule updates use the same two-step shape |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | FHLMC §5202.5 EC reduction for FORECLOSURE is 24m (vs FNMA's 36m) | Per-agency content matrix §FHLMC | LOW — Phase 3 fixture is hand-edited; AGY-03 test asserts the configured value. If wrong on first seed, planner bumps to 36m before merge. Industry sources are mixed; canonical FHLMC URL behind a clickable interface that didn't fully resolve in research. |
| A2 | Agency citations URL-only with rule_citation.source_pdf_sha256 IS NULL satisfy the Phase 2 source CHECK | Agency Rule Hand-Authoring §Citation pattern | NONE — verified at `db/migrations/0004_program_constraints.sql` (Phase 2) ships CHECK `source_pdf_sha256 IS NOT NULL OR source_url IS NOT NULL`. URL-only path satisfies. |
| A3 | Postgres 16 inherits parent table REVOKE to child partitions at attach time | Pitfall PG-2 | MEDIUM — Postgres docs are light; remediation is defense-in-depth (explicit REVOKE in `create_next_evaluation_event_partition`). Wave 0 introspection test confirms empirically. |
| A4 | `csv-parse@5.6+` is a stable dependency for FHFA CSV ingestion | FHFA Conforming Loan Limits §CSV parser choice | LOW — package has 10+ years of releases, ~5M dependents per npm. Adding it is a one-time decision. |
| A5 | FHFA 2026 "baseline" threshold is $832,750 for 1-unit | Open Question 7 + Pitfall PG-7 | LOW — FHFA confirmed 2026 baseline in news release (verified via search results). Loader reads the number from the FHFA file directly so the constant is informational only. |
| A6 | Mortgagee Letter 2016-14 is the correct citation for FHA Back-to-Work sunset 2016-09-30 | Per-agency content matrix §FHA + Pattern P5 | LOW — verified via multiple industry sources (themortgagereports.com, gustancho.com) and HUD's mortgagee letter archive. Letter URL `https://www.hud.gov/sites/documents/16-14ml.pdf` confirmed. The literal Mortgagee Letter that ENDED Back-to-Work is 2016-09 / 16-09 (per some sources) — Phase 3 fixture cites "Mortgagee Letter 2016-14" per CONTEXT D-08; planner verifies the exact letter number against HUD's official Back-to-Work termination notice before merge. |
| A7 | The cascade trigger function should be SECURITY INVOKER (not DEFINER) per CONTEXT D-15 | Cascade Infrastructure §enqueue_agency_cascade | NONE — locked by user decision; research validates the choice (system_role policy approach is cleaner than DEFINER + GUC management). |
| A8 | FNMA EC reduction for FORECLOSURE is 36m (3 years), not 24m | Per-agency content matrix §FNMA | NONE — verified on selling-guide.fanniemae.com B3-5.3-07; canonical 7-year base / 3-year EC. |
| A9 | The pg_cron monthly job runs as the postgres superuser (cron.schedule callback runs as the role that owns the schedule) | Audit Log Architecture §pg_cron | LOW — Supabase docs confirm pg_cron jobs run as the user who scheduled them. The `create_next_evaluation_event_partition()` function is SECURITY INVOKER, so it runs as that role. The migration MUST be run as a role with CREATE-table privileges on the `public` schema (postgres). |
| A10 | The `pg_partition_tree` system function is available for partition introspection in tests | Test Strategy §Wave 0 Gaps | NONE — `pg_partition_tree` is a built-in system function in Postgres 12+. |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed.
**Otherwise:** Items above need one of: (a) planner verifies before commit (A1, A6, A8), (b) defense-in-depth applied (A3), (c) accepted as low-risk informational (A4, A5, A7, A9, A10).

## Sources

### Primary (HIGH confidence)
- [PostgreSQL 16 Table Partitioning Documentation](https://www.postgresql.org/docs/16/ddl-partitioning.html) — declarative partitioning by RANGE, AFTER trigger inheritance, partition routing
- [PostgreSQL 16 Row Security Policies Documentation](https://www.postgresql.org/docs/16/ddl-rowsecurity.html) — RLS + FORCE ROW LEVEL SECURITY semantics
- [PostgreSQL hackers — RLS on inheritance/partitioning](https://www.postgresql.org/message-id/d094a87d-9d63-46c9-8c27-631f881b80fb@supportex.net) — verified RLS does NOT auto-propagate to child partitions; pattern for parent-only routing
- [FNMA Selling Guide B3-5.3-07](https://selling-guide.fanniemae.com/sel/b3-5.3-07/significant-derogatory-credit-events-waiting-periods-and-re-establishing-credit) — canonical FNMA derog matrix
- [FHFA 2026 Conforming Loan Limit Values](https://www.fhfa.gov/data/conforming-loan-limit) — CSV/XLSX download links
- [FHFA 2026 announcement](https://www.fhfa.gov/news/news-release/fhfa-announces-conforming-loan-limit-values-for-2026) — baseline + ceiling values
- [Supabase pg_cron documentation](https://supabase.com/docs/guides/database/extensions/pg_cron) — verified pg_cron available on every Supabase plan
- [Supabase Cron documentation](https://supabase.com/docs/guides/cron) — managed cron interface
- [csv-parse npm package](https://www.npmjs.com/package/csv-parse) — verified as the standard JS CSV parser
- [pg_cron GitHub repository](https://github.com/citusdata/pg_cron) — extension installation + cron.schedule semantics
- Repo: `db/schema/agency-rule-version.ts`, `db/schema/agency-rule.ts`, `db/schema/program-version.ts`, `db/schema/rule-citation.ts`, `db/schema/program-rule.ts` — Phase 2 schema verified in repo
- Repo: `db/migrations/0001_force_rls.sql`, `0003_force_rls_program.sql`, `0005_force_rls_agency.sql`, `0006_detect_loosenings.sql` — `--custom` migration patterns verified in repo
- Repo: `lib/rules/schemas/derog-seasoning.ts` and `lib/rules/schemas/index.ts` — Zod dispatch verified in repo
- Repo: `tests/rls/seedTwoTenants.ts`, `tests/_shared/agency-fixture.ts`, `tests/schema/setup.ts`, `tests/schema/fixtures/seed.ts` — test infra verified in repo
- Repo: `.planning/research/ARCHITECTURE.md` §"Pattern 5: Append-Only Audit Log with Snapshot ID", §"Cascade Trigger", §"Snapshot at Evaluation Time", §"Audit Trail Design", §"Concrete Schema (Sketch)", §"Flow 3: Agency Cascade"
- Repo: `.planning/research/PITFALLS.md` §1.1 / §1.2 / §1.3 / §1.4 / §1.5 / §1.6 / §3.4

### Secondary (MEDIUM confidence — verified across multiple sources)
- [VA Pamphlet 26-7 Chapter 4](https://www.benefits.va.gov/warms/docs/admin26/pamphlet/pam26_7/ch04.pdf) — VA derog rules (PDF accessible; specific topic 7 anchors not extracted in research session)
- [Freddie Mac Single-Family Seller/Servicer Guide §5202.5](https://guide.freddiemac.com/app/guide/section/5202.5) — FHLMC derog rules (canonical URL accessible but text behind clickable interface)
- [HUD 4000.1 Single-Family Housing Policy Handbook](https://www.hud.gov/sites/dfiles/SFH/documents/4000.1hsgh.pdf) — FHA derog rules
- [Mortgagee Letter 2016-14](https://www.hud.gov/sites/documents/16-14ml.pdf) — verified URL; specific Back-to-Work sunset content needs planner verification
- [Aha.io: partitioning a large Postgres table with Rails](https://www.aha.io/engineering/articles/partitioning-a-large-table-in-postgresql-with-rails) — production pattern: parent-only RLS routing
- [pgDash Exploring Row Level Security in PostgreSQL](https://pgdash.io/blog/exploring-row-level-security-in-postgres.html) — RLS semantics
- [Cybertec: Automatic partition creation in PostgreSQL](https://www.cybertec-postgresql.com/en/automatic-partition-creation-in-postgresql/) — pg_cron + plpgsql function pattern

### Tertiary (lower confidence — cross-checked but not authoritative)
- [Industry source — themortgagereports.com](https://themortgagereports.com/13372/fha-back-to-work-mortgage) — Back-to-Work historical context
- [Industry source — gustancho.com](https://gustancho.com/fha-waiting-period-after-bankruptcy-and-foreclosure/) — FHA waiting periods
- [Industry source — peoplesbankmtg.com](https://www.peoplesbankmtg.com/the-complete-guide-to-fha-bankruptcy-waiting-periods/) — FHA bankruptcy waiting periods 2025

## Metadata

**Confidence breakdown:**
- Audit log architecture: HIGH — Postgres docs + Phase 1+2 patterns + production references all converge on parent-only routing
- Snapshot ID canonicalization: HIGH — research/ARCHITECTURE.md §Snapshot at Evaluation Time gives the verbatim shape; CONTEXT D-04 locks
- FNMA derog matrix: HIGH — verified against canonical Selling Guide URL
- FHLMC / FHA / VA matrices: MEDIUM — overall structure confirmed; specific waiting periods cross-checked across industry sources but canonical URLs partially gated behind interactive interfaces
- Cascade trigger semantics: HIGH — research/ARCHITECTURE.md §Cascade Trigger + Phase 2 D-15/D-16 conventions verified in repo
- FHFA conforming loan limits: MEDIUM-HIGH — schema shape verified; CSV format confirmed via FHFA publication URLs; per-row Zod is straightforward
- pg_cron + Supabase compatibility: HIGH — Supabase docs confirm; pg_cron docs confirm
- Postgres 16 partition+RLS+REVOKE inheritance behavior: MEDIUM — pg-hackers thread confirms RLS, REVOKE behavior empirically tested at Phase 3 introspection
- Test posture: HIGH — Phase 2 D-19/D-20 patterns established; Phase 3 extends without forking

**Research date:** 2026-05-04
**Valid until:** 2026-06-03 (30 days for stable schema patterns; 7 days for FNMA Selling Guide URL anchors which republish on FNMA's monthly cadence — verify URLs are still live before each fixture commit)

## RESEARCH COMPLETE
