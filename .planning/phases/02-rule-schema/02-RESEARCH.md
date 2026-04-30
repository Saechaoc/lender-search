# Phase 2: Rule Schema - Research

**Researched:** 2026-04-30
**Domain:** Postgres 16 + Drizzle 0.45 — layered rule schema, bitemporal versioning, jsonb rule bodies, citation-discipline FK, EXCLUDE USING gist for active-version uniqueness, SQL function for loosening detection, Zod schemas backing rule_body
**Confidence:** HIGH on Drizzle 0.45 + Postgres 16 mechanics (verified via npm registry + docs); HIGH on Phase 1 carry-forward patterns (read directly from code); MEDIUM on the precise shape of `IncomeDocMethod` / `DscrMethod` / `DerogRule` Zod schemas (informed by FNMA Selling Guide + PITFALLS.md but not validated against an underwriter); FLAGGED — one CONTEXT.md decision (D-10 generated stored column with subquery) requires syntactic adjustment before it can be implemented.

## Summary

Phase 2 lands the schema keystone on top of Phase 1's RLS foundation. CONTEXT.md locks 21 decisions (D-01 through D-21). Every locked decision is implementable with Drizzle 0.45 + Postgres 16, with one specific syntactic exception that needs an immutable-function wrapper (D-10's generated stored column for `min_confidence` cannot use a subquery directly per Postgres rules — the planner needs to land a wrapper function in the same `--custom` migration that creates the column).

Drizzle 0.45 has no native `daterange` or range-type column. Phase 2 ships a small `customType` wrapper at `db/schema/_types/daterange.ts` consumed by `program_version` and `agency_rule_version`. The `EXCLUDE USING gist`, `FORCE ROW LEVEL SECURITY`, `system_role` policy, `detect_loosenings()` SQL function, generated stored column, and the `min_confidence` immutable wrapper all land via `--custom` migrations (the same Plan 01-05 pattern Phase 1 established).

For agency-table cross-tenant readability, the cleanest path is a Postgres role `system_role` (created in `scripts/init-db.sh` alongside `app_user`) referenced from the agency-table policies via `pgRole('system_role').existing()`. Drizzle 0.45's `pgPolicy({ to: ... })` accepts `pgRole` objects and existing-role refs; this is the documented path. The zero-uuid-sentinel alternative is rejected because it puts agency rows inside the tenant-id space (which is logically wrong) and forces every agency-rule INSERT to pre-set the GUC to a magic UUID.

`IncomeDocMethod` and `DscrMethod` are Zod schemas at `lib/rules/schemas/`, NOT separate tables (per D-11). The `rule_kind` enum carries 17 values (per D-09); each kind has a Zod schema at `lib/rules/schemas/<kind>.ts`. The Zod-derived shape is the contract Phase 4 evaluator (read), Phase 7 extraction (write), and Phase 8 AM commit (validate) all share. DB validation stays minimal: NOT NULL, `jsonb_typeof = 'object'`, `rule_kind IN (enum)`. Heavy shape validation is TS, not CHECK constraints (D-08 — clunky to migrate).

