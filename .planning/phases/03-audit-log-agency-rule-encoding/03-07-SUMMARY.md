---
phase: 3
plan: 07
title: Cascade trigger integration test + cascade_review_queue cross-tenant pen tests
subsystem: phase-3-audit-log-agency-rule-encoding
tags:
  - cascade-trigger
  - cascade-review-queue
  - rls-pen-test
  - tdd
  - reviews-mode-b5-b6-b10
  - wave-2
dependency_graph:
  requires:
    - 03-01 (Wave 0 — cascade_review_queue table + enqueue_agency_cascade trigger + DEFERRABLE FK migration 0013)
    - 03-02 (Wave 1 — FNMA-SEL-2026-04 seeded with 9 agency_rule rows for PG-9 multi-rule prior assertion)
  provides:
    - tests/cascade/cascade-trigger.test.ts (Phase 3 SC#5 / D-17 / AGY-08 integration coverage; closes the SC#5 gate)
    - tests/rls/cascade-review-queue-cross-tenant.test.ts (D-19 6-case matrix coverage for the new tenant-scoped queue table)
    - tests/rls/seedTwoTenants.ts::seedTwoTenantsWithProgramVersions (B6-compliant cascade-test helper, accepts existing PoolClient, never commits)
  affects:
    - tests/cascade/ (suite gains 4 trigger integration tests; previous content was Wave 0 poll-stub.test.ts only)
    - Wave 3 verification gates that read AGY-08 coverage via RLS + schema test counts
tech-stack:
  added: []
  patterns:
    - Single-transaction role-switch RLS pen test (SET LOCAL ROLE app_user + set_config + RESET ROLE; NOT separate connection via connectAsTenant) — fixes the iter-2 B6 regression where uncommitted seed rows were invisible to a separate app_user connection
    - Cascade test helper that accepts an existing PoolClient and never commits — caller's enclosing BEGIN/ROLLBACK owns lifecycle, guaranteeing zero queue-row leakage between tests
    - afterAll structural assertion that cascade_review_queue count = 0 post-suite (B6 isolation gate; converts a flaky "tests sometimes pass" into a structural property)
    - RED → GREEN cycle that flips a placeholder length-N assertion to prove the test exercises the trigger/RLS contract end-to-end (Plan 03-02 Task 3 precedent: placeholder hash → real hash)
key-files:
  created:
    - tests/cascade/cascade-trigger.test.ts
    - tests/rls/cascade-review-queue-cross-tenant.test.ts
  modified:
    - tests/rls/seedTwoTenants.ts (appended `seedTwoTenantsWithProgramVersions` + private `seedOneTenantProgramVersionOnly`; existing `seedTwoTenants` signature unchanged)
decisions:
  - Anonymous case (Task 03 it #2) uses non-existent UUID GUC instead of true `connectAsAnonymous` because uncommitted-on-admin seeds are invisible to a separate connection — documented inline; functionally equivalent fail-closed property
  - Cross-tenant INSERT test uses real FK IDs from `seedTwoTenantsWithProgramVersions` (Codex 03-07 suggestion) so a rejection is unambiguously RLS-related, not a generic FK violation
  - PG-4 initial-no-prior test uses synthetic year 2010 (in the free [2000-2025] window between fixture range [1000-1999] and real seed FNMA-SEL-2026-04 [2026-01-01,infinity)) — this avoids the EXCLUDE collision the plan's draft year=2095 would have triggered; documented inline as a deliberate pre-2026 anchor like Plan 03-02 deviation #1
  - Cross-tenant INSERT test omits `RESET ROLE` before ROLLBACK because pg aborts the transaction on the rejected INSERT; subsequent statements would error with "current transaction is aborted" — ROLLBACK on aborted txn is safe; documented inline
  - GitNexus reindex deferred per Plan 03-01 precedent — only NEW test files created (no existing-symbol modifications); mid-execution `npx gitnexus analyze` would index a half-complete state. Wave-3 integration gate is the right place
metrics:
  duration_minutes: 12
  duration_iso: PT12M
  tasks_completed: 3
  files_created: 2
  files_modified: 1
  commits: 5
  tests_added: 10
  completed_date: 2026-05-05
---

# Phase 3 Plan 07: Cascade trigger integration test + cascade_review_queue cross-tenant pen tests Summary

**Closes Phase 3 SC#5 (the literal "verified via integration test" gate for AGY-08 cascade trigger fan-out) and the AGY-08 cross-tenant matrix on the new `cascade_review_queue` table — 10 new tests (4 trigger + 6 cross-tenant) that all wrap setup + assertion + cleanup in BEGIN/ROLLBACK on a single admin client (B6) with `afterAll` asserting queue count = 0 post-suite.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-05T21:44:00Z
- **Completed:** 2026-05-05T21:56:12Z
- **Tasks:** 3
- **Files created:** 2
- **Files modified:** 1
- **Commits:** 5 (1 feat + 2 RED + 2 GREEN — TDD cycle visible in git log)
- **Tests added:** 10 (4 cascade trigger integration + 6 cross-tenant pen tests)

## Accomplishments

- Phase 3 SC#5 closed — `agency_rule_version` insert via the two-step convention fans out exactly N `cascade_review_queue` rows (one per affected `program_version`) verified end-to-end against the live trigger
- Pitfall PG-4 (initial-no-prior short-circuit) and Pitfall PG-9 (Cartesian-explode prevention with 9 FNMA child rules) are explicitly tested
- DEFERRABLE INITIALLY DEFERRED self-FK on `agency_rule_version.superseded_by` is structurally asserted (B5) — the two-step UPDATE-before-INSERT only works because of this clause shipped in migration 0013
- AGY-08 cross-tenant matrix coverage matches Phase 1 D-03 + Phase 2 D-19: 6 cases (cross-tenant SELECT, anonymous, in-tenant SELECT, cross-tenant INSERT/UPDATE/DELETE) — all enforced via single-transaction `SET LOCAL ROLE app_user` (the iter-2 B6 fix; not the separate-connection `connectAsTenant` pattern that broke iter-1)
- Zero queue-row leakage gate: `afterAll` asserts `count(*) = 0`; psql confirms 0 after every suite run

## Task Commits

Each task was committed atomically with the TDD RED → GREEN cycle visible:

1. **Task 1: B6-compliant `seedTwoTenantsWithProgramVersions` helper** — `7915aa8` (feat)
2. **Task 2: cascade trigger integration tests (RED)** — `4d7a800` (test)
2. **Task 2: cascade trigger fan-out assertions (GREEN)** — `2bad42b` (feat)
3. **Task 3: cross-tenant pen tests (RED)** — `38e671e` (test)
3. **Task 3: cross-tenant SELECT assertion locked (GREEN)** — `c63a430` (feat)

## What Shipped

### tests/rls/seedTwoTenants.ts (MODIFIED — append-only)

New exported helper `seedTwoTenantsWithProgramVersions(client: PoolClient, priorAgencyRuleVersionId: string): Promise<CascadeSeedResult>` that:
- Accepts an EXISTING `pg.PoolClient` (not a Pool); does NOT call `BEGIN`/`COMMIT`/`ROLLBACK` internally — caller's enclosing transaction owns lifecycle (B6)
- Skips `rule_citation` and `program_rule` inserts (Pitfall PG-9 — cascade trigger JOINs `program_version` ONLY, not `agency_rule`)
- Uses synthetic year `2150 + random(30)` for `program_version` effective_period — within PostgreSQL date type bounds; collision-free against real `[2026-01-01,infinity)` Wave 1 seeds (B10)

The existing `seedTwoTenants(pool, adminPool?)` signature is UNCHANGED; Phase 1 + Phase 2 callers continue to work. 56/56 RLS pen tests still pass.

### tests/cascade/cascade-trigger.test.ts (NEW, 4 it() blocks)

| # | Test | Asserts |
|---|------|---------|
| 1 | DEFERRABLE FK on superseded_by (B5) | `condeferrable=t AND condeferred=t` via pg_constraint introspection |
| 2 | D-17 two-step convention fan-out | `queue.length === 2` across two tenants; each row has `status='pending'`, correct `new_arv_id` + `prior_arv_id`; tenant_ids match seeded A and B |
| 3 | Pitfall PG-4 initial-no-prior | INSERT new ARV with `superseded_by=NULL` produces 0 queue rows |
| 4 | Pitfall PG-9 multi-rule prior | FNMA-SEL-2026-04 has 9 agency_rule children; trigger still produces exactly 2 rows (per program_version, NOT 18 from a Cartesian explode) |

Plus an `afterAll` structural assertion that `cascade_review_queue` count = 0 post-suite — the B6 isolation gate that converts "no leaked rows" from a hope into a structural property.

Verification: `pnpm test:schema -t 'cascade trigger'` → 4/4 passing. Full schema suite: 185/185 (was 181 + 4 new).

### tests/rls/cascade-review-queue-cross-tenant.test.ts (NEW, 6 it() blocks)

D-19 6-case matrix mirroring `program-cross-tenant.test.ts` / `lender-overlay-cross-tenant.test.ts`:

| # | Vector | Outcome |
|---|--------|---------|
| 1 | cross-tenant SELECT (GUC=A, target=B's queue row) | `rows.length === 0` |
| 2 | anonymous (GUC=non-existent UUID, no tenant matches) | `rows.length === 0` (fail-closed) |
| 3 | in-tenant SELECT (GUC=A, target=A's queue row) | `rows.length === 1`; row id matches seeded queueRowA |
| 4 | cross-tenant INSERT (GUC=A, INSERT tenant_id=B with REAL FKs) | `rejects.toThrow(/row-level security\|policy/i)` — Codex suggestion: real FKs make rejection unambiguously RLS, not FK |
| 5 | cross-tenant UPDATE (GUC=A, target=B's queue row) | `rowCount === 0` |
| 6 | cross-tenant DELETE (GUC=A, target=B's queue row) | `rowCount === 0` |

Every test runs the iter-2 B6 single-transaction role-switch pattern:
```
BEGIN
seed via seedCascadeQueueRows (under postgres + system_role; trigger fires)
SET LOCAL ROLE app_user
SELECT set_config('app.tenant_id', $tenantId, true)
... attack-vector query ...
RESET ROLE  -- skipped on the INSERT test (pg aborts txn on rejected INSERT)
ROLLBACK
```

Plus an `afterAll` queue-empty assertion. Verification: `pnpm test:rls -t 'cascade_review_queue'` → 6/6 passing. Full RLS suite: 62/62 (was 56 + 6 new).

## Decisions Made

- **Anonymous case uses non-existent-UUID GUC, not true `connectAsAnonymous`.** A fresh client (no prior `set_config`) wouldn't see uncommitted-on-admin seed rows AT ALL — RLS-failure becomes indistinguishable from setup-failure. Setting `app.tenant_id` to a `gen_random_uuid()` value yields functionally equivalent fail-closed semantics: no seeded row matches, RLS returns 0 rows. Documented inline in test #2.
- **Cross-tenant INSERT test omits `RESET ROLE` on the success path.** Pg aborts the transaction on the rejected INSERT; subsequent statements error with `current transaction is aborted, commands ignored until end of transaction block`. ROLLBACK on an aborted txn is always safe and the role auto-resets when the transaction ends. Documented inline.
- **PG-4 initial test uses year 2010, not 2095 as in the plan's draft.** Year 2095's `[2095-01-01,2096-01-01)` overlaps with FNMA-SEL-2026-04's `[2026-01-01,infinity)` per Postgres `daterange &&` semantics; the EXCLUDE constraint `agency_rule_version_no_overlap` would fire. Year 2010 lies in the free `[2000-2025]` window between the agency-fixture helper's `[1000-1999]` range and the real seed's `[2026-01-01,infinity)`. Documented inline citing Plan 03-02 deviation #1's pre-2026 anchoring precedent. Spotted during the RED phase as an EXCLUDE collision — fixed before commit.
- **GitNexus reindex deferred.** Per Plan 03-01's precedent (mid-execution indexing captures a half-complete state), and given this plan only creates NEW test files (no existing-symbol modifications), no impact analysis was required. The Wave 3 integration gate is the right place to reindex.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] PG-4 initial-no-prior test year collided with FNMA-SEL-2026-04 EXCLUDE constraint**

- **Found during:** Task 02 RED run (the test threw `conflicting key value violates exclusion constraint "agency_rule_version_no_overlap"` instead of the deliberate length-mismatch failure)
- **Issue:** Plan's draft used `yr = 2095` for the initial-insert test. Postgres `daterange &&` says ANY future-year range overlaps with `infinity`; FNMA-SEL-2026-04 is `[2026-01-01,infinity)` so `[2095-01-01,2096-01-01)` overlaps and the EXCLUDE constraint fires before the assertion runs.
- **Fix:** Anchor the test to year 2010, in the free `[2000-2025]` window between the agency-fixture helper's `[1000-1999]` random range and the real seed's `[2026-01-01,infinity)`. Documented the choice inline citing Plan 03-02 deviation #1's pre-2026 anchoring precedent. The intent of the test (initial-insert with no prior produces 0 queue rows) is preserved; only the year changed.
- **Files modified:** `tests/cascade/cascade-trigger.test.ts` (1 line: `const yr = 2010`)
- **Verification:** Test then passed in RED phase (the deliberate placeholder failures on tests #2 and #4 were the only remaining failures, as designed)
- **Committed in:** `4d7a800` (Task 02 RED commit; the year choice was part of the initial author of the file)

**2. [Rule 1 - Bug] `seedCascadeQueueRows` helper mapped queue rows by lexicographic order instead of tenant identity**

- **Found during:** Task 03 RED run (the in-tenant SELECT test failed with `expected [] to have a length of 1 but got +0` — but the deliberate RED placeholder was on a DIFFERENT test, so this was a real bug)
- **Issue:** The helper's draft used `const sortedTenants = [setup.tenantA, setup.tenantB].sort()` then `queueRows.find((r) => r.tenant_id === sortedTenants[0])` for `queueRowA`. UUIDs are random — `setup.tenantA` may be lexicographically larger or smaller than `setup.tenantB`. So `queueRowA` could end up being the queue row for `setup.tenantB`, breaking the in-tenant test (GUC=tenantA but row belongs to tenantB → RLS hides it).
- **Fix:** Map directly by tenant identity: `queueRows.find((r) => r.tenant_id === setup.tenantA)` for `queueRowA` and `setup.tenantB` for `queueRowB`. Throw a structured error if either is missing.
- **Files modified:** `tests/rls/cascade-review-queue-cross-tenant.test.ts` (helper-internal mapping logic)
- **Verification:** After the fix, in-tenant SELECT and cross-tenant UPDATE/DELETE all passed in RED phase (only the deliberate cross-tenant SELECT placeholder remained failing, as designed)
- **Committed in:** `38e671e` (Task 03 RED commit; included with the file's initial creation)

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs spotted during RED phase before any GREEN commit)
**Impact on plan:** Both fixes are surgical (1 line + helper-internal mapping). No scope creep. The plan's `files_modified` allowlist was honored — only the 3 listed files were touched. Both bugs were caught by the RED phase doing its job: the placeholder failures isolated the deliberate failures from real bugs, surfacing both regressions before they could land in GREEN.

## Authentication Gates

None encountered. The plan does not touch auth surfaces.

## Threat Flags

None. This plan adds only NEW TEST FILES that exercise the existing trigger + RLS surface shipped by Plan 03-01 (Wave 0). No new endpoints, no new auth paths, no new file access patterns. The threat surface is identical to Plan 03-01's `cascade_review_queue` infrastructure (FORCE RLS + two-policy shape + `enqueue_agency_cascade` SECURITY INVOKER trigger), now empirically verified by 10 new tests.

## Known Stubs

None. Both new test files contain real assertions against real infrastructure. No placeholder data, no TODO markers, no hardcoded empty values.

## TDD Gate Compliance

`workflow.tdd_mode = true`; Tasks 02 and 03 carry `tdd="true"`. Plan-level gate sequence verifiable in `git log --oneline c60d170..HEAD`:

| Gate | Commit | Tag |
|------|--------|-----|
| Task 1 (helper) | `7915aa8` — `feat(03-07-01): add seedTwoTenantsWithProgramVersions helper for cascade tests` | n/a (non-TDD; helper is plumbing) |
| Task 2 RED | `4d7a800` — `test(03-07-02): add cascade trigger integration test (RED)` | TDD-Phase: red |
| Task 2 GREEN | `2bad42b` — `feat(03-07-02): lock cascade trigger fan-out assertions (GREEN)` | TDD-Phase: green |
| Task 3 RED | `38e671e` — `test(03-07-03): add cascade_review_queue cross-tenant pen tests (RED)` | TDD-Phase: red |
| Task 3 GREEN | `c63a430` — `feat(03-07-03): lock cascade_review_queue cross-tenant assertions (GREEN)` | TDD-Phase: green |

REFACTOR phase: not needed — tests are structural assertions against shipped infrastructure; no behavior cleanup. The two Rule 1 deviations above were inline fixes, not separate refactor commits.

The RED phase was meaningful: each RED commit deliberately flipped a single key assertion (length=0 → length=1 or vice versa) to prove the test exercises the trigger / RLS contract end-to-end. Two real bugs surfaced during RED runs (years collision + tenant mapping) and were fixed before GREEN.

## Issues Encountered

None beyond the two Rule 1 deviations above. Both were surfaced and fixed in the RED phase before any GREEN commit landed.

## Threat Surface Scan

No new security-relevant surface. Reviewed each created/modified file:
- `tests/rls/seedTwoTenants.ts` — added test helper; no production code path
- `tests/cascade/cascade-trigger.test.ts` — test file; no auth, no network endpoint, no schema change at trust boundary
- `tests/rls/cascade-review-queue-cross-tenant.test.ts` — test file; same

The threat model for `cascade_review_queue` (per Plan 03-01: FORCE RLS + tenant_isolation policy + system_write policy + DEFERRABLE FK) is now empirically verified across the AGY-08 cross-tenant matrix.

## Self-Check: PASSED

Verified via direct file existence + commit log + database introspection.

### Files

| Path | Status |
|------|--------|
| tests/rls/seedTwoTenants.ts (modified — appended `seedTwoTenantsWithProgramVersions`) | FOUND |
| tests/cascade/cascade-trigger.test.ts | FOUND |
| tests/rls/cascade-review-queue-cross-tenant.test.ts | FOUND |
| .planning/phases/03-audit-log-agency-rule-encoding/03-07-SUMMARY.md | FOUND |

### Commits

| Hash | Status |
|------|--------|
| 7915aa8 | FOUND |
| 4d7a800 | FOUND |
| 2bad42b | FOUND |
| 38e671e | FOUND |
| c63a430 | FOUND |

### Database / runtime state

| Property | Verified |
|----------|----------|
| pnpm typecheck exits 0 | YES |
| pnpm test:schema -t 'cascade trigger' → 4/4 pass | YES |
| pnpm test:rls -t 'cascade_review_queue' → 6/6 pass | YES |
| pnpm test:schema → 185/185 pass (was 181 + 4 new) | YES |
| pnpm test:rls → 62/62 pass (was 56 + 6 new) | YES |
| Post-suite cascade_review_queue count = 0 (B6 isolation gate held) | YES |
| `agency_rule_version.superseded_by` FK condeferrable=t AND condeferred=t (B5 verified by test #1) | YES |
| FNMA-SEL-2026-04 has 9 agency_rule children (PG-9 test asserts >= 9) | YES |
| Trigger fan-out produces exactly N program_version queue rows, NOT N × ruleCount (PG-9 verified) | YES |
| Initial INSERT (no prior) produces 0 queue rows (PG-4 verified) | YES |
| Cross-tenant SELECT/UPDATE/DELETE return 0 / rowCount=0 / rowCount=0 | YES |
| Cross-tenant INSERT with mismatched tenant_id raises `row-level security` error | YES |
| In-tenant SELECT returns the tenant's own queue row | YES |
| `tests/rls/seedTwoTenants.ts::seedTwoTenants` signature unchanged (Phase 1+2 callers unaffected) | YES |

## Next Wave Readiness

Wave 2 cascade work is complete. The plan delivers everything Phase 3 SC#5 requires (the literal "verified via integration test" gate) and adds the AGY-08 cross-tenant matrix coverage. Phase 6 (cascade poller body in `lib/cascade/poll.ts`) can build on:
- The trigger contract is empirically verified — Phase 6 only needs to call the two-step convention path and trust the trigger to fan out correctly.
- The RLS surface on `cascade_review_queue` is empirically verified — Phase 8 (AM review UI) can read from this table with confidence that tenant isolation is enforced at the database, not the application.

## Deferred Issues

- **GitNexus reindex.** The PostToolUse hook has fired stale-index warnings on every commit. Per CLAUDE.md `gitnexus_impact` mandate: this plan only created NEW test files (no existing-symbol modifications), so no impact analysis was required for the work itself. Mid-execution `npx gitnexus analyze` would index a half-complete state; per Plan 03-01's deferred-issues precedent, the Wave 3 integration gate is the right place to reindex.
- **None outside scope.** No pre-existing warnings, lints, or unrelated failures surfaced. The 3-file allowlist was honored. No CI workflow changes, no migration changes, no schema changes.

---
*Phase: 03-audit-log-agency-rule-encoding*
*Plan: 07*
*Completed: 2026-05-05*
