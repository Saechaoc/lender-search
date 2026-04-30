# Phase 2: Rule Schema - Context

**Gathered:** 2026-04-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 lands the layered rule schema (4-layer enum), structured DerogRule model, bitemporal versioning with `daterange` + `EXCLUDE USING gist`, and citation discipline as a database constraint. Tables ship for the agency layer (`agency_rule_version`, `agency_rule`); the FNMA/FHLMC/FHA/VA derogatory-event matrix data is hand-authored in Phase 3. This is the schema keystone — every later phase pays the rework cost if Phase 2 is wrong (Pitfall 4.1).

**In scope (SCH-01 through SCH-14):**

- `agency_rule_version` (system-owned, NOT tenant-scoped) + `agency_rule` (system-owned). Tables only; Phase 3 hand-authors FNMA/FHLMC/FHA/VA content. `agency_rule_version.effective_period daterange` with `EXCLUDE USING gist (agency WITH =, effective_period WITH &&)` and `superseded_by uuid NULL` self-FK so the Phase 3 cascade trigger can resolve which programs reference a now-superseded version.
- `program` (tenant-scoped, RLS-policed) + `program_version` (tenant-scoped, RLS, bitemporal `effective_period daterange` + content-addressed `source_document_fingerprint text NOT NULL`). State enum `('draft','in_review','active','deprecated','sunset')`. `EXCLUDE USING gist (program_id WITH =, effective_period WITH &&) WHERE (state = 'active')` — only one active version per program at a time.
- `program_rule` (tenant-scoped, RLS) with `layer text` enum restricted to `('INVESTOR_OVERLAY','PRODUCT_FEATURE')`, `rule_kind text` enum, `rule_body jsonb NOT NULL`, `field_confidence jsonb NOT NULL DEFAULT '{}'::jsonb`, generated `min_confidence numeric STORED`, `primary_citation_id uuid NOT NULL REFERENCES rule_citation(id)`.
- `lender_overlay_rule` (tenant-scoped, RLS, `applies_to_program_id uuid NULL`) — table shape only; brokerage-author UI is Phase 12 (LOV-01..03).
- `rule_citation` (page + bbox + textSpan + excerpt) — required FK target for every program_rule and agency_rule. Optional `secondary_for_rule_id uuid NULL` back-pointer for multi-page 1:N citations. `pgvector` embedding column deferred to Phase 7.
- Structured DerogRule shape: rows in `agency_rule` with `rule_kind = 'derog_seasoning'` and a typed `rule_body` carrying `event_type` (BK7 | BK13_DISCHARGED | BK13_DISMISSED | MULTIPLE_BK | FORECLOSURE | DEED_IN_LIEU | SHORT_SALE | MORTGAGE_CHARGE_OFF | MOD | FORBEARANCE), `measurement_anchor`, `base_waiting_months`, `extenuating_circumstances_waiting_months`, `post_event_LTV_caps[]` (each with `months_since_min`/`months_since_max`/`max_LTV`/`purposeAllowList`/`occupancyAllowList`), `reestablished_credit_required`, `mortgage_included_in_bk_rule`, `notes_citations[]`. Queryable by `event_type` per Phase 2 SC#2.
- Typed `IncomeDocMethod` and `DscrMethod` Zod/TS schemas at `lib/rules/schemas/` backing `rule_body` for `rule_kind IN ('income_doc_method','dscr_method')` per program. Schemas shared between Phase 7 extraction validator, Phase 8 AM commit, and Phase 4 evaluator.
- `eligible_loan_purposes` / `eligible_property_types` / `eligible_occupancies` / `eligible_doc_types` enumerated arrays + explicit `ineligible_*` columns on `program_version` (SCH-11).
- State-level eligibility + county overlay scaffolding on `program_version` (SCH-12 — USDA-shape only; full USDA encoding is Phase 12 v2 COV-v2-01).
- SQL function `detect_loosenings(program_version_id uuid)` returning a violations table; called by Phase 2 schema-constraint tests now and by Phase 8 AM commit transaction later. No BEFORE INSERT trigger — detection, not write-time blocking, per SCH-03 "surfaces during AM review."
- RLS pen tests at `tests/rls/` extended to every new tenant-scoped table (`program`, `program_version`, `program_rule`, `lender_overlay_rule`, `rule_citation`).
- Schema-constraint tests at `tests/schema/`: NOT NULL primary_citation_id, EXCLUDE blocks overlapping active program_versions, `detect_loosenings()` flags constructed loosenings, structured DerogRule round-trips through Drizzle and queries by event_type.
- Drizzle schema at `db/schema/<table>.ts` per Phase 1 pattern + `--custom` migrations for `FORCE ROW LEVEL SECURITY`, `EXCLUDE USING gist`, `detect_loosenings()` SQL function, `rule_citation` source CHECK, `system_role` policy on agency tables.

