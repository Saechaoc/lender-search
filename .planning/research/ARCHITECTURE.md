# Architecture Research

**Domain:** Eligibility-first mortgage program search with AI-assisted rule extraction, multi-tenant overlay layering, and versioned auditable rule sets
**Researched:** 2026-04-29
**Confidence:** HIGH on canonical shape (RLS + Postgres-native rule store + async extraction queue is well-trodden territory in regulated SaaS); MEDIUM on specific job-queue choice (pg-boss vs Trigger.dev is a defensible tie); MEDIUM on whether the evaluation engine should be a separate service or in-process at MVP (recommendation below: in-process at Phase 1, extract at Phase 2).

---

## Executive Recommendation

**Single canonical architecture: Postgres-centric monolith with a worker pool, Postgres RLS for tenant isolation, and a thin separation between the synchronous evaluation path (LO search) and the asynchronous extraction pipeline (AM upload).**

Concretely:

- **Web app:** Next.js (App Router) on Vercel. Server-side rendering for the LO search and AM review surfaces. tRPC or Next.js Route Handlers for the API. Client renders the three-pane review UI; everything else is server-driven.
- **Database:** Supabase Postgres. One database, one schema for canonical data, a `staging` schema for in-flight extraction drafts. Postgres Row-Level Security as the authoritative tenant isolation boundary. `pgvector` for chunk-level rule citation similarity search. `temporal` semantics implemented manually with `effective_at` / `expires_at` daterange columns and `WITHOUT OVERLAPS` exclusion constraints (Postgres 18 native temporal support).
- **Evaluation engine:** Pure TypeScript module, in-process inside the Next.js server, deterministic, no I/O during evaluation (rule snapshot is hydrated from Postgres up front, evaluation runs in memory). Returns `{ decision, deciding_rule_id, rule_stack, scenario_hash, ruleset_snapshot_id }`. **This is the hot path; budget P50 ≤ 2s end-to-end, with evaluation itself ≤ 100ms.**
- **Extraction pipeline:** Async worker queue (recommendation: **pg-boss** at MVP, pre-promoted to Trigger.dev at Phase 2 if extraction volume grows). PDFs land in Supabase Storage; jobs run a multi-pass pipeline (OCR → structural parse → rule normalization → overlay diffing → confidence scoring) and write to a `staging.draft_rule` table. Promotion to canonical `rule` table happens only after AM commit.
- **Audit log:** Append-only `evaluation_event` table that stores the full `rule_stack` plus an immutable hash of the rule-snapshot used. Never edited, never soft-deleted. This is the legal-defensibility surface.
- **Agency cascade:** Database trigger on `agency_rule_version` insert enqueues a `cascade.review` job that flags every program referencing the prior agency version. No external event bus needed at MVP.

**Why this shape:** It collapses to a single Postgres + Vercel deployment for Phase 1, runs on Supabase's free or pro tier, gives the strict tenant-isolation guarantee the antitrust environment demands at the database layer (not the application layer, where a missing `WHERE` clause leaks data across tenants), and keeps the evaluation engine portable so it can be lifted into a dedicated service later without rewriting it.

**Major variants worth considering and rejected:**
1. **Separate evaluation service from day one** (Go or Rust microservice). Rejected: solo dev, cold-start latency on Vercel/serverless can blow the P50 ≤ 2s budget, and there is no horizontal-scale problem at Phase 1's coverage staircase (50 programs at MVP, 1k by month 12). Revisit when evaluation latency dominates.
2. **Document database (MongoDB / Firestore) for the rule schema.** Rejected: the rule layering, "most-restrictive wins" reduction, and bitemporal versioning all want relational integrity. Postgres + `jsonb` for the rule-body payload gives 90% of the schema flexibility with full SQL constraints.
3. **External rule engine (Drools, OPA, JSON Logic).** Rejected: the value is in the *rule data model* (layer, derog matrix, near-miss deltas, confidence), not in a generic rule-DSL. Hand-rolled deterministic evaluator is simpler, faster, and easier to explain to an auditor than a Rete-based engine.
4. **Schema-per-tenant** (Citus, PostgreSQL schemas keyed on tenant). Rejected: 50–500 tenants is a sweet spot for shared-table + RLS; schema-per-tenant complicates migrations and the agency cascade has to fan out across schemas.

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Browser (LO / AM)                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────┐        │
│  │ Search /     │  │ Comparison / │  │ AM Three-Pane Review UI      │        │
│  │ Results /    │  │ Saved        │  │ (PDF viewer + extracted rule │        │
│  │ Near-miss    │  │ Scenarios    │  │  object + edit form)         │        │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┬───────────────┘        │
└─────────┼──────────────────┼──────────────────────────┼───────────────────────┘
          │                  │                          │
          ▼                  ▼                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Next.js App on Vercel (single deploy)                  │
│  ┌────────────────────┐  ┌─────────────────────┐  ┌────────────────────┐    │
│  │ Auth + RLS context │  │ tRPC / Route Hndlrs │  │ Server Components  │    │
│  │ (Supabase Auth)    │  │ (LO search, AM API) │  │ (LO/AM rendering)  │    │
│  └─────────┬──────────┘  └──────────┬──────────┘  └──────────┬─────────┘    │
│            │                        │                        │              │
│            ▼                        ▼                        ▼              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │            Evaluation Engine (in-process TypeScript)                │    │
│  │   evaluate(scenario, snapshot) → { decision, rule_stack, deciding } │    │
│  └────────────────────────────────────┬───────────────────────────────┘    │
└───────────────────────────────────────┼─────────────────────────────────────┘
                                        │
                                        │ queries
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Supabase Postgres (canonical data plane)                  │
│  ┌────────────────────┐  ┌─────────────────────┐  ┌────────────────────┐    │
│  │ tenant             │  │ agency_rule_version │  │ program_version    │    │
│  │ user / role        │  │ agency_rule         │  │ program_rule       │    │
│  │ (RLS-enforced)     │  │ (system-owned)      │  │ (FK → agency_ver)  │    │
│  └────────────────────┘  └─────────────────────┘  └────────────────────┘    │
│  ┌────────────────────┐  ┌─────────────────────┐  ┌────────────────────┐    │
│  │ scenario           │  │ evaluation_event    │  │ rule_citation      │    │
│  │ saved_scenario     │  │ (immutable audit)   │  │ (PDF page + bbox)  │    │
│  └────────────────────┘  └─────────────────────┘  └────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │     staging schema (draft rules from extraction, AM-mutable)         │   │
│  │  staging.extraction_run, staging.draft_rule, staging.confidence      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                        ▲
                                        │ writes drafts / reads canonical
                                        │
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Worker Pool (pg-boss on Postgres)                         │
│  ┌────────────────────┐  ┌─────────────────────┐  ┌────────────────────┐    │
│  │ extraction.ingest  │  │ extraction.normalize│  │ extraction.diff    │    │
│  │ (OCR + structural) │  │ (rules + overlay)   │  │ (vs prior version) │    │
│  └────────────────────┘  └─────────────────────┘  └────────────────────┘    │
│  ┌────────────────────┐  ┌─────────────────────┐  ┌────────────────────┐    │
│  │ cascade.agency     │  │ scenario.staleness  │  │ alerting.saved     │    │
│  │ (FNMA/FHLMC/FHA/   │  │ (re-evaluate saved) │  │ (notify LO on      │    │
│  │  VA delta scan)    │  │                     │  │  outcome flip)     │    │
│  └────────────────────┘  └─────────────────────┘  └────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                        ▲
                                        │ uploads / reads PDFs
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Supabase Storage                                     │
│   /tenants/{tenant_id}/programs/{program_id}/{matrix_pdf_sha256}.pdf         │
│   (RLS-policied object access; signed URLs for AM viewer)                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Owns | Implementation |
|-----------|------|----------------|
| **Web frontend (Next.js)** | LO search form, results rendering, comparison view, AM three-pane review UI, saved-scenario management | Next.js App Router, React Server Components for LO views, client components for AM PDF viewer (`react-pdf` + bounding-box overlay) |
| **API (tRPC / Route Handlers)** | Scenario submission, AM CRUD on draft rules, program/version reads, export to Encompass/LendingPad | tRPC for type-safe RPC inside the same Next.js process; signed-URL minting for PDFs |
| **Evaluation engine** | Deterministic eligibility evaluation, rule-stack assembly, near-miss delta calculation, confidence-aware result annotation | Pure TS module under `src/lib/eval/`; no I/O; takes `(scenario, snapshot)` and returns `{decision, rule_stack, deciding_rule, near_miss}` |
| **Rule store (Postgres)** | Canonical rule data, agency versioning, program versioning, FK references between programs and agency versions | Single Postgres database; canonical schema is system-of-record; never written directly by the extraction pipeline |
| **Tenant store** | Tenant rows, user-tenant membership, role mapping, JWT claim source | `tenant`, `user_tenant_role` tables; tenant_id is propagated via JWT custom claim and consumed by RLS |
| **Audit log** | Immutable record of every evaluation: scenario hash, deciding rule, full rule stack, ruleset snapshot id, timestamp, tenant, user | `evaluation_event` table, append-only, partitioned by month after Phase 1 |
| **Extraction pipeline** | OCR ingest → structural parse → rule normalization → overlay diff → confidence score → write to `staging.draft_rule` | Worker jobs in pg-boss; calls Anthropic API for extraction LLM steps; never writes canonical tables |
| **AM review service** | Confidence-sorted queue, three-pane bind to source PDF page+bbox, bulk-accept above threshold, commit promotes staging → canonical | Server actions that move rows from `staging.draft_rule` to `program_rule` inside a single transaction |
| **Scheduler** | Periodic agency-rule-source poll (FNMA/FHLMC Selling Guide RSS), saved-scenario re-evaluation cron, queue-stuck-job sweep | pg-boss scheduled jobs; Vercel Cron for trigger; no external scheduler |
| **Agency rule store** | System-owned, not tenant-scoped: FNMA/FHLMC/FHA/VA base rule sets and their version history | `agency_rule_version` + `agency_rule` tables; bypasses RLS via a `system` role |
| **Citation index** | PDF page + bounding-box + offset for every extracted rule, traversable from a result row back to source | `rule_citation` table FK'd to `program_rule`; rendered by AM viewer and by the LO "why" expansion |

