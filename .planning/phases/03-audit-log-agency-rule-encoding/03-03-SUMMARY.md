---
phase: 3
plan: 03
title: FHLMC §5202.5 derog matrix — full event-type parity + golden snapshot
subsystem: phase-3-audit-log-agency-rule-encoding
tags:
  - fhlmc
  - derog-seasoning
  - agency-seed
  - b1a-per-agency-registry
  - golden-snapshot
  - tdd
dependency_graph:
  requires:
    - 03-01 (Wave 0 shared infra — types.ts, seed-agency.ts loader, scripts/seed/index.ts aggregator, agency-fhlmc.ts stub, vitest schema include extension to tests/agency/)
  provides:
    - lib/agency-seeds/fhlmc/derog-seasoning.ts (FHLMC fixture; consumed by scripts/seed/agency-fhlmc.ts)
    - 1 FHLMC agency_rule_version row + 8 child agency_rule rows in DB after pnpm db:seed
    - Per-agency AGY-01 test file tests/agency/agency-version-fhlmc.test.ts (B1a)
    - FHLMC derog golden snapshot hash e69f8f8cecbe18b699a194ca8286a87638bb6fa5f8b7ab020f9dc91134febb2e
  affects:
    - scripts/seed/agency-fhlmc.ts (replaced Wave 0 no-op stub body with real seed call)
tech-stack:
  added: []
  patterns:
    - B1a per-agency contributor file (scripts/seed/agency-{agency}.ts) — zero shared-aggregator edits
    - Per-agency assertion file pattern (tests/agency/agency-version-{agency}.test.ts)
    - Golden-snapshot regression hash with explicit RED→GREEN commit sequence
key-files:
  created:
    - lib/agency-seeds/fhlmc/derog-seasoning.ts
    - tests/agency/fhlmc-derog.test.ts
    - tests/agency/agency-version-fhlmc.test.ts
  modified:
    - scripts/seed/agency-fhlmc.ts
decisions:
  - Assumption A1 verification (FHLMC FORECLOSURE EC = 24m vs FNMA 36m) recorded as planner-locked value. Manual URL verification at https://guide.freddiemac.com/app/guide/section/5202.5 deferred to merge-time review per plan instruction; the fixture cites RESEARCH.md#Assumption-A1 and surfaces the FHLMC-specific reduction in the citation excerpt so AMs can audit the delta without re-reading the canonical guide.
  - Pitfall 1.6 encoded as MORTGAGE_CHARGE_OFF.mortgage_included_in_bk_rule = 'FC_CLOCK_ALWAYS' per FHLMC posture; explicitly distinct from FNMA's 'BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED' so downstream evaluators can dispatch correctly.
  - Test golden snapshot hash locked at e69f8f8cecbe18b699a194ca8286a87638bb6fa5f8b7ab020f9dc91134febb2e during the GREEN commit; future fixture edits that change rule_body will fail this assertion and require deliberate hash bump (no -u snapshot reflexes).
metrics:
  duration_minutes: 5
  duration_iso: PT5M25S
  tasks_completed: 3
  files_created: 3
  files_modified: 1
  commits: 4
  tests_added: 11
  completed_date: 2026-05-05
---

# Phase 3 Plan 03: FHLMC §5202.5 derog matrix — full event-type parity + golden snapshot Summary

Hand-authored the full FHLMC Single-Family Seller/Servicer Guide §5202.5 derogatory waiting-period matrix (8 event types) as a TypeScript fixture with FHLMC-specific deltas relative to FNMA (FORECLOSURE EC = 24m versus FNMA's 36m per Assumption A1; MORTGAGE_CHARGE_OFF carries `FC_CLOCK_ALWAYS` versus FNMA's `BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED` per Pitfall 1.6); replaced Plan 03-01's Wave 0 stub body at `scripts/seed/agency-fhlmc.ts` with the real `seedAgencyVersionAndRules` call (B1a parallel-safe — zero edits to shared aggregator); shipped 10 per-event-type structural assertions plus a sha256 golden-snapshot regression test and a per-agency AGY-01 file. RED→GREEN TDD gate sequence preserved.

## Tasks Completed

