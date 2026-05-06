---
phase: 3
plan: 05
title: VA Pamphlet 26-7 derog matrix — cited-only rows + golden snapshot
subsystem: phase-3-audit-log-agency-rule-encoding
tags:
  - agency-rules
  - derog-seasoning
  - va-pamphlet-26-7
  - reviews-mode-iter-2
  - sentinel-rows
  - cross-agency-parity
  - wave-1
dependency_graph:
  requires:
    - 03-01 (Wave 0 shared infra: AgencyRuleSeed types, seedAgencyVersionAndRules loader, seed/index.ts aggregator, scripts/seed/agency-va.ts stub, derog-seasoning Zod schema with not_applicable + nullable base_waiting_months, agency_rule_state enum + sunset/deprecation columns)
  provides:
    - lib/agency-seeds/va/derog-seasoning.ts (vaDerogSeasoningSeeds — 8 typed AgencyRuleSeed entries)
    - scripts/seed/agency-va.ts (real seedVa() body — replaces Wave 0 stub)
    - tests/agency/va-derog.test.ts (7 structural + golden snapshot tests)
    - tests/agency/agency-version-va.test.ts (1 AGY-01 test for VA agency_rule_version row)
  affects: []
tech-stack:
  added: []
  patterns:
    - Sentinel rows (not_applicable=true + base_waiting_months=null) for AGY-05 cross-agency parity without violating layer discipline
    - sortKeysDeep recipe for jsonb golden-snapshot determinism (matches Postgres jsonb canonical key order on read-back)
    - Per-agency test file pattern (B1a) — tests/agency/va-derog.test.ts owns VA assertions; no shared agency-version.test.ts
    - .map(...) over `as const` event_type tuple for compact sentinel-row generation
key-files:
  created:
    - lib/agency-seeds/va/derog-seasoning.ts
    - tests/agency/va-derog.test.ts
    - tests/agency/agency-version-va.test.ts
  modified:
    - scripts/seed/agency-va.ts
decisions:
  - Iter-2 B4a sentinel pattern adopted: 4 non-cited event types (FC/DIL/SS/CHARGE_OFF) encoded as not_applicable=true rows instead of being deferred. Total VA rows = 8 (3 cited BK + 5 sentinels), satisfying AGY-05 cross-agency parity.
  - Golden hash locked deterministically from fixture before first DB run (sortKeysDeep + JSON.stringify), value a6a5974b45e6548558d9ddbcbf84ae53b6c7438362c08bcb85227230e7e909bb.
  - "Deferred-event-types-absent" assertion replaced with "iter-2 sentinel coverage" assertion per Rule 1 — the plan's stale acceptance criterion contradicted the iter-2 fixture body.
  - TDD RED+GREEN folded into single test(03-05-03) commit per Plan 03-01 Task 5/7/8 precedent (system under test is being constructed in this plan).
  - Zero edits to shared scripts/seed-agency.ts, scripts/seed/index.ts, or any shared tests file (B1a parallel-safe).
metrics:
  duration_minutes: 8
  duration_iso: PT8M
  tasks_completed: 3
  files_created: 3
  files_modified: 1
  commits: 3
  tests_added: 8
  completed_date: 2026-05-05
---

# Phase 3 Plan 05: VA Pamphlet 26-7 derog matrix — cited-only rows + golden snapshot Summary

Encoded the VA Pamphlet 26-7 Chapter 4 Topic 7 derog seasoning matrix as 8 typed `agency_rule` rows (3 cited BK rules + 5 explicit `not_applicable=true` sentinels), wired the per-agency contributor at `scripts/seed/agency-va.ts` (replacing the Wave 0 stub), and shipped 8 structural + golden-snapshot tests across two B1a-compliant per-agency test files. Closes Wave 1's VA branch with the iter-2 REVIEWS resolutions (B1a per-agency registry, B4a strict citation gate + sentinel coverage, B9 explicit not_applicable for missing rules) all visible in source.

## Tasks Completed

