---
phase: 02-rule-schema
plan: 01
subsystem: database
tags: [drizzle, zod, postgres, daterange, system-role, vitest]

requires:
  - phase: 01-tenant-isolation-foundation
    provides: Drizzle 0.45 schema-as-code pattern, pgPolicy + pgEnum + customType API surface, Vitest 4.1.x configuration baseline, scripts/init-db.sh bootstrap script, two-connection-string env contract (DATABASE_MIGRATION_URL + DATABASE_URL)

provides:
  - daterange Drizzle customType wrapper at db/schema/_types/daterange.ts (Plans 02-02 + 02-03 import this for program_version.effective_period and agency_rule_version.effective_period)
  - system_role Postgres role declaration via pgRole('system_role').existing() at db/schema/system-role.ts (Plan 02-03 + Plan 02-05 reference this for agency-table cross-tenant readability policy)
  - scripts/init-db.sh extension that bootstraps system_role role (CREATE ROLE NOLOGIN NOBYPASSRLS NOSUPERUSER + GRANT system_role TO postgres + GRANT CONNECT/USAGE/SELECT permissions)
  - 17 per-rule_kind Zod schemas at lib/rules/schemas/<kind>.ts covering D-09 enum (numeric kinds, structured DerogSeasoning + IncomeDocMethod + DscrMethod, allow-list arrays, geo, special)
  - lib/rules/schemas/index.ts dispatch table with `as const satisfies Record<RuleKind, z.ZodType>` exhaustiveness guard + `parseRuleBody(kind, body)` single entry point consumed by Phase 4 evaluator + Phase 7 extraction validator + Phase 8 AM commit
  - vitest.schema.config.ts standalone Vitest config for tests/schema/ + tests/rules/ glob (separate from Phase 1's vitest.config.ts to avoid dragging in tests/rls/ globalSetup)
  - package.json `test:schema` script (`vitest run --config vitest.schema.config.ts`)

affects: [02-02, 02-03, 02-04, 02-05, 02-08, 02-09, phase 04 evaluator, phase 07 extraction, phase 08 AM commit]

tech-stack:
  added: [Zod 4.4.1 (already in deps), Drizzle 0.45 customType API, Drizzle 0.45 pgRole API]
  patterns: [Drizzle customType for unsupported native types, pgRole().existing() for externally-managed Postgres roles, per-rule_kind Zod dispatch with compile-time exhaustiveness, separate Vitest config for non-RLS test surface]

key-files:
  created:
    - db/schema/_types/daterange.ts
    - db/schema/system-role.ts
    - lib/rules/schemas/index.ts (dispatch table)
    - lib/rules/schemas/derog-seasoning.ts (FNMA post-FC 3-to-7-year window per RESEARCH §Pattern 7)
    - lib/rules/schemas/income-doc-method.ts (Pitfall 1.8 — typed object not flat label)
    - lib/rules/schemas/dscr-method.ts (Pitfall 1.9 — typed object with min_dscr_by_ltv_tier)
    - lib/rules/schemas/{ltv-max,cltv-max,hcltv-max,fico-min,dti-max,reserves-min}.ts (numeric kinds)
    - lib/rules/schemas/{occupancy-allow,purpose-allow,property-type-allow,doc-type-allow}.ts (allow-list kinds)
    - lib/rules/schemas/{geo-state,geo-county}.ts (geo kinds)
    - lib/rules/schemas/{mi-required,manual-uw-path}.ts (special kinds)
    - vitest.schema.config.ts
  modified:
    - scripts/init-db.sh (appended system_role bootstrap)
    - package.json (added test:schema script after test:rls:watch)

key-decisions:
  - "Drizzle 0.45's customType wrapper unblocks daterange usage in Plans 02-02/02-03 — issue #2647 confirms no native daterange support; pass-through fromDriver/toDriver suffices for our usage (Postgres serializes daterange as text)"
  - "system_role declared via pgRole().existing() (not pgRole().new()) so Drizzle does NOT manage role lifecycle — scripts/init-db.sh owns bootstrap; pgPolicy({ to: systemRole }) just references it"
  - "lib/rules/schemas/index.ts uses `as const satisfies Record<RuleKind, z.ZodType>` for compile-time exhaustiveness — adding a new rule_kind to the enum without a matching schema is a TypeScript build error"
  - "vitest.schema.config.ts is a standalone config (not an extension of vitest.config.ts) so test:schema doesn't inherit tests/rls/global-setup.ts (which would re-run drizzle-kit migrate on every Vitest invocation; Plan 02-07 already migrated)"
  - "Zod schemas are TypeScript-only — DB-level validation is intentionally minimal (NOT NULL + jsonb_typeof + rule_kind enum); shape changes don't churn migrations (D-08 / RESEARCH §Pattern 6)"

patterns-established:
  - "customType wrapper pattern at db/schema/_types/ for Postgres types Drizzle 0.45 doesn't model natively (daterange, future: tstzrange, ltree, etc.)"
  - "pgRole().existing() for Postgres roles whose lifecycle is owned by infrastructure scripts (scripts/init-db.sh) — Drizzle declares the reference without trying to CREATE/DROP"
  - "Per-rule_kind Zod dispatch pattern with parseRuleBody(kind, body) entry point — extensible by adding enum value + matching schema file, exhaustiveness enforced at compile time"
  - "Separate Vitest config per test domain (tests/rls/ vs tests/schema/+tests/rules/) — avoids globalSetup bleed across test surfaces"

requirements-completed: [SCH-04, SCH-05, SCH-06, SCH-07, SCH-09, SCH-10]

duration: ~25min
completed: 2026-04-30
---

# Phase 02 Plan 01: Wave 0 Foundation — daterange customType + system_role + 17 Zod schemas + vitest.schema.config

**Wave 0 prerequisites for every later Phase 2 plan landed: Drizzle daterange customType, system_role pgRole declaration, scripts/init-db.sh role bootstrap, 17 per-rule_kind Zod schemas with compile-time-exhaustive dispatch table, and the separate Vitest config + npm script for the schema-constraint + Zod-unit test surface.**

## What Was Built

### Drizzle infrastructure
- `db/schema/_types/daterange.ts` — `customType<{ data: string }>` wrapper with `dataType: () => 'daterange'` + pass-through `fromDriver`/`toDriver`. Drizzle 0.45 has no native `daterange` (issue #2647) so this is the documented path. Plan 02-02 imports it for `program_version.effective_period`; Plan 02-03 imports it for `agency_rule_version.effective_period`.
- `db/schema/system-role.ts` — `pgRole('system_role').existing()` declaration. Drizzle does NOT manage the role lifecycle; `scripts/init-db.sh` owns bootstrap. `pgPolicy({ to: systemRole })` in Plans 02-03 + 02-05 references this without creating it.
- `scripts/init-db.sh` extended with idempotent `CREATE ROLE system_role NOLOGIN NOBYPASSRLS NOSUPERUSER` + `GRANT system_role TO postgres` + `GRANT CONNECT ON DATABASE`/`USAGE ON SCHEMA public`/`SELECT ON ALL TABLES` block. Phase 3 hand-authoring (FNMA / FHLMC / FHA / VA agency rule rows) runs as postgres which inherits system_role grants.

### Zod rule-body schemas
- 17 per-`rule_kind` schemas at `lib/rules/schemas/<kind>.ts` matching D-09's enum verbatim. Numeric kinds (`ltv_max`, `cltv_max`, `hcltv_max`, `fico_min`, `dti_max`, `reserves_min`) carry simple `value` + bounds. Allow-list kinds (`occupancy_allow`, `purpose_allow`, `property_type_allow`, `doc_type_allow`) carry `allowed[]` arrays. Geo kinds (`geo_state`, `geo_county`) carry FIPS-shape data.
- Structured shapes encoded per RESEARCH §Pattern 6/7/8:
  - `derog-seasoning.ts` — Pitfall 1.1 / Phase 2 SC#2 keystone. `event_type` enum (BK7, BK13_DISCHARGED, BK13_DISMISSED, MULTIPLE_BK, FORECLOSURE, DEED_IN_LIEU, SHORT_SALE, MORTGAGE_CHARGE_OFF, MOD, FORBEARANCE), `measurement_anchor`, `base_waiting_months`, `extenuating_circumstances_waiting_months`, `post_event_LTV_caps[]` (with `months_since_min/max`, `max_LTV`, `purposeAllowList[]`, `occupancyAllowList[]`), `reestablished_credit_required`, `mortgage_included_in_bk_rule`, `notes_citations[]`. SC#2 row "FNMA post-foreclosure 3-to-7-year band, max LTV 90%, primary purchase or RT-refi only" round-trips through this shape.
  - `income-doc-method.ts` — Pitfall 1.8. `method` enum (BANK_STATEMENT_12MO, BANK_STATEMENT_24MO, FULL_DOC, WVOE, ASSET_DEPLETION, P_AND_L, ITIN_DOC, etc.), `expense_factor` (numeric), `expense_factor_source` (CPA / BORROWER_ATTEST / FIXED_PERCENTAGE), `comingling_treatment` (ALLOWED / DISALLOWED / EVIDENCE_REQUIRED), `nsf_treatment`, `qualifying_period_months`. "12-month bank statement" no longer flattens to a label.
  - `dscr-method.ts` — Pitfall 1.9. `numerator_rule` (GROSS_RENTS / NET_OPERATING_INCOME / MARKET_RENT), `denominator_method` (PITIA / PITI / PITIA_HOA), `min_dscr_by_ltv_tier[]` (LTV-tiered DSCR floors), `io_handling`, `arm_qualification`, `no_ratio_option`.
- `lib/rules/schemas/index.ts` — `ruleKinds` const-tuple (17 values, ordered per D-09), `RuleKind = typeof ruleKinds[number]` type, `ruleBodySchemas` dispatch object with `as const satisfies Record<RuleKind, z.ZodType>` (compile-time exhaustiveness — adding an enum value without a schema is a TS error), `parseRuleBody(kind, body)` single entry point. Phase 4 evaluator + Phase 7 extraction + Phase 8 AM commit consume this surface.

### Test config
- `vitest.schema.config.ts` — standalone Vitest config (NOT an extension of `vitest.config.ts`) targeting `tests/schema/**/*.test.ts` + `tests/rules/**/*.test.ts`. `pool: 'forks' + isolate: true + sequence.concurrent: false` mirrors Phase 1's pattern. Excludes `tests/rls/global-setup.ts` (which runs `drizzle-kit migrate`) because Plan 02-07's [BLOCKING] migrate already ran by the time `pnpm test:schema` fires in Wave 3.
- `package.json` — `"test:schema": "vitest run --config vitest.schema.config.ts"` inserted after `test:rls:watch`. Existing `test:rls` and `test:rls:watch` unchanged.

## Verification

- `pnpm typecheck` exits 0 — all 17 Zod schemas + dispatch table + customType + system-role compile clean
- `node -e "JSON.parse(require('fs').readFileSync('package.json'))"` passes — package.json valid JSON
- All 21 acceptance-criteria file existence + content greps pass (see `02-01-PLAN.md` `<acceptance_criteria>` and `<verify>` blocks for the 3 tasks)
- `tests/schema/` is empty (Plan 02-08 owns) — `pnpm test:schema` would exit "no tests found" which is expected at this stage

## Cross-Plan Wiring

| From | To | Via | Pattern |
|------|-----|-----|---------|
| `db/schema/_types/daterange.ts` | Plan 02-02 `program_version.effective_period` | `import { daterange } from './_types/daterange.js'` + `daterange('effective_period').notNull()` | column declaration |
| `db/schema/_types/daterange.ts` | Plan 02-03 `agency_rule_version.effective_period` | same import path | column declaration |
| `db/schema/system-role.ts` | Plan 02-03 `agency_rule` pgPolicy | `pgPolicy('agency_system_role_all', { to: systemRole })` | RLS policy `to:` clause |
| `db/schema/system-role.ts` | Plan 02-05 `0005_force_rls_agency.sql` | system_role grants on agency tables (Plan 02-05 owns the SQL; this declares the role) | role-based GRANT |
| `lib/rules/schemas/index.ts` | Plan 02-04 unit tests | `import { parseRuleBody, ruleKinds } from 'lib/rules/schemas'` | per-schema parse/reject tests |
| `lib/rules/schemas/index.ts` | Plan 02-08 DerogRule round-trip test | `parseRuleBody('derog_seasoning', insertedRow.rule_body)` | structured-shape round-trip |
| `vitest.schema.config.ts` | Plan 02-08 + 02-04 + 02-09 test runs | `pnpm test:schema` | npm script |
| `scripts/init-db.sh` system_role bootstrap | Plan 02-09 cross-tenant agency-readability test | psql `SET ROLE system_role; SELECT * FROM agency_rule;` | role-switch in test |

## Phase 1 Carry-Forward (Unchanged)

- NodeNext `.js` extensions on relative imports (TS2835)
- snake_case Postgres column names
- Two-connection-string env contract (DATABASE_MIGRATION_URL + DATABASE_URL)
- `pool: 'forks'` + `isolate: true` for Vitest Postgres-connection isolation
- `current_setting('app.tenant_id', true)::uuid` canonical RLS predicate (Phase 2 RLS policies in Plans 02-02 + 02-03 follow same pattern; agency tables in Plan 02-03 use `to: systemRole` instead of GUC predicate)

## Issues Encountered

The initial executor agent hit a runtime usage limit after Task 1 committed (cdce6ee). Tasks 2 + 3 written to disk by that agent but uncommitted. Continuation completed Task 2 commit (lib/rules/schemas/) and Task 3 (vitest.schema.config.ts + package.json edit) directly without re-spawning, since the work product was already on disk and verified via `pnpm typecheck`.

## Next: Wave 1 Plans

Plans 02-02 + 02-03 + 02-04 unblock simultaneously after this plan commits. Per Plan 02-05's revision, intra-Wave-1 `db/schema/index.ts` overlap between 02-02 and 02-03 forces sequential execution within Wave 1; 02-04 (tests at `tests/rules/`) is independent.
