---
phase: 3
plan: 02
title: FNMA B3-5.3-07 derog matrix — full event-type parity + golden snapshot
subsystem: phase-3-audit-log-agency-rule-encoding
tags:
  - agency-rules
  - fnma-selling-guide
  - derog-seasoning
  - foreclosure-b2-split
  - golden-snapshot
  - wave-1
dependency_graph:
  requires:
    - 03-01 (Wave 0 — types, loader skeleton, agency stubs, derogSeasoningSchema nullability + _seed_key)
  provides:
    - lib/agency-seeds/fnma/derog-seasoning.ts (Phase 4 evaluator's hydrated RuleSnapshot for FNMA)
    - scripts/seed/agency-fnma.ts (real FNMA contributor body — replaces Wave 0 stub)
    - tests/agency/fnma-derog.test.ts (Phase 3 SC#3 line-item assertions + golden hash regression sentry)
    - tests/agency/agency-version-fnma.test.ts (AGY-01 FNMA + USDA per-agency assertion file — B1a)
  affects:
    - tests/_shared/agency-fixture.ts (Rule 1 deviation — random daterange anchored pre-2026)
    - tests/schema/{agency-rule-state,agency-rule-version-exclude,superseded-by-deferrable}.test.ts (Rule 1 — direct ARV INSERTs anchored pre-2026)
tech-stack:
  added: []
  patterns:
    - Per-agency seed contributor file (B1a registry pattern; sibling Wave 1 plans 03-03/04/05 own fhlmc/fha/va equivalents)
    - Distinct seedKey discriminator per row when multiple rows share the same event_type (B2 FORECLOSURE 2-row split)
    - Golden sha256 snapshot of seeded rule_body bundle as a regression sentry (per-agency, ordered)
    - URL-only citations under SYSTEM tenant (D-07; source_pdf_sha256/page_number/bbox NULL satisfies Phase 2 D-03 CHECK)
    - Pre-2026 historical-year anchoring in test fixtures (sidesteps Postgres `daterange &&` semantics where `[2026,infinity)` overlaps with future-year ranges)
key-files:
  created:
    - lib/agency-seeds/fnma/derog-seasoning.ts
    - tests/agency/fnma-derog.test.ts
    - tests/agency/agency-version-fnma.test.ts
  modified:
    - scripts/seed/agency-fnma.ts (Wave 0 stub body → real seedAgencyVersionAndRules call)
    - tests/_shared/agency-fixture.ts (Rule 1 — makeRandomEffectivePeriod anchored to year [1000..1999])
    - tests/schema/agency-rule-state.test.ts (Rule 1 — FHLMC range [2300..2350) → [1900..1950))
    - tests/schema/agency-rule-version-exclude.test.ts (Rule 1 — FNMA ranges [3000000..) and [4000000..) → [1500..1750) and [1800..1900))
    - tests/schema/superseded-by-deferrable.test.ts (Rule 1 — prior+new ARV range [2200..2250) → [1700..1750))
decisions:
  - FORECLOSURE encoded as 2 rows with distinct seedKeys 'FORECLOSURE_PURCHASE' and 'FORECLOSURE_LCOR' so the loader's COALESCE(_seed_key, event_type) dedupe predicate doesn't collapse them into one (REVIEWS.md B2 iter-2 fix)
  - Citation excerpts kept ≤290 chars (well under the 500-char cap); URL-only sourceUrl per D-07 with anchor-style fragment IDs (#BK_CHAPTER_7, #FORECLOSURE_PURCHASE_PRIMARY, etc.)
  - This plan modifies ONLY scripts/seed/agency-fnma.ts (the FNMA contributor); scripts/seed-agency.ts and scripts/seed/index.ts are untouched (B1a parallel-safe — sibling Wave 1 plans don't conflict)
  - Golden hash 71b24015b029b0f07ebbcc8f84c78a26c75c7835488d64fac5670f7230f7e201 locked from RED→GREEN cycle; updated only on intentional rule-content changes
  - Rule 1 deviation: pre-2026 historical-year anchoring in 4 test files outside the plan's allowlist; precedent set by Plan 03-01 deviation #1 (modified tests/_shared/agency-fixture.ts as a Rule 1 fix outside its allowlist)
metrics:
  duration_minutes: 14
  duration_iso: PT14M20S
  tasks_completed: 3
  files_created: 3
  files_modified: 5
  commits: 5
  tests_added: 16
  completed_date: 2026-05-05
---

# Phase 3 Plan 02: FNMA B3-5.3-07 derog matrix — full event-type parity + golden snapshot Summary

Phase 3 SC#3 correctness gate for FNMA: hand-authored 9-row derog seasoning matrix (8 event types with FORECLOSURE split into 2 rows per REVIEWS.md B2) lands under FNMA-SEL-2026-04 with effective_period `[2026-01-01,infinity)`, plus 13 structural + golden-snapshot assertions (Phase 3 SC#3 line items) and 3 AGY-01 cross-tenant assertions, with a 4-file Rule 1 deviation that pre-emptively unblocks sibling Wave 1 plans 03-03/04/05 from the `agency_rule_version_no_overlap` EXCLUDE collision their own infinity seeds will introduce.

## Tasks Completed

| # | Task | Commit | Files | TDD |
|---|------|--------|-------|-----|
| 1 | FNMA derog seed fixture (9 rows, B2 split) | 7110cc3 | lib/agency-seeds/fnma/derog-seasoning.ts (created) | n/a |
| 2 | Wire FNMA contributor (B1a) — replace Wave 0 stub body | a7e4717 | scripts/seed/agency-fnma.ts (modified) | n/a |
| 3 (RED) | FNMA derog tests + agency-version-fnma tests with placeholder hash | f9b3c27 | tests/agency/fnma-derog.test.ts (created), tests/agency/agency-version-fnma.test.ts (created) | RED |
| 3 (GREEN) | Lock golden snapshot hash after capture | f80bff2 | tests/agency/fnma-derog.test.ts (modified) | GREEN |
| 3 (Rule 1) | Anchor test fixture daterange pre-2026 | 7075112 | tests/_shared/agency-fixture.ts + 3 tests/schema/*.test.ts | n/a (deviation) |

## What Shipped

### lib/agency-seeds/fnma/derog-seasoning.ts (NEW, 235 lines)

Hand-authored TypeScript fixture exporting `fnmaDerogSeasoningSeeds: AgencyRuleSeed<DerogSeasoning>[]` with exactly 9 entries. Each entry is typed against the existing `derogSeasoningSchema` Zod schema (Plan 03-01 Task 08 Delta 6); compile-time + runtime Zod validation in the loader.

Per-event-type breakdown:

| event_type | base_waiting_months | EC_months | measurement_anchor | post_event_LTV_caps | mortgage_in_bk |
|------------|---------------------|-----------|--------------------|---------------------|----------------|
| BK7 | 48 | 24 | DISCHARGE | [] | NOT_APPLICABLE |
| BK13_DISCHARGED | 24 | null | DISCHARGE | [] | NOT_APPLICABLE |
| BK13_DISMISSED | 48 | 24 | DISMISSAL | [] | NOT_APPLICABLE |
| MULTIPLE_BK | 60 | 36 | DISCHARGE | [] | NOT_APPLICABLE |
| FORECLOSURE (row A — seedKey=FORECLOSURE_PURCHASE) | 84 | 36 | COMPLETION | [{36..84, max_LTV=90, PURCHASE, PRIMARY}] | NOT_APPLICABLE |
| FORECLOSURE (row B — seedKey=FORECLOSURE_LCOR) | 84 | 36 | COMPLETION | [{36..84, max_LTV=90, RATE_TERM_REFI, PRIMARY+SECOND_HOME+INVESTMENT}] | NOT_APPLICABLE |
| DEED_IN_LIEU | 48 | 24 | COMPLETION | [] | NOT_APPLICABLE |
| SHORT_SALE | 48 | 24 | SALE_CONFIRMATION | [] | NOT_APPLICABLE |
| MORTGAGE_CHARGE_OFF | 48 | 24 | CHARGE_OFF_DATE | [] | BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED |

URL-only citations (Pitfall D-07): each citation's `sourceUrl` carries an anchor fragment (e.g., `#BK_CHAPTER_7`, `#FORECLOSURE_PURCHASE_PRIMARY`); `excerpt` is verbatim FNMA Selling Guide language ≤500 chars (actual max in the file: 290 chars).

### scripts/seed/agency-fnma.ts (MODIFIED — Wave 0 stub body replaced)

Previously a Wave 0 no-op stub. Now invokes `seedAgencyVersionAndRules({ agency: 'FNMA', versionLabel: 'FNMA-SEL-2026-04', effectivePeriod: '[2026-01-01,infinity)', sourceUrl: 'https://selling-guide.fanniemae.com/sel/b3-5.3-07/', seeds: fnmaDerogSeasoningSeeds })`. The central aggregator at `scripts/seed-agency.ts` and the dispatcher at `scripts/seed/index.ts` are unchanged (B1a parallel-safe). Wave 0 already imports `seedFnma` from this file.

### tests/agency/fnma-derog.test.ts (NEW, 13 it() blocks)

12 structural assertions covering Phase 3 SC#3 line items + 1 sha256 golden snapshot regression sentry. The golden hash `71b24015b029b0f07ebbcc8f84c78a26c75c7835488d64fac5670f7230f7e201` is locked in; intentional rule changes require an explicit hash update.

Notable B2-split coverage:
- `'FORECLOSURE: encoded as TWO rows per B2 ...'` — `expect(rows).toHaveLength(2)` + 84m/36m/COMPLETION/90% LTV cap on both
- `'FORECLOSURE row A: PURCHASE on PRIMARY only ...'` — `purposeAllowList === ['PURCHASE']` AND `occupancyAllowList === ['PRIMARY']`
- `'FORECLOSURE row B: RATE_TERM_REFI permitted for all eligible occupancies ...'` — `purposeAllowList === ['RATE_TERM_REFI']` AND occupancy includes INVESTMENT
- SQL gate: `'FORECLOSURE: SQL query for B2 returns BOTH rows ...'` — JOIN-style SELECT returns 2 rows; the limited-cash-out row's occupancyAllowList contains 'INVESTMENT' (the explicit B2 acceptance criterion)

### tests/agency/agency-version-fnma.test.ts (NEW, 3 it() blocks)

AGY-01 cross-cutting coverage scoped to FNMA + USDA only. Per B1a: each Wave 1 plan owns its own per-agency assertion file; the cross-cutting AGY-01 coverage emerges from the union of the four files. Sibling Wave 1 plans 03-03/04/05 add `agency-version-fhlmc.test.ts`, `agency-version-fha.test.ts`, `agency-version-va.test.ts` independently — zero merge conflict.

## Deviations from Plan

### Auto-fixed Issues

#### 1. [Rule 1 - Bug] Test fixture daterange anchored pre-2026

- **Found during:** Task 3 final regression check (`pnpm test:schema`).
- **Issue:** Plan's Task 02 commit (a7e4717) lands FNMA-SEL-2026-04 with `effective_period = '[2026-01-01,infinity)'` per CONTEXT D-13. Postgres `daterange &&` says ANY range `[Y, Y+1)` with year Y >= 2026 overlaps with `infinity`. The pre-existing test fixture helper `tests/_shared/agency-fixture.ts::makeRandomEffectivePeriod()` picked random years `[2100..102099]` for the SYSTEM-tenant FNMA INSERT, so every fixture seedAgencyVersion call after my plan's commit collided with my real FNMA-SEL-2026-04 row on the `agency_rule_version_no_overlap` EXCLUDE constraint. Three direct-INSERT test files (`agency-rule-state.test.ts`, `agency-rule-version-exclude.test.ts`, `superseded-by-deferrable.test.ts`) had the same bug at the test level: `2300+random(50)`, `3000000+random(100000)`, `4000000+random(100000)`, `2200+random(50)` all overlap with infinity.
- **Fix:** Anchor every random range to a pre-2026 historical year. Specifically:
  - `tests/_shared/agency-fixture.ts::makeRandomEffectivePeriod()` now picks a **1-day** range inside year `[1000..1999]` (≈373k unique slots — wide enough for parallel sibling-worktree runs).
  - `tests/schema/agency-rule-state.test.ts`: FHLMC range → `[1900..1950)`.
  - `tests/schema/agency-rule-version-exclude.test.ts`: "blocks overlap" → `[1500..1750)`; "different agencies" → `[1800..1900)`.
  - `tests/schema/superseded-by-deferrable.test.ts`: prior+new pair → `[1700..1750)`.
  - Each window is wide and disjoint from the helper's day-level slots inside `[1000..1999]`.
- **Files modified:** tests/_shared/agency-fixture.ts, tests/schema/agency-rule-state.test.ts, tests/schema/agency-rule-version-exclude.test.ts, tests/schema/superseded-by-deferrable.test.ts.
- **Allowlist note:** None of these 4 files were in this plan's `files_modified` allowlist. Per Plan 03-01's precedent (their deviation #1 modified the same `tests/_shared/agency-fixture.ts` as a Rule 1 ON CONFLICT fix outside their allowlist), Rule 1 scope-boundary applies — the regression is directly caused by THIS plan's `[2026-01-01,infinity)` seed, the fix is surgical year-range adjustment in test files only, and the same fix pre-emptively unblocks sibling Wave 1 plans 03-03/04/05 (FHLMC/FHA/VA) that will introduce their own `[2026-01-01,infinity)` rows shortly.
- **Commit:** 7075112.

### Authentication Gates

None encountered. The plan does not touch auth surfaces.

## Threat Flags

None — this plan adds agency_rule data under the SYSTEM tenant via the existing two-policy `agency_rule_version` (world_read + system_write) shape that Plan 02 + Plan 03-01 hardened. No new network endpoints, no new auth paths, no new file access patterns. The threat surface is identical to Plan 03-01's loader skeleton, just with real FNMA data flowing through it.

## Known Stubs

The 3 sibling per-agency contributors (`scripts/seed/agency-fhlmc.ts`, `scripts/seed/agency-fha.ts`, `scripts/seed/agency-va.ts`) remain Wave 0 stubs. Plans 03-03/04/05 swap their bodies as part of the parallel Wave 1 batch. None of them are this plan's responsibility — B1a parallel-safe by design.

## TDD Gate Compliance

Task 3 carries `tdd="true"`. Plan-level gate sequence:

| Gate | Commit | Tag |
|------|--------|-----|
| RED | f9b3c27 — `test(03-02-03): add FNMA derog matrix structural assertions + golden snapshot (RED)` | TDD-Phase: red |
| GREEN | f80bff2 — `feat(03-02-03): lock FNMA derog golden snapshot hash (GREEN)` | TDD-Phase: green |

REFACTOR phase: not needed. The Rule 1 deviation (7075112) is a regression fix triggered by Task 3's full-suite verification, not a behavior cleanup of the new tests themselves.

Tasks 1 and 2 are non-TDD (fixture data + per-agency contributor wiring). Their validation is the migration-and-seed integration covered by Task 3's tests.

## Self-Check: PASSED

Verified via direct file existence + commit log + database introspection.

### Files

| Path | Status |
|------|--------|
| lib/agency-seeds/fnma/derog-seasoning.ts | FOUND |
| scripts/seed/agency-fnma.ts (modified) | FOUND |
| tests/agency/fnma-derog.test.ts | FOUND |
| tests/agency/agency-version-fnma.test.ts | FOUND |
| tests/_shared/agency-fixture.ts (Rule 1 fix) | FOUND |
| tests/schema/agency-rule-state.test.ts (Rule 1 fix) | FOUND |
| tests/schema/agency-rule-version-exclude.test.ts (Rule 1 fix) | FOUND |
| tests/schema/superseded-by-deferrable.test.ts (Rule 1 fix) | FOUND |

### Commits

| Hash | Status |
|------|--------|
| 7110cc3 | FOUND |
| a7e4717 | FOUND |
| f9b3c27 | FOUND |
| f80bff2 | FOUND |
| 7075112 | FOUND |

### Database / runtime state

| Property | Verified |
|----------|----------|
| pnpm typecheck exits 0 | YES |
| pnpm test:schema 146/146 pass | YES |
| pnpm db:seed creates 1 FNMA-SEL-2026-04 agency_rule_version | YES |
| pnpm db:seed creates 9 child agency_rule rows under FNMA-SEL-2026-04 | YES |
| FORECLOSURE event_type returns 2 rows (B2 split) with distinct _seed_key | YES |
| Re-running pnpm db:seed produces same counts (1 ARV + 9 rules) | YES |
| Snapshot id+hash stable across re-runs | YES |
| FNMA derog matrix tests: 13/13 pass | YES |
| agency_rule_version: FNMA + USDA tests: 3/3 pass | YES |
| Golden snapshot hash locked at 71b24015b029b0f07ebbcc8f84c78a26c75c7835488d64fac5670f7230f7e201 | YES |
| scripts/seed-agency.ts NOT modified (B1a parallel-safe) | YES |
| tests/agency/agency-version.test.ts (shared) NOT created (B1a per-agency only) | YES |