**Out of scope (explicit deferrals):**

- Hand-authored FNMA / FHLMC / FHA / VA agency rule content → Phase 3 (AGY-01..09)
- Append-only `evaluation_event` audit log + `REVOKE UPDATE, DELETE` + `ruleset_snapshot_id` → Phase 3 (AUD-01..04)
- Pure-TS evaluation engine at `lib/eval/` → Phase 4 (EVL-01..09)
- Library-vs-custom evaluator spike → Phase 4 (EVL-09)
- `staging.draft_rule` / `staging.draft_rule_field_confidence` / `staging.extraction_run` schema + extraction pipeline → Phase 7 (EXT-01..10)
- AM three-pane review UI, confidence-sorted queue, bulk-accept, license gate, program lifecycle state-transition enforcement at AM commit boundary → Phase 8 (AM-01..09, PRG-01..04, LCS-01..04)
- LO scenario form / results / comparison view → Phase 9 (LO-01..10)
- Saved scenarios / sharing / disclaimer → Phase 10 (SHR-01..04, DCL-01..04)
- Coverage build-out + GTM exit gates → Phase 11 (COV-01..03, GTM-01..02)
- Brokerage `LENDER_OVERLAY` author UI → Phase 12 v2 (LOV-01..03)
- 2026 FHFA conforming loan limits + high-balance overlay table → Phase 3 (AGY-09)
- `pgvector` embedding column on `rule_citation` → Phase 7 (extraction-driven semantic search)
- Live pricing tables → Phase 13 (PRC-01..05)

</domain>

<decisions>
## Implementation Decisions

### Citation FK enforcement (SCH-13 — release-blocker per Conventions §)

- **D-01:** `program_rule.primary_citation_id uuid NOT NULL REFERENCES rule_citation(id)` and `agency_rule.primary_citation_id uuid NOT NULL REFERENCES rule_citation(id)`. Standard FK constraint; no triggers; no deferrable mechanics. Insert order is citation-then-rule within a single transaction. The hard "no rule without citation" guarantee is the NOT NULL primary FK.
- **D-02:** Multi-page / multi-citation case (one rule cites multiple PDF pages, or a derog rule cites the FNMA Selling Guide URL plus a specific section): additional citations live as `rule_citation` rows with optional `secondary_for_rule_id uuid NULL` back-pointer to the program_rule or agency_rule they supplement. Phase 4 evaluator concatenates primary + secondary citations when rendering the "why" expansion.
- **D-03:** `rule_citation` columns: `id uuid pk default gen_random_uuid()`, `source_pdf_sha256 text NULL` (nullable for hand-authored agency rules with only a Selling Guide URL), `source_url text NULL`, `page_number int NULL`, `bbox jsonb NULL` (`{x,y,w,h}`), `excerpt text NOT NULL` (the cited textSpan), `secondary_for_rule_id uuid NULL`, `created_at timestamptz NOT NULL DEFAULT now()`. Plus a `--custom` CHECK constraint: `source_pdf_sha256 IS NOT NULL OR source_url IS NOT NULL` so every citation has at least one source pointer.
- **D-04:** The bbox/textSpan-actually-appears-at-cited-bbox server-side validation called out in PROJECT.md §Conventions runs in Phase 7 (extraction pipeline) before staging→canonical promotion — NOT at Phase 2's DB layer. Phase 2 ships the structural FK; Phase 7 wires the substantive validation.

### Layer storage shape (SCH-01, SCH-02 prep)

- **D-05:** Three-table split per `.planning/research/ARCHITECTURE.md` §"Concrete Schema":
  - `agency_rule` — system-owned (NOT tenant-scoped, NO RLS, system_role policy for cross-tenant readability), `agency_rule_version_id` FK, layer is implicitly `AGENCY_BASE` (no layer column).
  - `program_rule` — tenant-scoped (RLS), `layer text` enum constrained to `('INVESTOR_OVERLAY','PRODUCT_FEATURE')`, `program_version_id` FK. AGENCY_BASE never appears here (programs reference agency via `program_version.agency_rule_version_id` FK; embedding agency rules per program is Anti-Pattern 1).
  - `lender_overlay_rule` — tenant-scoped (RLS), `applies_to_program_id uuid NULL` (NULL means applies to all programs at the brokerage tenant), layer is implicitly `LENDER_OVERLAY` (no layer column). Phase 2 ships table shape; brokerage-author UI is Phase 12.
