---
status: complete
phase: 02-rule-schema
source: [02-01-SUMMARY.md, 02-02-SUMMARY.md, 02-03-SUMMARY.md, 02-04-SUMMARY.md, 02-05-SUMMARY.md, 02-06-SUMMARY.md, 02-07-SUMMARY.md, 02-08-SUMMARY.md, 02-09-SUMMARY.md]
started: 2026-05-01T14:33:00Z
updated: 2026-05-01T15:08:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test — Fresh DB + All Migrations
expected: Reset Postgres to pristine state, apply all 7 migrations cleanly. system_role role created, FORCE RLS active on tenant-scoped tables, detect_loosenings function present. No errors during init-db or migrate.
result: pass

### 2. Schema Constraint Test Suite
expected: `pnpm test:schema` passes — citation FK enforcement, EXCLUDE USING gist (program_version + agency_rule_version overlap prevention), program_rule layer CHECK constraint, derog round-trip, detect_loosenings (post CR-01 fix scoping JOIN by event_type), min_confidence GENERATED column (post WR-02 jsonb resilience fix), agency cross-tenant readability. All 86 schema tests green.
result: issue
reported: |
  3 failed | 91 passed (94). Failures all in code-fixer's own work:
  1. tests/schema/detect-loosenings.test.ts:107 — expected length 1, got 2. CR-01 JOIN scoping by event_type didn't take; overlay BK7 still cross-pairs against FORECLOSURE agency row.
  2. tests/schema/min-confidence-generated.test.ts:53 — `error: invalid input syntax for type numeric: "true"`. WR-02 jsonb_min_numeric still fails on non-numeric jsonb values (boolean).
  3. tests/schema/min-confidence-generated.test.ts:72 — same error on jsonb with `true` + string `"high"`. WR-02 resilience fix is incomplete.
severity: major

### 3. Zod Rule-Schema Test Suite
expected: Zod rule_kind schemas pass — 17 schemas, dispatch table exhaustiveness, allow-list defaults (post WR-03), DerogSeasoning + IncomeDocMethod + DscrMethod fixtures, FNMA foreclosure round-trip, geoState overlap test (post WR-04). Note: `pnpm test` script does not exist; tests/rules/ is included in `pnpm test:schema` glob via vitest.schema.config.ts.
result: pass
note: "Verified by Test 2's `pnpm test:schema` run — 15 test files (6 rules + 9 schema), 91 passing. All 3 failures were in tests/schema/ (CR-01, WR-02 x2); zero failures in tests/rules/. WR-03 + WR-04 fix tests passed."

### 4. RLS Cross-Tenant Test Suite
expected: `pnpm test:rls` passes — Phase 1 baseline (15 tests) + Phase 2 extensions for program, program_version, program_rule, rule_citation, lender_overlay_rule cross-tenant SELECT/UPDATE/DELETE blocked. Shared agency-fixture module (post WR-05) wires correctly. 56 RLS tests green.
result: pass

### 5. Typecheck After Fix Commits
expected: `pnpm typecheck` (or `pnpm tsc --noEmit`) passes with zero errors after the 6 fix commits (CR-01 through WR-05). Drizzle schema types, Zod schema types, and shared agency-fixture module compile cleanly.
result: pass

### 6. Lint After Fix Commits
expected: `pnpm lint` passes with zero errors. Recently-modified files (4 allow-list schemas, detect_loosenings migration, jsonb_min_numeric migration, allow-list-kinds.test.ts, agency-fixture.ts, seedTwoTenants.ts, fixtures/seed.ts) clean.
result: issue
reported: |
  0 errors, 3 warnings — all "Unused eslint-disable directive (no problems were reported from 'no-var')":
  - tests/rls/global-setup.ts:59
  - tests/schema/setup.ts:20
  - tests/schema/setup.ts:22
  Auto-fixable with `pnpm lint --fix` (or pass --fix flag).
severity: minor

### 7. detect_loosenings Returns Expected Output for FNMA Fixture
expected: After applying migrations, run the FNMA foreclosure fixture seed and call `detect_loosenings(...)` against a stricter agency baseline. Function returns the expected loosening rows (post CR-01 fix: only matches event_type='FORECLOSURE' rows, no Cartesian explosion across event types). Verified via tests/schema/detect-loosenings.test.ts.
result: pass
verified: 2026-05-01T15:07:00Z
note: |
  detect-loosenings: 3/3 pass. CR-01 fix verified — BK7 overlay no longer Cartesian-paired against FORECLOSURE agency baseline.

  Diagnostic: 0006 migration was applied before CR-01 was added to the file. drizzle-kit treats migration records as idempotent — file edits don't re-apply once recorded in __drizzle_migrations. User fixed by replaying the file directly (function uses CREATE OR REPLACE so direct psql replay is safe).

  Implication: Test 2's CR-01 failure was a stale-deployment artifact, not a source-code bug. Source fix at commit 47bddc5 is correct. Test 2's other 2 failures (WR-02 in min-confidence-generated.test.ts) are separate and remain unresolved — those are real source-code bugs in jsonb_min_numeric.