DerogRule rows live in `agency_rule` with `rule_kind = 'derog_seasoning'` (per CONTEXT.md Claude's Discretion lean). The structured `rule_body` carries `event_type` + `post_event_LTV_caps[]` per Pitfall 1.1/1.2 shape. SC#2's queryable-by-event-type test passes via `WHERE rule_body->>'event_type' = 'FORECLOSURE'`. A single demonstration `agency_rule_version` + `agency_rule` row pair for the FNMA post-foreclosure example ships in test fixtures (NOT a seed migration) — keeps Phase 2 strictly schema-only and lets Phase 3 own the full hand-authoring transaction without the rework risk of "Phase 2 already shipped this row."

**Primary recommendation:** Plan structure mirrors Phase 1 — drizzle-kit-generated table-creation migrations (0002, 0005) sandwiched between `--custom` migrations (0003, 0004, 0006, 0007) for FORCE/EXCLUDE/system_role/SQL functions. Land Zod schemas at `lib/rules/schemas/` first (enables RED tests), then Drizzle schema, then the six migrations in dependency order (CONTEXT D-18). Pen-test extension at `tests/rls/` and schema-constraint tests at `tests/schema/` close the phase.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Citation FK enforcement (SCH-13):**
- **D-01:** `program_rule.primary_citation_id uuid NOT NULL REFERENCES rule_citation(id)` and `agency_rule.primary_citation_id uuid NOT NULL REFERENCES rule_citation(id)`. Standard FK; no triggers; no deferrable mechanics. Insert order is citation-then-rule within a single transaction.
- **D-02:** Multi-page / multi-citation case: additional citations live as `rule_citation` rows with optional `secondary_for_rule_id uuid NULL` back-pointer to the program_rule or agency_rule they supplement.
- **D-03:** `rule_citation` columns: `id`, `source_pdf_sha256 text NULL`, `source_url text NULL`, `page_number int NULL`, `bbox jsonb NULL`, `excerpt text NOT NULL`, `secondary_for_rule_id uuid NULL`, `created_at`. Plus a `--custom` CHECK: `source_pdf_sha256 IS NOT NULL OR source_url IS NOT NULL`.
- **D-04:** bbox/textSpan substantive validation defers to Phase 7 extraction (NOT Phase 2).

**Layer storage shape (SCH-01, SCH-02 prep):**
- **D-05:** Three-table split — `agency_rule` (system-owned, NO RLS, system_role policy), `program_rule` (tenant, layer enum: `INVESTOR_OVERLAY` | `PRODUCT_FEATURE`), `lender_overlay_rule` (tenant, ships empty for Phase 12).
- **D-06:** Phase 4 evaluator UNIONs all three tables to assemble rule_stack; layer attribution is computed at evaluation time.
- **D-07:** `lender_overlay_rule` ships at Phase 2 even though no UI populates it (Pitfall 4.1).

**rule_body validation strictness:**
- **D-08:** Hybrid validation: jsonb `rule_body` + `rule_kind` enum + per-rule_kind Zod schemas at `lib/rules/schemas/<kind>.ts`. DB checks NOT NULL + `jsonb_typeof='object'` + `rule_kind IN (enum)` only. Heavy shape validation in TS.
- **D-09:** Phase 2 `rule_kind` enum (17 values): `('ltv_max', 'cltv_max', 'hcltv_max', 'fico_min', 'dti_max', 'reserves_min', 'derog_seasoning', 'income_doc_method', 'dscr_method', 'geo_state', 'geo_county', 'occupancy_allow', 'purpose_allow', 'property_type_allow', 'doc_type_allow', 'mi_required', 'manual_uw_path')`.
- **D-10:** Per-field confidence: `field_confidence jsonb NOT NULL DEFAULT '{}'::jsonb` on `program_rule` and `agency_rule`; generated stored column `min_confidence numeric` for indexed sort. **CHECK at write boundary (Zod): every field_confidence value in [0, 1].**
- **D-11:** `IncomeDocMethod` and `DscrMethod` are typed Zod schemas at `lib/rules/schemas/income-doc-method.ts` and `lib/rules/schemas/dscr-method.ts` — NOT separate tables. One row per program per method in `program_rule`.

**Loosening rejection enforcement (SCH-03 + SC#4):**
- **D-12:** SQL function `detect_loosenings(program_version_id uuid) RETURNS TABLE (program_rule_id uuid, agency_rule_id uuid, dimension text, agency_value jsonb, overlay_value jsonb)` deployed via `--custom` migration `0007_detect_loosenings.sql`.
- **D-13:** No BEFORE INSERT/UPDATE trigger. SCH-03 says "surfaces them as data-quality errors during AM review" — AM-time UX, not write-time hard rejection. Phase 8 AM commit calls it pre-commit.
- **D-14:** Numeric comparison rules (per dimension):
  - `ltv_max` / `cltv_max` / `hcltv_max` / `dti_max`: overlay must be ≤ agency
  - `fico_min` / `reserves_min`: overlay must be ≥ agency
  - `derog_seasoning.base_waiting_months` / `extenuating_circumstances_waiting_months`: overlay must be ≥ agency
  - Allow-list arrays (occupancy/purpose/property_type/doc_type): overlay must be subset of agency
  - Other rule_kinds: skipped at Phase 2 (function returns rows for comparable kinds only)

**Bitemporal versioning shape (SCH-09):**
- **D-15:** `program_version` columns include `effective_period daterange NOT NULL`, `recorded_at timestamptz`, `state` (5-value CHECK), `source_document_fingerprint text NOT NULL`, plus `eligible_*` and `ineligible_*` arrays per SCH-11 and `geo_*` scaffolding per SCH-12. `EXCLUDE USING gist (program_id WITH =, effective_period WITH &&) WHERE (state = 'active')` lands via `--custom` migration.
- **D-16:** `agency_rule_version` columns: `agency text NOT NULL CHECK (agency IN (5 values))`, `version_label`, `source_url NULL`, `source_pdf_sha256 NULL`, `effective_period daterange NOT NULL`, `recorded_at`, `superseded_by uuid NULL REFERENCES agency_rule_version(id)`. `EXCLUDE USING gist (agency WITH =, effective_period WITH &&)` lands via `--custom` migration.

**Migration tooling:**
- **D-17:** Phase 2 reuses Phase 1's pattern: Drizzle schema TS at `db/schema/<table>.ts` declares tables/indexes/standard FKs/`pgPolicy()`; `drizzle-kit generate` produces table-creation SQL; `--custom` migrations cover `FORCE ROW LEVEL SECURITY`, `EXCLUDE USING gist`, SQL functions, `system_role` policies.
- **D-18:** Migration ordering:
  1. `0002_program_schema.sql` (drizzle-kit generate) — `program`, `program_version`, `program_rule`, `rule_citation` tables + indexes + standard FKs + tenant-scoped pgPolicy
  2. `0003_force_rls_program.sql` (`--custom`) — `FORCE ROW LEVEL SECURITY` on the four new tenant-scoped tables + `GRANT SELECT,INSERT,UPDATE,DELETE` to `app_user`
  3. `0004_program_constraints.sql` (`--custom`) — `EXCLUDE USING gist` on `program_version` + `rule_citation` source CHECK + min_confidence wrapper function + generated stored column
  4. `0005_agency_schema.sql` (drizzle-kit generate) — `agency_rule_version`, `agency_rule`, `lender_overlay_rule` tables + indexes + standard FKs + `lender_overlay_rule` tenant-scoped pgPolicy
  5. `0006_force_rls_agency.sql` (`--custom`) — `FORCE` on `lender_overlay_rule` + `system_role` policy on `agency_rule_version` and `agency_rule` + `EXCLUDE USING gist` on `agency_rule_version` + `app_user` GRANTs
  6. `0007_detect_loosenings.sql` (`--custom`) — `detect_loosenings(uuid)` function definition

**Test approach:**
- **D-19:** Pen-test extension at `tests/rls/`: every new tenant-scoped table (`program`, `program_version`, `program_rule`, `lender_overlay_rule`, `rule_citation`) gets cross-tenant SELECT/INSERT/UPDATE/DELETE coverage matching Phase 1 D-03 matrix.
- **D-20:** New schema-constraint tests at `tests/schema/`:
  1. Inserting `program_rule` without `primary_citation_id` fails with NOT NULL violation
  2. Inserting `program_rule` with non-existent FK fails with FK violation
  3. `EXCLUDE` blocks two `state='active'` overlapping `program_version` rows for same `program_id`; allows for different states
  4. `agency_rule_version` `EXCLUDE` blocks overlapping for same agency
  5. `detect_loosenings()` returns row when overlay loosens; empty when restrictive
  6. Structured DerogRule round-trip query by event_type
  7. `agency_rule` cross-tenant readable via `system_role` policy
  8. `rule_citation` source CHECK fires when both source columns NULL
- **D-21:** Vitest config: add `tests/schema/` to include glob; mirror `tests/rls/` setup. New script `"test:schema": "vitest run tests/schema"`.

### Claude's Discretion

- Exact column-name conventions on new tables (snake_case mirroring Phase 1) — **research recommendation: snake_case throughout**
- Index design beyond mandatory `tenant_id` indexes — **research recommendation: `(program_version_id, layer, rule_kind)` on `program_rule`; `(agency_rule_version_id)` on `program_version`; `(min_confidence)` on `program_rule`; `(state, effective_period) GIST` on `program_version`**
- Whether `derog_rule` is a separate table or rows in `agency_rule` with `rule_kind='derog_seasoning'` — **research recommendation: rows in `agency_rule`** (CONTEXT lean confirmed; lower table count, structured body via Zod, SC#2 query stays clean)
- Drizzle column type choices — **research recommendation: `text` everywhere over `varchar(N)`; `numeric` for confidence fields; `uuid` for ids; `timestamptz` for timestamps**
- Single seed `agency_rule_version`+`agency_rule` row vs ephemeral test fixtures — **research recommendation: ephemeral test fixtures** (Phase 2 stays strictly schema-only; Phase 3 owns the full FNMA hand-authoring transaction without "we already shipped some of this" rework risk)
- `system_role` Postgres role vs zero-uuid sentinel — **research recommendation: Postgres role** (Drizzle 0.45 `pgPolicy({ to: pgRole('system_role').existing() })` is documented path; cleaner than sentinel UUID and matches the Phase 3 hand-authoring workflow where the migration runner is already postgres-superuser)

### Deferred Ideas (OUT OF SCOPE)

- Hand-authored FNMA / FHLMC / FHA / VA agency rule content → Phase 3 (AGY-01..09)
- Append-only `evaluation_event` audit log + `REVOKE UPDATE, DELETE` + `ruleset_snapshot_id` → Phase 3 (AUD-01..04)
- Daily Vercel Cron polling agencies + cascade trigger on `agency_rule_version` INSERT + per-affected-program review queue fan-out → Phase 3 (AGY-07, AGY-08)
- Pure-TS evaluation engine at `lib/eval/` → Phase 4 (EVL-01..09)
- `json-rules-engine@7.x` vs custom evaluator spike → Phase 4 (EVL-09)
- `pgvector` embedding column on `rule_citation` → Phase 7
- `staging.draft_rule` / `staging.draft_rule_field_confidence` / `staging.extraction_run` schema → Phase 7 (EXT-06)
- AM commit transaction calling `detect_loosenings()` to block bad commits → Phase 8 (SCH-03 AM-time enforcement)
- AM three-pane review UI + program lifecycle state-transition enforcement → Phase 8
- License gate on `program_version` commit → Phase 8 (LCS-01..04)
- Brokerage `LENDER_OVERLAY` author UI → Phase 12 v2 (LOV-01..03)
- 2026 FHFA conforming loan limit values + high-balance overlay table → Phase 3 (AGY-09)
- Live-pricing tables `pricing_feed`, `pricing_quote` → Phase 13 (PRC-01..05)
- Saved-scenario alerting on indexed program rule change → Phase 14 v3 (WKF-03)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCH-01 | `layer` enum on every rule | D-05 three-table split — `program_rule.layer` enum (`INVESTOR_OVERLAY` \| `PRODUCT_FEATURE`); agency layer implicit on `agency_rule`; lender overlay layer implicit on `lender_overlay_rule` |
| SCH-02 | "Most restrictive wins" + rule stack at evaluation | D-06 — Phase 4 evaluator UNIONs all three tables; Phase 2 ships shape, not evaluator |
| SCH-03 | Loosening detection + data-quality error during AM review | D-12 + D-13 + D-14 — `detect_loosenings(uuid)` SQL function; called by Phase 8 AM commit (deferred wiring); Phase 2 schema-constraint test asserts function works on fixture |
| SCH-04 | Structured DerogRule per event type | Rows in `agency_rule` with `rule_kind='derog_seasoning'`; `rule_body` per Zod schema at `lib/rules/schemas/derog-seasoning.ts` (Pitfall 1.1 shape) |
| SCH-05 | FNMA post-FC 3-to-7-year window structurally encoded | DerogRule's `post_event_LTV_caps[]` carries `months_since_min`/`max`/`max_LTV`/`purposeAllowList`/`occupancyAllowList`; SC#2 round-trip test asserts query path (Pitfall 1.2) |
| SCH-06 | Typed `IncomeDocMethod` per program | D-11 — Zod schema at `lib/rules/schemas/income-doc-method.ts`; persisted in `rule_body` when `rule_kind='income_doc_method'` (Pitfall 1.8 shape) |
| SCH-07 | Typed `DscrMethod` per DSCR program | D-11 — Zod schema at `lib/rules/schemas/dscr-method.ts`; persisted in `rule_body` when `rule_kind='dscr_method'` (Pitfall 1.9 shape) |
| SCH-08 | `tenant.kind` enum on every tenant | Already shipped Phase 1 (`db/schema/tenant.ts`) — values `BROKERAGE` \| `RETAIL_LENDER` \| `WHOLESALE_LENDER` \| `SYSTEM`; Phase 2 does not modify |
| SCH-09 | Per-`ProgramVersion` `effective_period daterange` + `source_document_fingerprint` | D-15 — `program_version` carries both; bitemporal `recorded_at` separate from `effective_period`; `EXCLUDE USING gist` enforces no overlapping active versions |
| SCH-10 | Per-field confidence numeric (0-1) | D-10 — `field_confidence jsonb` on `program_rule` and `agency_rule`; generated stored `min_confidence numeric` (via immutable wrapper function — see Open Question Q1) |
| SCH-11 | `eligible_*` + `ineligible_*` arrays per program | Columns on `program_version`: `eligible_loan_purposes text[]`, `eligible_property_types text[]`, `eligible_occupancies text[]`, `eligible_doc_types text[]`, plus `ineligible_*` companion arrays |
| SCH-12 | State + county overlay scaffolding | Columns on `program_version`: `eligible_states text[]`, `ineligible_states text[]`, `geo_county_overlay jsonb` (USDA-shape only — full encoding Phase 12 v2 COV-v2-01) |
| SCH-13 | Citation FK as DB constraint | D-01 — NOT NULL FK to `rule_citation(id)` on both `program_rule` and `agency_rule`; structural guarantee per Pitfall 2.8 |
| SCH-14 | Every program_rule traces to extraction_run | Phase 2 ships `extraction_run_id uuid NULL` column on `program_rule`; FK target lives in Phase 7's `staging.extraction_run` table; column shape ready, FK added in Phase 7 |

## Standard Stack

### Core (already locked in Phase 1; Phase 2 reuses)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | 0.45.2 | Schema-as-code; type-safe queries | [VERIFIED: npm view drizzle-orm version → 0.45.2] Phase 1 D-10 pattern; `pgPolicy` + `pgEnum` + `pgTable` + `pgRole` from `drizzle-orm/pg-core` |
| drizzle-kit | 0.31.10 | Migration tool | [VERIFIED: npm view drizzle-kit version → 0.31.10] file-based migrations; Phase 1 D-10 (never `push`) |
| postgres (postgres-js) | 3.4.9 | DB driver | [VERIFIED: package.json] `prepare: false` for Supabase pooler |
| pg (node-postgres) | 8.20.0 | Test driver | [VERIFIED: package.json] used by tests/rls/ harness directly per CONTEXT D-01 |
| zod | 4.4.1 | Runtime validation + schema source of truth | [VERIFIED: npm view zod version → 4.4.1] Phase 2 ships per-rule_kind Zod schemas at `lib/rules/schemas/` |
| vitest | 4.1.5 | Test runner | [VERIFIED: package.json] extend to `tests/schema/` per D-21 |

### Supporting (new for Phase 2 — none needed)
Phase 2 is schema-only; no new runtime dependencies. The Zod schemas at `lib/rules/schemas/` use the existing `zod@4.4.1`. No PDF, no LLM, no extraction libs (those land Phase 7).

### Postgres extensions required
| Extension | Version | Required For | Migration |
|-----------|---------|--------------|-----------|
| `btree_gist` | bundled with PG 16 | `EXCLUDE USING gist (col1 WITH =, daterange WITH &&)` — needs btree behavior on the `=` column [CITED: postgresql.org/docs/16/btree-gist.html] | `0004_program_constraints.sql` opens with `CREATE EXTENSION IF NOT EXISTS btree_gist;` |
| `pgcrypto` | NOT required | `gen_random_uuid()` is built into Postgres 13+ [VERIFIED: scripts/init-db.sh comment] | already used by Phase 1; no new migration |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `customType` for daterange | Wait for Drizzle native daterange | Drizzle issue #2647 (open since July 2024) [CITED: github.com/drizzle-team/drizzle-orm/issues/2647] — no native support in 0.45; customType is the documented path |
| `system_role` Postgres role | Zero-uuid sentinel `tenant_id` | Sentinel approach forces every agency-rule INSERT to pre-set GUC to a magic UUID; logically wrong (agency rules are NOT tenant data); Drizzle's `pgRole('system_role').existing()` is documented [CITED: orm.drizzle.team/docs/rls] |
| Rows in `agency_rule` with `rule_kind='derog_seasoning'` | Separate `derog_rule` table | Separate table requires evaluator JOIN logic; rows-in-agency_rule keeps SC#2 query as `SELECT ... FROM agency_rule WHERE rule_kind='derog_seasoning' AND rule_body->>'event_type'='FORECLOSURE'` — single table read |
| Hand-rolled jsonb shape validation in CHECK | jsonb_schema extension | `pg_jsonschema` (Supabase extension) requires extension install + per-kind schema registration; D-08 says heavy validation in TS not DB — clunky migration when shape evolves |
| Single seed FNMA row in Phase 2 | Ephemeral test fixture | Seed risks Phase 3 rework if FNMA hand-authoring revises shape; ephemeral fixture proves SC#2 query path without coupling Phase 2 close to Phase 3 hand-authoring start |

**Installation:** No new packages.

**Version verification:** Drizzle 0.45.2 + drizzle-kit 0.31.10 + zod 4.4.1 — all verified against npm registry on 2026-04-30 [VERIFIED: `npm view <pkg> version`]. These match `package.json` lockfile from Phase 1.

## Architecture Patterns

### Recommended Project Structure (additions to Phase 1 layout)

```
db/
├── schema/
│   ├── _types/
│   │   └── daterange.ts          # NEW — customType wrapper for daterange
│   ├── agency-rule-version.ts    # NEW — agency_rule_version table
│   ├── agency-rule.ts            # NEW — agency_rule table (rows include derog rules)
│   ├── canary.ts                 # Phase 1 — unchanged
│   ├── index.ts                  # Phase 1 — barrel export, Phase 2 appends new exports
│   ├── lender-overlay-rule.ts    # NEW — lender_overlay_rule table (ships empty)
│   ├── program-rule.ts           # NEW — program_rule table
│   ├── program-version.ts        # NEW — program_version table
│   ├── program.ts                # NEW — program table
│   ├── rule-citation.ts          # NEW — rule_citation table
│   ├── system-role.ts            # NEW — pgRole('system_role').existing() declaration
│   └── tenant.ts                 # Phase 1 — unchanged
└── migrations/
    ├── 0000_initial.sql          # Phase 1 — unchanged
    ├── 0001_force_rls.sql        # Phase 1 — unchanged
    ├── 0002_program_schema.sql   # NEW — drizzle-kit generate
    ├── 0003_force_rls_program.sql # NEW — --custom (FORCE + GRANTs)
    ├── 0004_program_constraints.sql # NEW — --custom (EXCLUDE + CHECK + min_confidence wrapper + generated col)
    ├── 0005_agency_schema.sql    # NEW — drizzle-kit generate
    ├── 0006_force_rls_agency.sql # NEW — --custom (FORCE + system_role policy + EXCLUDE + GRANTs)
    └── 0007_detect_loosenings.sql # NEW — --custom (SQL function definition)

lib/
├── db/                           # Phase 1
├── env.ts                        # Phase 1
├── rules/                        # NEW directory
│   └── schemas/
│       ├── index.ts              # NEW — barrel + dispatch table mapping rule_kind → Zod schema
│       ├── ltv-max.ts            # NEW — { value: number(0..100) }
│       ├── cltv-max.ts           # NEW — { value: number(0..120) }
│       ├── hcltv-max.ts          # NEW — { value: number(0..120) }
│       ├── fico-min.ts           # NEW — { value: int(300..850) }
│       ├── dti-max.ts            # NEW — { value: number(0..100) }
│       ├── reserves-min.ts       # NEW — { value: number, unit: 'months' | 'dollars' }
│       ├── derog-seasoning.ts    # NEW — DerogRule shape (Pitfall 1.1)
│       ├── income-doc-method.ts  # NEW — IncomeDocMethod (Pitfall 1.8)
│       ├── dscr-method.ts        # NEW — DscrMethod (Pitfall 1.9)
│       ├── geo-state.ts          # NEW — { allowList: string[2][], denyList: string[2][] }
│       ├── geo-county.ts         # NEW — { entries: { state, fips, allowed }[] }
│       ├── occupancy-allow.ts    # NEW — { values: ('PRIMARY'|'SECOND_HOME'|'INVESTMENT')[] }
│       ├── purpose-allow.ts      # NEW — { values: ('PURCHASE'|'RATE_TERM_REFI'|'CASH_OUT'|'CONSTRUCTION'|...)[] }
│       ├── property-type-allow.ts # NEW — SFR/2-4/condo-warrantable/condo-non-warrantable/co-op/PUD/manufactured
│       ├── doc-type-allow.ts     # NEW — full doc/12-mo bs/24-mo bs/1099/P&L/asset depletion/...
│       ├── mi-required.ts        # NEW — { required: bool, providers: string[] }
│       └── manual-uw-path.ts     # NEW — { allowed: bool, compensatingFactors: string[] }
└── tenant/                       # Phase 1

tests/
├── rls/                          # Phase 1 — extend per D-19
│   ├── (existing files)
│   ├── fixtures/
│   │   ├── (existing)
│   │   └── seedTwoTenants.ts     # EXTEND — also seed program/program_version/program_rule/rule_citation per tenant
│   ├── program-cross-tenant.test.ts        # NEW
│   ├── program-version-cross-tenant.test.ts # NEW
│   ├── program-rule-cross-tenant.test.ts   # NEW
│   ├── lender-overlay-cross-tenant.test.ts # NEW
│   └── rule-citation-cross-tenant.test.ts  # NEW
└── schema/                       # NEW directory
    ├── citation-fk.test.ts       # D-20.1, D-20.2 (NOT NULL + FK)
    ├── program-version-exclude.test.ts # D-20.3
    ├── agency-rule-version-exclude.test.ts # D-20.4
    ├── detect-loosenings.test.ts # D-20.5
    ├── derog-rule-roundtrip.test.ts # D-20.6 (SC#2)
    ├── agency-cross-tenant-readable.test.ts # D-20.7
    └── citation-source-check.test.ts # D-20.8
```

### Pattern 1: customType for `daterange`

**What:** Drizzle 0.45 has no native `daterange` column — issue #2647 has been open since July 2024 [CITED: github.com/drizzle-team/drizzle-orm/issues/2647]. Use `customType<>()` from `drizzle-orm/pg-core` to declare a thin wrapper that maps to the Postgres `daterange` type.

**When to use:** Both `program_version.effective_period` and `agency_rule_version.effective_period` use this single shared customType.

**Example:**
```typescript
// db/schema/_types/daterange.ts
// Source: orm.drizzle.team/docs/custom-types
import { customType } from 'drizzle-orm/pg-core';

/**
 * daterange — Postgres built-in range type for [start, end) date ranges.
 *
 * Drizzle 0.45 has no native daterange (issue #2647). This customType wraps
 * the type using string literal representation `[2026-01-01,2027-01-01)` —
 * the canonical Postgres input/output format for daterange.
 *
 * Half-open `[start, end)` is the convention: start inclusive, end exclusive.
 * Phase 2 SC#3 "two overlapping active versions cannot coexist" leans on
 * the half-open shape — adjacent ranges `[a, b) [b, c)` do NOT overlap, so
 * back-to-back versions don't trip the EXCLUDE constraint.
 *
 * Query "active at date X": `WHERE effective_period @> 'X'::date` uses the
 * containment operator. Postgres converts the date to a daterange singleton.
 */
export const daterange = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'daterange';
  },
  // Postgres returns daterange as the literal string `[start,end)` — pass through.
  fromDriver(value: string): string {
    return value;
  },
  toDriver(value: string): string {
    return value;
  },
});
```

```typescript
// db/schema/program-version.ts (excerpt)
import { daterange } from './_types/daterange.js';

export const programVersion = pgTable('program_version', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  programId: uuid('program_id').notNull().references(() => program.id),
  agencyRuleVersionId: uuid('agency_rule_version_id').notNull().references(() => agencyRuleVersion.id),
  effectivePeriod: daterange('effective_period').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
  state: text('state').notNull(), // CHECK in --custom migration
  sourceDocumentFingerprint: text('source_document_fingerprint').notNull(),
  // ... eligible_*, ineligible_*, geo_*
}, (t) => [...]);
```

### Pattern 2: pgRole for `system_role` agency-table policy

**What:** Agency tables are NOT tenant-scoped. They need a policy that lets every authenticated tenant read them but only `system_role` can write. Drizzle 0.45's `pgPolicy({ to: pgRole('system_role').existing() })` is the documented path [CITED: orm.drizzle.team/docs/rls].

**When to use:** `agency_rule_version` and `agency_rule` policies (NOT `lender_overlay_rule` which is tenant-scoped).

**Example:**
```typescript
// db/schema/system-role.ts
import { pgRole } from 'drizzle-orm/pg-core';

/**
 * system_role — Postgres role for agency-rule cross-tenant reads + agency
 * authoring. Created by scripts/init-db.sh (Phase 1 plan adds it alongside
 * app_user) with NOLOGIN — granted to migration role for hand-authoring
 * agency rules in Phase 3.
 *
 * `.existing()` tells drizzle-kit "do not manage this role" — it's defined
 * outside the schema (in init-db.sh / production env). Migrations reference
 * the role by name only.
 */
export const systemRole = pgRole('system_role').existing();
```

```typescript
// db/schema/agency-rule.ts (excerpt — policy section)
import { systemRole } from './system-role.js';

export const agencyRule = pgTable('agency_rule', {
  // ... columns
}, (t) => [
  // Cross-tenant readable (everyone authenticated reads agency rules)
  pgPolicy('agency_rule_world_read', {
    as: 'permissive',
    for: 'select',
    to: 'public',
    using: sql`true`,
  }),
  // Only system_role writes
  pgPolicy('agency_rule_system_write', {
    as: 'permissive',
    for: 'all',
    to: systemRole,
    using: sql`true`,
    withCheck: sql`true`,
  }),
]);
```

**Bootstrap addition to `scripts/init-db.sh`** (lands in Phase 2 plan, not Phase 1):
```bash
# Phase 2: system_role for agency-table writes (Phase 3 hand-authoring will GRANT to migration role)
CREATE ROLE system_role NOLOGIN NOBYPASSRLS NOSUPERUSER;
GRANT system_role TO postgres;  -- migration runner can write agency rules
GRANT CONNECT ON DATABASE lender_search_dev TO system_role;
GRANT USAGE ON SCHEMA public TO system_role;
```

### Pattern 3: EXCLUDE USING gist + WHERE partial constraint

**What:** Postgres-native pattern for "no two overlapping active versions per program." Requires `btree_gist` extension because the `=` column (program_id, agency) needs B-tree behavior in a GiST index [CITED: postgresql.org/docs/16/btree-gist.html].

**When to use:** Lands via `--custom` migrations (Drizzle 0.45 does not model EXCLUDE constraints natively — same shape as Phase 1's FORCE RLS pattern).

**Example (`0004_program_constraints.sql`):**
```sql
-- Source: postgresql.org/docs/16/btree-gist.html + java-jedi.medium.com/exclusion-constraints-b2cbd62b637a
-- Phase 2 / SC#3: two overlapping active versions for the same program cannot coexist.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- program_version: only one ACTIVE version per program at a time.
-- Adjacent ranges [a, b) [b, c) do NOT overlap — supports back-to-back versions.
ALTER TABLE program_version
  ADD CONSTRAINT program_version_no_overlap_active
  EXCLUDE USING gist (program_id WITH =, effective_period WITH &&)
  WHERE (state = 'active');

-- rule_citation source CHECK (D-03)
ALTER TABLE rule_citation
  ADD CONSTRAINT rule_citation_has_source
  CHECK (source_pdf_sha256 IS NOT NULL OR source_url IS NOT NULL);
```

**Example (`0006_force_rls_agency.sql` excerpt):**
```sql
-- agency_rule_version: only one active version per agency at a time.
-- No state column on agency_rule_version (per D-16) — no WHERE partial.
ALTER TABLE agency_rule_version
  ADD CONSTRAINT agency_rule_version_no_overlap
  EXCLUDE USING gist (agency WITH =, effective_period WITH &&);
```

### Pattern 4: Generated stored column with immutable wrapper function (D-10 fix)

**What:** Postgres CANNOT use a subquery directly inside `GENERATED ALWAYS AS (...) STORED` [CITED: postgresql.org/docs/current/ddl-generated-columns.html — "The generation expression can only use immutable functions and cannot use subqueries or reference anything other than the current row in any way."]. CONTEXT.md D-10's literal expression `(SELECT MIN((value)::numeric) FROM jsonb_each_text(field_confidence))` will fail at migration time.

**Fix:** Wrap the subquery in an `IMMUTABLE` PL/pgSQL function and reference the function from the generated-column expression. This is the standard workaround [CITED: shanestillwell.com/snip/2025/05/02/postgres-generation-expression-is-not-immutable].

**When to use:** `program_rule.min_confidence` and `agency_rule.min_confidence` generated columns.

**Example (`0004_program_constraints.sql` — adds the wrapper before the column):**
```sql
-- Source: postgresql.org/docs/current/ddl-generated-columns.html
-- D-10 spec required a subquery in the generated expression; Postgres rejects.
-- Wrap in IMMUTABLE function so generation expression evaluates the function
-- (which Postgres trusts because we declared it IMMUTABLE).

CREATE OR REPLACE FUNCTION jsonb_min_numeric(j jsonb) RETURNS numeric
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  RETURNS NULL ON NULL INPUT
AS $$
  SELECT MIN((value)::numeric) FROM jsonb_each_text(j)
$$;

-- Now declare the generated column referencing the function.
-- field_confidence already exists (drizzle-kit generated 0002 declared it).
-- Drizzle 0.45 has no first-class GENERATED ALWAYS AS STORED + immutable-function
-- support that survives migration regen, so we add it via --custom here.
ALTER TABLE program_rule
  ADD COLUMN min_confidence numeric
  GENERATED ALWAYS AS (jsonb_min_numeric(field_confidence)) STORED;

ALTER TABLE agency_rule
  ADD COLUMN min_confidence numeric
  GENERATED ALWAYS AS (jsonb_min_numeric(field_confidence)) STORED;

-- Index for Phase 8 confidence-sorted queue (deferred wiring; index is cheap now).
CREATE INDEX program_rule_min_confidence_idx
  ON program_rule (min_confidence)
  WHERE min_confidence IS NOT NULL;
```

**Caveat:** Postgres trusts the IMMUTABLE declaration without verification. If a future plan changes `jsonb_min_numeric` to a non-deterministic body, generated columns silently produce stale values. Drizzle 0.45 doesn't model this; the function lives only in `--custom` migrations and changes require a new migration that drops + recreates dependent columns.

### Pattern 5: detect_loosenings() SQL function (D-12)

**What:** Pure SQL function returning a TABLE of violations. Pure SQL (not PL/pgSQL) is preferred because:
- All operations are set-based (no procedural loops needed)
- Postgres can inline the function for query planning
- Easier to reason about / test

**When to use:** Phase 2 schema-constraint test calls it on a fixture; Phase 8 AM commit calls it pre-commit.

**Example (`0007_detect_loosenings.sql`):**
```sql
-- Source: postgresql.org/docs/16/sql-createfunction.html
-- D-12 / SCH-03 + Phase 2 SC#4
-- For each INVESTOR_OVERLAY rule in program_rule for the given program_version,
-- joins to the matching AGENCY_BASE rule in agency_rule (by rule_kind + the
-- program_version's agency_rule_version_id) and returns rows where overlay
-- is more permissive than agency baseline.
--
-- SECURITY INVOKER (default): function runs with caller's permissions, so
-- RLS policies on program_rule still apply — Phase 8's AM commit transaction
-- only sees rules in the AM's tenant context. Agency_rule has the world-read
-- policy so the JOIN works regardless of caller tenant.

CREATE OR REPLACE FUNCTION detect_loosenings(p_program_version_id uuid)
  RETURNS TABLE (
    program_rule_id uuid,
    agency_rule_id uuid,
    dimension text,
    agency_value jsonb,
    overlay_value jsonb
  )
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
AS $$
  WITH
    overlay_rules AS (
      SELECT pr.id, pr.rule_kind, pr.rule_body, pv.agency_rule_version_id
      FROM program_rule pr
      JOIN program_version pv ON pv.id = pr.program_version_id
      WHERE pr.program_version_id = p_program_version_id
        AND pr.layer = 'INVESTOR_OVERLAY'
    ),
    paired AS (
      SELECT
        ovr.id AS overlay_id,
        ar.id AS agency_id,
        ovr.rule_kind,
        ovr.rule_body AS overlay_body,
        ar.rule_body AS agency_body
      FROM overlay_rules ovr
      JOIN agency_rule ar
        ON ar.agency_rule_version_id = ovr.agency_rule_version_id
        AND ar.rule_kind = ovr.rule_kind
    )
  -- Numeric ≤ comparisons (overlay must be ≤ agency to count as restricting)
  SELECT
    p.overlay_id, p.agency_id, p.rule_kind,
    p.agency_body, p.overlay_body
  FROM paired p
  WHERE p.rule_kind IN ('ltv_max', 'cltv_max', 'hcltv_max', 'dti_max')
    AND (p.overlay_body->>'value')::numeric > (p.agency_body->>'value')::numeric

  UNION ALL

  -- Numeric ≥ comparisons (overlay must be ≥ agency to count as restricting)
  SELECT
    p.overlay_id, p.agency_id, p.rule_kind,
    p.agency_body, p.overlay_body
  FROM paired p
  WHERE p.rule_kind IN ('fico_min', 'reserves_min')
    AND (p.overlay_body->>'value')::numeric < (p.agency_body->>'value')::numeric

  UNION ALL

  -- derog_seasoning: overlay's base_waiting_months and extenuating_circumstances_waiting_months must be ≥ agency
  SELECT
    p.overlay_id, p.agency_id, p.rule_kind,
    p.agency_body, p.overlay_body
  FROM paired p
  WHERE p.rule_kind = 'derog_seasoning'
    AND (
      COALESCE((p.overlay_body->>'base_waiting_months')::int, 0) <
        COALESCE((p.agency_body->>'base_waiting_months')::int, 0)
      OR COALESCE((p.overlay_body->>'extenuating_circumstances_waiting_months')::int, 0) <
        COALESCE((p.agency_body->>'extenuating_circumstances_waiting_months')::int, 0)
    )

  UNION ALL

  -- Allow-list: overlay's "values" array must be a SUBSET of agency's
  -- (overlay adding values is loosening). Uses jsonb @> (contains): if
  -- agency_body->'values' contains overlay_body->'values', it's restrictive.
  SELECT
    p.overlay_id, p.agency_id, p.rule_kind,
    p.agency_body, p.overlay_body
  FROM paired p
  WHERE p.rule_kind IN ('occupancy_allow', 'purpose_allow', 'property_type_allow', 'doc_type_allow')
    AND NOT (p.agency_body->'values' @> p.overlay_body->'values');
$$;
```

### Pattern 6: rule_kind dispatch table for Zod schemas

**What:** A single `lib/rules/schemas/index.ts` exports every per-kind Zod schema and a dispatch table mapping `rule_kind` → schema. Phase 4 evaluator, Phase 7 extraction validator, and Phase 8 AM commit all consume this dispatch table.

**Example:**
```typescript
// lib/rules/schemas/index.ts
import { z } from 'zod';
import { ltvMaxSchema } from './ltv-max.js';
import { cltvMaxSchema } from './cltv-max.js';
import { ficoMinSchema } from './fico-min.js';
import { dtiMaxSchema } from './dti-max.js';
import { derogSeasoningSchema } from './derog-seasoning.js';
import { incomeDocMethodSchema } from './income-doc-method.js';
import { dscrMethodSchema } from './dscr-method.js';
// ... 17 imports total

export const ruleKinds = [
  'ltv_max', 'cltv_max', 'hcltv_max', 'fico_min', 'dti_max', 'reserves_min',
  'derog_seasoning', 'income_doc_method', 'dscr_method',
  'geo_state', 'geo_county',
  'occupancy_allow', 'purpose_allow', 'property_type_allow', 'doc_type_allow',
  'mi_required', 'manual_uw_path',
] as const;

export type RuleKind = typeof ruleKinds[number];

export const ruleBodySchemas = {
  ltv_max: ltvMaxSchema,
  cltv_max: cltvMaxSchema,
  fico_min: ficoMinSchema,
  dti_max: dtiMaxSchema,
  derog_seasoning: derogSeasoningSchema,
  income_doc_method: incomeDocMethodSchema,
  dscr_method: dscrMethodSchema,
  // ...
} as const satisfies Record<RuleKind, z.ZodType>;

/**
 * Type-narrow rule_body validation by rule_kind.
 * Phase 7 extraction validator + Phase 8 AM commit + Phase 4 evaluator all use this.
 */
export function parseRuleBody(kind: RuleKind, body: unknown) {
  return ruleBodySchemas[kind].parse(body);
}
```

### Pattern 7: DerogRule Zod schema shape (Pitfall 1.1, SCH-04, SC#2)

**Example:**
```typescript
// lib/rules/schemas/derog-seasoning.ts
import { z } from 'zod';

export const derogEventType = z.enum([
  'BK7',
  'BK13_DISCHARGED',
  'BK13_DISMISSED',
  'MULTIPLE_BK',
  'FORECLOSURE',
  'DEED_IN_LIEU',
  'SHORT_SALE',
  'MORTGAGE_CHARGE_OFF',
  'MOD',
  'FORBEARANCE',
]);

export const measurementAnchor = z.enum([
  'DISCHARGE',
  'DISMISSAL',
  'COMPLETION',
  'SALE_CONFIRMATION',
  'NOTE_DATE',
  'CHARGE_OFF_DATE',
]);

export const occupancyValue = z.enum(['PRIMARY', 'SECOND_HOME', 'INVESTMENT']);
export const purposeValue = z.enum([
  'PURCHASE', 'RATE_TERM_REFI', 'CASH_OUT_REFI',
  'CONSTRUCTION', 'CONSTRUCTION_TO_PERM',
  'HELOC', 'CES_SECOND_LIEN',
]);

export const postEventLtvCap = z.object({
  months_since_min: z.number().int().nonnegative(),
  months_since_max: z.number().int().nonnegative().nullable(),
  max_LTV: z.number().min(0).max(100),
  max_CLTV: z.number().min(0).max(120).nullable().optional(),
  max_HCLTV: z.number().min(0).max(120).nullable().optional(),
  purposeAllowList: z.array(purposeValue),
  occupancyAllowList: z.array(occupancyValue),
});

export const mortgageIncludedInBkRule = z.enum([
  'NOT_APPLICABLE',
  'BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED',
  'FC_CLOCK_ALWAYS',
]);

/**
 * DerogRule — structured derogatory-event seasoning.
 * Per Pitfall 1.1 / 1.2 / 1.3 / 1.5 / 1.6.
 *
 * Cardinality: one row in agency_rule per (agency_rule_version_id, event_type).
 * SC#2 query: SELECT * FROM agency_rule WHERE rule_kind='derog_seasoning'
 *               AND rule_body->>'event_type' = 'FORECLOSURE'.
 */
export const derogSeasoningSchema = z.object({
  event_type: derogEventType,
  measurement_anchor: measurementAnchor,
  base_waiting_months: z.number().int().nonnegative(),
  extenuating_circumstances_waiting_months: z.number().int().nonnegative().nullable(),
  post_event_LTV_caps: z.array(postEventLtvCap).default([]),
  reestablished_credit_required: z.boolean(),
  reestablishment_criteria_text: z.string().nullable().optional(),
  mortgage_included_in_bk_rule: mortgageIncludedInBkRule,
  notes_citations: z.array(z.string()).default([]),
});

export type DerogSeasoning = z.infer<typeof derogSeasoningSchema>;
```

**SC#2 fixture row:**
```typescript
// FNMA post-foreclosure: 7y baseline, 3y w/ EC, 3-to-7-year window 90% LTV cap
const fnmaForeclosure: DerogSeasoning = {
  event_type: 'FORECLOSURE',
  measurement_anchor: 'COMPLETION',
  base_waiting_months: 84, // 7y
  extenuating_circumstances_waiting_months: 36, // 3y w/ EC
  post_event_LTV_caps: [
    {
      months_since_min: 36,
      months_since_max: 84,
      max_LTV: 90,
      purposeAllowList: ['PURCHASE', 'RATE_TERM_REFI'],
      occupancyAllowList: ['PRIMARY'],
    },
  ],
  reestablished_credit_required: true,
  mortgage_included_in_bk_rule: 'BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED',
  notes_citations: ['FNMA Selling Guide B3-5.3-07'],
};
```

### Pattern 8: IncomeDocMethod + DscrMethod (Pitfall 1.8 / 1.9)

```typescript
// lib/rules/schemas/income-doc-method.ts (Pitfall 1.8)
import { z } from 'zod';

export const incomeDocMethodSchema = z.object({
  method: z.enum([
    'FULL_DOC', 'BANK_STATEMENT_12MO', 'BANK_STATEMENT_24MO',
    'P_AND_L_ONLY', 'WVOE', 'ASSET_DEPLETION', 'NO_DOC', '1099_ONLY',
  ]),
  // Bank-statement specific (apply when method ∈ BANK_STATEMENT_*)
  account_type: z.enum(['PERSONAL', 'BUSINESS', 'EITHER']).nullable().optional(),
  expense_factor: z.number().min(0).max(1).nullable().optional(),
  expense_factor_source: z.enum([
    'FIXED_PERCENTAGE', 'CPA_LETTER', 'P_AND_L_RECONCILIATION', 'BORROWER_ATTESTATION',
  ]).nullable().optional(),
  exclude_transfers: z.boolean().nullable().optional(),
  max_nsf_per_period: z.number().int().nonnegative().nullable().optional(),
  comingling_treatment: z.enum(['ALLOWED', 'DISALLOWED', 'SEASONED']).nullable().optional(),
  qualifying_deposit_seasoning: z.string().nullable().optional(),
  qualifying_period_months: z.number().int().nonnegative().nullable().optional(),
});
```

```typescript
// lib/rules/schemas/dscr-method.ts (Pitfall 1.9)
import { z } from 'zod';

export const dscrLtvTier = z.object({
  ltv_max: z.number().min(0).max(120),
  min_dscr: z.number().min(0),
});

export const dscrMethodSchema = z.object({
  numerator_rule: z.enum([
    'LOWER_OF_LEASE_AND_MARKET',
    'HIGHER_OF_LEASE_AND_MARKET',
    'LEASE_ONLY',
    'MARKET_ONLY',
    'LEASE_WITH_MARKET_FALLBACK',
  ]),
  short_term_rental_allowed: z.boolean(),
  short_term_rental_seasoning_months: z.number().int().nonnegative().nullable().optional(),
  denominator_method: z.enum([
    'NOTE_RATE_PITIA',
    'NOTE_RATE_ITIA_FOR_IO',
    'FULLY_AMORTIZED_QUALIFYING',
    'INDEX_PLUS_MARGIN',
    'INDEX_PLUS_MARGIN_PLUS_2',
  ]),
  min_dscr_by_ltv_tier: z.array(dscrLtvTier).default([]),
  no_ratio_option: z.boolean(),
  no_ratio_max_ltv: z.number().min(0).max(120).nullable().optional(),
});
```

### Anti-Patterns to Avoid

- **Anti-Pattern 1: Embedding agency rules per program (ARCHITECTURE.md Anti-Pattern 1).** D-05 already prohibits this — never add an `agency_rule_body` column to `program_rule`. Programs reference agency by FK on `program_version.agency_rule_version_id`.
- **Anti-Pattern 2: Using `text` for `rule_kind` instead of an enum.** D-09 says explicit enum. This catches typos at insert time.
- **Anti-Pattern 3: Validating jsonb shape with CHECK constraints.** D-08 says heavy shape validation lives in TS (Zod). DB checks are minimal: NOT NULL + jsonb_typeof. Migration churn on shape changes is the killer.
- **Anti-Pattern 4: Using `varchar(N)` for short text columns.** Postgres convention prefers `text` (zero performance difference, fewer migration headaches). Phase 1 already established this pattern.
- **Anti-Pattern 5: Storing confidence as `real` or `double precision`.** Use `numeric` for confidence fields (deterministic; required for stable comparisons in audit replay).
- **Anti-Pattern 6: Trigger-based loosening rejection (D-13 prohibits).** A BEFORE INSERT trigger that hard-rejects breaks Phase 7's extraction-draft path where temporarily-loosening rows arrive before AM review. SCH-03 says "surfaces during AM review" — Phase 8 is the call site.
- **Anti-Pattern 7: Letting drizzle-kit `push` apply policies (Phase 1 D-10 — issue #3504).** Always use `drizzle-kit migrate` (file-based). `push` silently drops RLS DDL.
- **Anti-Pattern 8: Single-source citation FK (Pitfall 2.8).** D-01's NOT NULL `primary_citation_id` is structural; never relax to nullable + soft validation.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bitemporal "no overlapping versions" | Custom trigger checking ranges | `EXCLUDE USING gist` + `daterange` + `btree_gist` | Postgres-native; one-line constraint vs. dozens of lines of trigger logic; constraint is set-based and atomic |
| daterange column type | Two `date` columns + check constraint | Postgres `daterange` + customType wrapper | Native containment operators (`@>`, `&&`, etc.); EXCLUDE constraint requires actual range type |
| Loosening detection trigger | BEFORE INSERT trigger that rejects | `detect_loosenings(uuid)` SQL function | D-13 — surfaces at AM review time, not write time; extraction pipeline writes draft rows that may temporarily loosen |
| jsonb shape validation in DB | `CHECK (jsonb_path_exists(...))` per kind | Zod schemas at `lib/rules/schemas/<kind>.ts` | D-08 — heavy validation in TS; DB churn on shape change is migration nightmare |
| Cross-tenant agency reads | Application-layer flag + custom auth | `system_role` Postgres role + `pgPolicy({ to: systemRole })` | D-05 — same RLS mechanism as Phase 1; one source of truth |
| Per-rule confidence sort | Compute MIN at query time per row | Generated stored column `min_confidence` + index | Phase 8 confidence-sorted queue is the hot path; computed-at-query is N×O(jsonb_each) per page |
| Multi-page citation linkage | Bridge table | Optional `secondary_for_rule_id` back-pointer | D-02 — single column; primary FK stays NOT NULL |
| Tenant isolation on every query | `WHERE tenant_id = ?` | RLS policies + `setTenantContext` | Phase 1 already shipped; Phase 2 reuses (Pitfall 3.5) |

**Key insight:** Phase 2 is mostly DDL composition. The pitfall is reaching for procedural mechanisms (triggers, application-layer checks) when Postgres-native DDL constraints handle the same problem with stronger guarantees.

## Common Pitfalls

### Pitfall A: Daterange half-open vs. closed range mismatch

**What goes wrong:** Postgres `daterange` is half-open by default — `[start, end)` excludes the end date. If migration code emits `[2026-01-01, 2026-12-31]` (closed) the EXCLUDE constraint sees `2026-12-31` as inclusive and back-to-back versions `[2026-12-31, 2027-12-31]` overlap on a single day.
**Why it happens:** SQL date-range literals default to inclusive on both ends in many docs.
**How to avoid:** Always emit `daterange(start, end, '[)')` explicitly OR use the canonical literal `'[2026-01-01,2027-01-01)'`. Document this in the customType file and assert in `program-version-exclude.test.ts` that adjacent ranges don't trip the constraint.
**Warning signs:** EXCLUDE blocks adjacent (non-overlapping) version commits.

### Pitfall B: btree_gist extension forgotten

**What goes wrong:** `EXCLUDE USING gist (program_id WITH =, ...)` fails with "data type uuid has no default operator class for access method gist."
**Why it happens:** GiST natively supports range/geometric types; B-tree-equivalent operators on scalar types (uuid, text) require `btree_gist`.
**How to avoid:** Open `0004_program_constraints.sql` with `CREATE EXTENSION IF NOT EXISTS btree_gist;`. Same for `0006`.
**Warning signs:** Migration fails with operator class error.

### Pitfall C: Generated column subquery rejected (THE D-10 BLOCKER)

**What goes wrong:** Postgres rejects `GENERATED ALWAYS AS ((SELECT MIN(...) FROM ...)) STORED` — subqueries are forbidden.
**Why it happens:** Postgres documentation: "The generation expression can only use immutable functions and cannot use subqueries or reference anything other than the current row in any way." [CITED: postgresql.org/docs/current/ddl-generated-columns.html]
**How to avoid:** Wrap the subquery in an `IMMUTABLE` PL/pgSQL or SQL function (`jsonb_min_numeric(j jsonb)`) and reference the function from the generated column. Pattern 4 above shows the exact DDL.
**Warning signs:** Migration fails with "cannot use subquery in generation expression."

### Pitfall D: pgPolicy with `to: pgRole(...)` without `.existing()`

**What goes wrong:** Drizzle-kit tries to manage the role's lifecycle and fails when the role already exists in the database.
**Why it happens:** `pgRole('system_role')` (without `.existing()`) tells drizzle-kit "I want this role created/managed." If the role lives in `init-db.sh` (outside drizzle's view), drizzle-kit emits CREATE ROLE statements and conflicts.
**How to avoid:** Use `pgRole('system_role').existing()` so drizzle-kit treats it as external. Set `entities.roles.exclude: ['system_role']` in `drizzle.config.ts` if more granular control needed.
**Warning signs:** `drizzle-kit generate` emits unexpected CREATE ROLE / ALTER ROLE statements.

### Pitfall E: `system_role` policy too permissive on agency tables

**What goes wrong:** Cross-tenant readability is intentional, but a misconfigured policy that allows `INSERT` from public lets any tenant author agency rules.
**Why it happens:** Forgetting that `to: 'public'` + `for: 'all'` opens write paths.
**How to avoid:** Two policies per agency table — one `for: 'select', to: 'public', using: 'true'` (cross-tenant read) and one `for: 'all', to: systemRole, using/withCheck: 'true'` (system writes only).
**Warning signs:** Pen test catches a public INSERT succeeding on `agency_rule`.

### Pitfall F: Insert order on `program_rule` + `rule_citation`

**What goes wrong:** D-01's NOT NULL FK requires the citation row to exist before the rule row. INSERT order matters within a transaction.
**Why it happens:** Standard FK enforcement — citation row's PK must exist when rule row's FK is checked. (Deferrable FKs would work but D-01 says no deferrable mechanics.)
**How to avoid:** Server actions / extraction pipeline emit `INSERT rule_citation RETURNING id` first, then `INSERT program_rule WITH primary_citation_id = $1` — single transaction, two statements.
**Warning signs:** Inserts fail with FK violation when citation hasn't been written yet.

### Pitfall G: GUC bootstrap on agency-table writes

**What goes wrong:** `agency_rule_version` and `agency_rule` are NOT tenant-scoped; they have no `tenant_id`. But Phase 1's pen-test setup connects as `app_user` (NOBYPASSRLS NOSUPERUSER), and the `system_role` policy uses `to: systemRole`. If the test connection isn't `system_role`, agency-table tests can't INSERT.
**Why it happens:** Test connection identity mismatch.
**How to avoid:** Schema-constraint tests that write agency rules connect as `postgres` (migration role, granted `system_role`) via `DATABASE_MIGRATION_URL`. Cross-tenant readability tests connect as `app_user` (verifying SELECT works without GUC).
**Warning signs:** Agency-rule INSERT in test fails with "no policy" error.

### Pitfall H: Phase 1 GUC carry-forward — placeholder behavior on touched sessions

**What goes wrong:** Phase 1 documented (Plan 01-07) that once `app.tenant_id` is touched in a Postgres 16 session, RESET / DISCARD ALL leaves it as `''` (empty string), not NULL. Tests for cross-tenant agency reads must NOT touch the GUC.
**Why it happens:** Postgres 16 placeholder GUC quirk.
**How to avoid:** Mirror Phase 1's `connectAsAnonymous` pattern — fresh `pg.Client` (not pool) for tests that need NULL GUC behavior. Phase 2 reuses `tests/rls/fixtures/connection.ts::connectAsAnonymous` unchanged.
**Warning signs:** Cross-tenant SELECT raises 22P02 (invalid uuid syntax) instead of returning rows.

### Pitfall I: Drizzle 0.45 doesn't model `EXCLUDE USING gist`

**What goes wrong:** Trying to declare `pgTable` with an EXCLUDE constraint via `(t) => [...]` — Drizzle 0.45 has no API for this.
**Why it happens:** Same reason FORCE RLS isn't modeled — EXCLUDE constraints require GiST operator classes that need extension awareness.
**How to avoid:** EXCLUDE goes in `--custom` migrations only (Pattern 3). Drizzle schema declares the columns; EXCLUDE lands separately.
**Warning signs:** Drizzle-generated migration lacks EXCLUDE clauses despite schema-level docstrings.

### Pitfall J: Mortgage-included-in-BK rule branch shape (Pitfall 1.6)

**What goes wrong:** The DerogRule shape must let evaluator decide whether the BK 4y clock or FC 7y clock applies based on `mortgage_included_in_bk_rule` enum + scenario inputs. Flat boolean isn't enough.
**Why it happens:** Conditional rule application based on document possession.
**How to avoid:** `derogSeasoningSchema.mortgage_included_in_bk_rule: 'NOT_APPLICABLE' | 'BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED' | 'FC_CLOCK_ALWAYS'`. Phase 4 evaluator branches on this enum.
**Warning signs:** Phase 5 golden-set scenario for "BK 5y + FC 5y, mortgage included, not reaffirmed" returns wrong answer.

### Pitfall K: Schema-stability-before-UI (Pitfall 4.1)

**What goes wrong:** Phase 2 ships incomplete schema; Phase 4+ harden the evaluator against the rule shape; Phase 12 changes break everything.
**Why it happens:** The schema is the keystone — Phase 4 evaluator depends on it; Phase 7 extraction populates it; Phase 8 commits to it.
**How to avoid:** Lock all 14 SCH-* requirements at Phase 2. Resist "we'll add it later" — adding `lender_overlay_rule` later (D-07) would force schema migration after Phase 4 hardens. SCH-11 + SCH-12 columns ship now even if Phase 12 fully populates them.
**Warning signs:** Future phase asks for a column that Phase 2 should have shipped.

## Code Examples

### Round-trip query for SC#2 (DerogRule by event_type)

```typescript
// tests/schema/derog-rule-roundtrip.test.ts (sketch)
import { test, expect } from 'vitest';
import { Client } from 'pg';
import { fnmaForeclosure } from './fixtures/derog-fnma-foreclosure.js';

test('FNMA post-FC DerogRule round-trips by event_type query (SC#2)', async () => {
  const client = new Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
  await client.connect();
  try {
    await client.query('BEGIN');

    // 1. Citation first (D-01 NOT NULL FK; insert order matters per Pitfall F)
    const cit = await client.query<{ id: string }>(
      `INSERT INTO rule_citation (source_url, excerpt) VALUES ($1, $2) RETURNING id`,
      ['https://selling-guide.fanniemae.com/B3-5.3-07', 'Foreclosure 7-year baseline...'],
    );
    const citationId = cit.rows[0]!.id;

    // 2. agency_rule_version
    const arv = await client.query<{ id: string }>(
      `INSERT INTO agency_rule_version (agency, version_label, source_url, effective_period)
       VALUES ('FNMA', 'SEL-2026-04', $1, '[2026-04-01,2026-12-31)') RETURNING id`,
      ['https://selling-guide.fanniemae.com/2026-04'],
    );
    const arvId = arv.rows[0]!.id;

    // 3. agency_rule with rule_kind=derog_seasoning + structured DerogRule body
    await client.query(
      `INSERT INTO agency_rule (agency_rule_version_id, rule_kind, rule_body, primary_citation_id)
       VALUES ($1, 'derog_seasoning', $2::jsonb, $3)`,
      [arvId, JSON.stringify(fnmaForeclosure), citationId],
    );

    // 4. Query by event_type — SC#2 acceptance
    const { rows } = await client.query(
      `SELECT rule_body FROM agency_rule
        WHERE rule_kind = 'derog_seasoning'
          AND rule_body->>'event_type' = 'FORECLOSURE'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].rule_body.post_event_LTV_caps[0].max_LTV).toBe(90);
    expect(rows[0].rule_body.post_event_LTV_caps[0].purposeAllowList).toEqual([
      'PURCHASE', 'RATE_TERM_REFI',
    ]);
    expect(rows[0].rule_body.post_event_LTV_caps[0].occupancyAllowList).toEqual(['PRIMARY']);

    await client.query('ROLLBACK'); // throwaway
  } finally {
    await client.end();
  }
});
```

### Active-at-date query (bitemporal lookup)

```typescript
// Phase 4 evaluator hot path — at scenario evaluation, hydrate snapshot for "now"
const snapshot = await db.execute(sql`
  SELECT pv.id, pv.agency_rule_version_id, pv.source_document_fingerprint
  FROM program_version pv
  WHERE pv.tenant_id = current_setting('app.tenant_id', true)::uuid
    AND pv.state = 'active'
    AND pv.effective_period @> CURRENT_DATE
`);
```

The `@>` containment operator is the canonical "X is inside this range" check on `daterange`.

### EXCLUDE constraint test

```typescript
// tests/schema/program-version-exclude.test.ts (sketch)
test('two overlapping active program_versions for the same program rejected (SC#3)', async () => {
  // Setup: seed tenant, program, agency_rule_version, citation
  // ... boilerplate omitted

  // First active version OK
  await client.query(`
    INSERT INTO program_version (tenant_id, program_id, agency_rule_version_id,
                                 effective_period, state, source_document_fingerprint)
    VALUES ($1, $2, $3, '[2026-01-01,2026-12-31)', 'active', 'sha256:abc')
  `, [tenantId, programId, arvId]);

  // Overlapping active version rejected by EXCLUDE
  await expect(client.query(`
    INSERT INTO program_version (tenant_id, program_id, agency_rule_version_id,
                                 effective_period, state, source_document_fingerprint)
    VALUES ($1, $2, $3, '[2026-06-01,2027-06-01)', 'active', 'sha256:def')
  `, [tenantId, programId, arvId])).rejects.toThrow(/conflicting key value violates exclusion constraint/);

  // Same range but state='draft' — NOT blocked (WHERE state='active' partial)
  await expect(client.query(`
    INSERT INTO program_version (tenant_id, program_id, agency_rule_version_id,
                                 effective_period, state, source_document_fingerprint)
    VALUES ($1, $2, $3, '[2026-06-01,2027-06-01)', 'draft', 'sha256:ghi')
  `, [tenantId, programId, arvId])).resolves.not.toThrow();
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `temporal_tables` extension for bitemporal | `daterange` + EXCLUDE USING gist | Postgres 9.2+ shipped range types; pattern stable since ~2014 | Native, no extension needed beyond `btree_gist` |
| pg_jsonschema for jsonb shape validation | Zod schemas in TS | 2024-2025 — Drizzle 0.32+ + Zod 4 | DB stays simple; validation co-located with type definitions; migrations don't churn on shape changes |
| `WITHOUT OVERLAPS` syntax (Postgres 18) | EXCLUDE USING gist (16-compat) | Postgres 18 is too new for 2026 prod | Phase 2 sticks to 16-compat patterns |
| `jsonb_path_exists` CHECK constraints | `jsonb_typeof = 'object'` only + Zod | 2024 onward | Heavy validation in TS; DB checks structural-only |

**Deprecated/outdated:**
- `temporal_tables` extension: not on Supabase managed Postgres; bitemporal pattern via daterange + EXCLUDE is the current path
- `varchar(N)`: still works but Postgres convention is `text` everywhere

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `daterange` half-open `[start, end)` is the right shape for `effective_period` | Pattern 1 + Pitfall A | If closed range `[start, end]` is preferred, adjacent versions like `[A, B] [B, C]` will collide on single day. Test-driven; flagged in Pitfall A. |
| A2 | `system_role` Postgres role + `pgPolicy({ to: pgRole('system_role').existing() })` works cleanly with Drizzle 0.45 + drizzle-kit 0.31.10 | Pattern 2 | If drizzle-kit doesn't honor `.existing()` (regression), fall back to `--custom` migration that creates the policies after `0005_agency_schema.sql`'s table-creation step. Verifiable by running `pnpm drizzle-kit generate` and inspecting output. |
| A3 | `jsonb_min_numeric(j jsonb)` IMMUTABLE wrapper produces correct values for all Phase 2 inserts | Pattern 4 | Generated columns trust IMMUTABLE declaration; `MIN((value)::numeric) FROM jsonb_each_text(j)` is genuinely deterministic for valid inputs. If a non-numeric jsonb value appears in `field_confidence`, the cast raises 22P02 at INSERT time — caller-visible error, not silent corruption. Zod write-boundary check enforces 0..1 numeric so this should be unreachable. |
| A4 | `derog_seasoning` body shape per Pitfall 1.1 covers SCH-04 + SC#2 fully | Pattern 7 | If Phase 3 hand-authoring discovers the FNMA/FHLMC/FHA/VA matrix needs a field Phase 2 didn't anticipate (e.g., `down_payment_source` restriction), Zod schema can extend with optional fields without DB migration (jsonb tolerates new keys). High-risk fields are committed; low-risk extension via Zod `.optional()` is safe. |
| A5 | One row per (agency_rule_version_id, event_type) is the right cardinality for derog rules | Pattern 7 | Unique constraint on (agency_rule_version_id, rule_kind, rule_body->>'event_type') would enforce. Phase 2 ships without unique on jsonb-extracted column (clunky); Phase 3 hand-authoring transaction can add this constraint when known shapes lock. Plan should add an index on `(agency_rule_version_id, rule_kind, (rule_body->>'event_type'))` for query performance. |
| A6 | SECURITY INVOKER on `detect_loosenings` is correct (not DEFINER) | Pattern 5 | INVOKER means caller's RLS applies — Phase 8 AM commit runs in tenant context, sees only that tenant's program_rule rows. agency_rule has world-read so the JOIN works. DEFINER would let the function bypass RLS, which is wrong for Phase 8's tenant-scoped use. Validated via D-20.5 test that runs the function from a tenant context. |
| A7 | Single demonstration FNMA `agency_rule_version`+`agency_rule` row for SC#2 ships as test fixture, not seed migration | CONTEXT Discretion + Open Question Q4 | Ephemeral fixture keeps Phase 2 strictly schema-only and avoids Phase 3 rework risk. If Phase 3 plans want a Phase 2 head start, the fixture file lifts cleanly into a seed migration with one cp command. |
| A8 | btree_gist extension is safe to install on Supabase managed Postgres | Pattern 3 | btree_gist is in Supabase's bundled extensions list (verified for Postgres 16 on Supabase Pro). Local docker postgres:16 also ships it. No environment-specific incompatibility expected. |
| A9 | `daterange` literal `'[2026-01-01,2027-01-01)'` survives the `postgres-js` driver round-trip without parsing surprises | Pattern 1 + customType | postgres-js passes unknown types as text per its default oid-mapping behavior. customType's `fromDriver`/`toDriver` are pass-through strings, so the literal survives. If postgres-js auto-parses dateranges to objects (it doesn't, as of 3.4.9), customType wraps the conversion. |

**If this table grew empty:** All claims are verified or cited — no user confirmation needed. Currently A1, A4, A5, A7 are MEDIUM-confidence assumptions worth flagging to the user / discuss-phase if any of them was unclear. CONTEXT.md already locked the choices for A1, A5, A7 (per discretion); A4 is the highest-risk because it's the wedge feature.

## Open Questions

1. **Generated column subquery — confirmed BLOCKER but solvable**
   - What we know: Postgres rejects `GENERATED ALWAYS AS ((SELECT MIN(...))) STORED`. CONTEXT D-10 wrote the expression literally with the subquery.
   - What's unclear: Nothing — the immutable-function-wrapper workaround (Pattern 4) is the standard solution.
   - Recommendation: Plan adds the wrapper function + generated column in `0004_program_constraints.sql`. CONTEXT D-10 needs an inline annotation: "via `jsonb_min_numeric(j jsonb)` IMMUTABLE wrapper per Pattern 4."

2. **Should the cross-tenant readability tests connect as which user?**
   - What we know: `app_user` (NOBYPASSRLS NOSUPERUSER) is what Phase 1 tests use. `agency_rule` policies are `to: 'public'` for SELECT — `app_user` can read.
   - What's unclear: Should the schema-constraint test for "agency rules are cross-tenant readable" use `connectAsAnonymous` (no GUC) OR `connectAsTenant(tenantA)` and verify SELECT works?
   - Recommendation: Both. `connectAsAnonymous` proves "even with no tenant context, agency reads work" (system role / observability use case); `connectAsTenant` proves "tenant A reads the same agency rules tenant B reads." Plan ships both tests.

3. **Phase 7 `extraction_run_id` FK shape — column-only or already-FK?**
   - What we know: SCH-14 says every program_rule traces to extraction_run. Phase 7 (EXT-06) creates `staging.extraction_run`. Phase 2 ships the column.
   - What's unclear: Is `extraction_run_id uuid NULL` shipped as a plain column with the FK added in Phase 7, or as a FK-with-no-target (impossible — FK requires target table)?
   - Recommendation: Phase 2 ships `extraction_run_id uuid NULL` as a plain column (no FK). Phase 7 adds `ALTER TABLE program_rule ADD CONSTRAINT program_rule_extraction_run_fk FOREIGN KEY (extraction_run_id) REFERENCES staging.extraction_run(id)` in its `--custom` migration. Comment on the column declares the deferred wiring.

4. **Should Phase 2 commit a single `agency_rule_version` + `agency_rule` row pair for the FNMA post-foreclosure example, OR keep it as test fixture only?** (CONTEXT Claude's Discretion)
   - What we know: SC#2 demands a queryable structured DerogRule. Phase 3 owns the full FNMA matrix hand-authoring (AGY-02).
   - What's unclear: Does the Phase 2 SC#2 test need a seeded row, or is a test-fixture row sufficient?
   - Recommendation: **Test fixture only** (CONTEXT Discretion). Reasons:
     - Phase 3 owns FNMA hand-authoring as a single transaction; Phase 2 shipping a partial row creates "we already have one" rework risk if Phase 3 revises the shape.
     - Test fixture proves the query path without coupling Phase 2 close to Phase 3 hand-authoring start.
     - Migration files stay strictly schema/policy/function — no domain data.

5. **Index strategy on jsonb-extracted columns**
   - What we know: D-20.6 round-trip query is `WHERE rule_kind='derog_seasoning' AND rule_body->>'event_type'='FORECLOSURE'`. Without an index this is a seq scan (acceptable at Phase 2's empty-table state but Phase 3 fills agency_rule with ~50 rows).
   - What's unclear: Should Phase 2 ship an expression index now, or defer to Phase 3 when query volume justifies?
   - Recommendation: Ship a partial expression index on `agency_rule (rule_kind, (rule_body->>'event_type')) WHERE rule_kind='derog_seasoning'` in `0005_agency_schema.sql` as a `--custom` step. Cheap; supports Phase 3 query patterns; enforces a maintenance discipline ("if you add a kind that needs jsonb-extracted indexing, declare it here").

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Postgres 16 | All Phase 2 work | ✓ (docker compose from Phase 1) | 16.x [VERIFIED: Phase 1 docker-compose] | — |
| `btree_gist` extension | Pattern 3 EXCLUDE constraints | ✓ (bundled with Postgres 16) | 1.7+ | — |
| `gen_random_uuid()` (built-in) | All UUID PKs | ✓ (Postgres 13+ built-in per init-db.sh comment) | bundled | — |
| Drizzle 0.45 + drizzle-kit 0.31 | Schema + migrations | ✓ (Phase 1) | 0.45.2 / 0.31.10 [VERIFIED: package.json] | — |
| Zod 4.4.1 | Per-rule_kind schemas | ✓ (Phase 1) | 4.4.1 [VERIFIED: package.json] | — |
| Vitest 4.1.5 | tests/schema/ + tests/rls/ | ✓ (Phase 1) | 4.1.5 [VERIFIED: package.json] | — |
| pg 8.20.0 | Test driver for direct SQL | ✓ (Phase 1) | 8.20.0 [VERIFIED: package.json] | — |
| postgres 3.4.9 | Drizzle runtime | ✓ (Phase 1) | 3.4.9 [VERIFIED: package.json] | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

**Phase 2 is purely DDL + Zod + tests** — no new external dependencies beyond what Phase 1 already shipped. The single new Postgres extension (`btree_gist`) ships with Postgres 16 by default.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 [VERIFIED: package.json] |
| Config file | `vitest.config.ts` (Phase 1) — extend per D-21 to include `tests/schema/` |
| Quick run command | `pnpm test:rls` (existing) + `pnpm test:schema` (new per D-21) |
| Full suite command | `pnpm test:rls && pnpm test:schema && pnpm typecheck && pnpm lint` |
| Phase gate | All four green before `/gsd-verify-work` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCH-01 | layer enum constrained to (`INVESTOR_OVERLAY`, `PRODUCT_FEATURE`) on program_rule | unit/schema | `pnpm vitest run tests/schema/program-rule-layer-check.test.ts` | ❌ Wave 0 — schema-constraint suite |
| SCH-02 | "Most restrictive wins" rule_stack assembly | DEFERRED to Phase 4 | — | n/a — Phase 2 only ships shape |
| SCH-03 | Loosening surfaced as data-quality error | unit/schema | `pnpm vitest run tests/schema/detect-loosenings.test.ts` (D-20.5) | ❌ Wave 0 |
| SCH-04 | Structured DerogRule per event type | unit/schema | `pnpm vitest run tests/schema/derog-rule-roundtrip.test.ts` (D-20.6) | ❌ Wave 0 |
| SCH-05 | FNMA post-FC 90% LTV window encoded | unit/schema | Same test as SCH-04 | ❌ Wave 0 |
| SCH-06 | Typed IncomeDocMethod | unit (Zod parse) | `pnpm vitest run tests/rules/income-doc-method.test.ts` | ❌ Wave 0 |
| SCH-07 | Typed DscrMethod | unit (Zod parse) | `pnpm vitest run tests/rules/dscr-method.test.ts` | ❌ Wave 0 |
| SCH-08 | tenant.kind enum | already shipped Phase 1 | `pnpm vitest run tests/rls/cross-tenant-select.test.ts` | ✅ Phase 1 |
| SCH-09 | effective_period daterange + source_document_fingerprint + EXCLUDE | unit/schema | `pnpm vitest run tests/schema/program-version-exclude.test.ts` (D-20.3) + `tests/schema/agency-rule-version-exclude.test.ts` (D-20.4) | ❌ Wave 0 |
| SCH-10 | Per-field confidence + min_confidence generated column | unit/schema | `pnpm vitest run tests/schema/min-confidence-generated.test.ts` | ❌ Wave 0 |
| SCH-11 | eligible_*/ineligible_* arrays | structural | covered by table-creation migration test (drizzle-kit generates DDL with columns) | drizzle-kit migration is the test |
| SCH-12 | Geo state/county scaffolding | structural | same as SCH-11 | drizzle-kit migration is the test |
| SCH-13 | Citation FK + NOT NULL | unit/schema | `pnpm vitest run tests/schema/citation-fk.test.ts` (D-20.1, D-20.2) | ❌ Wave 0 |
| SCH-14 | extraction_run_id traceability | structural (column ships; FK in Phase 7) | structural test only | drizzle-kit migration is the test |
| RLS-extension | Pen tests on every new tenant-scoped table | integration | `pnpm test:rls` after extension | ✅ harness exists; tests need extension |

### Sampling Rate

- **Per task commit:** `pnpm test:rls --run --reporter=basic` + `pnpm test:schema --run --reporter=basic` (target: < 30s wall)
- **Per wave merge:** `pnpm typecheck && pnpm lint && pnpm test:rls && pnpm test:schema && pnpm db:reset && pnpm db:migrate` (full migration apply + suite)
- **Phase gate:** Full suite green + structural assertions: `psql -c "SELECT relname FROM pg_class WHERE relforcerowsecurity"` returns all 7 tenant-scoped tables (Phase 1's 2 + Phase 2's 5)

### Wave 0 Gaps

- [ ] `tests/schema/` directory creation
- [ ] `tests/schema/citation-fk.test.ts` — covers SCH-13 (D-20.1, D-20.2)
- [ ] `tests/schema/program-version-exclude.test.ts` — covers SCH-09 active-overlap (D-20.3)
- [ ] `tests/schema/agency-rule-version-exclude.test.ts` — covers SCH-09 agency-overlap (D-20.4)
- [ ] `tests/schema/detect-loosenings.test.ts` — covers SCH-03 (D-20.5)
- [ ] `tests/schema/derog-rule-roundtrip.test.ts` — covers SCH-04 + SCH-05 (D-20.6)
- [ ] `tests/schema/agency-cross-tenant-readable.test.ts` — covers system_role policy (D-20.7)
- [ ] `tests/schema/citation-source-check.test.ts` — covers D-20.8
- [ ] `tests/schema/min-confidence-generated.test.ts` — covers SCH-10
- [ ] `tests/schema/program-rule-layer-check.test.ts` — covers SCH-01
- [ ] `tests/rules/` — Zod-only unit tests for each rule_kind schema (parse + reject)
- [ ] `tests/rls/program-cross-tenant.test.ts` — D-19 extension
- [ ] `tests/rls/program-version-cross-tenant.test.ts` — D-19 extension
- [ ] `tests/rls/program-rule-cross-tenant.test.ts` — D-19 extension
- [ ] `tests/rls/lender-overlay-cross-tenant.test.ts` — D-19 extension
- [ ] `tests/rls/rule-citation-cross-tenant.test.ts` — D-19 extension
- [ ] `tests/rls/fixtures/seedTwoTenants.ts` — extend to seed program/program_version/program_rule/rule_citation per tenant (D-19)
- [ ] `vitest.config.ts` — extend `include` to cover `tests/schema/**/*.test.ts` and `tests/rules/**/*.test.ts` (D-21)
- [ ] `package.json` — add `"test:schema": "vitest run tests/schema tests/rules"` script (D-21)

## Project Constraints (from CLAUDE.md)

| Directive | Source | How Phase 2 Honors It |
|-----------|--------|----------------------|
| Run impact analysis before editing any symbol | CLAUDE.md §"Always Do" | New tables/columns are additive; planner runs `gitnexus_impact` on `setTenantContext` (the one Phase 1 symbol Phase 2 touches by way of pen-test extension) |
| Run `gitnexus_detect_changes()` before committing | CLAUDE.md §"Always Do" | Each plan task ends with the check; orchestrator includes in verify gate |
| NEVER edit a function/class/method without first running `gitnexus_impact` | CLAUDE.md §"Never Do" | Phase 2 is mostly new files; the only Phase 1 file touched is `tests/rls/fixtures/seedTwoTenants.ts` (extension only, signature unchanged) |
| NEVER rename symbols with find-and-replace — use `gitnexus_rename` | CLAUDE.md §"Never Do" | No renames in Phase 2 |
| NEVER commit changes without running `gitnexus_detect_changes()` | CLAUDE.md §"Never Do" | Plan task structure includes verify before commit |
| All LLM calls run server-side via Server Actions / route handlers | CLAUDE.md §Conventions | Phase 2 has no LLM calls (extraction is Phase 7) |
| Citation discipline as hard constraint | CLAUDE.md §Conventions | D-01 NOT NULL FK on `primary_citation_id` lands at DB level |
| Tenant filtering at the database, never the application | CLAUDE.md §Conventions | RLS policies on every new tenant-scoped table; Phase 1 patterns reused |
| Pure-TS evaluation engine at `lib/eval/` | CLAUDE.md §Conventions | Phase 4; Phase 2 designs the rule shape so evaluator is a pure consumer |
| Append-only audit log | CLAUDE.md §Conventions | Phase 3; Phase 2 doesn't touch evaluation_event |
| Staging schema for extraction | CLAUDE.md §Conventions | Phase 7; Phase 2 ships canonical only |
| Bitemporal versioning with daterange + EXCLUDE USING gist | CLAUDE.md §Conventions | D-15 + D-16 + Pattern 3 |
| Cross-tenant data exposure is release-blocker | CLAUDE.md §Conventions | RLS policies + pen-test extension on every new tenant-scoped table |
| TypeScript 5.7 everywhere | CLAUDE.md §Tech Stack | Phase 1 set; Phase 2 unchanged |
| Drizzle 0.45 with `prepare: false` | CLAUDE.md §Tech Stack | Phase 1 set; Phase 2 reuses |
| Postgres 16+ via Supabase | CLAUDE.md §Tech Stack | Phase 1 docker; Phase 2 schema |
| Use GSD workflow for all file changes | CLAUDE.md §GSD Workflow Enforcement | Phase 2 work proceeds via `/gsd-execute-phase` |

## Sources

### Primary (HIGH confidence)
- [Postgres 16 docs: Generated Columns](https://www.postgresql.org/docs/16/ddl-generated-columns.html) — confirmed: subqueries forbidden, immutable functions required
- [Postgres 16 docs: btree_gist extension](https://www.postgresql.org/docs/16/btree-gist.html) — confirmed: required for `EXCLUDE USING gist (uuid_col WITH =, ...)` patterns
- [Postgres 16 docs: Constraints / EXCLUDE](https://www.postgresql.org/docs/16/ddl-constraints.html) — EXCLUDE USING gist syntax + WHERE partial-constraint pattern
- [Postgres 16 docs: JSON Functions](https://www.postgresql.org/docs/16/functions-json.html) — `jsonb_each_text`, `jsonb_typeof`, `->`/`->>` operators
- [Postgres 16 docs: Range Types](https://www.postgresql.org/docs/16/rangetypes.html) — daterange canonical literal `[start,end)` half-open default
- [Drizzle 0.45 docs: Custom types](https://orm.drizzle.team/docs/custom-types) — customType API (`dataType`, `fromDriver`, `toDriver`)
- [Drizzle docs: PostgreSQL column types](https://orm.drizzle.team/docs/column-types/pg) — confirmed daterange not native
- [Drizzle docs: Generated Columns](https://orm.drizzle.team/docs/generated-columns) — `generatedAlwaysAs()` produces STORED columns
- [Drizzle docs: Row-Level Security (RLS)](https://orm.drizzle.team/docs/rls) — `pgPolicy({ to: pgRole(...).existing() })` documented
- [Phase 1 codebase: db/schema/tenant.ts + canary.ts](file:///Users/chrissaechao/IdeaProjects/lender-search/db/schema/tenant.ts) — pgPolicy pattern reference
- [Phase 1 codebase: db/migrations/0001_force_rls.sql](file:///Users/chrissaechao/IdeaProjects/lender-search/db/migrations/0001_force_rls.sql) — `--custom` migration pattern reference
- [Phase 1 codebase: lib/tenant/context.ts](file:///Users/chrissaechao/IdeaProjects/lender-search/lib/tenant/context.ts) — setTenantContext primitive (Phase 2 reuses unchanged)

### Secondary (MEDIUM confidence)
- [Drizzle issue #2647: daterange feature request](https://github.com/drizzle-team/drizzle-orm/issues/2647) — confirms no native daterange in 0.45
- [Drizzle issue #3504: RLS Policies not applied with push](https://github.com/drizzle-team/drizzle-orm/issues/3504) — Phase 1 D-10 reaffirmed
- [Java-jedi: Exclusion Constraints in Postgres](https://java-jedi.medium.com/exclusion-constraints-b2cbd62b637a) — EXCLUDE USING gist worked example with daterange + WHERE partial
- [Cybertec: exclusion constraints beyond UNIQUE](https://www.cybertec-postgresql.com/en/postgresql-exclusion-constraints-beyond-unique/) — production patterns
- [Shane Stillwell: Postgres Generation Expression Is Not Immutable (May 2025)](https://www.shanestillwell.com/snip/2025/05/02/postgres-generation-expression-is-not-immutable/) — immutable-function-wrapper workaround
- [Magnus Hagander: JSON field constraints](https://blog.hagander.net/json-field-constraints-228/) — `jsonb_typeof` CHECK pattern
- [Crunchy Data: Enums vs Check Constraints in Postgres](https://www.crunchydata.com/blog/enums-vs-check-constraints-in-postgres) — when to prefer which (Phase 2 uses both)
- [Beekeeper Studio: JSONB Functions in PostgreSQL](https://www.beekeeperstudio.io/blog/jsonb-functions-in-postgresql) — operators reference

### Tertiary (LOW confidence — flagged for validation)
- None — all Phase 2 mechanics verified against either Postgres 16 docs or Drizzle 0.45 docs or Phase 1 codebase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Phase 1 carry-forward confirmed by reading `package.json`, `db/schema/*.ts`, `lib/tenant/context.ts`, `tests/rls/*` directly
- Architecture (Drizzle 0.45 patterns): HIGH — verified via Drizzle docs + Postgres 16 docs; daterange/EXCLUDE/system_role patterns are textbook
- Postgres 16 mechanics: HIGH — docs are explicit on generated-column subquery prohibition (the BLOCKER → workaround is documented)
- Zod schemas (DerogRule / IncomeDocMethod / DscrMethod): MEDIUM — informed by Pitfall 1.1/1.8/1.9 + FNMA Selling Guide references; Phase 5 golden-set + Phase 3 hand-authoring will validate shape
- Validation Architecture: HIGH — mirrors Phase 1 Vitest pattern exactly; new schema-constraint suite is structural

**Research date:** 2026-04-30
**Valid until:** 2026-05-30 (30 days — Phase 2 is schema work; no fast-moving libraries; only watch is for Drizzle 0.46+ landing native daterange, which would simplify Pattern 1 but not break it)

---

## RESEARCH COMPLETE

Phase 2 research is complete. **All 21 CONTEXT.md decisions are implementable** with Drizzle 0.45 + Postgres 16, with one syntactic adjustment to D-10 — the generated stored column `min_confidence` cannot use a literal subquery per Postgres rules; it lands via an `IMMUTABLE` SQL wrapper function `jsonb_min_numeric(j jsonb)` declared in `0004_program_constraints.sql` immediately before the column-add statement. The plan picks up `system_role` Postgres role (Drizzle's `pgRole('system_role').existing()`), `customType` for `daterange` (Drizzle 0.45 issue #2647 has no native support), `btree_gist` extension at the head of `0004`, ephemeral test-fixture FNMA derog row (Phase 3 owns hand-authoring), six migrations in CONTEXT D-18 order, pen-test extension at `tests/rls/`, and a new `tests/schema/` suite covering 8 schema-constraint behaviors. Zod schemas at `lib/rules/schemas/` ship 17 per-`rule_kind` schemas plus the dispatch table consumed by Phase 4/7/8. Validation Architecture is a Vitest extension of Phase 1 patterns; no new dependencies; full suite gate is `pnpm test:rls && pnpm test:schema && pnpm typecheck && pnpm lint`. Open Question Q1 (the D-10 fix) is the only delta from CONTEXT decisions and has a documented workaround.