---

## Recommended Project Structure

```
src/
├── app/                              # Next.js App Router
│   ├── (lo)/                         # LO-facing routes (scenario, results, saved)
│   │   ├── search/page.tsx
│   │   ├── results/[scenarioId]/page.tsx
│   │   └── saved/page.tsx
│   ├── (am)/                         # AM-facing routes (review queue, three-pane)
│   │   ├── review/queue/page.tsx
│   │   ├── review/[programVersionId]/page.tsx
│   │   └── upload/page.tsx
│   ├── api/                          # Route Handlers (when tRPC isn't enough)
│   │   ├── trpc/[trpc]/route.ts
│   │   ├── webhook/extraction/route.ts
│   │   └── export/[format]/route.ts
│   └── layout.tsx
├── lib/
│   ├── eval/                         # Pure evaluation engine (PORTABLE, NO I/O)
│   │   ├── engine.ts                 # evaluate(scenario, snapshot)
│   │   ├── derog.ts                  # Derogatory event matrix evaluator
│   │   ├── overlay.ts                # Layer reduction ("most restrictive wins")
│   │   ├── near-miss.ts              # Minimum-edit-distance delta calculator
│   │   ├── snapshot.ts               # Snapshot hydration from Postgres
│   │   └── types.ts                  # Scenario, RuleSnapshot, EvalResult
│   ├── extraction/                   # Async pipeline stages (worker-side)
│   │   ├── ocr.ts                    # Document OCR + bounding boxes
│   │   ├── structural.ts             # Section/heading/table parse
│   │   ├── normalize.ts              # LLM call → draft rule object
│   │   ├── overlay-detect.ts         # Identify INVESTOR_OVERLAY vs base
│   │   ├── confidence.ts             # Per-field score
│   │   └── diff.ts                   # Compare against prior ProgramVersion
│   ├── tenant/                       # Tenancy + RLS context propagation
│   │   ├── context.ts                # set_config('app.tenant_id', ...) wrapper
│   │   └── policies.sql              # All RLS policies, version-controlled
│   ├── audit/                        # Audit log emission
│   │   └── emit.ts                   # writeEvaluationEvent(...)
│   └── trpc/                         # tRPC routers
│       ├── lo-router.ts
│       ├── am-router.ts
│       └── admin-router.ts
├── workers/                          # pg-boss job handlers
│   ├── extraction-pipeline.ts
│   ├── agency-cascade.ts
│   ├── scenario-staleness.ts
│   └── index.ts                      # Worker entry point (separate process)
├── db/
│   ├── migrations/                   # SQL migrations (Drizzle or sqitch)
│   ├── schema.ts                     # Drizzle schema, derived from migrations
│   └── seed/                         # Phase 0 seed data: agency base rules
├── components/                       # Shared UI primitives
│   ├── lo/                           # LO-only components
│   ├── am/                           # AM-only components (PDF viewer, etc.)
│   └── ui/                           # shadcn/ui primitives
└── tests/
    ├── eval/                         # Golden-set scenario tests (200 scenarios)
    ├── extraction/                   # Extraction regression suite
    └── rls/                          # Tenant-isolation pen tests
```

### Structure Rationale

- **`lib/eval/` is dependency-free.** This is the most important boundary in the codebase. The engine takes a `RuleSnapshot` (already hydrated) and a `Scenario` and returns a `EvalResult`. No database, no auth, no logging — everything is injected. This makes it (a) trivial to test against the 200-scenario golden set, (b) lift-and-shift-able into a dedicated service if Phase 2 latency demands it, and (c) impossible for a future change to introduce a tenant-isolation bug at the engine layer because the engine has no tenant context.
- **`lib/extraction/` runs only in workers.** Never imported from `app/`. Long-running, can call external LLM APIs, can fail and retry. Output writes to `staging.*` tables.
- **`workers/` is a separate process from `app/`.** Same repo, same `package.json`, but a separate Node entry point. Can be deployed to a Railway/Render/Fly worker initially, or kept as a Vercel Background Function in Phase 0/1 if extraction volume is low.
- **`db/migrations/` is the system of record for schema.** Drizzle's schema file is generated from migrations, not the other way around. RLS policies live in version-controlled `.sql` files and are applied via migration.
- **`tests/rls/` is non-negotiable.** Every PR that touches tenancy must pass a pen-test suite that connects as tenant A and attempts to read tenant B's data. This is the antitrust safety net.

---

## Architectural Patterns

### Pattern 1: Snapshot-Based Evaluation (Read-Once, Evaluate Many)

**What:** Before evaluating an LO scenario, the API hydrates a `RuleSnapshot` — a serialized bundle of every program version, every rule, every agency-base-rule version they reference, plus the tenant's `LENDER_OVERLAY` — into a single in-memory structure. The evaluation engine then runs purely against this snapshot.

**When to use:** Any evaluation that needs deterministic, fast, auditable results across hundreds of programs in under 2 seconds.

**Trade-offs:**
- (+) P50 ≤ 2s is achievable: one Postgres query (or two: programs + agency cascade) instead of N round-trips.
- (+) The snapshot is hashable, which gives the audit log a stable `ruleset_snapshot_id` to record.
- (+) Deterministic: same scenario + same snapshot → byte-identical result. Trivially testable against the golden set.
- (-) Memory per request: 50 programs × ~5KB rule body = 250KB; at 1k programs that's 5MB per snapshot. Cache aggressively per tenant.
- (-) Snapshot staleness: an AM commit while a request is mid-flight will not be reflected. Acceptable; LO results are decision-support, not real-time positions.

**Example:**

```typescript
// Hot path on LO search
async function searchPrograms(scenario: Scenario, ctx: TenantContext) {
  const snapshot = await snapshotCache.get(ctx.tenantId, async () => {
    return hydrateSnapshot(ctx); // single SQL with all program/agency/overlay rows
  });

  const results = snapshot.programs.map(p => evaluate(scenario, p, snapshot));

  await emitEvaluationEvent({
    tenant_id: ctx.tenantId,
    user_id: ctx.userId,
    scenario_hash: hashScenario(scenario),
    ruleset_snapshot_id: snapshot.id,
    results: results.map(r => ({ program_version_id: r.program_version_id,
                                  decision: r.decision,
                                  deciding_rule_id: r.deciding_rule_id,
                                  rule_stack: r.rule_stack })),
  });

  return results;
}
```

