# Roadmap: Lender Search

## Overview

Lender Search is built phase-by-phase along a single critical path: **schema correctness → measurable golden set → MVP UI**. Phase 0 is foundation work (sub-phases 1-5) — tenant isolation, schema, audit, evaluator, and a 200-scenario expert-validated golden set — with no customer-visible product. Phase 1 is the MVP (sub-phases 6-11) — LO search, AM extraction-and-review, programs indexed, brand renamed, ready for external GTM. Phase 2 (sub-phases 12-13) adds coverage and live pricing. Phase 3 (sub-phases 14-15) adds workflow intelligence and an optional warranty product. Every phase boundary is KPI-gated, not calendar-gated. Sub-phases inside Phase 0 and Phase 1 are sliced fine for solo-dev focus; sub-phases inside Phase 2/3 are sketched at lower fidelity because they sit downstream of Phase 1 KPI evidence.

## Phases

**Phase Numbering:**
- Integer phases (1-15): Planned milestone work
- Decimal phases (e.g., 5.1): Reserved for urgent insertions

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Tenant Isolation Foundation** - Postgres + RLS + CI pen-test suite enforcing zero cross-tenant egress before any tenant data exists *(2026-04-30 — UAT shipped PR #1)*
- [x] **Phase 2: Rule Schema** - Layered rule schema, structured derog model, bitemporal versioning, citation discipline as DB constraint *(2026-05-04 — shipped PR #2)*
- [ ] **Phase 3: Audit Log + Agency Rule Encoding** - Append-only `evaluation_event`, FNMA/FHLMC/FHA/VA hand-authored rule sets, agency cascade infrastructure
- [ ] **Phase 4: Pure-TS Evaluation Engine** - Snapshot-based evaluator with derog state machine, near-miss, layer attribution; library-vs-custom spike resolved
- [ ] **Phase 5: Golden Set + Phase 0 Exit Gates** - 200-scenario expert-validated golden set; Reducto acceptance test; precision/recall gates pass
- [ ] **Phase 6: App Skeleton + Auth + Observability** - Next.js 16, Supabase Auth, tenant JWT context, Inngest worker pool, Sentry/Axiom telemetry
- [ ] **Phase 7: Extraction Pipeline** - Reducto + Claude multi-pass extraction writing to staging; consensus-pass mitigation wired
- [ ] **Phase 8: AM Review Surface + Lifecycle + Licensing** - Three-pane review UI, confidence queue, bulk-accept, program lifecycle, license gate
- [ ] **Phase 9: LO Scenario Flow + Results + Integrations** - LO scenario form, eligibility results, comparison view, Encompass/LendingPad export
- [ ] **Phase 10: Saved Scenarios + Sharing + Disclaimer** - Saved scenario library, shareable links, borrower-safe view, decision-support disclaimer everywhere
- [ ] **Phase 11: Coverage Build-Out + GTM Exit Gates** - 50 programs indexed (≥60% non-QM), brand rename, initial buyer persona committed
- [ ] **Phase 12: Coverage Expansion + Multi-Tenant Overlays + Mobile** [v2] - USDA/HFA/CES/HELOC/construction; tenant-authored overlays; mobile-responsive
- [ ] **Phase 13: Live Pricing + Antitrust Review Gate** [v2] - Pricing data plane, opt-in lender feeds, counsel-led antitrust review
- [ ] **Phase 14: Workflow Intelligence** [v3] - Saved-scenario alerting, AE collaboration messaging, borrower-safe presentation pages
- [ ] **Phase 15: Native Mobile + E&O Warranty** [v3 conditional] - Native iOS/Android (gated on usage data); Candor-modeled warranty product

## Phase Details

### Phase 1: Tenant Isolation Foundation
**Goal**: Postgres database stands up with `FORCE ROW LEVEL SECURITY` on every tenant-scoped table; CI pen-test suite blocks merge on any cross-tenant query that succeeds. This is the antitrust insurance policy — every later phase depends on it being in place before any tenant data exists.
**Depends on**: Nothing (first phase)
**Requirements**: TNT-01, TNT-02, TNT-03, TNT-04, TNT-05, TNT-06, CFG-02, CFG-05
**Success Criteria** (what must be TRUE):
  1. A query authenticated as Tenant A returns zero rows when targeting Tenant B's data on every tenant-scoped table (verified by `tests/rls/` CI pen-test suite blocking merge on success)
  2. Postgres 16+ via Supabase is provisioned with Drizzle ORM 0.45 connected with `prepare: false`; migrations apply cleanly from a fresh database
  3. JWT-tampering tests, service-role boundary tests, cross-tenant write attempts, and cross-tenant read attempts all fail closed
  4. `tenant_id` is indexed on every tenant-scoped table; RLS policies use `current_setting('app.tenant_id')::uuid` from JWT app_metadata
  5. No environment-variable plaintext secrets land in source; t3-env validates all required keys at boot
**Plans**: 8 plans across 5 waves

Plans:

**Wave 0** *(blocks all later waves)*
- [x] 01-01-PLAN.md — Workspace + tooling bootstrap (pnpm, TS 5.7, drizzle/vitest config shells, docker-compose Postgres 16, NOBYPASSRLS app_user) *(2026-04-29)*

**Wave 1** *(blocked on Wave 0; plans run in parallel)*
- [x] 01-02-PLAN.md — t3-env boot-fail-closed validation at lib/env.ts + env-boot smoke test *(2026-04-30)*
- [x] 01-03-PLAN.md — Drizzle 0.45 client (prepare: false) + setTenantContext primitive at lib/tenant/context.ts *(2026-04-30)*

**Wave 2** *(blocked on Wave 1; plans sequential)*
- [x] 01-04-PLAN.md — TS schema (tenant + _rls_canary) with pgPolicy + index; drizzle-kit generate produces 0000_initial.sql
- [x] 01-05-PLAN.md — `--custom` 0001_force_rls.sql migration + [BLOCKING] `drizzle-kit migrate` against docker Postgres

**Wave 3** *(blocked on Wave 2; plans sequential)*
- [x] 01-06-PLAN.md — Pen-test harness (globalSetup, setup.ts BYPASSRLS+FORCE checks, JWT/tenants/connection fixtures)
- [x] 01-07-PLAN.md — Six pen tests covering D-03 matrix (cross-tenant select/write, JWT tampering, service-role, GUC reset, index scan)

**Wave 4** *(blocked on Wave 3)*
- [x] 01-08-PLAN.md — ESLint flat config (process.env + service-role guards) + GitHub Actions CI workflow + final verification checkpoint

**Cross-cutting constraints** *(truths shared across 2+ plans):*
- Tenant filtering is database-enforced via RLS, never application-layer
- GUC name `app.tenant_id` is single source of truth — defined only in `lib/tenant/context.ts`
- `drizzle-kit migrate` (file-based migrations); never `drizzle-kit push` (silently drops RLS DDL — Issue #3504)
- Phase 1 has no user/auth surface; JWT mocked via `jose` for tests; real Supabase JWKS validation lands Phase 6
- `FORCE ROW LEVEL SECURITY` required so even table owners are subject to policy

**UI hint**: no

### Phase 2: Rule Schema
**Goal**: Postgres schema lands with a normalized layered rule model, a structured derog event model encoding the FNMA matrix nuances, bitemporal versioning, citation discipline as a database constraint, and `tenant.kind` enum from day one. This is the keystone — every later phase pays the rework cost if this is wrong.
**Depends on**: Phase 1
**Requirements**: SCH-01, SCH-02, SCH-03, SCH-04, SCH-05, SCH-06, SCH-07, SCH-08, SCH-09, SCH-10, SCH-11, SCH-12, SCH-13, SCH-14
**Success Criteria** (what must be TRUE):
  1. A `program_rule` row cannot persist without an associated `rule_citation` row carrying page + bbox + textSpan (database constraint, not application validation)
  2. A `DerogRule` row encoding "FNMA post-foreclosure 3-to-7-year band, max LTV 90%, primary purchase or RT-refi only" can be queried by `event_type=FORECLOSURE` and returns the structured `post_event_LTV_caps[]` with `purposeAllowList`, `occupancyAllowList`, and time bounds
  3. A `program_version` row carries an `effective_period daterange` and a content-addressed `source_document_fingerprint`; two overlapping active versions for the same program cannot coexist (`EXCLUDE USING gist` exclusion constraint)
  4. Inserting an `INVESTOR_OVERLAY` rule that loosens a corresponding `AGENCY_BASE` rule surfaces as a data-quality error (loosening rejection)
  5. Every `program_rule` field carries a `confidence numeric (0-1)`; `IncomeDocMethod` and `DscrMethod` are typed objects (not flat labels) and persist per-program
**Plans**: 9 plans across 4 waves

Plans:

**Wave 0** *(blocks all later waves)*
- [x] 02-01-PLAN.md — daterange customType + system_role pgRole + scripts/init-db.sh extension + 17 lib/rules/schemas Zod schemas + dispatch table + vitest.schema.config.ts + test:schema script

**Wave 1** *(blocked on Wave 0; plans run in parallel)*
- [x] 02-02-PLAN.md — db/schema TS for program/program_version/program_rule/rule_citation tables + index barrel extension (SCH-01/SCH-09/SCH-10/SCH-11/SCH-12/SCH-13/SCH-14)
- [x] 02-03-PLAN.md — db/schema TS for agency_rule_version/agency_rule/lender_overlay_rule tables + system_role policies + index barrel extension (SCH-01/SCH-04/SCH-09/SCH-10/SCH-13)
- [x] 02-04-PLAN.md — Zod schema unit tests at tests/rules/ covering all 17 rule_kinds + dispatch table exhaustiveness + FNMA SC#2 fixture (SCH-04/SCH-05/SCH-06/SCH-07/SCH-10)

**Wave 2** *(blocked on Wave 1; plans sequential)*
- [x] 02-05-PLAN.md — drizzle-kit generate 0002_program_and_agency_schema + --custom 0003_force_rls_program + 0006_force_rls_agency (FORCE on 5 tenant-scoped tables; GRANTs on agency tables)
- [x] 02-06-PLAN.md — --custom 0004_program_constraints (btree_gist + EXCLUDE on program_version + agency_rule_version + jsonb_min_numeric wrapper + min_confidence STORED + CHECKs + partial expression index) + 0007_detect_loosenings function

**Wave 3** *(blocked on Wave 2; sequential gate then parallel)*
- [x] 02-07-PLAN.md — [BLOCKING] pnpm db:reset + drizzle-kit migrate + psql introspection asserting FORCE / pg_proc / pg_extension / GENERATED columns / CHECKs / EXCLUDE / partial indexes
- [x] 02-08-PLAN.md — tests/schema/ structural test suite (D-20 #1-#8 + D-10 min_confidence + SCH-01 layer enum) — 9 tests + setup + seed fixture
- [x] 02-09-PLAN.md — tests/rls/ pen-test extension (D-19) — 5 cross-tenant tests covering Phase 1 D-03 matrix on the 5 new tenant-scoped tables + seedTwoTenants extension + global-setup TRUNCATE/GRANT extension

**Cross-cutting constraints** *(truths shared across 2+ plans):*
- Phase 1 patterns reused unchanged: NodeNext .js extensions; .env.local-first dotenv ordering; vitest pool: 'forks'; canonical RLS predicate `current_setting('app.tenant_id', true)::uuid`; `--custom` migrations for FORCE/EXCLUDE/SQL functions
- ruleKind pgEnum literal in db/schema/program-rule.ts MUST match lib/rules/schemas/index.ts ruleKinds tuple verbatim (D-09 17 values, same order)
- agency_rule_version + agency_rule are NOT tenant-scoped; cross-tenant readability via two-policy shape (world_read SELECT + system_role write)
- jsonb_min_numeric IMMUTABLE wrapper resolves Pitfall C (Postgres rejects subquery in GENERATED expression)
- Phase 2 stays strictly schema-only; Phase 3 owns FNMA/FHLMC/FHA/VA hand-authoring (AGY-01..09)

**UI hint**: no

### Phase 3: Audit Log + Agency Rule Encoding
**Goal**: Append-only `evaluation_event` lands with `REVOKE UPDATE, DELETE` enforced at the database level. Hand-author the FNMA, FHLMC, FHA, VA agency-base rule sets (USDA scaffolded only; FHA Back-to-Work marked DEPRECATED with sunset 2016-09-30). Agency cascade infrastructure (daily Vercel Cron + trigger on `agency_rule_version` insert + per-affected-program review queue) is wired.
**Depends on**: Phase 2
**Requirements**: AUD-01, AUD-02, AUD-03, AUD-04, AGY-01, AGY-02, AGY-03, AGY-04, AGY-05, AGY-06, AGY-07, AGY-08, AGY-09
**Success Criteria** (what must be TRUE):
  1. Any historical scenario can be re-evaluated against its historical `RuleSnapshot` and returns the same decision and rule stack as the original evaluation (deterministic replay)
  2. The application role cannot UPDATE or DELETE rows in `evaluation_event` — tampering is structurally impossible, not policy-prohibited
  3. The full FNMA B3-5.3-07 derog matrix is encoded as queryable rows: BK7 (4y / 2y EC), BK13 (2y discharged / 4y dismissed), multi-filing (5y / 7y), foreclosure (7y / 3y EC + 90% LTV cap window), DIL/short sale/charge-off (4y / 2y EC), mortgage-included-in-BK exception
  4. FHA HUD 4000.1 standard extenuating-circumstances provision is encoded; FHA Back-to-Work is marked `DEPRECATED` with `sunset: 2016-09-30` and is queryable but not active
  5. A new `agency_rule_version` insert fires a trigger that enqueues a `cascade.review` job for every `program_version` referencing the now-superseded agency version (verified via integration test)
**Plans**: 8 plans across 4 waves

Plans:

**Wave 0** *(blocks all later waves)*
- [x] 03-01-PLAN.md — Shared infra: types + audit/cascade lib + schema migrations (evaluation_event partitioned + REVOKE, cascade_review_queue + trigger, FHFA tables + EXCLUDE, program_version FK delta) + loader skeleton + CI/test wiring

**Wave 1** *(blocked on Wave 0; plans run in parallel)*
- [x] 03-02-PLAN.md — FNMA B3-5.3-07 derog matrix (8 event types + golden snapshot); seeds AGY-01 cross-agency test scaffold
- [x] 03-03-PLAN.md — FHLMC §5202.5 derog matrix (8 event types incl. FC_CLOCK_ALWAYS + golden snapshot)
- [x] 03-04-PLAN.md — FHA HUD 4000.1 derog (7 active types, MULTIPLE_BK skipped per Open Question 5) + Back-to-Work DEPRECATED with sunset 2016-09-30
- [x] 03-05-PLAN.md — VA Pamphlet 26-7 derog (7 active types) + completes AGY-01 cross-agency assertions

**Wave 2** *(blocked on Wave 1; plans run in parallel)*
- [x] 03-06-PLAN.md — FHFA 2026 conforming loan limits CSV + csv-parse loader extension + structural / FK / idempotency tests
- [x] 03-07-PLAN.md — Cascade trigger integration test (D-17 SC#5) + cascade_review_queue cross-tenant pen tests + seedTwoTenantsWithProgramVersions helper

**Wave 3** *(blocked on Wave 2; sequential gate)*
- [x] 03-08-PLAN.md — [BLOCKING] Phase 3 integration gate — full reset/migrate/seed/test:rls/test:schema/typecheck/lint cycle + structural state introspection + human-verify checkpoint
**UI hint**: no

### Phase 4: Pure-TS Evaluation Engine
**Goal**: `lib/eval/` exposes `evaluate(scenario, snapshot)` returning `{ decision, rule_stack, deciding_rule, near_miss }` with no I/O and no framework dependencies. The derog state machine processes derogatory events first to compute active LTV-cap windows before evaluating standard rules. The Phase 0 spike between `json-rules-engine` 7.x and a ~500-LOC custom evaluator is decided on the lower-rule-corruption-blast-radius criterion.
**Depends on**: Phase 3
**Requirements**: EVL-01, EVL-02, EVL-03, EVL-04, EVL-05, EVL-06, EVL-07, EVL-08, EVL-09
**Success Criteria** (what must be TRUE):
  1. A scenario in the post-foreclosure 3-to-7-year window at 95% LTV for an investment-property purchase returns `ineligible` with the deciding rule citing the FNMA post-event LTV cap (the highest-stakes false-positive case the structured derog model exists to prevent)
  2. The evaluator returns a `near_miss` result with explicit `cost` for ranking — FICO delta, LTV delta, DTI delta, doc-type swap, or seasoning-months-remaining — for every ineligible program where a single-dimension change would qualify
  3. `rule_stack[]` for a single failing dimension contains every applicable rule ordered by restrictiveness with `layer` attribution (`AGENCY_BASE` / `INVESTOR_OVERLAY` / `PRODUCT_FEATURE` / `LENDER_OVERLAY`); the deciding rule is identified
  4. The `lib/eval/` module imports nothing from the database layer, the auth layer, or the framework layer — a unit test instantiates it with a hand-built `RuleSnapshot` and runs in <100ms per program
  5. The Phase 0 library-vs-custom spike is committed: a written decision document records benchmark results on rule-corruption-blast-radius and either `json-rules-engine@7.x` or the custom ~500-LOC evaluator is the canonical path
**Plans**: TBD
**UI hint**: no

### Phase 5: Golden Set + Phase 0 Exit Gates
**Goal**: 200-scenario golden set drafted with the 50/25/25 sourcing mix, ≥1 paid external expert reviewer (senior underwriter) reviews every expected outcome with citations to FNMA Selling Guide / FHLMC §5202.5 / HUD 4000.1 / VA Pamphlet 26-7. Scenarios lock before the evaluator runs against them. Phase 0 exit gates pass: precision ≥98%, recall ≥95%, Reducto acceptance test ≥95% on 10 non-QM matrices (or consensus-pass mitigation documented), all RLS pen tests green.
**Depends on**: Phase 4
**Requirements**: GLD-01, GLD-02, GLD-03, GLD-04, GLD-05, GLD-06
**Success Criteria** (what must be TRUE):
  1. 200 scenarios are committed, each tagged with category coverage (derog edge cases, non-QM doc-method variance, multi-borrower FICO mid-score, post-FC 3-to-7-year window, condo project review, manual UW paths, multi-filing, mortgage-included-in-BK, FHA EC) and sourced 50% real-broker / 25% incumbent-public-examples / 25% adversarial
  2. Each scenario carries an expected `decision`, expected `deciding_rule_id` reference, and expected `rule_stack` skeleton signed off by ≥1 paid external senior underwriter; expected outcomes cite source guideline (not the evaluator)
  3. The evaluator achieves ≥98% precision and ≥95% recall against the locked expected outcomes (the Phase 0 exit gate); CI runs the suite on every PR and a regression on any single scenario blocks merge
  4. The Reducto vendor acceptance test produces ≥95% cell accuracy on 10 representative non-QM matrices, OR a consensus-pass mitigation (Reducto + Claude Sonnet 4.6 vision at +~$0.05/PDF) is documented, budgeted, and toggleable
  5. All RLS pen tests pass in CI as a precondition to Phase 1 entry; a written gate document records all four exit-gate pass states
**Plans**: TBD
**UI hint**: no

### Phase 6: App Skeleton + Auth + Observability
**Goal**: Next.js 16.2 App Router stands up on Vercel Pro with Supabase Auth, JWT app_metadata carrying `tenant_id`, `withTenantContext` wrapping every Postgres query. Inngest 4.2 worker pool deploys for the extraction pipeline. Sentry captures errors and LLM call traces; Axiom retains logs beyond Vercel's 1-day window with `tenant_id` redaction at egress.
**Depends on**: Phase 5
**Requirements**: CFG-01, CFG-03, CFG-04, OBS-01, OBS-02, OBS-03, OBS-04
**Success Criteria** (what must be TRUE):
  1. A user signs in via Supabase Auth and the resulting JWT carries `tenant_id` in `app_metadata`; every server action and route handler runs inside `withTenantContext`, automatically setting `app.tenant_id` per request
  2. No client bundle contains the Anthropic SDK, the Reducto SDK, or any LLM API key; LLM calls run server-side via Server Actions / route handlers exclusively (verified by build inspection)
  3. Sentry captures a deliberate error from a server action and surfaces the trace within 60 seconds; the trace includes `tenant_id` and `user_id` redacted at the egress boundary
  4. The Inngest worker pool runs as a separate function on Vercel; a smoke-test job triggers, runs >60 seconds, and completes — proving the durable workflow path survives Vercel's function ceiling
  5. Dashboards in Axiom track P50/P95 evaluation latency, extraction-pipeline-step duration, AM time-to-commit, AM correction rate, and per-call LLM token cost
**Plans**: TBD
**UI hint**: yes

### Phase 7: Extraction Pipeline
**Goal**: AM PDF upload triggers an Inngest durable workflow that runs Pass 1 (structural — product blocks, FICO×LTV grids), Pass 2 (rule normalization — cells/footnotes to schema with footnote anchoring), Pass 3 (overlay detection — diff vs. agency_rule_version, flag loosenings), Pass 4 (per-field confidence scoring with explicit reasons). Reducto is primary; Claude vision consensus-pass is wired and toggleable. Server-side post-extraction validator confirms `textSpan` actually appears at the cited bbox before staging persists. Pipeline rejects rules referencing FHA Back-to-Work from post-2016 source documents.
**Depends on**: Phase 6
**Requirements**: EXT-01, EXT-02, EXT-03, EXT-04, EXT-05, EXT-06, EXT-07, EXT-08, EXT-09, EXT-10
**Success Criteria** (what must be TRUE):
  1. A non-QM matrix PDF uploaded by an AM produces draft rules in `staging.draft_rule` with per-field confidence, citation page+bbox+textSpan, and overlay-vs-agency tagging — without writing a single row to canonical `program_rule`
  2. The post-extraction validator drops any staged rule whose `textSpan` does not appear in the cited PDF page at the specified bbox; dropped rules log a structured reason
  3. Re-running extraction on the same PDF with a different model version produces a fresh `extraction_run` and never corrupts existing canonical state (idempotency verified)
  4. A matrix dated 2018 referencing FHA Back-to-Work surfaces as a rejected-rule with a logged reason; pre-2016 documents accept Back-to-Work references
  5. A `consensus_pass` toggle on a matrix run engages Reducto + Claude Sonnet 4.6 vision; cells where the two vendors disagree are auto-flagged for AM review at +~$0.05/PDF cost
**Plans**: TBD
**UI hint**: no

### Phase 8: AM Review Surface + Lifecycle + Licensing
**Goal**: AM reviews extracted rules in a three-pane UI (source PDF with citation highlight, extracted rule object, edit form). Confidence-sorted queue (lowest first); bulk-accept above 0.95 threshold with mandatory server-side textSpan validation. Per-field comments persist across versions. New matrix uploads create a draft `program_version` with delta view; commit archives prior version atomically. Program lifecycle states (`draft → in review → active → deprecated → sunset`) enforced. Lender license gate — no matrix enters `in review` without a `license_id`. AM KPIs: ≤45 min standard non-QM matrix; ≤15 min delta on existing program.
**Depends on**: Phase 7
**Requirements**: AM-01, AM-02, AM-03, AM-04, AM-05, AM-06, AM-07, AM-08, AM-09, PRG-01, PRG-02, PRG-03, PRG-04, LCS-01, LCS-02, LCS-03, LCS-04
**Success Criteria** (what must be TRUE):
  1. AM views a draft rule alongside the source PDF page with the citation bbox highlighted and edits the rule in a form-bound editor; saving the edit promotes the rule from staging to canonical in a single transaction with atomic version archival
  2. A bulk-accept on rules ≥0.95 confidence runs server-side textSpan validation on each rule and rejects any that fail; AM time per standard non-QM matrix measures ≤45 min in the dashboard (Phase 1 KPI)
  3. A second matrix upload for an existing program creates a draft `program_version` with a field-level diff against the active version; AM reviews only the delta in ≤15 min (Phase 1 KPI)
  4. A program transitions through `draft → in review → active → deprecated → sunset` with auditable state transitions; only `active` programs surface in LO search by default; `stale` tagging fires when `effective_period.expires_at` passes or no refresh in 90 days
  5. A matrix cannot enter `in review` without a `license_id` reference for the lender; a `program_version` commit without a `license_id` is blocked at the database level; license template explicitly prohibits competitive-intelligence aggregation across lenders (LCS-04: live-pricing licensing terms remain v2 — Phase 1 license covers eligibility data only)
**Plans**: TBD
**UI hint**: yes

### Phase 9: LO Scenario Flow + Results + Integrations
**Goal**: LO fills a single scenario form covering borrower (FICO mid-score per borrower, citizenship/ITIN/foreign national, veteran, FTHB, self-employment), loan (purpose, amount, term, amortization, lien position), property (type, occupancy, state, county, condo type), ratios (LTV/CLTV/HCLTV, DTI, reserves), income/doc type (full doc, bank statement 12/24-mo, P&L, asset depletion, DSCR with ratio/no-ratio, ITIN), derog history (typed events with EC flag), special flags. Results split into Eligible / Conditional (near-miss with single-dimension fix) / Ineligible. Each row exposes max LTV/CLTV/HCLTV, max DTI, MI, reserves, derog seasoning, with expandable "why" showing layer-attributed citations + deep links. Comparison view pins ≤4 programs side-by-side with PDF export. P50 ≤2s, P95 ≤5s. Encompass FNM 3.2 / MISMO 3.4 + LendingPad export.
**Depends on**: Phase 8
**Requirements**: LO-01, LO-02, LO-03, LO-04, LO-05, LO-06, LO-07, LO-08, LO-09, LO-10, INT-01, INT-02, INT-03
**Success Criteria** (what must be TRUE):
  1. An LO submits a fully-specified scenario covering every field group (borrower, loan, property, ratios, doc type, derog, special flags) and receives results split into Eligible / Conditional / Ineligible at P50 ≤2s and P95 ≤5s wall time across the indexed corpus
  2. An ineligible result row exposes the deciding rule with `layer` attribution ("max LTV 80% from PennyMac investor overlay over FNMA base of 95%") and a deep link to the source PDF page at the cited bbox; conditional rows show the single-dimension fix (FICO delta, LTV delta, DTI delta, doc-type swap, or seasoning months remaining)
  3. A confidence badge appears on a result row when the deciding rule has confidence < 0.90 with copy "AM has not confirmed this rule — verify with lender"
  4. An LO pins up to four programs into a comparison view showing every qualification dimension and exports the comparison to PDF with the standard decision-support disclaimer
  5. An LO exports a saved scenario as Encompass FNM 3.2 / MISMO 3.4 or LendingPad-compatible payload; the export contains only LO-supplied data plus deterministic derivations from the eligibility result with zero cross-tenant program data leakage
**Plans**: TBD
**UI hint**: yes

### Phase 10: Saved Scenarios + Sharing + Disclaimer
**Goal**: LO saves scenarios into a per-LO library with name and notes; re-runs flag `stale` when underlying `program_version` changes. Shareable links carry an optional borrower-safe view that hides LO compensation and overlay tags. Decision-support disclaimer renders prominently on every result, every PDF export, every shareable link (including borrower-safe view at full prominence). Confidence badge on low-confidence rules. ToS with liability cap and audit-trail commitment ships before MVP launch.
**Depends on**: Phase 9
**Requirements**: SHR-01, SHR-02, SHR-03, SHR-04, DCL-01, DCL-02, DCL-03, DCL-04
**Success Criteria** (what must be TRUE):
  1. An LO saves a scenario, returns to it days later, re-runs it, and receives a `stale` flag if any underlying `program_version` referenced in the saved result has changed since the last run (compared by `ruleset_snapshot_id`)
  2. An LO generates a shareable link with the borrower-safe toggle on; the rendered view hides LO compensation and overlay tags but renders the decision-support disclaimer at full prominence (no de-emphasis vs. LO view)
  3. Every result row, every comparison-view PDF export, and every shareable link surface the "decision-support, not credit decision" disclaimer reviewed by counsel; copy is identical and prominent across surfaces
  4. The Terms-of-Service published before MVP launch includes a liability cap and the audit-trail commitment; the published version is content-addressed and referenced from every disclaimer surface
  5. A confidence badge fires on any result whose deciding rule has confidence < 0.90 ("AM has not confirmed this rule — verify with lender") on both LO and borrower-safe views
**Plans**: TBD
**UI hint**: yes

### Phase 11: Coverage Build-Out + GTM Exit Gates
**Goal**: Index 50 programs (≥60% non-QM) using the Phase 7-8 extraction pipeline and AM review surface. Every program references a current `agency_rule_version` and carries a `license_id`. Phase 1 exit gates pass: precision ≥98% sustained on the now-extended golden set, recall ≥95%, AM onboarding time ≤45 min standard non-QM and ≤15 min delta, AM correction rate <10% trending. Brand renamed (the working name "Lender Search" collides with Scotsman Guide's lendersearch.com from March 2023) before any external GTM activity. Initial buyer persona (broker MLO vs. retail LO vs. wholesale AE) committed based on Phase 1 pilot data.
**Depends on**: Phase 10
**Requirements**: COV-01, COV-02, COV-03, GTM-01, GTM-02
**Success Criteria** (what must be TRUE):
  1. 50 active programs with ≥60% non-QM (bank statement, DSCR, ITIN, foreign national, post-derog) are searchable in production; every program references a current `agency_rule_version` and a non-null `license_id`
  2. The 200-scenario golden set extended with the 50 indexed programs sustains precision ≥98% and recall ≥95%; AM correction rate trends toward <10% by month 6
  3. AM onboarding time measured continuously is ≤45 min for a standard non-QM matrix (KPI gate) and ≤15 min for a delta on an existing program (KPI gate)
  4. A non-conflicting product name is selected and trademark-cleared before any external GTM activity; the brand "Lender Search" working-name dependency is removed from public-facing surfaces
  5. The initial buyer persona (broker MLO vs. retail LO vs. wholesale AE running scenarios for partners) is committed in PROJECT.md based on Phase 1 pilot data; coverage weighting decisions for Phase 2 derive from the persona commit
**Plans**: TBD
**UI hint**: yes

### Phase 12: Coverage Expansion + Multi-Tenant Overlays + Mobile [v2]
**Goal**: Encode USDA agency rules and add HFA, second-lien CES/HELOC, construction-to-perm program families. Tenant-authored `LENDER_OVERLAY` UI for brokerages and retail lenders using the Phase 8 three-pane review pattern; overlays scoped strictly to authoring tenant. Mobile-responsive scenario flow via Tailwind breakpoints (no separate codebase). Encompass Partner Connect deeper write-back, Byte LOS, USDA Eligibility Map API with caching, FNMA Condo Project Manager API with caching.
**Depends on**: Phase 11
**Requirements**: COV-v2-01, COV-v2-02, COV-v2-03, COV-v2-04, COV-v2-05, LOV-01, LOV-02, LOV-03, MOB-01, INT-v2-01, INT-v2-02, INT-v2-03, INT-v2-04
**Success Criteria** (what must be TRUE):
  1. USDA, HFA, second-lien CES/HELOC, and construction-to-perm programs are searchable; coverage staircase reaches 250 programs by month 6
  2. A brokerage tenant authors a `LENDER_OVERLAY` rule that applies on top of inherited investor overlays; the overlay is invisible to other tenants (verified by RLS pen tests)
  3. The LO scenario flow renders cleanly at mobile breakpoints with no separate codebase; touch-target accessibility passes WCAG 2.2 AA
  4. Encompass Partner Connect and Byte integrations push scenarios with deterministic derivations only; cached USDA Eligibility Map and FNMA CPM lookups respect documented TTLs
**Plans**: TBD
**UI hint**: yes

### Phase 13: Live Pricing + Antitrust Review Gate [v2]
**Goal**: Pricing data plane (`pricing_feed`, `pricing_quote` tables) ingests note rate, points/credit, APR, lock period from opt-in lender feeds (no rate-lock execution). Pricing eligibility predicate references the rule layer; pricing inherits hard-fail constraints from eligibility evaluation. Side-by-side rate comparison surface scoped strictly within a single tenant (no cross-tenant rate visibility — explicit antitrust posture). Per-MI-provider overlay matching hardens the Phase 1 tightest-overlay heuristic. Live-pricing-specific lender data-licensing terms negotiated with each opt-in lender; counsel-led antitrust review of the data architecture before rollout.
**Depends on**: Phase 12
**Requirements**: PRC-01, PRC-02, PRC-03, PRC-04, PRC-05, LCS-v2-01, LCS-v2-02
**Success Criteria** (what must be TRUE):
  1. An opt-in lender pricing feed populates note rate, points/credit, APR, and lock period on result rows for in-scope programs; no rate-lock execution path exists
  2. A side-by-side rate comparison renders within a single tenant context only; cross-tenant rate visibility is impossible (verified by RLS pen tests extended for the pricing tables)
  3. Per-MI-provider overlay matching produces correct MI tier selection; the Phase 1 tightest-overlay heuristic is replaced
  4. A counsel-led antitrust review document signs off on the data architecture before live-pricing rollout; live-pricing-specific lender data-licensing terms are negotiated with each opt-in lender
**Plans**: TBD
**UI hint**: yes

### Phase 14: Workflow Intelligence [v3]
**Goal**: Saved-scenario re-run alerting fires when an indexed program changes a rule that affects the saved scenario's outcome (email + in-app). AE collaboration surface (LoanNEX-style two-way messaging on a scenario) scoped to the lender's own AEs and the originating LO. Borrower-safe shareable scenario landing pages (full presentation, not just a link).
**Depends on**: Phase 13
**Requirements**: WKF-01, WKF-02, WKF-03
**Success Criteria** (what must be TRUE):
  1. A saved scenario whose outcome flips after an indexed program changes a relevant rule generates an email + in-app alert to the originating LO with the diff explained in plain language
  2. An LO and an AE exchange messages on a scenario; messaging is scoped strictly to the lender's own AEs and the originating LO with no cross-tenant visibility
  3. A borrower-safe shareable URL renders a full presentation page (not just a link redirect) with disclaimers, citation-grounded eligibility narrative, and zero LO compensation or overlay tags
**Plans**: TBD
**UI hint**: yes

### Phase 15: Native Mobile + E&O Warranty [v3 conditional]
**Goal**: Native iOS/Android — built only if mobile usage data shows ≥40% of LO sessions on mobile form factor for *scenario discovery* (not just refresh). Optional E&O warranty product modeled on Candor's repurchase-warranty framing — AAA-rated insurer partnership, 60-month post-closing tail; gated on sustained eligibility precision ≥99.5%.
**Depends on**: Phase 14
**Requirements**: MOB-v3-01, EOW-01
**Success Criteria** (what must be TRUE):
  1. Mobile usage data shows ≥40% of LO sessions on mobile form factor for scenario discovery (not just quote refresh) — the gating trigger before any native build investment
  2. Native iOS and Android builds (if gate passes) deliver scenario discovery with feature parity to the responsive web flow
  3. Sustained eligibility precision ≥99.5% across the indexed corpus for the prior 6 months — the gating trigger before any warranty product
  4. An AAA-rated insurer partnership signs off on a Candor-modeled E&O warranty product with a 60-month post-closing tail
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → (v2) 12 → 13 → (v3) 14 → 15

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Tenant Isolation Foundation | 8/8 | Complete | 2026-04-30 |
| 2. Rule Schema | 9/9 | Complete | 2026-05-04 |
| 3. Audit Log + Agency Rule Encoding | 0/TBD | Not started | - |
| 4. Pure-TS Evaluation Engine | 0/TBD | Not started | - |
| 5. Golden Set + Phase 0 Exit Gates | 0/TBD | Not started | - |
| 6. App Skeleton + Auth + Observability | 0/TBD | Not started | - |
| 7. Extraction Pipeline | 0/TBD | Not started | - |
| 8. AM Review Surface + Lifecycle + Licensing | 0/TBD | Not started | - |
| 9. LO Scenario Flow + Results + Integrations | 0/TBD | Not started | - |
| 10. Saved Scenarios + Sharing + Disclaimer | 0/TBD | Not started | - |
| 11. Coverage Build-Out + GTM Exit Gates | 0/TBD | Not started | - |
| 12. Coverage Expansion + Multi-Tenant Overlays + Mobile | 0/TBD | Not started | - |
| 13. Live Pricing + Antitrust Review Gate | 0/TBD | Not started | - |
| 14. Workflow Intelligence | 0/TBD | Not started | - |
| 15. Native Mobile + E&O Warranty | 0/TBD | Not started | - |

---

*Roadmap created: 2026-04-29*
*Granularity: fine (15 phases — 11 v1 sub-phases at full fidelity inside the PRD-locked Phase 0 / Phase 1 shape; 4 v2/v3 sub-phases sketched at lower fidelity)*
*Coverage: 110/110 v1 requirements mapped (Note: REQUIREMENTS.md summary line states "95 total" but the actual category-by-category sum is 110 — every REQ-ID is mapped exactly once)*