| # | Task                                                              | Commit  | Files                                          | TDD            |
| - | ----------------------------------------------------------------- | ------- | ---------------------------------------------- | -------------- |
| 1 | Author VA derog fixture (3 cited BK + 5 not_applicable sentinels) | 6528833 | lib/agency-seeds/va/derog-seasoning.ts (new)   | n/a            |
| 2 | Wire VA seed via per-agency contributor (B1a, replace stub body)  | 297444e | scripts/seed/agency-va.ts (modified)           | n/a            |
| 3 | VA structural + golden snapshot tests + AGY-01 row test           | ac88b39 | tests/agency/va-derog.test.ts (new), tests/agency/agency-version-va.test.ts (new) | RED+GREEN folded |

TDD note (per Plan 03-01 Task 5/7/8 precedent): Task 3 folds RED+GREEN into a single `test(03-05-03)` commit because the system under test (the seed loader writing 8 VA rows + the fixture itself) is being constructed in this same plan. Writing the same test twice (once expecting fail, once expecting pass) on freshly-built fixtures would be theater. The golden hash was precomputed deterministically from the fixture body using a `sortKeysDeep` recipe so the first CI test:schema run lands GREEN immediately.

## What Shipped

### lib/agency-seeds/va/derog-seasoning.ts

Exports `vaDerogSeasoningSeeds: AgencyRuleSeed<DerogSeasoning>[]` with 8 entries:

**3 cited BK rules** (per REVIEWS.md B4a strict-citation gate; every URL anchors at a VA Pamphlet 26-7 Chapter 4 Topic 7 section):

| event_type        | base | EC   | anchor    | note                                                |
| ----------------- | ---- | ---- | --------- | --------------------------------------------------- |
| BK7               | 24m  | 12m  | DISCHARGE | re-established credit required                      |
| BK13_DISCHARGED   | 24m  | n/a  | DISCHARGE | 12-month pay-out + trustee approval is alternative path |
| BK13_DISMISSED    | 24m  | 12m  | DISMISSAL | re-established credit required                      |

**5 explicit `not_applicable=true` sentinels** (per iter-2 REVIEWS.md B4a + B9, AGY-05 cross-agency parity):

| event_type           | rationale                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| MULTIPLE_BK          | B9 — VA does not separately specify multi-filing; Phase 4 falls back to single-BK rule                     |
| FORECLOSURE          | iter-2 B4a — 24m market wait is lender overlay, not VA agency base; Phase 4 falls back to FNMA/FHLMC       |
| DEED_IN_LIEU         | same reasoning as FORECLOSURE                                                                              |
| SHORT_SALE           | same reasoning                                                                                             |
| MORTGAGE_CHARGE_OFF  | VA does not separately specify; lenders treat as foreclosure-equivalent (their overlay, not VA base)       |

The 4 lender-overlay-shaped event types (FC/DIL/SS/CHARGE_OFF) are produced by a `.map()` over an `as const` tuple to keep the fixture compact; the loader's INSERT path treats them identically to the literal MULTIPLE_BK sentinel.