### Pattern 2: Database-Enforced Tenancy via RLS + JWT Claim

**What:** Every tenant-scoped table has `tenant_id uuid not null`. RLS policies use `current_setting('app.tenant_id')` (set per-connection from the JWT `tenant_id` custom claim) to filter `SELECT/INSERT/UPDATE/DELETE`. The application *cannot* leak data across tenants even if a `WHERE` clause is forgotten.

**When to use:** Always, for any column in this system other than the agency-base-rule and system-config tables.

**Trade-offs:**
- (+) The strongest possible isolation guarantee short of a database-per-tenant. The October 2025 OB antitrust complaint makes this critical.
- (+) Every developer mistake (forgotten filter) becomes a "no rows returned" instead of a cross-tenant leak.
- (+) Supabase's `auth.jwt()` makes this near-zero-config: tenant_id goes into JWT custom claims at sign-in.
- (-) Performance: tenant_id must be indexed on every table; complex policies can slow queries. Mitigation: keep policies to a single equality check.
- (-) Testing complexity: integration tests must run as a tenant context, not as a superuser.

**Example:**

```sql
-- Every tenant-scoped table follows this pattern
ALTER TABLE program_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_version FORCE ROW LEVEL SECURITY;  -- applies to table owners too

CREATE POLICY tenant_isolation ON program_version
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX program_version_tenant_idx ON program_version (tenant_id);
```

```typescript
// Per-request: set the tenant context before any query runs
async function withTenantContext<T>(tenantId: string, fn: () => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn();
  });
}
```

The agency-base rule tables (`agency_rule_version`, `agency_rule`) are *not* tenant-scoped — they're system-owned, readable by all tenants, writable only by the system role. Programs reference them by FK, so all tenants share the same FNMA/FHLMC/FHA/VA base.

### Pattern 3: Bitemporal Versioning with Daterange Effective Windows

