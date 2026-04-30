---
phase: 02-rule-schema
plan: 04
subsystem: testing
tags: [zod, vitest, validation, fixtures]

requires:
  - phase: 02-rule-schema/01
    provides: 17 Zod schemas + dispatch table at lib/rules/schemas/, vitest.schema.config.ts + test:schema npm script

provides:
  - tests/rules/fixtures/fnma-foreclosure.ts (Phase 2 SC#2 keystone fixture — FNMA post-FC 3-to-7-year window encoded per RESEARCH §Pattern 7; reused by Plan 02-08 derog-rule-roundtrip.test.ts)
  - tests/rules/derog-seasoning.test.ts (8 cases — parse fixture; reject Pitfall 1.6 / 1.2 / 1.1 violations)
  - tests/rules/income-doc-method.test.ts (7 cases — Pitfall 1.8 typed shape coverage)
  - tests/rules/dscr-method.test.ts (6 cases — Pitfall 1.9 typed shape coverage)
  - tests/rules/numeric-kinds.test.ts (16 cases across ltv_max/cltv_max/hcltv_max/fico_min/dti_max/reserves_min)
  - tests/rules/allow-list-kinds.test.ts (18 cases across 4 allow-list kinds + geo_state + geo_county + mi_required + manual_uw_path)
  - tests/rules/dispatch-table.test.ts (7 cases — ruleKinds.length===17, exact 17-value list per D-09, every kind has matching schema, parseRuleBody routes correctly)

affects: [02-08 (reuses fnma-foreclosure fixture for round-trip test), phase 04 evaluator, phase 07 extraction validator, phase 08 AM commit]

tech-stack:
  added: []
  patterns: [Vitest unit tests for pure Zod schemas — no DB; per-schema parse-good + reject-bad coverage matrix; runtime dispatch-table exhaustiveness regression gate]

key-files:
  created:
    - tests/rules/fixtures/fnma-foreclosure.ts
    - tests/rules/derog-seasoning.test.ts
    - tests/rules/income-doc-method.test.ts
    - tests/rules/dscr-method.test.ts
    - tests/rules/numeric-kinds.test.ts
    - tests/rules/allow-list-kinds.test.ts
    - tests/rules/dispatch-table.test.ts

key-decisions:
  - "fnma-foreclosure.ts is an EPHEMERAL test fixture (per RESEARCH Open Question Q4 + CONTEXT Discretion) — Phase 3 owns full FNMA hand-authoring; Phase 2 ships only the SC#2 query-path proof"
  - "Tests group by kind family (numeric / allow-list+geo+special / structured derog-seasoning + income-doc-method + dscr-method) rather than one-test-file-per-schema for compactness without sacrificing VALIDATION D8 coverage"
  - "Runtime dispatch-table.test.ts catches the `as const satisfies Record<RuleKind, z.ZodType>` regression case where a ruleBodySchemas key gets removed after type-check passes"

patterns-established:
  - "Per-schema test pattern: ≥1 parse-good case + ≥1 reject-bad case per VALIDATION D8 dimension"
  - "Fixture file naming: tests/rules/fixtures/<source>-<event>.ts — plain TS export (no .test.ts extension so Vitest doesn't try to run as a test)"
  - "ZodError import + toThrow(ZodError) assertion shape mirrors Zod 4 conventions"

requirements-completed: [SCH-04, SCH-05, SCH-06, SCH-07, SCH-10]

duration: ~8min
completed: 2026-04-30
---

# Phase 02 Plan 04: Zod-Schema Unit Tests + FNMA SC#2 Fixture

**63 unit tests across 6 test files exercise all 17 Zod schemas + dispatch table at the rule-body validation boundary. The FNMA SC#2 fixture lives at `tests/rules/fixtures/fnma-foreclosure.ts` and is reused by Plan 02-08's Drizzle round-trip test.**

## What Was Built

- **fnma-foreclosure.ts** fixture — verbatim per RESEARCH §Pattern 7: `event_type='FORECLOSURE'`, `base_waiting_months=84` (7-year baseline), `extenuating_circumstances_waiting_months=36` (3-year EC), `post_event_LTV_caps[0]` with `months_since_min=36 / months_since_max=84 / max_LTV=90 / purposeAllowList=['PURCHASE','RATE_TERM_REFI'] / occupancyAllowList=['PRIMARY']`, `mortgage_included_in_bk_rule='BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED'`, citation 'FNMA Selling Guide B3-5.3-07'.
- **6 test files** (63 tests total): derog-seasoning (8) + income-doc-method (7) + dscr-method (6) + numeric-kinds (16) + allow-list-kinds (18) + dispatch-table (7). All assert via vitest `expect()` + `toThrow(ZodError)`.

## Verification

- `pnpm typecheck` exits 0
- `pnpm test:schema --run` exits 0 with **63/63 tests passing in 6 test files** (157ms duration)

## Cross-Plan Wiring

| From | To | Via |
|------|-----|-----|
| `tests/rules/fixtures/fnma-foreclosure.ts` | Plan 02-08 derog-rule-roundtrip.test.ts | `import { fnmaForeclosure }` — INSERT into agency_rule via Drizzle, SELECT by event_type, assert structured body |
| `tests/rules/dispatch-table.test.ts` | Phase 4 / 7 / 8 consumers | Runtime regression gate for `parseRuleBody(kind, body)` exhaustiveness |

## Notes

Vitest 4.1.5 doesn't accept `--reporter=basic` (the reporter name changed; default reporter is now used). All 7 files compile + run cleanly under the `pnpm test:schema` pipeline (vitest.schema.config.ts) without dragging in tests/rls/ globalSetup.