| # | Task | Commit | Files | TDD |
|---|------|--------|-------|-----|
| 1 | Author FHLMC derog seed fixture (8 event types; FORECLOSURE 24m EC; MORTGAGE_CHARGE_OFF FC_CLOCK_ALWAYS) | 5f32ddd | 1 created | n/a |
| 2 | Replace Wave 0 stub body at scripts/seed/agency-fhlmc.ts with real seed call (B1a) | 3d45996 | 1 modified | n/a |
| 3 | RED + GREEN TDD cycle on 11 tests (10 derog + 1 agency-version) with golden-snapshot hash lock-in | e6a1ae9 (RED), a38c440 (GREEN) | 2 created | RED→GREEN |

## What Shipped

### lib/agency-seeds/fhlmc/derog-seasoning.ts

8 event-type entries against `DerogSeasoning` Zod schema:

| Event | Base | EC | Anchor | mortgage_included_in_bk_rule |
|-------|------|----|--------|------------------------------|
| BK7 | 48m | 24m | DISCHARGE | NOT_APPLICABLE |
| BK13_DISCHARGED | 24m | null | DISCHARGE | NOT_APPLICABLE |
| BK13_DISMISSED | 48m | 24m | DISMISSAL | NOT_APPLICABLE |
| MULTIPLE_BK | 60m | 36m | DISCHARGE | NOT_APPLICABLE |
| FORECLOSURE | 84m | **24m** (FHLMC delta vs FNMA 36m) | COMPLETION | NOT_APPLICABLE |
| DEED_IN_LIEU | 48m | 24m | COMPLETION | NOT_APPLICABLE |
| SHORT_SALE | 48m | 24m | SALE_CONFIRMATION | NOT_APPLICABLE |
| MORTGAGE_CHARGE_OFF | 48m | 24m | CHARGE_OFF_DATE | **FC_CLOCK_ALWAYS** (FHLMC delta) |

Citations URL-only under SYSTEM tenant (D-07). Each excerpt ≤500 chars (max 265). All 8 entries Zod-validated via `parseRuleBody('derog_seasoning', ...)`.

### scripts/seed/agency-fhlmc.ts

Wave 0 no-op stub body replaced with the real `seedAgencyVersionAndRules` call:

```typescript
await seedAgencyVersionAndRules({
  agency: 'FHLMC',
  versionLabel: 'FHLMC-SSG-2026-Q1',
  effectivePeriod: '[2026-01-01,infinity)',
  sourceUrl: 'https://guide.freddiemac.com/app/guide/section/5202.5',
  seeds: fhlmcDerogSeasoningSeeds,
});
```

This plan introduced **zero edits** to the shared `scripts/seed-agency.ts` aggregator and zero edits to `scripts/seed/index.ts` (B1a parallel-safe with sibling Wave 1 plans 03-02 / 03-04 / 03-05).

### tests/agency/fhlmc-derog.test.ts (10 tests)

| # | Test | Notes |
|---|------|-------|
| 1 | BK7: 48m base, 24m EC, anchor=DISCHARGE | parity |
| 2 | BK13_DISCHARGED: 24m base, no EC, anchor=DISCHARGE | parity |
| 3 | BK13_DISMISSED: 48m base, 24m EC, anchor=DISMISSAL | parity |
| 4 | MULTIPLE_BK: 60m base, 36m EC, anchor=DISCHARGE | Pitfall 1.5 |
| 5 | FORECLOSURE: 84m base, 24m EC, anchor=COMPLETION | **FHLMC delta vs FNMA 36m EC; Assumption A1** |
| 6 | DEED_IN_LIEU: 48m base, 24m EC, anchor=COMPLETION | parity |
| 7 | SHORT_SALE: 48m base, 24m EC, anchor=SALE_CONFIRMATION | parity |
| 8 | MORTGAGE_CHARGE_OFF: 48m base, 24m EC, anchor=CHARGE_OFF_DATE | parity |
| 9 | MORTGAGE_CHARGE_OFF: mortgage_included_in_bk_rule = FC_CLOCK_ALWAYS | **FHLMC delta vs FNMA; Pitfall 1.6** |
| 10 | FHLMC derog bundle matches golden snapshot | sha256 regression hash (locked GREEN) |

### tests/agency/agency-version-fhlmc.test.ts (1 test)

Per-agency AGY-01 file (B1a) — asserts FHLMC-SSG-2026-Q1 row exists with `[2026-01-01,infinity)` effective_period and the canonical guide.freddiemac.com source URL. Cross-cutting AGY-01 coverage emerges from the union of `tests/agency/agency-version-{fnma,fhlmc,fha,va}.test.ts`; this plan owns only the FHLMC slice so sibling Wave 1 plans run without merge conflict.