**What:** Every versioned rule entity has both a "valid time" (when it's effective in the real world) and a "transaction time" (when it was recorded). This is required for "given the rules in effect on date X, what would have been the eligibility outcome?" — the audit-defensibility question.

**When to use:** `agency_rule_version`, `program_version`, `program_rule`, `lender_overlay_rule`. Anything where "what did we believe was true at time T?" matters.

**Trade-offs:**
- (+) Lets the audit log re-evaluate any historical scenario against the rules that were live at scenario time. Critical for liability defense.
- (+) Postgres 18 ships native `WITHOUT OVERLAPS` exclusion constraints, so adjacent versions cannot overlap in valid time.
- (-) Schema complexity: every row has `effective_at`, `expires_at` (or a `daterange`/`tstzrange`), and a separate `recorded_at`.
- (-) Queries must always filter on the relevant time slice. A snapshot query becomes `WHERE effective_at <@ now()`.

**Example:**

```sql
CREATE TABLE agency_rule_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency text NOT NULL CHECK (agency IN ('FNMA','FHLMC','FHA','VA','USDA')),
  version_label text NOT NULL,                    -- e.g. "FNMA SEL-2026-03"
  source_url text,
  source_pdf_sha256 text,
  effective_period daterange NOT NULL,            -- valid time
  recorded_at timestamptz NOT NULL DEFAULT now(), -- transaction time
  superseded_by uuid REFERENCES agency_rule_version(id),
  EXCLUDE USING gist (agency WITH =, effective_period WITH &&)
);

CREATE TABLE program_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  program_id uuid NOT NULL,
  agency_rule_version_id uuid NOT NULL REFERENCES agency_rule_version(id),
  matrix_pdf_sha256 text NOT NULL,                -- source-document fingerprint
  effective_period daterange NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL CHECK (state IN ('draft','in_review','active','deprecated','sunset')),
  EXCLUDE USING gist (program_id WITH =, effective_period WITH &&)
    WHERE (state = 'active')
);
```

The `agency_rule_version_id` FK is the cascade backbone: when a new `agency_rule_version` row lands, a trigger enqueues a `cascade.review` job that selects every `program_version` whose `agency_rule_version_id` references the now-superseded row.

### Pattern 4: Staging Schema for In-Flight Drafts (Extraction Pipeline)

**What:** The extraction pipeline never touches canonical tables. It writes into a parallel `staging` schema (`staging.extraction_run`, `staging.draft_rule`, `staging.draft_rule_field_confidence`). AM commit is a transaction that copies staging rows into canonical rows.

**When to use:** Whenever AI / LLM output flows into a system of record that requires human review.

**Trade-offs:**
- (+) Canonical tables stay clean; an extraction failure can never corrupt active rule data.
- (+) The AM review queue is a single SELECT against `staging.draft_rule` ordered by min-confidence-field.
- (+) Re-running extraction (re-OCR with a better model) is a no-op against canonical state.
- (-) Two schemas to migrate, two sets of types. Manageable.

**Example:**

```sql
CREATE SCHEMA staging;

CREATE TABLE staging.extraction_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  matrix_pdf_sha256 text NOT NULL,
  program_id uuid,                          -- null on first ingest, set after AM links
  status text NOT NULL,                     -- 'ingested','normalized','diffed','reviewing','committed','failed'
  error jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE staging.draft_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  extraction_run_id uuid NOT NULL REFERENCES staging.extraction_run(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  layer text NOT NULL,                      -- AGENCY_BASE / INVESTOR_OVERLAY / PRODUCT_FEATURE / LENDER_OVERLAY
  rule_kind text NOT NULL,                  -- ltv_max / fico_min / dti_max / derog_seasoning / ...
  rule_body jsonb NOT NULL,                 -- the actual rule payload
  citation_pdf_page int NOT NULL,
  citation_bbox jsonb NOT NULL,             -- {x,y,w,h} on the source page
  citation_text text,                       -- the exact OCR'd text the rule was derived from
  field_confidence jsonb NOT NULL,          -- {ltv_max: 0.96, fico_min: 0.82, ...}
  min_confidence numeric GENERATED ALWAYS AS
    ((SELECT min((value)::numeric) FROM jsonb_each_text(field_confidence))) STORED,
  diff_status text,                         -- 'unchanged','added','modified','removed' vs prior version
  reviewer_decision text,                   -- 'pending','accepted','edited','rejected'
  reviewer_user_id uuid,
  reviewed_at timestamptz
);

CREATE INDEX staging_draft_rule_queue_idx
  ON staging.draft_rule (tenant_id, reviewer_decision, min_confidence)
  WHERE reviewer_decision = 'pending';
```

The "confidence-sorted queue" the PRD calls for is just `ORDER BY min_confidence ASC` against this index.

### Pattern 5: Append-Only Audit Log with Snapshot ID

**What:** Every evaluation writes a row to `evaluation_event` capturing `(scenario_hash, ruleset_snapshot_id, deciding_rule_id, rule_stack, decision, tenant_id, user_id, evaluated_at)`. Rows are never updated or deleted. The `ruleset_snapshot_id` is a content-addressed hash of the rule bundle used at evaluation time.

**When to use:** Always, for every evaluation. This is the legal-defensibility layer.

**Trade-offs:**
- (+) Re-evaluating a historical scenario against historical rules is a JOIN, not an archaeology project.
- (+) Append-only + content-addressed snapshot id makes tampering detectable.
- (+) Saved-scenario alerting is a query: `for each saved scenario, re-evaluate against current snapshot, compare against the snapshot it was last evaluated under, alert if decision flipped`.
- (-) Storage growth: 8 scenarios/LO/day × 1k LOs × 50 programs = 400k rows/day. Partition by month, archive after 24 months.

**Example:**

```sql
CREATE TABLE evaluation_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  scenario_hash text NOT NULL,              -- sha256 of canonicalized scenario
  scenario_payload jsonb NOT NULL,          -- the full scenario, for re-eval
  ruleset_snapshot_id text NOT NULL,        -- content-addressed snapshot hash
  program_version_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('eligible','near_miss','ineligible')),
  deciding_rule_id uuid,
  rule_stack jsonb NOT NULL,                -- full ordered list of rules evaluated, with layer
  near_miss_delta jsonb,                    -- if applicable: {fico: -10, ltv: 5, ...}
  evaluated_at timestamptz NOT NULL DEFAULT now()
) PARTITION BY RANGE (evaluated_at);

-- No UPDATE/DELETE permission for application role
REVOKE UPDATE, DELETE ON evaluation_event FROM authenticated;
```

### Pattern 6: Citation Linkage from Rule to PDF Source

**What:** Every `program_rule` (and `agency_rule`) row has a 1:N relationship to `rule_citation` rows that record `(pdf_sha256, page_number, bbox, text)`. The LO "why" expansion and the AM three-pane viewer both render from this table.

**When to use:** Every extracted rule, no exceptions. Hand-authored rules (Phase 0 agency-base seed) get a citation pointing at the Selling Guide URL + section number instead of bbox.

**Trade-offs:**
- (+) Explainability becomes trivially auditable: from a result row, click "why" → rule citation → PDF page → highlighted region.
- (+) AM review three-pane UI gets its data layout for free.
- (-) Extraction pipeline must preserve bounding boxes through the OCR → structural → normalization pipeline. Use OCR engines that return word-level bboxes (Mistral Document AI, Azure Document Intelligence, AWS Textract).

```sql
CREATE TABLE rule_citation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL,                    -- polymorphic: program_rule or agency_rule
  rule_table text NOT NULL CHECK (rule_table IN ('program_rule','agency_rule')),
  source_pdf_sha256 text,                   -- null for hand-authored agency rules
  source_url text,                          -- e.g. Selling Guide URL
  page_number int,
  bbox jsonb,                               -- {x,y,w,h} normalized to page
  excerpt text NOT NULL,                    -- the actual cited text
  embedding vector(1536)                    -- for similarity search across cites
);
```

---

## Data Flow

### Flow 1: LO Scenario → Ranked Result (Synchronous, Hot Path)

```
Browser                  Next.js Server                    Postgres
   │                          │                                │
   │ POST /api/lo/search      │                                │
   │  {scenario}              │                                │
   ├─────────────────────────▶│                                │
   │                          │ withTenantContext(tenant_id):  │
   │                          │  set_config('app.tenant_id')   │
   │                          ├───────────────────────────────▶│
   │                          │                                │
   │                          │ Cache check: snapshot for      │
   │                          │ (tenant_id, current_time)      │
   │                          │                                │
   │                          │ if miss: hydrateSnapshot()     │
   │                          │   SELECT all active            │
   │                          │   program_version JOIN         │
   │                          │   program_rule JOIN            │
   │                          │   agency_rule_version JOIN     │
   │                          │   agency_rule JOIN             │
   │                          │   lender_overlay_rule          │
   │                          │   WHERE effective_at <@ now()  │
   │                          ├───────────────────────────────▶│
   │                          │◀───────────────────────────────┤
   │                          │  RuleSnapshot {id, programs[]} │
   │                          │                                │
   │                          │ for each program:              │
   │                          │   evaluate(scenario, program,  │
   │                          │            snapshot)           │
   │                          │   → {decision, rule_stack,     │
   │                          │      deciding, near_miss}      │
   │                          │                                │
   │                          │ rank: eligible > near_miss     │
   │                          │       > ineligible             │
   │                          │                                │
   │                          │ emitEvaluationEvent(tenant,    │
   │                          │   user, scenario_hash,         │
   │                          │   snapshot_id, results)        │
   │                          ├───────────────────────────────▶│
   │                          │                                │
   │                          │ append-only INSERT into        │
   │                          │ evaluation_event partition     │
   │                          │                                │
   │ 200 OK                   │                                │
   │ {results, snapshot_id}   │                                │
   │◀─────────────────────────┤                                │
   │                          │                                │
```

**Latency budget:**
- Snapshot hydration: ≤ 200ms (single SQL with JOINs, indexed; cached per tenant for 30s)
- Evaluation: ≤ 100ms for 50 programs, ≤ 500ms for 1k programs (in-memory, no I/O)
- Audit log emit: ≤ 50ms (single async-fire-and-forget INSERT, batched if needed)
- Network + render: ≤ 1s
- **Total P50: ≤ 1.5s; P95: ≤ 4s.** Beats PRD target.

### Flow 2: AM Upload → Extraction → Review → Commit (Asynchronous)

```
AM Browser           Next.js Server          Storage         pg-boss          Postgres
   │                      │                      │              │                 │
   │ POST /api/am/upload  │                      │              │                 │
   │  matrix.pdf          │                      │              │                 │
   ├─────────────────────▶│                      │              │                 │
   │                      │ stream to Storage    │              │                 │
   │                      │ /tenants/T/programs  │              │                 │
   │                      │ /P/<sha256>.pdf      │              │                 │
   │                      ├─────────────────────▶│              │                 │
   │                      │                      │              │                 │
   │                      │ INSERT staging.      │              │                 │
   │                      │   extraction_run     │              │                 │
   │                      │ (status='queued')    │              │                 │
   │                      ├──────────────────────┼──────────────┼────────────────▶│
   │                      │                      │              │                 │
   │                      │ pg-boss.send         │              │                 │
   │                      │  ('extraction.       │              │                 │
   │                      │   ingest', run_id)   │              │                 │
   │                      ├──────────────────────┼─────────────▶│                 │
   │ 202 Accepted         │                      │              │                 │
   │ {run_id}             │                      │              │                 │
   │◀─────────────────────┤                      │              │                 │
   │                      │                      │              │                 │
   │                      │                      │              │ Worker picks up:│
   │                      │                      │              │ 1. OCR PDF      │
   │                      │                      │              │   (page+bbox)   │
   │                      │                      │              │ 2. Structural   │
   │                      │                      │              │    parse        │
   │                      │                      │              │ 3. LLM normalize│
   │                      │                      │              │    → draft rules│
   │                      │                      │              │ 4. Overlay diff │
   │                      │                      │              │    vs prior     │
   │                      │                      │              │    program ver  │
   │                      │                      │              │ 5. Per-field    │
   │                      │                      │              │    confidence   │
   │                      │                      │              ├────────────────▶│
   │                      │                      │              │ INSERT into     │
   │                      │                      │              │ staging.        │
   │                      │                      │              │   draft_rule    │
   │                      │                      │              │ (with citations,│
   │                      │                      │              │  confidence,    │
   │                      │                      │              │  diff_status)   │
   │                      │                      │              │                 │
   │                      │                      │              │ UPDATE          │
   │                      │                      │              │ extraction_run  │
   │                      │                      │              │ status=         │
   │                      │                      │              │ 'reviewing'     │
   │                      │                      │              │                 │
   │ ── time passes ──    │                      │              │                 │
   │                      │                      │              │                 │
   │ GET /am/review/queue │                      │              │                 │
   ├─────────────────────▶│                      │              │                 │
   │                      │ SELECT * FROM        │              │                 │
   │                      │ staging.draft_rule   │              │                 │
   │                      │ WHERE reviewer_      │              │                 │
   │                      │       decision=      │              │                 │
   │                      │       'pending'      │              │                 │
   │                      │ ORDER BY             │              │                 │
   │                      │   min_confidence ASC │              │                 │
   │                      ├──────────────────────┼──────────────┼────────────────▶│
   │                      │◀─────────────────────┼──────────────┼─────────────────┤
   │ Three-pane review UI │                      │              │                 │
   │ AM accepts/edits     │                      │              │                 │
   │ each draft_rule      │                      │              │                 │
   │                      │                      │              │                 │
   │ POST /am/commit      │                      │              │                 │
   ├─────────────────────▶│                      │              │                 │
   │                      │ BEGIN TRANSACTION    │              │                 │
   │                      ├──────────────────────┼──────────────┼────────────────▶│
   │                      │ INSERT new           │              │                 │
   │                      │  program_version     │              │                 │
   │                      │  (state='active',    │              │                 │
   │                      │   effective_at=now)  │              │                 │
   │                      │ INSERT program_rule  │              │                 │
   │                      │   for each accepted  │              │                 │
   │                      │   draft              │              │                 │
   │                      │ INSERT rule_citation │              │                 │
   │                      │ UPDATE prior         │              │                 │
   │                      │   program_version    │              │                 │
   │                      │   SET state=         │              │                 │
   │                      │   'deprecated',      │              │                 │
   │                      │   expires_at=now     │              │                 │
   │                      │ UPDATE staging.      │              │                 │
   │                      │   extraction_run     │              │                 │
   │                      │   status='committed' │              │                 │
   │                      │ pg-boss.send         │              │                 │
   │                      │  ('scenario.         │              │                 │
   │                      │   staleness',        │              │                 │
   │                      │   program_id)        │              │                 │
   │                      │ COMMIT               │              │                 │
   │                      │                      │              │                 │
   │ 200 OK               │                      │              │                 │
   │◀─────────────────────┤                      │              │                 │
```

### Flow 3: Agency Cascade (Async, System-Owned)

```
Scheduler (Vercel Cron, daily)
   │
   ▼
pg-boss job: 'agency.poll'
   │
   ├─▶ Fetch FNMA Selling Guide RSS / FHLMC Bulletins / FHA Mortgagee Letters / VA Circulars
   │
   ├─▶ Hash latest doc; compare to known-version hashes
   │
   └─▶ If new version detected:
       │
       ├─▶ Run extraction on the agency PDF (same pipeline as AM matrix, but writes
       │   to staging.draft_agency_rule)
       │
       ├─▶ INSERT new agency_rule_version (effective_period bracketed against prior)
       │
       ├─▶ Postgres trigger on insert fires: enqueue 'cascade.review' for each
       │   program_version where agency_rule_version_id = (now superseded version)
       │
       └─▶ AM team gets a system-level review queue entry per affected program:
           "FNMA SEL-2026-04 changed; 23 of your active programs reference SEL-2026-03;
            click to review delta and either re-bracket to new version or flag for
            re-extraction from updated lender matrix"
```

This is the central differentiator the PRD calls out and no incumbent has shipped.

### Flow 4: Saved-Scenario Staleness Detection (Async, Per-Tenant)

```
pg-boss scheduled job: 'scenario.staleness' (runs hourly)
   │
   ▼
For each tenant:
  set_config('app.tenant_id')
  current_snapshot = hydrateSnapshot()

  For each saved_scenario WHERE last_snapshot_id != current_snapshot.id:
    For each previously-eligible program_version:
      result_now = evaluate(scenario, program_version, current_snapshot)
      if result_now.decision != saved_scenario.last_known_decision_for(program_version):
        INSERT alert (tenant_id, lo_user_id, scenario_id, program_version_id,
                      old_decision, new_decision, deciding_rule_id_now)

    UPDATE saved_scenario SET last_snapshot_id = current_snapshot.id
```

This is Phase 3, but the data model supports it from Phase 0. No new schema needed at Phase 1.

---

## Build Order (Tied to PROJECT.md Phasing)

### Phase 0: Schema + Golden Set (Foundation, No UI)

**Build order — strictly sequential, each step unblocks the next:**

1. **Postgres schema migrations** — `tenant`, `agency_rule_version`, `agency_rule`, `program_version`, `program_rule`, `rule_citation`, `lender_overlay_rule`, `evaluation_event`, plus the `staging` schema. Drizzle migrations under version control.
2. **RLS policies on every tenant-scoped table** — single equality check, indexed, with a `tests/rls/` pen-test suite that runs in CI and blocks merge on any cross-tenant leak.
3. **Hand-authored agency-base seed** — FNMA, FHLMC, FHA, VA. This is the data work the PRD explicitly calls out. No extraction pipeline yet — type the rules in.
4. **Evaluation engine (`lib/eval/`)** — pure TS, snapshot in / result out. No I/O.
5. **Derogatory event matrix evaluator** — full FNMA-style waiting periods, post-event LTV cap windows, re-establishment criteria, mortgage-included-in-BK rule.
6. **200-scenario golden set** — fixture files under `tests/eval/golden/`, expected results reviewed with a domain expert, run on every commit.
7. **Snapshot hydration query** — the single SQL that produces a `RuleSnapshot` from current Postgres state.
8. **Audit log emit** — `writeEvaluationEvent` writes to `evaluation_event` after every evaluation.

**Phase 0 exit criterion:** golden set passes at ≥98% precision, ≥95% recall against expert-reviewed expected outcomes. No customer-visible product.

**Phase 0 deploy footprint:** None. Migrations + tests run locally and in CI.

### Phase 1: MVP — LO Search + AM Onboarding

**Build order:**

1. **Next.js app skeleton + Supabase Auth + tenant JWT claim** — sign-in writes `tenant_id` into JWT; every request runs inside `withTenantContext`.
2. **LO scenario form + results view** — wraps the Phase 0 evaluation engine; all logic already exists, this is just UI.
3. **Comparison view + PDF export with disclaimer** — pin up to four programs side-by-side; jsPDF or similar.
4. **Saved scenarios** — `saved_scenario` table; shareable link with optional borrower-safe view; staleness flag (column only, alerting deferred to Phase 3).
5. **pg-boss + worker process deploy** — Railway/Render/Fly worker, separate from the Next.js Vercel deploy. Same repo, same migrations.
6. **Extraction pipeline stages** — OCR (pluggable; start with Mistral Document AI or Azure Document Intelligence for word-level bboxes), structural parse, normalization (Anthropic Claude with structured output schemas), confidence scoring, overlay diffing.
7. **AM upload → staging draft writes** — file lands in Supabase Storage, pg-boss job runs full pipeline, results in `staging.draft_rule`.
8. **AM three-pane review UI** — `react-pdf` viewer + bounding-box overlay + edit form bound to the draft rule. Confidence-sorted queue from `staging.draft_rule_queue_idx`.
9. **Bulk-accept above threshold** — server action moves all `min_confidence > 0.95` and `diff_status = 'unchanged'` rows from staging to canonical in one transaction.
10. **Program lifecycle states** — `draft → in_review → active → deprecated → sunset` enforced as `program_version.state` constraint.
11. **Agency cascade infrastructure** — daily Vercel Cron triggers `agency.poll` job; trigger on `agency_rule_version` insert enqueues `cascade.review` jobs.
12. **Confidence badge on result rows** — read `program_rule.confidence`, surface the badge when the deciding rule has confidence < 0.90.
13. **Encompass + LendingPad export** — JSON shape per their import schema; behind a button on the result row.

**Phase 1 exit criterion:** 50 programs indexed (≥60% non-QM), eligibility precision ≥98% on the now-extended golden set, AM onboarding time ≤ 45 min for a standard non-QM matrix, P50 time-to-results ≤ 2s.

**Phase 1 deploy footprint:**
- Vercel: Next.js app (LO search, AM review, API)
- Railway/Render/Fly: pg-boss worker process (extraction + cascade jobs)
- Supabase: Postgres + Storage + Auth
- Anthropic API: extraction LLM (per-tenant rate-limit budget)
- Mistral or Azure: OCR with bboxes

### Phase 2: Coverage + Pricing

1. **USDA agency rules** — handled exactly like FNMA/FHLMC at Phase 0. Plus HFA, second-lien CES/HELOC, construction-to-perm.
2. **Pricing data plane** — *new* schema tables `pricing_feed`, `pricing_quote`, with a separate ingest pipeline behind opt-in lender consent.
3. **Multi-tenant `LENDER_OVERLAY` for retail and brokerage** — schema already supports this from Phase 0; Phase 2 adds the UI for tenants to author their own overlay rules with the same three-pane review pattern.
4. **Mobile-responsive scenario flow** — Tailwind responsive breakpoints, no separate codebase.
5. **Encompass Partner Connect + Byte integrations** — webhook receiver, scenario push.
6. **(Conditional) Extract evaluation engine into a separate service** if Vercel function cold starts plus 1k-program snapshot evaluation are blowing the latency budget. The pure-TS engine ports to a Cloudflare Worker, Fly machine, or Lambda with no business-logic changes.

### Phase 3: Workflow + Intelligence

1. **Borrower-safe shareable scenario landing pages** — public URLs, no tenant data leakage; shadow tenant for the borrower.
2. **AE collaboration surface** — two-way messaging on a scenario; new `scenario_message` table, RLS scoped to scenario participants.
3. **Saved-scenario alerting** — Flow 4 above goes live; pg-boss scheduled job, email/SMS via Postmark/Twilio.
4. **Native iOS/Android** — only if usage data demands it.
5. **E&O warranty product** — third-party integration; out of architectural scope.

---

## Multi-Tenant Isolation: Recommendation

**Use Postgres Row-Level Security with tenant_id passed via JWT custom claim, set per-connection via `set_config('app.tenant_id', ...)`. Apply RLS to every tenant-scoped table. `FORCE ROW LEVEL SECURITY` on each so even the table owner (the migration role) is subject to the policy.**

### Security Rationale (Antitrust Posture)

The October 2025 Optimal Blue antitrust class action alleges that Pricing Insight enabled lender-to-lender pricing data exchange that constituted anticompetitive coordination. The structural defense for this product is *cryptographic-grade* tenant isolation: a brokerage's `LENDER_OVERLAY` is *not visible* to other tenants, and a lender's confidential pricing detail (Phase 2) is *not visible* to a different lender, by *database constraint*, not by application convention.

Three reasons RLS is the correct boundary, not application-layer filtering:

1. **Defense in depth.** A future bug — a forgotten `WHERE tenant_id = ?` clause, an N+1 fix that inadvertently joins across tenants, an admin tool that uses a superuser connection — becomes a "no rows returned" instead of a leak. Application-layer filtering treats every query as a load-bearing security control. RLS makes the database the load-bearing control, where mistakes are caught at policy-evaluation time.

2. **Auditability.** "Show me, by inspection, every place tenant data could leak across tenants" has a finite answer with RLS: the set of tables without `ENABLE ROW LEVEL SECURITY`, and the set of policies. With application-layer filtering it's "every SQL query in the codebase, forever."

3. **Regulator and litigant posture.** When the inevitable subpoena or discovery request arrives — and in this antitrust environment it will — the answer "every tenant-scoped row is filtered at the database layer by a policy that has been in place since launch and tested in CI on every commit" is materially stronger than "we filter in the application."

### Specific Implementation

```sql
-- One pattern, applied to every tenant-scoped table
ALTER TABLE program_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_version FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_read ON program_version
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_write ON program_version
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_update ON program_version
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_delete ON program_version
  FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Always indexed
CREATE INDEX program_version_tenant_idx ON program_version (tenant_id);
```

System-owned tables (`agency_rule_version`, `agency_rule`, `tenant`, `evaluation_event` for cross-tenant diagnostics) have a separate `system_role` policy that bypasses the tenant check; this role is only used by the worker process and migration scripts, never by the user-facing API.

The tenant_id flows like this:

```
User signs in via Supabase Auth
  ↓
Auth webhook (Edge Function) reads user_tenant_role table, picks active tenant
  ↓
Injects tenant_id into JWT custom claim 'tenant_id'
  ↓
Next.js middleware: extract JWT, verify, attach to request context
  ↓
Every Postgres query runs inside withTenantContext(tenant_id, async () => {
  await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenant_id}, true)`)
  // ... actual queries
})
  ↓