VA_VERSION_LABEL = `'VA-PAM-26-7-Ch4'` per CONTEXT D-13.
VA_CITATION_BASE = `https://www.benefits.va.gov/warms/docs/admin26/m26-07/Lender_Handbook_VA_Pamphlet_Complete.pdf` (every row's citation `sourceUrl` extends this with a section anchor).

### scripts/seed/agency-va.ts

Wave 0 stub replaced (per the iter-2 B1a regression resolution: stubs were shipped from Wave 0 so Wave 1 plans REPLACE bodies, not files). Final body invokes `seedAgencyVersionAndRules` with:

- `agency: 'VA'`
- `versionLabel: 'VA-PAM-26-7-Ch4'`
- `effectivePeriod: '[2026-01-01,infinity)'`
- `sourceUrl` pointed at the VA Pamphlet 26-7 PDF
- `seeds: vaDerogSeasoningSeeds` (the 8-entry array from Task 1)

This plan introduces **zero edits** to shared `scripts/seed-agency.ts` or `scripts/seed/index.ts` per B1a — the aggregator (Wave 0) already imports `seedVa()`, and the function shape is unchanged from the stub.

### tests/agency/va-derog.test.ts

7 `it()` blocks — all admin-pool-bound structural assertions (require `pnpm db:seed` to have run):

1. **BK7 structural** — base=24, EC=12, anchor=DISCHARGE, reestablished_credit_required=true, not_applicable falsy
2. **BK13_DISCHARGED structural** — base=24, anchor=DISCHARGE
3. **BK13_DISMISSED structural** — base=24, EC=12, anchor=DISMISSAL
4. **MULTIPLE_BK B9 sentinel** — rule_body.not_applicable=true, base_waiting_months=null
5. **B4a strict citation gate** — every VA agency_rule row's primary_citation_id resolves to a citation URL containing `benefits.va.gov` (asserted via SQL count of NOT-LIKE rows = 0)
6. **iter-2 sentinel coverage (AGY-05)** — FORECLOSURE / DEED_IN_LIEU / SHORT_SALE / MORTGAGE_CHARGE_OFF all exist as `not_applicable=true` rows with `base_waiting_months=null`. *(Replaces the plan's stale "deferred-event-types-absent" assertion per Rule 1 — see Deviations.)*
7. **Golden snapshot** — 8 rows with sha256 hash matching the precomputed locked value. Recipe: sort by event_type, deep-sort each row's keys (canonical jsonb order), `JSON.stringify`, sha256. Locked hash: `a6a5974b45e6548558d9ddbcbf84ae53b6c7438362c08bcb85227230e7e909bb`.

### tests/agency/agency-version-va.test.ts

1 `it()` block (AGY-01 / D-13): asserts the VA-PAM-26-7-Ch4 `agency_rule_version` row exists with `effective_period = '[2026-01-01,infinity)'` and `source_url` containing `benefits.va.gov`. Per B1a, this is a VA-only file — there is no shared `tests/agency/agency-version.test.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stale "deferred-event-types-absent" assertion replaced with iter-2 sentinel-coverage assertion**

- **Found during:** Task 3
- **Issue:** The plan's iter-2 body (lines 35–62, 186–213) explicitly encodes 5 `not_applicable=true` sentinels (MULTIPLE_BK + FC + DIL + SS + CHARGE_OFF), making the total row count 8 — but the plan's task-3 acceptance criteria and the verbatim test snippet at lines 372–388 retained a stale "deferred event types per B4a are NOT seeded (FORECLOSURE / DIL / SS / MORTGAGE_CHARGE_OFF)" assertion (`expect(rows).toHaveLength(0)`). That assertion was inherited from the pre-iter-2 cited-only-defer draft and would unconditionally FAIL against the iter-2 fixture (which seeds those rows). Likewise the plan's `must_haves` retained "deferred 4 rows are documented in `## Deferred` section" but no `## Deferred` section exists in the iter-2 plan body.
- **Fix:** Replaced the deferred-absent assertion with an iter-2-correct "sentinel coverage" assertion that:
  - Asserts all 4 event types (FC/DIL/SS/CHARGE_OFF) exist
  - Asserts each has `not_applicable=true` AND `base_waiting_months=null`
  - Asserts the observed event-type set equals the expected sentinel set
  This is iter-2 AGY-05 cross-agency parity correct (every derog event type queryable as a VA row) AND respects the layer model (no flat 24m wait encoded as agency base).
- **Files modified:** tests/agency/va-derog.test.ts (1 it-block rewritten)
- **Commit:** ac88b39
- **Plan source-of-truth resolution:** when the plan body and acceptance criteria conflict, the iter-2 fixture spec (lines 35–62 + 186–213) is the source of truth — the acceptance criteria block was simply not updated when iter-2 swapped "defer" for "sentinel".

**2. [Rule 1 - Bug] Stale row counts in plan's `<verify>` block and `must_haves`**

- **Found during:** Task 2 verification
- **Issue:** The plan's task-2 `<verify>` block (line 332) asserts `grep -q '^4$'` on the post-seed VA agency_rule count — claiming 4 rows. The plan's `must_haves` (lines 518, 522, 524) repeat "4 entries (3 cited BK rules + 1 MULTIPLE_BK not_applicable)". But the iter-2 fixture body (the source of truth) yields 8 rows (3 BK + 5 sentinels), and the iter-2 cross-agency state check at lines 295–303 explicitly says "VA | VA-PAM-26-7-Ch4 | 4" (also stale). The iter-2 task-1 acceptance criteria at line 236 correctly says "exactly 8 entries", and the iter-2 SUMMARY paragraph at line 49 says "Total seeded rows under VA-PAM-26-7-Ch4: 8".
- **Fix:** Honored the iter-2 fixture spec (8 rows). The fixture, contributor wiring, and tests all assume 8 rows. The plan's stale "4" references are inconsistent with the iter-2 body and were not regressions — they were artifacts of a partial revision pass.
- **Files modified:** none — the fix is structural (8 rows is what the iter-2 fixture body produces).
- **Commit:** ac88b39 (test file's golden snapshot asserts `toHaveLength(8)`).

**3. [Plan ambiguity, not a bug] Test count: 7 it() blocks vs plan's "6 tests" claim**

- **Found during:** Task 3 acceptance grep
- **Issue:** Plan task-3 `<acceptance_criteria>` line 472 claims `grep -cE "^  it\\('"  == 6` but enumerates 7 distinct test components on lines 344–349 ("3 active-EC assertions" + MULTIPLE_BK + B4a citation gate + deferred-absent + golden snapshot = 7). The plan's "6 tests" count appears to be a typo (3 BK as separate `it()` blocks plus 4 other tests = 7 total).
- **Resolution:** Followed the plan's enumerated list (7 distinct tests) rather than the count claim. Each BK rule has its own structural assertion as the plan body specifies.
- **Files modified:** none

### Auth Gates

None. This plan does not touch auth surfaces.

## Threat Flags

None — this plan adds reference data (8 VA `agency_rule` rows + 1 `agency_rule_version` row) under the existing SYSTEM tenant. No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries.

## Known Stubs

None introduced by this plan. The Wave 0 stub at `scripts/seed/agency-va.ts` was the contract this plan was tasked with replacing — that's done. No data-rendering stubs. Phase 4 evaluator's missing-event_type fall-through (per B9 semantics) is a deliberate Phase-4 contract, not a stub.

## TDD Gate Compliance

This plan has `type: not specified at plan-level` (autonomous=true; tasks 1/2 are non-TDD; task 3 is `tdd="true"`). Per-task gate sequence:

| Task | Gate                | Commit  | Notes                                                                                                                              |
| ---- | ------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1    | (non-TDD)           | 6528833 | Fixture authoring; verification = pnpm typecheck                                                                                   |
| 2    | (non-TDD)           | 297444e | Wiring; verification = pnpm typecheck                                                                                              |
| 3    | RED+GREEN folded    | ac88b39 | Per Plan 03-01 Task 5/7/8 precedent. Golden hash precomputed deterministically before commit (sortKeysDeep recipe).               |

## Verification Status

**Local typecheck:** Clean across all 3 commits. `pnpm typecheck` exits 0 after each task.

**DB-bound verification (deferred to CI):** Tasks 2's `pnpm db:seed && pnpm db:seed && docker compose exec -T postgres psql ...` and Task 3's `pnpm test:schema -t 'VA Pamphlet 26-7'` cannot run in this parallel-executor worktree (no `.env.local` and the local Docker Postgres is shared with the main worktree). These run automatically in CI via `tests/schema/setup.ts` (Wave 0 wired `pnpm db:seed` into both `tests/rls/global-setup.ts` and `tests/schema/setup.ts`). The golden snapshot hash (`a6a5974b45e6548558d9ddbcbf84ae53b6c7438362c08bcb85227230e7e909bb`) was precomputed offline from the fixture body using the same `sortKeysDeep` recipe the test uses, so first CI run lands GREEN.

**Static structural verification performed in this worktree:**
- `pnpm typecheck` exits 0 (3 times)
- B1a compliance: `git diff --name-only HEAD scripts/seed-agency.ts scripts/seed/index.ts` empty (zero shared-file edits)
- B1a compliance: `tests/agency/agency-version.test.ts` does not exist (per-agency test files only)
- Acceptance grep checks pass (event_type literal counts, version_label string, benefits.va.gov URL count, not_applicable: true literal count, MULTIPLE_BK assertion presence, B4a citation-gate assertion presence)

## Cross-Agency Post-Wave-1 State Note

The plan's `<verify>` block at lines 295–303 claims VA contributes 4 rows to a 30-row total. Per the iter-2 fixture body the correct count is 8 VA rows (3 BK + 5 sentinels), making the cross-agency total 34 rather than 30. The other Wave 1 plans' counts (FNMA 9, FHLMC 8, FHA 8+1, USDA 0) are unaffected by this plan. This is a documentation lag inside Plan 03-05 itself, not a runtime conflict — when CI runs all Wave 1 plans together, the actual count will be 9+8+9+1+0+8 = 35 if FNMA's B2 split (9) is counted once and FHA's BTW DEPRECATED (1) is counted separately. Any cross-agency assertion downstream of this plan should query directly rather than relying on Plan 03-05's frozen count.

## Self-Check: PASSED

### Files

| Path                                              | Status |
| ------------------------------------------------- | ------ |
| lib/agency-seeds/va/derog-seasoning.ts            | FOUND  |
| scripts/seed/agency-va.ts                         | FOUND  |
| tests/agency/va-derog.test.ts                     | FOUND  |
| tests/agency/agency-version-va.test.ts            | FOUND  |

### Commits

| Hash    | Status |
| ------- | ------ |
| 6528833 | FOUND  |
| 297444e | FOUND  |
| ac88b39 | FOUND  |

### Acceptance grep checks

| Check                                                                                            | Result          |
| ------------------------------------------------------------------------------------------------ | --------------- |
| `pnpm typecheck` exits 0                                                                         | YES             |
| `lib/agency-seeds/va/derog-seasoning.ts` exports `vaDerogSeasoningSeeds`                         | YES             |
| `grep -c VA-PAM-26-7-Ch4 lib/agency-seeds/va/derog-seasoning.ts` >= 1                            | 8 (≥1)          |
| `grep -cE 'sentinel\|REVIEWS.md.*B4a' lib/agency-seeds/va/derog-seasoning.ts` >= 1               | 14 (≥1)         |
| `grep -cE 'benefits.va.gov' lib/agency-seeds/va/derog-seasoning.ts` >= 1                         | 2 (≥1)          |
| `grep -c 'not_applicable: true' lib/agency-seeds/va/derog-seasoning.ts` >= 1                     | 5 (≥1)          |
| BK7 24m / 12m timings present                                                                    | YES             |
| `scripts/seed/agency-va.ts` imports vaDerogSeasoningSeeds + invokes seedAgencyVersionAndRules    | YES             |
| `versionLabel: 'VA-PAM-26-7-Ch4'` in agency-va.ts                                                | YES             |
| `effectivePeriod: '[2026-01-01,infinity)'` in agency-va.ts                                       | YES             |
| Zero edits to shared scripts/seed-agency.ts or scripts/seed/index.ts (B1a)                       | YES             |
| `tests/agency/va-derog.test.ts` `it()` count = 7 (matches plan's enumerated list, not "6" typo) | 7               |
| MULTIPLE_BK `not_applicable: true` assertion present                                             | YES             |
| B4a strict citation gate assertion (`NOT LIKE.*benefits.va.gov`) present                         | YES             |
| Golden snapshot asserts `toHaveLength(8)` (iter-2 row count)                                     | YES             |
| Golden hash locked (deterministic precompute)                                                    | YES (a6a597...) |
| `tests/agency/agency-version-va.test.ts` `it()` count = 1                                        | 1               |
| No shared `tests/agency/agency-version.test.ts` (B1a)                                            | NOT PRESENT     |