## Manual Verification Notes

**Assumption A1 — FHLMC FORECLOSURE EC reduction (24m).** The plan's Task 1 calls for manual planner verification at `https://guide.freddiemac.com/app/guide/section/5202.5` before merge to confirm the 24m extenuating-circumstances reduction. The canonical FHLMC guide URL sits behind a clickable interface that did not fully resolve in the original Phase 3 research session (RESEARCH.md confidence MEDIUM on FHLMC-specific anchor language). The fixture encodes 24m per the planner's locked value with `notes_citations: ['SSG-5202.5#FORECLOSURE', 'RESEARCH.md#Assumption-A1']` and the citation excerpt explicitly surfaces the "industry-noted reduction relative to FNMA" so AMs reviewing the seed can audit the delta. **If merge-time verification finds the actual value to be 36m or 48m**, the fix is a one-line edit in `lib/agency-seeds/fhlmc/derog-seasoning.ts` plus a deliberate golden-hash bump in `tests/agency/fhlmc-derog.test.ts` (the sha256 assertion will fail and force a diff review — exactly the behavior the regression test is designed for).

The CI pipeline executes the same hand-authored fixture, so any post-merge correction follows the standard "edit fixture → re-run db:seed → bump golden hash → ship" cycle.

## Verification

```bash
pnpm typecheck
pnpm db:reset
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/lender_search_dev pnpm drizzle-kit migrate
pnpm db:seed
pnpm test:schema -t 'FHLMC derog matrix'
pnpm test:schema -t 'agency_rule_version: FHLMC'
```

Results:

| Command | Result |
|---------|--------|
| `pnpm typecheck` | exit 0 |
| `pnpm db:seed` | exit 0; 1 FHLMC ARV + 8 child rules; baseline rule_snapshot persisted |
| `pnpm db:seed` (re-run) | same counts; idempotent |
| `pnpm test:schema -t 'FHLMC derog matrix'` | 10/10 pass |
| `pnpm test:schema -t 'agency_rule_version: FHLMC'` | 1/1 pass |

Database state after seed:

```
 agency |    version_label    | child
--------+---------------------+-------
 FHLMC  | FHLMC-SSG-2026-Q1   |     8
 USDA   | USDA-SFH-7-CFR-3555 |     0
```

(USDA stub remains because Plan 03-04 / 03-05 stub bodies in this worktree are still no-ops — they ship in their own parallel Wave 1 plans.)

## Deviations from Plan

None. The plan executed exactly as written. The B1a per-agency contributor pattern + per-agency assertion file pattern was applied verbatim from Plan 03-02's FNMA precedent, modified only for FHLMC-specific values (event-type matrix, version label, citation base).

## TDD Gate Compliance

This plan is type=tdd at the per-task level (Task 03 carries `tdd="true"`). Plan-level gate sequence visible in git log:

| Gate | Commit | Tag |
|------|--------|-----|
| RED | e6a1ae9 — `test(03-03-03): add failing FHLMC derog matrix + AGY-01 tests (RED)` | TDD-Phase: red |
| GREEN | a38c440 — `feat(03-03-03): lock FHLMC derog golden snapshot hash (GREEN)` | TDD-Phase: green |

REFACTOR phase not needed — tests are pure structural assertions plus a hash check; no behavior cleanup.

Tasks 01 and 02 are non-TDD: Task 01 ships the fixture data file (validation = Zod parsing of every entry via `parseRuleBody`), Task 02 ships the seed wiring (validation = `pnpm db:seed` produces the expected row counts; idempotency proven across two runs). Task 03's RED commit covers both data-shape correctness AND the seed wiring — the structural test wouldn't pass under either a buggy fixture OR a buggy seed loader call, so the test suite acts as the integration gate for all three tasks.

## Authentication Gates

None encountered.

## Threat Flags

None — this plan adds an agency-rule fixture file, a seed-loader wiring shim, and 11 structural tests. No new network endpoints, auth paths, file-access patterns, or schema changes at trust boundaries. The threat surface (agency_rule + agency_rule_version RLS + system_role policy + URL-only citation per D-07) is unchanged from Plan 03-01's Wave 0 audit.

## Known Stubs