Postgres evaluates policies on every read/write
```

### CI Pen-Test (Non-Negotiable)

A `tests/rls/` suite runs on every PR. It seeds two tenants, signs in as tenant A, attempts to:

- `SELECT *` from every tenant-scoped table for tenant B's IDs
- `INSERT ... tenant_id = <tenant_B>` (must fail WITH CHECK)
- `UPDATE` tenant B's rows (must affect 0 rows)
- `DELETE` tenant B's rows (must affect 0 rows)

Any non-zero row count in any of these fails the build. This is the antitrust insurance policy.

### Variant Considered and Rejected: Schema-per-Tenant

For 50–500 tenants (the realistic Phase 1–2 range), schema-per-tenant adds operational pain (migrations × N tenants, agency cascade has to fan out across schemas, cold pool connections per schema) without meaningful security gain over RLS. Reconsider if the tenant count climbs into the thousands and per-tenant data residency becomes a contractual requirement.

### Variant Considered and Rejected: Database-per-Tenant

Reserved for the very-large-lender enterprise tier in Phase 3+, if at all. Out of scope for MVP.

---

## Rule-Schema Versioning + Agency Cascade: Recommendation

**Centralized rule store (one Postgres). Programs are normalized rows referencing agency_rule_version by FK, not embedded copies. Bitemporal versioning with `daterange effective_period` and `WITHOUT OVERLAPS` exclusion constraints. Snapshot at evaluation time captured by content-hashing the bundle.**

### Why Centralized, Not Per-Program Embedded

**Per-program embedded would mean:** every `program_version` row contains a JSON blob of all the rules, including a copy of the FNMA base. When FNMA SEL-2026-04 ships, every program is stale until each has been individually refreshed.

**Centralized referencing means:** every `program_version` references `agency_rule_version_id`. When FNMA SEL-2026-04 lands, a single insert into `agency_rule_version` plus a trigger to enqueue `cascade.review` jobs marks every affected program. The AM team explicitly accepts the new agency version, possibly re-extracting from the lender's matrix if the lender has issued an updated overlay.

**This design is the central differentiator.** The PRD's Wedge #2 ("agency-rule cascade with system-level review queue") is unbuildable on an embedded model and trivial on a centralized one.

### Concrete Schema (Sketch)

```sql
-- ==========================================================================
-- Tenant + auth (Supabase managed; tenant added by us)
-- ==========================================================================
CREATE TABLE tenant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('lender','brokerage','retail_shop','system')),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_tenant_role (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('lo','am','admin','system')),
  PRIMARY KEY (user_id, tenant_id)
);

