---
phase: 02-rule-schema
plan: 08
subsystem: testing
tags: [vitest, schema-constraint, exclude, generated-column, detect-loosenings]

requires:
  - phase: 02-rule-schema/07
    provides: live DB with 7 migrations applied + structural state verified

provides:
  - tests/schema/setup.ts (Vitest beforeAll exposing __pgPool + __pgAdminPool globals)
  - tests/schema/fixtures/seed.ts (seedTenantWithProgramAndCitation + seedAgencyDerogRule + truncateAllTables)
  - 9 schema-constraint test files at tests/schema/ covering D-20.1 through D-20.8 + D-10 + SCH-01/D-05

affects: [02-09 reuses connection helpers + may extend seedTwoTenants pattern]

key-decisions:
  - "Random 2100+ year range in seedAgencyDerogRule to avoid agency_rule_version_no_overlap EXCLUDE clashing across multiple test invocations within a run (each call needs unique daterange because seed COMMITs)"
  - "SAVEPOINT/ROLLBACK TO SAVEPOINT in program-version-exclude test so the expected EXCLUDE failure doesn't abort the outer transaction; lets us verify the partial WHERE allows different state in same transaction"
  - "Postgres 16's actual GENERATED column error message is 'cannot insert a non-DEFAULT value into column' (not 'cannot insert.*generated column' as RESEARCH suggested) — regex updated"

requirements-completed: [SCH-01, SCH-03, SCH-04, SCH-05, SCH-09, SCH-10, SCH-13]

duration: ~10min
completed: 2026-04-30
---

# Phase 02 Plan 08: tests/schema/ Constraint Suite

**86/86 tests passing across 15 files in 381ms. VALIDATION D2 (constraint correctness), D3 (function correctness), D5 (system_role correctness), D6 (DerogRule round-trip) all closed.**

## Test Results

| File | Tests | Status |
|------|-------|--------|
| tests/rules/* (Plan 02-04) | 63 | passed |
| tests/schema/citation-fk.test.ts | 3 | passed |
| tests/schema/program-version-exclude.test.ts | 2 | passed |
| tests/schema/agency-rule-version-exclude.test.ts | 2 | passed |
| tests/schema/citation-source-check.test.ts | 3 | passed |
| tests/schema/program-rule-layer-check.test.ts | 3 | passed |
| tests/schema/detect-loosenings.test.ts | 2 | passed |
| tests/schema/derog-rule-roundtrip.test.ts | 2 | passed |
| tests/schema/agency-cross-tenant-readable.test.ts | 3 | passed |
| tests/schema/min-confidence-generated.test.ts | 3 | passed |
| **Total** | **86** | **passed (15 files)** |

## Cross-Plan Wiring

- Plan 02-09 reuses `globalThis.__pgPool` from this plan's `tests/schema/setup.ts` — but Plan 02-09 lives in `tests/rls/` which uses its own setup file. No cross-plan import here; just convention sharing.
- The FNMA fixture from Plan 02-04 (`tests/rules/fixtures/fnma-foreclosure.ts`) round-trips through Drizzle insert + jsonb→object query verbatim; Phase 4 evaluator + Phase 5 golden set will exercise the same shape.