None remaining for FHLMC after this plan. The `scripts/seed/agency-fhlmc.ts` Wave 0 no-op stub body has been replaced with the real seed call; FHLMC-SSG-2026-Q1 is now a fully populated agency_rule_version with 8 child agency_rule rows.

Other agency contributor stubs (`scripts/seed/agency-fnma.ts`, `agency-fha.ts`, `agency-va.ts`) remain no-ops in this worktree and ship in sibling Wave 1 plans 03-02 / 03-04 / 03-05.

## Deferred Issues

- **GitNexus reindex.** Three PostToolUse hook reminders fired during this plan flagging stale index (last indexed at 0896303; this worktree branched from 5eb12de). Per the precedent set in Plan 03-01's "Deferred Issues" — running `npx gitnexus analyze` mid-plan would index a half-complete state, polluting the graph. The plan's 3 created files have no existing-symbol surface; the stub-body replacement at `scripts/seed/agency-fhlmc.ts` modifies a single function whose only caller is the aggregator at `scripts/seed/index.ts` (which already imports it). The orchestrator's wave-3 integration gate is the right place for re-indexing.
- **Pre-existing schema test failures.** Running the full `pnpm test:schema` suite produces ~22-28 failures across 10 unrelated test files (`citation-fk.test.ts`, `program-rule-layer-check.test.ts`, `agency-cross-tenant-readable.test.ts`, `derog-rule-roundtrip.test.ts`, `min-confidence-generated.test.ts`, etc.). Root cause: `tests/_shared/agency-fixture.ts::makeRandomEffectivePeriod` generates ranges in `[2100..,+1y)` which collide with the `[2026-01-01,infinity)` range that Plan 03-01's `pnpm db:seed` integration in `tests/schema/setup.ts` now inserts BEFORE these tests run. Verified the same failures present on the baseline `5eb12de` (27 failures with the same shape). This is **out of scope per Rule 1 SCOPE BOUNDARY** — the failure was caused by Plan 03-01's Wave 0 changes, not this plan's. The plan-prescribed verification (`pnpm test:schema -t 'FHLMC derog matrix'` + `-t 'agency_rule_version: FHLMC'`) is what this plan owns and that passes 11/11. A future plan should fix `tests/_shared/agency-fixture.ts` by either (a) generating ranges that explicitly exclude `infinity`, e.g., `[startYear-01-01, startYear+1-01-01)` already does that but they overlap with `infinity` per Postgres' `&&` daterange semantics, or (b) adopting per-test-tenant ARVs instead of accumulating SYSTEM-tenant rows across runs. Documented for the orchestrator's wave-3 follow-up plan.

## Self-Check: PASSED

Verified via direct file existence + commit log + database query.

### Files

| Path | Status |
|------|--------|
| lib/agency-seeds/fhlmc/derog-seasoning.ts | FOUND |
| scripts/seed/agency-fhlmc.ts | FOUND |
| tests/agency/fhlmc-derog.test.ts | FOUND |
| tests/agency/agency-version-fhlmc.test.ts | FOUND |

### Commits

| Hash | Status |
|------|--------|
| 5f32ddd | FOUND |
| 3d45996 | FOUND |
| e6a1ae9 | FOUND |
| a38c440 | FOUND |

### Database state

| Property | Verified |
|----------|----------|
| pnpm typecheck exits 0 | YES |
| FHLMC-SSG-2026-Q1 agency_rule_version row exists | YES |
| FHLMC has exactly 8 agency_rule child rows | YES |
| FHLMC FORECLOSURE rule has extenuating_circumstances_waiting_months = 24 | YES |
| FHLMC MORTGAGE_CHARGE_OFF carries mortgage_included_in_bk_rule = FC_CLOCK_ALWAYS | YES |
| pnpm db:seed idempotent (two runs preserve counts) | YES |
| pnpm test:schema -t 'FHLMC derog matrix' passes 10/10 | YES |
| pnpm test:schema -t 'agency_rule_version: FHLMC' passes 1/1 | YES |
| Golden snapshot hash locked at e69f8f8cecbe18b699a194ca8286a87638bb6fa5f8b7ab020f9dc91134febb2e | YES |
| Zero edits to scripts/seed-agency.ts (B1a parallel-safe) | YES |
| Zero edits to scripts/seed/index.ts (B1a parallel-safe) | YES |
| Zero edits to shared tests/agency/agency-version.test.ts (file does not exist; B1a) | YES |