-- ==========================================================================
-- Agency layer (system-owned, NOT RLS-scoped)
-- ==========================================================================
CREATE TABLE agency_rule_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency text NOT NULL CHECK (agency IN ('FNMA','FHLMC','FHA','VA','USDA')),
  version_label text NOT NULL,             -- "FNMA SEL-2026-03"
  source_url text,
  source_pdf_sha256 text,
  effective_period daterange NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  superseded_by uuid REFERENCES agency_rule_version(id),
  EXCLUDE USING gist (agency WITH =, effective_period WITH &&)
);

CREATE TABLE agency_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_rule_version_id uuid NOT NULL REFERENCES agency_rule_version(id),
  rule_kind text NOT NULL,                  -- 'ltv_max','fico_min','dti_max',
                                            -- 'derog_seasoning','reserves',...
  rule_body jsonb NOT NULL,                 -- the actual rule (see below)
  citation_url text,
  citation_section text                     -- "Selling Guide B3-5.3-09"
);

-- ==========================================================================
-- Program layer (TENANT-scoped, RLS-policed)
-- ==========================================================================
CREATE TABLE program (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  lender_id uuid NOT NULL REFERENCES tenant(id),  -- the lender tenant whose program this is
  name text NOT NULL,
  agency text NOT NULL,                     -- which agency base does this build on
  loan_types text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE program_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  program_id uuid NOT NULL REFERENCES program(id),
  agency_rule_version_id uuid NOT NULL REFERENCES agency_rule_version(id),
  matrix_pdf_sha256 text NOT NULL,
  effective_period daterange NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL CHECK (state IN ('draft','in_review','active','deprecated','sunset')),
  EXCLUDE USING gist (program_id WITH =, effective_period WITH &&)
    WHERE (state = 'active')
);

CREATE TABLE program_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  program_version_id uuid NOT NULL REFERENCES program_version(id) ON DELETE CASCADE,
  layer text NOT NULL CHECK (layer IN
    ('AGENCY_BASE','INVESTOR_OVERLAY','PRODUCT_FEATURE','LENDER_OVERLAY')),
  rule_kind text NOT NULL,
  rule_body jsonb NOT NULL,
  confidence numeric NOT NULL DEFAULT 1.0,  -- 1.0 for hand-authored; <1.0 for AI-extracted
  am_confirmed boolean NOT NULL DEFAULT false,
  source_citation_id uuid REFERENCES rule_citation(id)
);

CREATE INDEX program_rule_lookup_idx
  ON program_rule (tenant_id, program_version_id, layer, rule_kind);

-- ==========================================================================
-- Brokerage / retail LENDER_OVERLAY (separate from program_rule because
-- the same overlay applies across many programs at the brokerage)
-- ==========================================================================
CREATE TABLE lender_overlay_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,                  -- the brokerage tenant
  applies_to_program_id uuid REFERENCES program(id),  -- null = applies to all
  rule_kind text NOT NULL,
  rule_body jsonb NOT NULL,
  effective_period daterange NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- ==========================================================================