- **D-06:** Phase 4 evaluator UNIONs all three tables to assemble `rule_stack` per dimension. The `layer` attribution on the deciding rule (Differentiator #4) is computed at evaluation time from the source table, not stored on a single column. This makes "most restrictive wins" reduction across layers a pure function of joined data.
- **D-07:** `lender_overlay_rule` ships at Phase 2 even though no UI populates it. Adding the table later would force a schema change after Phase 4 evaluator hardens against the rule shape (Pitfall 4.1: schema instability cascades). Empty table at end of Phase 2.

### rule_body validation strictness (SCH-04, SCH-05, SCH-06, SCH-07, SCH-10)

- **D-08:** Hybrid validation: jsonb `rule_body` + `rule_kind text` enum + per-rule_kind Zod schemas at `lib/rules/schemas/<kind>.ts`, shared between Phase 7 extraction validator, Phase 8 AM commit, and Phase 4 evaluator. DB-level checks: `rule_body IS NOT NULL`, `jsonb_typeof(rule_body) = 'object'`, `rule_kind IN (enum)`. Heavy per-kind shape validation lives in TypeScript, not Postgres `CHECK (jsonb_path_exists(...))` constraints (those churn with every kind shape change and are clunky to migrate).
- **D-09:** `rule_kind` Phase 2 enum (extensible — new kinds add via Drizzle enum migration + matching Zod schema in same PR): `('ltv_max','cltv_max','hcltv_max','fico_min','dti_max','reserves_min','derog_seasoning','income_doc_method','dscr_method','geo_state','geo_county','occupancy_allow','purpose_allow','property_type_allow','doc_type_allow','mi_required','manual_uw_path')`.
- **D-10:** Per-field confidence (SCH-10): sibling jsonb column `field_confidence jsonb NOT NULL DEFAULT '{}'::jsonb` on `program_rule` (and `agency_rule`, with default `'{}'` since hand-authored agency rules are confidence 1.0 by definition; Phase 3 may override on `agency_rule.field_confidence` for synthetically-extracted agency rules). Plus a generated stored column `min_confidence numeric GENERATED ALWAYS AS ((SELECT MIN((value)::numeric) FROM jsonb_each_text(field_confidence))) STORED` so Phase 8's confidence-sorted queue is an indexed sort. CHECK at write boundary (Zod): every `field_confidence` value in `[0, 1]`.
- **D-11:** `IncomeDocMethod` (SCH-06) and `DscrMethod` (SCH-07) are typed Zod schemas at `lib/rules/schemas/income-doc-method.ts` and `lib/rules/schemas/dscr-method.ts` backing `rule_body` when `rule_kind IN ('income_doc_method','dscr_method')`. NOT separate tables. One row per program per method in `program_rule` (or `agency_rule` for agency-baseline doc methods). `IncomeDocMethod` shape covers personal-vs-business, expense-factor source (CPA / borrower-attest / fixed percentage), comingled-account treatment, NSF treatment, qualifying-period months. `DscrMethod` shape covers numerator rule (gross rents / net operating income / market rent), denominator rule (PITIA / PITI), IO handling, ARM qualification, no-ratio option flag.

### Loosening rejection enforcement (SCH-03 + Phase 2 Success Criterion #4)

- **D-12:** SQL function `detect_loosenings(program_version_id uuid) RETURNS TABLE (program_rule_id uuid, agency_rule_id uuid, dimension text, agency_value jsonb, overlay_value jsonb)` deployed via `--custom` migration at `db/migrations/0006_detect_loosenings.sql`. For each `INVESTOR_OVERLAY` row in `program_rule` for the given program_version, joins to the matching `AGENCY_BASE` row in `agency_rule` (by `rule_kind` + the program_version's `agency_rule_version_id`) and returns rows where the overlay is more permissive than the agency baseline.
- **D-13:** No BEFORE INSERT/UPDATE trigger that hard-rejects. SCH-03 says "surfaces them as data-quality errors during AM review" — meaning AM-time UX, not write-time hard rejection. A trigger would block legitimate extraction-draft rows that may temporarily contain detected loosenings before AM review. Phase 2 schema-constraint tests assert `detect_loosenings()` finds a constructed loosening on a fixture; Phase 8 AM commit transaction calls it pre-commit and blocks commit if non-empty (deferred wiring).
- **D-14:** Numeric comparison rules implemented inside the function:
  - `ltv_max` / `cltv_max` / `hcltv_max` / `dti_max`: overlay must be **≤** agency (overlays restrict; relaxing is loosening).
  - `fico_min` / `reserves_min`: overlay must be **≥** agency (raising the floor is restricting; lowering is loosening).
  - `derog_seasoning.base_waiting_months` and `extenuating_circumstances_waiting_months`: overlay must be **≥** agency (longer wait is restricting).
  - Allow-list arrays (`occupancy_allow`, `purpose_allow`, `property_type_allow`, `doc_type_allow`): overlay must be a **subset of** agency (removing options is restricting; adding is loosening).
  - Other rule_kinds: skipped at Phase 2 (function returns rows for the comparable kinds only); Phase 8 may extend.

### Bitemporal versioning shape (SCH-09 — locked in research, captured here for downstream agents)

- **D-15:** `program_version` columns: `id uuid pk`, `tenant_id uuid NOT NULL`, `program_id uuid NOT NULL REFERENCES program(id)`, `agency_rule_version_id uuid NOT NULL REFERENCES agency_rule_version(id)`, `effective_period daterange NOT NULL`, `recorded_at timestamptz NOT NULL DEFAULT now()`, `state text NOT NULL CHECK (state IN ('draft','in_review','active','deprecated','sunset'))`, `source_document_fingerprint text NOT NULL` (sha256 of source matrix PDF for extracted programs; content-addressed hash of canonical hand-authored payload for Phase 3 seed rows), plus `eligible_*` and `ineligible_*` arrays per SCH-11 and `geo_*` scaffolding per SCH-12. `EXCLUDE USING gist (program_id WITH =, effective_period WITH &&) WHERE (state = 'active')` lands via `--custom` migration.
- **D-16:** `agency_rule_version` columns: `id uuid pk`, `agency text NOT NULL CHECK (agency IN ('FNMA','FHLMC','FHA','VA','USDA'))`, `version_label text NOT NULL`, `source_url text NULL`, `source_pdf_sha256 text NULL`, `effective_period daterange NOT NULL`, `recorded_at timestamptz NOT NULL DEFAULT now()`, `superseded_by uuid NULL REFERENCES agency_rule_version(id)`. `EXCLUDE USING gist (agency WITH =, effective_period WITH &&)` lands via `--custom` migration. Phase 3 cascade trigger uses `superseded_by` to resolve affected program_versions.

### Migration tooling continuation (Phase 1 D-10, D-12 pattern)

- **D-17:** Phase 2 reuses Phase 1's pattern: Drizzle schema TS at `db/schema/<table>.ts` declares tables, indexes, standard FKs, and `pgPolicy()` for RLS; `drizzle-kit generate` produces table-creation SQL; `--custom` migrations cover `FORCE ROW LEVEL SECURITY`, `EXCLUDE USING gist`, SQL functions, and `system_role` policies on agency tables (Drizzle 0.45 doesn't model these natively).
- **D-18:** Migration ordering (proposed; Phase 2 plans may refine):
  1. `0002_program_schema.sql` (drizzle-kit generate) — `program`, `program_version`, `program_rule`, `rule_citation` tables + indexes + standard FKs + tenant-scoped pgPolicy SQL
  2. `0003_force_rls_program.sql` (`--custom`) — `FORCE ROW LEVEL SECURITY` on the four new tenant-scoped tables + `GRANT SELECT,INSERT,UPDATE,DELETE` to `app_user` (matches Phase 1 D-12)
  3. `0004_program_constraints.sql` (`--custom`) — `EXCLUDE USING gist` on `program_version` + `rule_citation` source CHECK
  4. `0005_agency_schema.sql` (drizzle-kit generate) — `agency_rule_version`, `agency_rule`, `lender_overlay_rule` tables + indexes + standard FKs + `lender_overlay_rule` tenant-scoped pgPolicy
  5. `0006_force_rls_agency.sql` (`--custom`) — `FORCE` on `lender_overlay_rule` + `system_role` policy on `agency_rule_version` and `agency_rule` + `EXCLUDE USING gist` on `agency_rule_version` + `app_user` GRANTs
  6. `0007_detect_loosenings.sql` (`--custom`) — `detect_loosenings(uuid)` function definition

### Test approach

- **D-19:** Pen-test extension at `tests/rls/`: every new tenant-scoped table (`program`, `program_version`, `program_rule`, `lender_overlay_rule`, `rule_citation`) gets cross-tenant SELECT/INSERT/UPDATE/DELETE coverage matching Phase 1 D-03 matrix. Reuses `seedTwoTenants`, `connectAsTenant`, `connectAsAnonymous` fixtures; extends `seedTwoTenants` to also create one program + program_version + program_rule + rule_citation per tenant.
- **D-20:** New schema-constraint tests at `tests/schema/`:
  1. Inserting `program_rule` without `primary_citation_id` fails with NOT NULL violation
  2. Inserting `program_rule` with `primary_citation_id` referencing a non-existent `rule_citation` fails with FK violation
  3. `EXCLUDE` blocks two `state='active'` `program_version` rows with overlapping `effective_period` for the same `program_id`; allows overlapping for different states
  4. `agency_rule_version` `EXCLUDE` blocks overlapping `effective_period` for the same agency
  5. `detect_loosenings()` returns the expected row when an `INVESTOR_OVERLAY` `ltv_max` is higher than its `AGENCY_BASE` peer; returns empty when overlay is restrictive
  6. Structured DerogRule (`rule_kind = 'derog_seasoning'`) round-trips: insert FNMA post-foreclosure 3-to-7-year body, query `WHERE rule_body->>'event_type' = 'FORECLOSURE'`, assert returned row has `post_event_LTV_caps[0].max_LTV = 90` and `purposeAllowList = ['PURCHASE','RATE_TERM_REFI']` and `occupancyAllowList = ['PRIMARY']`
  7. `agency_rule` rows are readable across tenants via the `system_role` policy (cross-tenant agency readability)
  8. Inserting `rule_citation` with both `source_pdf_sha256 IS NULL` and `source_url IS NULL` fails the source CHECK
- **D-21:** Vitest config: add `tests/schema/` to the include glob; mirror `tests/rls/` setup (globalSetup runs migrate; setup.ts asserts FORCE RLS + policy presence on new tables). New `package.json` script: `"test:schema": "vitest run tests/schema"`.

### Claude's Discretion

- Exact column-name conventions on new tables (snake_case mirroring Phase 1)
- Index design beyond mandatory `tenant_id` indexes — pick what supports rule-stack assembly (likely `(program_version_id, layer, rule_kind)` on `program_rule`) and the Phase 3 cascade trigger (likely `(agency_rule_version_id)` on `program_version`)
- Whether `derog_rule` is a separate table or rows in `agency_rule` with `rule_kind = 'derog_seasoning'` — leaning toward rows in `agency_rule` to keep table count down; structured derog body lives in jsonb with the Zod schema enforcing shape
- Drizzle column type choices where multiple options work (`text` vs varchar, numeric precision, etc.)
- Whether to ship a single seed `agency_rule_version` + `agency_rule` row pair for the FNMA post-foreclosure example to prove SC#2's query path in Phase 2 tests, OR rely on test-only fixtures — pick whichever minimizes Phase 3 hand-authoring rework
- Whether `system_role` is a Postgres role or a sentinel zero-uuid `tenant_id` for agency-table cross-tenant readability — pick whichever is cleanest with Drizzle 0.45's `pgPolicy` modeling

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/PROJECT.md` §Conventions — citation discipline as hard constraint, bitemporal versioning, staging schema for extraction, tenant filtering at the database, append-only audit, pure-TS evaluator at lib/eval/
- `.planning/PROJECT.md` §Architecture — centralized rule store sketch (agency_rule_version + program_version + program_rule + rule_citation), build order
- `.planning/PROJECT.md` §Out of Scope — cross-tenant overlay visibility (release-blocker), no Pricing-Insight-style competitive analytics
- `.planning/REQUIREMENTS.md` §SCH — SCH-01 through SCH-14 (the 14 requirements Phase 2 must satisfy)
- `.planning/REQUIREMENTS.md` §AGY — AGY-01 through AGY-09 (Phase 3 scope; Phase 2 ships table shape only)
- `.planning/ROADMAP.md` §"Phase 2: Rule Schema" — goal + 5 success criteria

### Architecture and patterns
- `.planning/research/ARCHITECTURE.md` §"Pattern 3: Bitemporal Versioning with Daterange Effective Windows" — `effective_period daterange` + `EXCLUDE USING gist`
- `.planning/research/ARCHITECTURE.md` §"Pattern 4: Staging Schema for In-Flight Drafts" — confidence column shape + `min_confidence` generated column (Phase 2 mirrors this on canonical tables; Phase 7 lifts for staging)
- `.planning/research/ARCHITECTURE.md` §"Pattern 6: Citation Linkage from Rule to PDF Source" — `rule_citation` row shape; embedding column deferred to Phase 7
- `.planning/research/ARCHITECTURE.md` §"Concrete Schema (Sketch)" — full DDL sketch covering `tenant`, `agency_rule_version`, `agency_rule`, `program`, `program_version`, `program_rule`, `lender_overlay_rule`, `rule_citation`, `evaluation_event`
- `.planning/research/ARCHITECTURE.md` §"Anti-Pattern 1: Embedding Agency Rules in Each Program" — `agency_rule` is centralized (drives D-05)
- `.planning/research/ARCHITECTURE.md` §"Anti-Pattern 4: Letting the Extraction Pipeline Write Canonical Tables" — staging schema separation (Phase 7 not Phase 2)

### Pitfalls (rule-schema-relevant)
- `.planning/research/PITFALLS.md` §Pitfall 1.1 — derog as boolean fails; structured event-typed model is mandatory
- `.planning/research/PITFALLS.md` §Pitfall 1.2 — FNMA 3-to-7-year post-foreclosure 90% LTV window must be encoded structurally (Phase 2 SC#2)
- `.planning/research/PITFALLS.md` §Pitfall 1.3 — `measurement_anchor` varies by event type (BK discharge vs foreclosure completion)
- `.planning/research/PITFALLS.md` §Pitfall 1.5 — multi-filing window stacking
- `.planning/research/PITFALLS.md` §Pitfall 1.6 — mortgage-included-in-BK rule branch (anchor = BK discharge per FNMA)
- `.planning/research/PITFALLS.md` §Pitfall 1.8 — `IncomeDocMethod` typed object, not flat label
- `.planning/research/PITFALLS.md` §Pitfall 1.9 — `DscrMethod` typed object
- `.planning/research/PITFALLS.md` §Pitfall 2.8 — citation discipline as schema-level enforcement (drives D-01)
- `.planning/research/PITFALLS.md` §Pitfall 3.5 — tenant isolation breached by shared overlay; `lender_overlay_rule` MUST carry `tenant_id` (drives D-05, D-07)
- `.planning/research/PITFALLS.md` §Pitfall 4.1 — schema stability before UI; Phase 2 is the keystone

### Stack rationale (do not relitigate)
- `.planning/research/STACK.md` — Postgres 16 + Drizzle 0.45 + jsonb + bitemporal patterns
- `CLAUDE.md` §Conventions — citation discipline, bitemporal, staging, tenant filtering, append-only audit, pure-TS evaluator at `lib/eval/`
- `CLAUDE.md` §Architecture — anti-patterns to avoid

### Phase 1 carry-forward (RLS / migration / test patterns)
- `.planning/phases/01-tenant-isolation-foundation/01-CONTEXT.md` — D-04..D-12 (RLS, FORCE, GUC, two-connection-string, Drizzle pattern, pen-test harness, t3-env, ESLint)
- `db/schema/tenant.ts` — `pgPolicy` + `tenant_kind` enum reference implementation (Phase 2 follows the same pattern)
- `db/schema/canary.ts` — tenant-scoped table reference (`tenant_id` FK, indexed, RLS policy)
- `db/migrations/0001_force_rls.sql` — `--custom` migration pattern for FORCE RLS + GRANTs
- `lib/tenant/context.ts` — `setTenantContext` primitive used by Phase 2 schema-constraint tests + pen-test harness
- `tests/rls/` — Phase 2 pen tests extend this harness without forking
- `drizzle.config.ts` — loads `.env.local` first then `.env`; two-connection-string pattern (postgres for migrations, app_user for runtime/tests)

### Source-of-truth domain references (Phase 3 hand-authoring target; Phase 2 schema must accommodate)
- FNMA Selling Guide B3-5.3-07 — derogatory waiting period matrix
- FHLMC Single-Family Seller/Servicer Guide §5202.5 — derog rules
- HUD 4000.1 — FHA derog (Back-to-Work DEPRECATED 2016-09-30; standard EC remains active)
- VA Pamphlet 26-7 — VA derog rules

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `db/schema/tenant.ts` — `pgPolicy` + `tenant_kind` enum reference; Phase 2 follows the same pattern for new tables
- `db/schema/canary.ts` — tenant-scoped table with `tenant_id` FK + index + RLS policy; Phase 2's `program`, `program_version`, `program_rule`, `lender_overlay_rule`, `rule_citation` mirror this pattern
- `db/schema/index.ts` — barrel export; Phase 2 appends `export * from './program.js'`, `export * from './program-version.js'`, `export * from './program-rule.js'`, `export * from './rule-citation.js'`, `export * from './agency-rule-version.js'`, `export * from './agency-rule.js'`, `export * from './lender-overlay-rule.js'`
- `db/migrations/0000_initial.sql` — drizzle-kit generated table DDL pattern
- `db/migrations/0001_force_rls.sql` — `--custom` migration pattern for FORCE RLS + GRANTs (Phase 2 mirrors per-table migration)
- `lib/tenant/context.ts::setTenantContext` — used directly in Phase 2 schema-constraint tests + pen-test harness extensions
- `lib/env.ts` — t3-env validated env access (no new vars at Phase 2; reused for tests)
- `tests/rls/setup.ts` — globalSetup runs migrate + GRANTs DML to app_user; Phase 2 extends to grant on new tables
- `tests/rls/seedTwoTenants.ts` — fixture extended to also seed one program / program_version / program_rule / rule_citation per tenant
- `tests/rls/connectAsTenant.ts` + `tests/rls/connectAsAnonymous.ts` — connection helpers reused unchanged
- `drizzle.config.ts` — two-connection-string pattern (`DATABASE_MIGRATION_URL` + `DATABASE_URL`); reused unchanged

### Established Patterns
- Schema-as-code in TypeScript: `pgTable()` + `pgPolicy()` + `pgEnum()` from `drizzle-orm/pg-core`
- NodeNext `.js` extensions on relative imports (TS2835)
- `current_setting('app.tenant_id', true)::uuid` is canonical RLS predicate; only references are `db/schema/*.ts` policies, `lib/tenant/context.ts`, `tests/rls/*`. Phase 2 must NOT introduce a fourth reference site
- `--custom` migration for FORCE RLS, EXCLUDE constraints, SQL functions, system_role policies (Drizzle 0.45 doesn't model these natively)
- Two-connection-string: `DATABASE_MIGRATION_URL` (postgres superuser, table owner) for migrations; `DATABASE_URL` (app_user, NOBYPASSRLS NOSUPERUSER) for runtime + pen tests
- Post-migrate GRANT step: every new table needs `GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE <new_table> TO app_user` after migrate creates it owned by postgres (init-db.sh's ALTER DEFAULT PRIVILEGES covers FUTURE tables but not the ones created during migrate)
- `drizzle-kit migrate` (file-based migrations); never `drizzle-kit push` (silently drops RLS DDL — Issue #3504)
- TDD pattern from Plan 01-07: tests for new constraints land in the same commit as the constraint (RED+GREEN folding when system under test exists prior)

### Integration Points
- `lib/tenant/context.ts::setTenantContext` is the integration seam Phase 6 `withTenantContext` consumes; Phase 2 schema work doesn't change the signature
- New tenant-scoped tables (`program`, `program_version`, `program_rule`, `lender_overlay_rule`, `rule_citation`) all carry `tenant_id` and follow the canonical RLS predicate
- `agency_rule_version` and `agency_rule` are NOT tenant-scoped — system-owned; Phase 2 introduces a `system_role` Postgres role pattern (or zero-uuid sentinel; see Claude's Discretion D-05) for cross-tenant readability
- `detect_loosenings(uuid)` SQL function is the integration seam Phase 8 AM commit transaction calls; signature locked at Phase 2 so Phase 8 plans don't relitigate
- `lib/rules/schemas/<kind>.ts` Zod schemas are the integration seam consumed by Phase 4 evaluator (read path), Phase 7 extraction validator (write path), Phase 8 AM commit (final validation before staging→canonical)
- Phase 3 cascade trigger on `agency_rule_version INSERT` resolves affected program_versions via `superseded_by` self-FK + `program_version.agency_rule_version_id`; Phase 2 ships these columns ready for the Phase 3 trigger to consume

</code_context>

<specifics>
## Specific Ideas

- The `_rls_canary` table from Phase 1 stays — Phase 2 does not delete or modify it. Permanent RLS regression smoke target for all later phases.
- Citation discipline is the architectural commitment that turns "extraction with confidence scoring" from decoration into a defensible wedge (Pitfall 2.8). The NOT NULL primary FK is the structural guarantee; bbox/textSpan substantive validation is Phase 7.
- Phase 2 SC#2 demands a queryable structured DerogRule for the FNMA post-foreclosure 3-to-7-year band. A single seed `agency_rule_version` + `agency_rule` row demonstrating this query path may ship in Phase 2 tests OR live as a fixture (Claude's Discretion); full FNMA matrix is Phase 3 AGY-02.
- Drizzle 0.45 does NOT model `EXCLUDE USING gist`, `FORCE ROW LEVEL SECURITY`, or SQL functions natively — every such DDL goes through `--custom` migrations. Phase 1 Plan 05 established the pattern; Phase 2 reuses without relitigation.
- Column-level: prefer `text` over `varchar(N)` (Postgres convention; no performance difference, fewer migration headaches). Use `numeric` (not `real`/`double precision`) for confidence and any monetary-adjacent fields.
- `system_role` Postgres role vs zero-uuid sentinel for agency-table readability: research/ARCHITECTURE.md sketches the system_role approach. Pick the option Drizzle's `pgPolicy()` models cleanest. If both are equally awkward, prefer the role approach because it generalizes to Phase 3's hand-authoring workflow (the migration runner already runs as postgres / superuser; agency rule writes are migration-driven).

</specifics>

<deferred>
## Deferred Ideas

These came up during analysis but belong in later phases. Captured to avoid loss; explicitly out of scope for Phase 2.

- **Hand-authored FNMA / FHLMC / FHA / VA agency rule content** — Phase 3 (AGY-01..09); Phase 2 ships the table shape and at most a single demonstration row for SC#2 query test.
- **Append-only `evaluation_event` table + `REVOKE UPDATE, DELETE` + content-addressed `ruleset_snapshot_id` + monthly partitions** — Phase 3 (AUD-01..04).
- **Daily Vercel Cron polling FNMA / FHLMC / FHA / VA + cascade trigger on `agency_rule_version` INSERT + per-affected-program review queue fan-out** — Phase 3 (AGY-07, AGY-08); Phase 2 ships the `superseded_by` column the trigger uses.
- **Pure-TS evaluation engine at `lib/eval/`** — Phase 4 (EVL-01..09); Phase 2 schema designs the rule shape so the evaluator is a pure consumer.
- **`json-rules-engine@7.x` vs ~500-LOC custom evaluator spike** — Phase 4 (EVL-09); decided on rule-corruption-blast-radius criterion.
- **`pgvector` embedding column on `rule_citation`** — Phase 7 extraction pipeline lands semantic-search needs; Phase 2 keeps `rule_citation` simple.
- **`staging.draft_rule` / `staging.draft_rule_field_confidence` / `staging.extraction_run` schema** — Phase 7 (EXT-06); structurally separate from canonical, mirrors per-field confidence shape.
- **AM commit transaction calling `detect_loosenings()` to block bad commits** — Phase 8 (SCH-03 AM-time enforcement); Phase 2 ships the function, Phase 8 wires the call site.
- **AM three-pane review UI + program lifecycle state-transition enforcement (`draft → in_review → active → deprecated → sunset`)** — Phase 8 (AM-01..09, PRG-01..04). Phase 2 ships the `state` column with CHECK constraint; Phase 8 enforces transition rules.
- **License gate on `program_version` commit (no commit without `license_id`)** — Phase 8 (LCS-01..04). Phase 2 may ship a nullable `license_id text` column on `program_version` if convenient; Phase 8 wires the gate.
- **Brokerage `LENDER_OVERLAY` author UI** — Phase 12 v2 (LOV-01..03); Phase 2 ships the empty `lender_overlay_rule` table.
- **2026 FHFA conforming loan limit values + high-balance overlay table** — Phase 3 (AGY-09); Phase 2 ships state/county overlay scaffolding shape (SCH-12) with USDA-shape only.
- **Live-pricing tables `pricing_feed`, `pricing_quote`** — Phase 13 (PRC-01..05).
- **Per-MI-provider overlay matching** — Phase 13 (PRC-05); Phase 2's tightest-overlay heuristic in `program_rule` covers MVP.
- **Saved-scenario alerting on indexed program rule change (re-evaluation cron + flow 4 in ARCHITECTURE.md)** — Phase 14 v3 (WKF-03); Phase 2 schema supports it via the bitemporal versioning + content-addressed source_document_fingerprint.

</deferred>

---

*Phase: 02-rule-schema*
*Context gathered: 2026-04-30*