## Summary

total: 7
passed: 5
issues: 2
pending: 0
skipped: 0
blocked: 0
notes: "Test 2 reported 3 schema failures; Test 7 (run after manual replay of 0006 migration) showed CR-01 was a stale-deployment artifact that resolves once detect_loosenings is re-deployed via CREATE OR REPLACE. Real remaining gaps: WR-02 (jsonb_min_numeric not resilient to non-numeric values, 2 tests still failing) + minor lint cleanup (3 stale eslint-disable directives, auto-fixable)."
skipped: 0
blocked: 0

## Gaps

- truth: "detect_loosenings scopes derog_seasoning JOIN by event_type so overlay BK7 only pairs with agency BK7, not FORECLOSURE (CR-01)"
  status: resolved_by_replay
  reason: "Test 2 initially reported failure at tests/schema/detect-loosenings.test.ts:107 (expected length 1, got 2). Test 7 confirmed the source-code fix is correct — 3/3 pass after manual replay of db/migrations/0006_detect_loosenings.sql against the live database."
  severity: major
  test: 2
  artifacts:
    - path: db/migrations/0006_detect_loosenings.sql
      issue: "Source fix at commit 47bddc5 IS correct (event_type qualifier on derog_seasoning JOIN). No further source change required."
  root_cause: |
    Stale deployment, not a source-code bug. drizzle-kit treats __drizzle_migrations as idempotent: once 0006 was recorded as applied, subsequent edits to the .sql file (the CR-01 fix) do not re-apply on `pnpm db:migrate`. The deployed function in the running database remained the pre-fix version.

    User resolved by replaying the migration file directly via psql. Safe because the function body is CREATE OR REPLACE FUNCTION — no destructive change required.
  missing:
    - "Document migration-replay protocol for CREATE OR REPLACE / DDL-idempotent edits in CLAUDE.md or .planning/ops doc — future developers need to know that editing 0006 in place requires manual replay (or a 0007 follow-up migration that calls CREATE OR REPLACE)"
    - "Consider adopting a convention: any post-merge fix to a migration .sql file ships as a NEW migration (0007, 0008, …) rather than an in-place edit, so drizzle-kit's idempotency guarantee actually applies"
  fix_commit_to_review: 47bddc5
  debug_session: ""

- truth: "jsonb_min_numeric tolerates non-numeric jsonb values (booleans, strings) without raising — returns NULL or skips them per WR-02 spec"
  status: failed
  reason: "User reported test failure: tests/schema/min-confidence-generated.test.ts:53 + :72 both `error: invalid input syntax for type numeric: \"true\"`. WR-02 fix in db/migrations/0004_program_constraints.sql did not actually wrap the numeric cast — the function still attempts `'true'::numeric` and Postgres raises."
  severity: major
  test: 2
  artifacts:
    - path: db/migrations/0004_program_constraints.sql
      issue: "jsonb_min_numeric body still casts every jsonb value to numeric without jsonb_typeof guard"
    - path: tests/schema/min-confidence-generated.test.ts
      issue: "tests 53 + 72 still failing — fix commit 18085a6 did not satisfy assertions"
  missing:
    - "In jsonb_min_numeric, filter or branch on jsonb_typeof(value) = 'number' before casting; alternatively wrap the cast in a per-row exception handler that skips non-numeric values"
    - "Re-run pnpm test:schema and confirm 0 failures"
  fix_commit_to_review: 18085a6
  root_cause: ""
  debug_session: ""

- truth: "ESLint runs clean (0 errors, 0 warnings) on tests/ after fix commits"
  status: failed
  reason: "User reported 3 warnings — all `Unused eslint-disable directive (no problems were reported from 'no-var')` at tests/rls/global-setup.ts:59, tests/schema/setup.ts:20, tests/schema/setup.ts:22. Stale `eslint-disable no-var` directives left over from earlier code; the underlying lines no longer trigger no-var. Auto-fixable with `pnpm lint --fix`."
  severity: minor
  test: 6
  artifacts:
    - path: tests/rls/global-setup.ts
      issue: "stale eslint-disable no-var directive on line 59"
    - path: tests/schema/setup.ts
      issue: "stale eslint-disable no-var directives on lines 20 + 22"
  missing:
    - "Run `pnpm lint --fix` (or remove the 3 directives by hand) and re-verify clean lint"
  root_cause: ""
  debug_session: ""