-- Citations (polymorphic to program_rule and agency_rule)
-- ==========================================================================
CREATE TABLE rule_citation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_pdf_sha256 text,
  source_url text,
  page_number int,
  bbox jsonb,
  excerpt text NOT NULL,
  embedding vector(1536)
);

-- ==========================================================================
-- Audit (append-only, partitioned by month)
-- ==========================================================================
CREATE TABLE evaluation_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  scenario_hash text NOT NULL,
  scenario_payload jsonb NOT NULL,
  ruleset_snapshot_id text NOT NULL,        -- content-addressed hash
  program_version_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('eligible','near_miss','ineligible')),
  deciding_rule_id uuid,                    -- references program_rule.id
  deciding_rule_layer text,                 -- denormalized for forensics
  rule_stack jsonb NOT NULL,                -- ordered list of rules + layers + outcomes
  near_miss_delta jsonb,
  evaluated_at timestamptz NOT NULL DEFAULT now()
) PARTITION BY RANGE (evaluated_at);

REVOKE UPDATE, DELETE ON evaluation_event FROM authenticated;
```

### Snapshot at Evaluation Time

The `ruleset_snapshot_id` recorded in `evaluation_event` is a deterministic hash:

```typescript
function snapshotId(snapshot: RuleSnapshot): string {
  // Order-independent, content-addressed
  const canonical = {
    agency_versions: snapshot.agencyVersions
      .map(a => ({id: a.id, recorded_at: a.recorded_at}))
      .sort((a, b) => a.id.localeCompare(b.id)),
    program_versions: snapshot.programVersions
      .map(p => ({id: p.id, recorded_at: p.recorded_at}))
      .sort((a, b) => a.id.localeCompare(b.id)),
    overlay_versions: snapshot.overlays
      .map(o => ({id: o.id, recorded_at: o.recorded_at}))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  return sha256(JSON.stringify(canonical));
}
```

This gives the audit log a single column to identify "the exact rule bundle in effect when this scenario was evaluated." Re-evaluating the same scenario against the same snapshot id is byte-identical.

### Cascade Trigger

```sql
CREATE FUNCTION enqueue_agency_cascade() RETURNS trigger AS $$
BEGIN
  PERFORM pgboss.send('cascade.review', jsonb_build_object(
    'agency_rule_version_id', NEW.id,
    'agency', NEW.agency,
    'version_label', NEW.version_label
  ));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agency_rule_version_inserted
  AFTER INSERT ON agency_rule_version
  FOR EACH ROW
  EXECUTE FUNCTION enqueue_agency_cascade();
```

The worker handler for `cascade.review` selects every `program_version` whose `agency_rule_version_id` was the now-superseded version (resolvable via `superseded_by`), creates a system-level review queue entry per program, and notifies the AM team.

---

## Audit Trail Design

The `evaluation_event` table is the legal-defensibility surface. Concrete properties:

- **Append-only.** `REVOKE UPDATE, DELETE ON evaluation_event FROM authenticated`. The application role cannot tamper.
- **Snapshot-bound.** Every event references `ruleset_snapshot_id`, which is content-addressed. "Which rules were in effect when we made this decision?" is answered by re-hydrating the snapshot from the IDs the event records (since each underlying row has `recorded_at` and is never deleted, only superseded).
- **Full rule stack.** `rule_stack jsonb` contains the ordered list of every rule that was checked, with its layer and outcome. The "why" expansion in the LO UI reads directly from this.
- **Deciding rule.** `deciding_rule_id` is the single rule that fired the disqualifying or qualifying decision. For near-miss cases, `near_miss_delta` records the minimum-edit-distance delta.
- **Scenario re-runnable.** `scenario_payload jsonb` stores the full scenario as submitted, so re-evaluating against current rules (Flow 4) is a straight database operation.
- **Partitioned by month.** Storage scales linearly; old partitions can be archived to cold storage after 24 months without affecting hot-path queries.
- **Tenant-scoped via RLS** for the customer-facing surface; the system role can read across tenants for support and forensics, with audit trails of its own (`system_audit` table records every cross-tenant query).

---

## Explainability Surface Design

The path from a result row to the source PDF page is:

```
LO clicks "Why?" on a result row
  ↓
UI fetches evaluation_event row by id
  ↓
rule_stack[] is rendered as an ordered list:
  - "FNMA base FICO ≥ 620 — passed (your scenario: 680)"
  - "Investor overlay FICO ≥ 660 — passed"
  - "Lender overlay max LTV 80% for 2-unit — failed (your scenario: 85%)" ← deciding
  ↓
Each item links to its underlying rule (program_rule.id or agency_rule.id)
  ↓
Click rule → fetch rule_citation rows joined by rule_id
  ↓
For agency rules: render the citation_url + citation_section text
For program rules: render the source PDF page in an inline viewer with bbox highlighted
```

The PDF viewer is `react-pdf` with a `<canvas>` overlay rendering the bbox. The citation excerpt is also stored as text in `rule_citation.excerpt` for accessibility and search.

For the AM three-pane review UI, the same data structures power a different layout: left pane is the PDF viewer at the citation's page+bbox, middle pane is the structured `draft_rule.rule_body` JSON, right pane is the edit form bound to that JSON. AM accepts → row moves from `staging.draft_rule` to `program_rule` with `am_confirmed = true`, and `rule_citation` rows are also promoted.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| **0–10 tenants, 50 programs, ~50 LOs** (Phase 1) | Single Postgres on Supabase Pro. Single Vercel deploy. One worker process on Render/Fly. Snapshot cache per tenant. **No changes from canonical architecture.** |
| **10–100 tenants, 250 programs, ~500 LOs** (Phase 1 → Phase 2) | Same architecture. Promote pg-boss to dedicated Postgres if it competes for connections. Add a read replica for the snapshot hydration query. Partition `evaluation_event` by month. |
| **100–1k tenants, 1k programs, 5k LOs** (Phase 2 maturity) | Lift evaluation engine into a dedicated service (Cloudflare Worker or Fly machines, geographically distributed). Move snapshot cache to Redis with per-tenant invalidation on commit. Move extraction workers to Trigger.dev for durable execution + observability. |
| **1k+ tenants, 10k+ programs** (Phase 3+) | Re-evaluate schema-per-tenant if data residency contracts demand it. Add a CDN-cached read path for the agency rule store. Consider per-region Postgres for latency. |

### Scaling Priorities (What Breaks First)

1. **First bottleneck: snapshot hydration query.** At 1k programs the JOIN across `program_version × program_rule × agency_rule_version × agency_rule × lender_overlay_rule` will get slow. Mitigation: per-tenant materialized snapshot view, refreshed on commit. Then per-tenant Redis cache.
2. **Second bottleneck: evaluation latency at 1k programs.** 1k × 100 rule checks = 100k operations per request. Pure JS handles this in ~200ms but starts to hurt P95. Mitigation: pre-filter programs by hard scenario keys (loan type, occupancy, state) before evaluating. Then move engine to Rust if needed (the snapshot interface is portable).
3. **Third bottleneck: extraction throughput.** A single worker is fine at 5–10 matrix uploads/day. At 100/day, parallel workers and Trigger.dev's durable execution become valuable.
4. **Fourth bottleneck: `evaluation_event` write volume.** 8 scenarios × 1k LOs × 50 programs = 400k inserts/day. Postgres handles this trivially but the table grows fast. Mitigation: monthly partitions, archive cold partitions after 24 months.

---

## Anti-Patterns

### Anti-Pattern 1: Embedding Agency Rules in Each Program

**What people do:** Store every program's rules — including the FNMA base — as a single JSON blob per program version. Each program version is fully self-describing.
**Why it's wrong:** When the agency publishes a new Selling Guide version, every program is silently stale. There is no way to ask "which programs are affected by FNMA SEL-2026-04?" without scanning every program. The cascade differentiator becomes unbuildable.
**Do this instead:** Centralized `agency_rule_version` table; programs reference it by FK; cascade is a single trigger + queue job. The PRD's central differentiator depends on this design.

### Anti-Pattern 2: Application-Layer Tenant Filtering

**What people do:** Every query starts with `WHERE tenant_id = ?`, enforced by code review and convention.
**Why it's wrong:** One forgotten clause leaks data across tenants. In an antitrust environment after October 2025 OB, a single such leak is existentially expensive.
**Do this instead:** Postgres RLS with `FORCE ROW LEVEL SECURITY`. Application can never bypass. CI pen-test on every PR.

### Anti-Pattern 3: Mutable Audit Log

**What people do:** `evaluation_event` rows are updated when the user re-runs a scenario, or deleted when a tenant is offboarded.
**Why it's wrong:** The audit log's value is that it's a tamper-resistant record of decisions made at a specific time. Mutability destroys that. Regulator trust evaporates.
**Do this instead:** Append-only with `REVOKE UPDATE, DELETE`. Tenant offboarding moves the partition to cold archive, never deletes. Re-runs create new events.

### Anti-Pattern 4: Letting the Extraction Pipeline Write Canonical Tables

**What people do:** OCR + LLM output goes directly into `program_rule`, with a flag `is_draft = true` that the AM clears after review.
**Why it's wrong:** A bug in the pipeline can corrupt canonical state. RLS policies and FKs from `evaluation_event` reach into rules that may be hallucinated. Re-running extraction is destructive.
**Do this instead:** Strict separation. `staging.draft_rule` is the only sink for the pipeline. AM commit is an explicit transaction that copies rows to canonical. The pipeline can be re-run any number of times against the same PDF without affecting active state.

### Anti-Pattern 5: Synchronous Extraction in the Request Path

**What people do:** AM uploads a PDF, the API blocks for 30+ seconds running OCR + LLM extraction, then returns the draft rules.
**Why it's wrong:** Vercel function timeouts (30s on Hobby, 60s on Pro), poor UX, no retry on transient LLM failures, no parallelism across pipeline stages.
**Do this instead:** Async queue from upload-receipt onward. AM polls or subscribes to a status channel; when the run reaches `reviewing`, the queue surfaces the drafts.

### Anti-Pattern 6: Logging the Scenario Payload in Plain Text Without Hashing

**What people do:** `evaluation_event.scenario_payload` is the only identifier of a scenario.
**Why it's wrong:** Re-running staleness detection requires comparing scenarios; comparing nested JSON is expensive at scale. Joining across millions of events on payload equality is impossible.
**Do this instead:** Always store both `scenario_hash` (sha256 of canonicalized JSON) and `scenario_payload`. Index on `scenario_hash`. Comparison is O(1).

### Anti-Pattern 7: Storing the Anthropic API Key in localStorage (the existing prototype's pattern)

**What people do:** Carry forward the prototype pattern of putting the Anthropic key in browser localStorage.
**Why it's wrong:** Documented in the existing codebase audit as a security concern. Plaintext key, exfiltrable from any XSS, no rotation, no audit.
**Do this instead:** Server-side LLM proxy. Browser never sees the key. Per-tenant rate limits and audit trail of every LLM call sit on the server.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| **Supabase Postgres** | Connection string via env; Drizzle for typed queries; RLS via JWT claim | Use `pgbouncer` connection pooling; transaction mode for `set_config` propagation |
| **Supabase Auth** | OAuth + email/magic-link; JWT custom claim populated by Edge Function on sign-in | tenant_id custom claim is the single source of truth for tenancy |
| **Supabase Storage** | Per-tenant prefix `/tenants/{tenant_id}/`; signed URLs for AM PDF viewing | Storage RLS policies mirror Postgres RLS; never serve a tenant's PDF to another tenant |
| **Anthropic API (Claude)** | Server-side proxy; structured output schemas for extraction; rate-limited per tenant | Per-tenant API budget; request log for audit |
| **OCR (Mistral / Azure)** | Server-side, called from worker only; word-level bbox required | Mistral Document AI for cost; Azure Document Intelligence for accuracy on complex tables |
| **Vercel Cron** | Daily agency-poll trigger; hourly staleness scan trigger | Free tier sufficient at MVP |
| **pg-boss** | Postgres-backed queue inside the same database; SKIP LOCKED concurrency | Promote to Trigger.dev at Phase 2 if extraction volume demands durable execution |
| **Encompass / LendingPad** | Export only at Phase 1 (JSON / their import schema); webhook receivers at Phase 2 | No bidirectional sync at MVP |
| **Postmark / Twilio** | Phase 3 alerts on saved-scenario staleness | Out of Phase 1 scope |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| **Next.js app ↔ evaluation engine** | Direct in-process function call | Engine is pure TS, no I/O, dependency-free |
| **Next.js app ↔ Postgres** | tRPC routers wrap Drizzle queries inside `withTenantContext` | Every query runs with `app.tenant_id` set |
| **Next.js app ↔ pg-boss (enqueue)** | Direct SQL `pgboss.send()` | Same database, same transaction as the originating action |
| **Worker process ↔ Postgres** | Drizzle, but using the system_role for cross-tenant agency cascade work; tenant-scoped role for extraction writes | Worker has access to system role for queue table only; tenant role for `staging.*` |
| **Worker process ↔ Anthropic / OCR** | HTTP, retried with exponential backoff | All retries idempotent against `staging.draft_rule` upsert by `(extraction_run_id, rule_kind, citation_pdf_page)` |
| **Worker process ↔ Storage** | Signed URL with short TTL | Worker fetches the PDF, never stores it locally beyond the job lifetime |
| **App ↔ Worker** | Asynchronous via pg-boss; status polling via Postgres | No direct HTTP between app and worker |

---

## Sources

- [Multi-tenant data isolation with PostgreSQL Row Level Security | AWS](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/)
- [Row-level security recommendations | AWS Prescriptive Guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-managed-postgresql/rls.html)
- [Postgres RLS Implementation Guide — permit.io](https://www.permit.io/blog/postgres-rls-implementation-guide)
- [Shipping multi-tenant SaaS using Postgres RLS — thenile.dev](https://www.thenile.dev/blog/multi-tenant-rls)
- [Supabase Authorization via Row Level Security](https://supabase.com/features/row-level-security)
- [Supabase Token Security and Row Level Security](https://supabase.com/docs/guides/auth/oauth-server/token-security)
- [SQL2011 Temporal — PostgreSQL Wiki](https://wiki.postgresql.org/wiki/SQL2011Temporal)
- [Two-dimensional time with bitemporal data — Aiven](https://aiven.io/blog/two-dimensional-time-with-bitemporal-data)
- [Multi-temporal versioning in Postgres — HASH Developer Blog](https://hash.dev/blog/multi-temporal-versioning)
- [Temporal database — Wikipedia](https://en.wikipedia.org/wiki/Temporal_database)
- [HealthEdge OCR Pipeline Architecture (HITL with confidence)](https://healthedge.com/resources/blog/building-a-scalable-ocr-pipeline-technical-architecture-behind-healthedge-s-document-processing-platform)
- [Multi-Stage Field Extraction of Financial Documents (arXiv 2025)](https://arxiv.org/html/2510.23066v1)
- [Human In The Loop for AI Document Processing — Unstract](https://unstract.com/blog/human-in-the-loop-hitl-for-ai-document-processing/)
- [pg-boss on GitHub](https://github.com/timgit/pg-boss)
- [Hatchet vs Trigger.dev v3 vs Inngest — PkgPulse 2026](https://www.pkgpulse.com/blog/hatchet-vs-trigger-dev-v3-vs-inngest-durable-workflows-2026)
- [Audit Trails and Explainability for Compliance — Lawrence Emenike](https://lawrence-emenike.medium.com/audit-trails-and-explainability-for-compliance-building-the-transparency-layer-financial-services-d24961bad987)
- [The Compliance Policy Digitization Blueprint](https://www.complianceandrisks.com/blog/the-compliance-policy-digitization-blueprint-architecting-auditable-rule-engines-for-the-ai-era/)
- Existing project context: `/Users/chrissaechao/IdeaProjects/lender-search/.planning/PROJECT.md`
- Existing prototype reference: `/Users/chrissaechao/IdeaProjects/lender-search/.planning/codebase/ARCHITECTURE.md`

---

*Architecture research for: eligibility-first mortgage program search with AI-assisted rule extraction*
*Researched: 2026-04-29*
