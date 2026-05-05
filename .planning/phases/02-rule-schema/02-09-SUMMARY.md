---
phase: 02-rule-schema
plan: 09
subsystem: testing
tags: [rls, postgres, vitest, pen-test, multi-tenant, antitrust]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: tests/rls/ harness (setup, global-setup, connectAsTenant, connectAsAnonymous, JWT fixture); FORCE RLS + tenant_self_filter / canary_tenant_isolation policies
  - phase: 02-rule-schema (Plan 02-02)
    provides: program / program_version / program_rule / rule_citation tables + RLS policies
  - phase: 02-rule-schema (Plan 02-03)
    provides: agency_rule_version / agency_rule / lender_overlay_rule tables + RLS policies
  - phase: 02-rule-schema (Plan 02-05/06)
    provides: 5 migrations (0002-0006) including FORCE RLS + EXCLUDE constraints + GRANTs to app_user
  - phase: 02-rule-schema (Plan 02-07)
    provides: live DB with all migrations applied + introspection-verified FORCE RLS on all 7 tenant-scoped tables
provides:
  - Cross-tenant pen-test coverage for the 5 new Phase 2 tenant-scoped tables (program, program_version, program_rule, rule_citation, lender_overlay_rule)
  - D-03 matrix per table (cross-tenant SELECT/INSERT/UPDATE/DELETE all fail closed)
  - FK-to-foreign-program edge case empirically documented (Postgres FK target check bypasses RLS — observed behavior, real assertion)
  - Behavioral closure of T-2-01 (cross-tenant data egress) for all 7 tenant-scoped tables
  - Extended seedTwoTenants fixture (relocated to top-level path) returning program-family UUIDs for both tenants + shared agency_rule_version
  - Defensive __pgAdminPool construction in setup.ts (works around Vitest 4 module-context boundary)
affects: [02-rule-schema close, phase-3-audit-agency, phase-4-evaluator, phase-7-extraction-pipeline, phase-12-lender-overlay-author-ui]

# Tech tracking
tech-stack:
  added: []  # No new libraries — pure tests/fixtures over existing pg/Vitest harness
  patterns:
    - "Per-table cross-tenant matrix: every tenant-scoped table gets a 6-case D-03 file (SELECT cross/anon/in-tenant + INSERT-rejected/UPDATE-0/DELETE-0)"
    - "Seed shared agency rows under adminPool (Pitfall G); seed tenant rows under app_user pool (Pitfall 7 bootstrap)"
    - "FK-to-foreign-program edge case: assert OBSERVED Postgres behavior with real assertion, document the data-integrity gap as a Phase 12 commit-transaction guard requirement (Approach (a) per Plan revision 2026-04-30 / Issue W5)"
    - "Defensive __pgAdminPool in both globalSetup AND setupFiles (Vitest 4 module-context boundary — Plan 01-06 §Rule 3 deviation)"

key-files:
  created:
    - tests/rls/seedTwoTenants.ts (top-level; replaces tests/rls/fixtures/tenants.ts)
    - tests/rls/program-cross-tenant.test.ts
    - tests/rls/program-version-cross-tenant.test.ts
    - tests/rls/program-rule-cross-tenant.test.ts
    - tests/rls/rule-citation-cross-tenant.test.ts
    - tests/rls/lender-overlay-cross-tenant.test.ts
  modified:
    - tests/rls/global-setup.ts (TRUNCATE list + GRANTs extended; __pgAdminPool exposure)
    - tests/rls/setup.ts (defensive __pgAdminPool; FORCE-RLS check extended to 7 tables; expected-policy check extended to 7 isolation policies)
    - tests/rls/cross-tenant-select.test.ts (import path updated)
    - tests/rls/cross-tenant-write.test.ts (import path updated)
    - tests/rls/guc-reset.test.ts (import path updated)
    - tests/rls/jwt-tampering.test.ts (import path updated)
    - tests/rls/index-scan.test.ts (import path updated)

key-decisions:
  - "Relocated seed fixture from tests/rls/fixtures/tenants.ts to tests/rls/seedTwoTenants.ts (Rule 3 deviation: plan-stipulated path differed from Phase 1 layout). Single source of truth — one seed file, not two."
  - "FK-to-foreign-program edge case asserts OBSERVED Postgres behavior (rowCount=1) — Approach (a) per Plan revision 2026-04-30 / Issue W5. Real assertion catches future Postgres patches that might propagate RLS into FK target checks (silently flipping success to failure). Data-integrity gap (B-tenant overlay binding to A-tenant program) documented in test JSDoc as a Phase 12 LOV-01..03 commit-transaction-level guard requirement."
  - "Cross-tenant SELECT test for lender_overlay_rule uses __pgAdminPool (BYPASSRLS) for the B-tenant overlay seed so it COMMITs (connectAsTenant rolls back, voiding the row before A's assertion). Cleanup DELETE prevents pollution into the FK-to-foreign-program test that runs afterwards."
  - "tests/rls/setup.ts FORCE-RLS sanity check extended to all 7 tenant-scoped tables (Phase 1's 2 + Phase 2's 5) — defensive per-test-run protection against accidental rollback during long CI sessions; Plan 02-07 introspection covered this once."

patterns-established:
  - "Cross-tenant pen-test file naming: tests/rls/{table}-cross-tenant.test.ts. One file per tenant-scoped table; Phase 4+ adds new test files as new tables land."
  - "Approach (a) for edge cases where Postgres semantics permit cross-tenant references (FK target checks, foreign keys to invisible rows): assert observed behavior with real assertion, document data-integrity gap as a future commit-transaction guard requirement. Documentation theater (typeof boolean) is forbidden."
  - "Seed contract for Phase 2 tests: seedTwoTenants(pool, adminPool?) returns SeedResult with program-family UUIDs for both tenants + shared agency rows. adminPool defaults to globalThis.__pgAdminPool. Tests use the seed contract directly without re-implementing per-tenant fixtures."

requirements-completed: [SCH-01, SCH-02, SCH-08, SCH-13, TNT-01, TNT-02, TNT-03, TNT-04, TNT-05, TNT-06]

# Metrics
duration: 7m 30s
completed: 2026-04-30
---

# Phase 2 Plan 09: Pen-Test Extension for Phase 2 Tenant-Scoped Tables Summary

**Cross-tenant pen-test coverage for the 5 new Phase 2 tables (program / program_version / program_rule / rule_citation / lender_overlay_rule) extending Phase 1's D-03 matrix; FK-to-foreign-program edge case empirically documented for Phase 12 LOV commit-transaction guard.**

## Performance

- **Duration:** 7 min 30 sec
- **Started:** 2026-04-30T19:59:40Z
- **Completed:** 2026-04-30T20:07:10Z
- **Tasks:** 3
- **Files created:** 6 (1 fixture + 5 test files)
- **Files modified:** 7 (2 harness files + 5 import updates)

## Accomplishments

- **Closed T-2-01 behaviorally for the 5 new tenant-scoped tables.** Each table has the full Phase 1 D-03 matrix: cross-tenant SELECT returns 0 rows, anonymous returns 0 rows, in-tenant SELECT returns the in-tenant row, cross-tenant INSERT is rejected by RLS WITH CHECK, cross-tenant UPDATE/DELETE on foreign rows affects 0 rows.
- **FK-to-foreign-program edge case captured with a real assertion.** Tenant B's INSERT into `lender_overlay_rule` with `applies_to_program_id=A_program_id` SUCCEEDS (rowCount=1) because Postgres FK target row check bypasses RLS by design. The test asserts this empirically per Approach (a) of Plan revision 2026-04-30 / Issue W5; the data-integrity gap (B-tenant overlay binding to A-tenant program) is documented as a Phase 12 LOV-01..03 commit-transaction-level guard requirement.
- **Extended seedTwoTenants** to seed program + program_version (state='active') + program_rule + rule_citation per tenant, plus a shared agency_rule_version (under postgres adminPool per Pitfall G). Each per-tenant seed runs in its own transaction so the GUC resets between tenants (Pitfall 7 bootstrap).
- **All 12 RLS test files green.** Phase 1's 7 (env-boot, cross-tenant-select, cross-tenant-write, guc-reset, index-scan, jwt-tampering, service-role-boundary) + Phase 2's 5 (program, program_version, program_rule, rule_citation, lender_overlay) = 12 files / 56 cases passing on the live CI DB.

## Task Commits

Each task was committed atomically with `--no-verify` (parallel-executor protocol):

1. **Task 1: Extend pen-test harness for Phase 2 tenant-scoped tables** — `7fb3b86` (feat)
   - Extended `seedTwoTenants` (relocated to `tests/rls/seedTwoTenants.ts`); extended `global-setup.ts` (TRUNCATE + GRANTs); extended `setup.ts` (defensive __pgAdminPool + FORCE-RLS check on 7 tables + expected-policy check on 7 isolation policies); 5 Phase 1 import paths updated
2. **Task 2: Cross-tenant pen tests for program / program_version / rule_citation** — `3ecef04` (test)
3. **Task 3: Cross-tenant pen tests for program_rule + lender_overlay_rule (with FK-to-foreign-program edge case)** — `b6c0ea9` (test)

**Plan metadata commit:** to be created after this SUMMARY lands (orchestrator handles SUMMARY commit per parallel-executor protocol).

## Files Created/Modified

### Created
- `tests/rls/seedTwoTenants.ts` — Extended seed fixture (relocated from `fixtures/tenants.ts` per plan path). Returns SeedResult with `tenantA/B`, `canaryA/B`, `programA/B`, `programVersionA/B`, `programRuleA/B`, `citationA/B`, `sharedAgencyRuleVersionId`, `sharedAgencyCitationId`. Seeds shared agency_rule_version under adminPool (Pitfall G); seeds per-tenant program family under app_user pool (Pitfall 7 bootstrap; each tenant in own transaction).
- `tests/rls/program-cross-tenant.test.ts` — 6-case D-03 matrix for `program` table (TNT-01..04 / T-2-01).
- `tests/rls/program-version-cross-tenant.test.ts` — 6-case D-03 matrix for `program_version` table.
- `tests/rls/program-rule-cross-tenant.test.ts` — 6-case D-03 matrix for `program_rule` table (Pitfall 3.5: tenant A's overlay rules MUST NOT leak to tenant B).
- `tests/rls/rule-citation-cross-tenant.test.ts` — 6-case D-03 matrix for `rule_citation` table (SCH-13 citation discipline).
- `tests/rls/lender-overlay-cross-tenant.test.ts` — 4 D-03 cases + FK-to-foreign-program edge case (5 total).

### Modified
- `tests/rls/global-setup.ts` — TRUNCATE list extended to 9 tables (CASCADE); GRANTs DML on 5 new tenant-scoped tables + SELECT on agency_rule + agency_rule_version; exposes `globalThis.__pgAdminPool` for the case where Vitest 4 module-context propagation works.
- `tests/rls/setup.ts` — Defensively constructs `globalThis.__pgAdminPool` itself (Vitest 4 module-context boundary). Extended FORCE-RLS sanity check from 2 → 7 tenant-scoped tables. Extended expected-policy check from 2 → 7 isolation policies.
- `tests/rls/cross-tenant-select.test.ts`, `tests/rls/cross-tenant-write.test.ts`, `tests/rls/guc-reset.test.ts`, `tests/rls/jwt-tampering.test.ts`, `tests/rls/index-scan.test.ts` — Import paths updated from `./fixtures/tenants.js` → `./seedTwoTenants.js` (one-line each).

### Deleted
- `tests/rls/fixtures/tenants.ts` — Replaced by `tests/rls/seedTwoTenants.ts` at top-level path per plan.

## Decisions Made

- **Relocated seed fixture from `tests/rls/fixtures/tenants.ts` to `tests/rls/seedTwoTenants.ts`.** Plan listed `tests/rls/seedTwoTenants.ts` in `files_modified` and verification grep'd that exact path. The Phase 1 baseline placed it at `fixtures/tenants.ts`. Cleanest interpretation: honor the plan's stated path; treat as a single relocation rather than maintaining two seed files. All 5 Phase 1 imports updated. Tracked as a Rule 3 (blocking) auto-fix.
- **FK-to-foreign-program edge case asserts OBSERVED success with `expect(result.rowCount).toBe(1)`.** Real assertion (Approach (a) per Plan revision 2026-04-30 / Issue W5), not the rejected weak `typeof insertSucceeded === 'boolean'` placeholder. Catches future Postgres patches that might propagate RLS into FK target checks. The data-integrity gap (B-tenant overlay binding to A-tenant program — RLS hides A's program from B's SELECTs but FK constraint creates the structural link) is documented in test JSDoc as a Phase 12 LOV-01..03 commit-transaction-level guard requirement.
- **`tests/rls/setup.ts` constructs `__pgAdminPool` defensively** (in addition to `global-setup.ts` setting it). Vitest 4 globalSetup and setupFiles run in different module contexts (Plan 01-06 §Rule 3 deviation observed empirically); a global set in globalSetup is best-effort. setup.ts owns its own pool's lifecycle via beforeAll/afterAll.
- **Cross-tenant SELECT test for lender_overlay_rule uses `__pgAdminPool` (BYPASSRLS) for the B-tenant overlay seed** so the row COMMITs. `connectAsTenant` rolls back (which would void the row before A's assertion). Cleanup `DELETE` at the end of the test prevents pollution into the FK-to-foreign-program test that runs afterwards.
- **`seedSharedAgency` generates a non-overlapping random `effective_period`** per call so the `agency_rule_version_no_overlap` EXCLUDE constraint (Plan 02-06) doesn't fire across multiple `seedTwoTenants()` invocations within a single test run. Mirrors the same pattern in `tests/schema/fixtures/seed.ts::seedAgencyDerogRule`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan-stipulated file path didn't match Phase 1 layout**
- **Found during:** Task 1 (Extend tests/rls/seedTwoTenants.ts)
- **Issue:** Plan referenced `tests/rls/seedTwoTenants.ts` in `files_modified` and verification grep'd for symbols at that path. The Phase 1 baseline placed the seed fixture at `tests/rls/fixtures/tenants.ts`. The plan's instruction "Step 1 — Extend `tests/rls/seedTwoTenants.ts`. The current file's `SeedResult` only has tenantA/tenantB/canaryA/canaryB. Extend to: ..." assumed a path that didn't exist on disk.
- **Fix:** Created the new seed at the plan-stipulated top-level path `tests/rls/seedTwoTenants.ts`; deleted `tests/rls/fixtures/tenants.ts`; updated 5 Phase 1 imports (`cross-tenant-select.test.ts`, `cross-tenant-write.test.ts`, `guc-reset.test.ts`, `jwt-tampering.test.ts`, `index-scan.test.ts`) from `./fixtures/tenants.js` → `./seedTwoTenants.js`. Single source of truth — one seed file, not two.
- **Verification:** `pnpm typecheck` exit 0; `pnpm test:rls --run` = 27/27 Phase 1 tests still pass after the relocation.
- **Committed in:** `7fb3b86` (Task 1 commit)

**2. [Rule 3 - Blocking] TypeScript global-decl conflict between setup.ts and tests/schema/setup.ts**
- **Found during:** Task 1 (Extend setup.ts with __pgAdminPool)
- **Issue:** Plan's verbatim snippet declared `var __pgAdminPool: Pool` in `setup.ts` and `Pool | undefined` in `global-setup.ts`. `tests/schema/setup.ts` already declared `Pool` (non-optional). Globals merge across files; conflicting decls → `Subsequent variable declarations must have the same type` (TS2403).
- **Fix:** Aligned `global-setup.ts` to declare `var __pgAdminPool: Pool` (non-optional) instead of `Pool | undefined`. The `setup.ts` beforeAll always sets it before any test, so non-optional is correct.
- **Verification:** `pnpm typecheck` exit 0.
- **Committed in:** `7fb3b86` (Task 1 commit)

**3. [Rule 3 - Blocking] Plan's verify command used invalid Vitest 4 reporter flag**
- **Found during:** Initial Phase 1 baseline run
- **Issue:** Plan's verify script used `pnpm test:rls --run --reporter=basic`. Vitest 4 removed the `basic` reporter (it now resolves `basic` as a path and errors with `Cannot find module 'basic'`).
- **Fix:** Used `pnpm test:rls --run` (no reporter override; default reporter works fine). Per-task verification used `--reporter=verbose` for the lender-overlay file to confirm the FK edge case ran.
- **Verification:** `pnpm test:rls --run` exits 0 with all 56 tests passing.
- **Committed in:** Not committed — runtime command adjustment only; plan's documented verify command is not part of the source code.

---

**Total deviations:** 3 auto-fixed (3 blocking)
**Impact on plan:** All three were small surface-level adjustments — the structural intent of the plan was honored exactly. The seed extension shape, test matrix coverage, FK-to-foreign-program assertion approach, and global-setup TRUNCATE/GRANT extensions all match the plan verbatim. No scope creep; no architectural changes.

## Issues Encountered

- **None substantive.** The plan was thorough; the three Rule 3 deviations above were minor path/type/CLI adjustments. The TDD RED→GREEN cycle for Task 1 surfaced the global-decl conflict immediately (typecheck error before commit), which is exactly what TDD is for.

## Threat Surface — Closed by This Plan

| Threat ID | Disposition | Verification |
|-----------|-------------|--------------|
| T-2-01 (Information Disclosure: cross-tenant SELECT on the 5 new tenant-scoped tables) | mitigate (full — verified) | 5 pen-test files × 5-6 D-03 cases = 29 assertions covering SELECT/INSERT/UPDATE/DELETE per table. setup.ts FORCE-RLS sanity check on all 7 tenant-scoped tables runs every test invocation. |

## Threat Flags

None — this plan is pure test additions; no new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries.

## Test Suite Snapshot

Final `pnpm test:rls --run` output (tail):

```
 RUN  v4.1.5 /Users/chrissaechao/IdeaProjects/lender-search

[✓] migrations applied successfully!
 Test Files  12 passed (12)
      Tests  56 passed (56)
   Start at  13:06:24
   Duration  898ms (transform 163ms, setup 286ms, import 219ms, tests 1.25s, environment 1ms)
```

**Breakdown:**
- Phase 1 baseline (7 files / 27 tests): env-boot (3) + cross-tenant-select (4) + cross-tenant-write (4) + guc-reset (3) + index-scan (2) + jwt-tampering (3) + service-role-boundary (?). Total: 27.
- Phase 2 D-19 (5 files / 29 tests):
  - program-cross-tenant: 6
  - program-version-cross-tenant: 6
  - program-rule-cross-tenant: 6
  - rule-citation-cross-tenant: 6
  - lender-overlay-cross-tenant: 5 (4 D-03 cases + 1 FK-to-foreign-program edge case)

## FK-to-Foreign-Program Empirical Result

The plan's `<output>` section asks for documentation of the OBSERVED behavior to inform Phase 12 LOV-01..03 planning.

**Observed behavior:** Tenant B's INSERT INTO `lender_overlay_rule` with `tenant_id=B`, `applies_to_program_id=A_program_id`, `primary_citation_id=B_citation_id` **SUCCEEDS** with `rowCount=1`. Postgres FK target row check is enforced at the system level (walks `pg_class` directly to verify the target row exists), bypassing the RLS policy that would otherwise hide tenant A's program from tenant B.

**Documented Postgres behavior:** This is documented Postgres behavior, not a bug. RLS does not propagate into FK constraint enforcement. The data-integrity gap created (B-tenant overlay row referencing an A-tenant program — RLS hides A's program from B's SELECTs, but the FK link is structurally present) is a known limitation.

**Phase 12 LOV-01..03 commit-transaction guard requirement:** When validating `applies_to_program_id` at commit time, the AM commit transaction MUST verify that `program.tenant_id = current_setting('app.tenant_id', true)::uuid` before allowing the overlay to commit. This is an application-layer check (not RLS-layer), executed in the same transaction that promotes the staging draft to canonical.

## relforcerowsecurity Sanity Check Coverage

Per the plan's `<output>` question: yes, `tests/rls/setup.ts`'s `relforcerowsecurity` check WAS extended to cover the 5 new tables. Plan 02-07's introspection covered this once at structural-verification time; the per-test-run sanity check protects against accidental rollback during long-running CI sessions. The check now runs against all 7 tenant-scoped tables (`_rls_canary, lender_overlay_rule, program, program_rule, program_version, rule_citation, tenant`).

## Phase 2 Verification Closure

Per the plan's `<output>` final-verification statement:

- **VALIDATION D4 (RLS extension correctness):** closed by this plan — pen tests assert behavioral isolation on every Phase 2 tenant-scoped table.
- **VALIDATION D2/D3/D5/D6:** closed by Plan 02-08 (schema constraints — agency-cross-tenant readability, program-rule layer CHECK, citation FK + source CHECK, EXCLUDE constraints, detect_loosenings).
- **Combined:** Phase 2 is structurally complete. T-2-01 is closed at both the structural (Plan 02-07 introspection) and behavioral (Plan 02-09 pen tests) levels.

### Phase 2 Close Summary (across all 9 plans)

- **Files created (cumulative):** 17 Zod schemas + dispatch table (Plan 01) + 9 Drizzle schema files (Plans 02/03) + 7 migrations (`0000_initial.sql` through `0006_*.sql` — Plans 04/05/06) + 6 Zod test files / 63 cases (Plan 04) + 9 schema-constraint test files (Plan 08) + 5 pen-test files (Plan 09) + extended seedTwoTenants + global-setup + setup.ts + 02-CONTEXT/RESEARCH/PLAN-CHECK + per-plan SUMMARY files. Roughly ~50 files of net new content across the phase.
- **Migrations:** 7 total — `0000_initial`, `0001_force_rls`, `0002_phase2_schema` (Plan 02-05), `0003_phase2_grants_force_rls` (Plan 02-05), `0004_phase2_check_constraints` (Plan 02-06), `0005_phase2_exclude_partial_index_min_confidence` (Plan 02-06), `0006_phase2_detect_loosenings_function_grant` (Plan 02-06).
- **Tests across Phase 2:** Plan 02-04 (6 Zod files / 63 cases) + Plan 02-08 (9 schema-constraint files) + Plan 02-09 (5 pen-test files / 29 cases) = **20 test files**, ~100+ test cases when including Phase 1's 27 RLS pen tests.

## Self-Check: PASSED

All claims verified before SUMMARY persists.

**Files exist:**
- FOUND: tests/rls/seedTwoTenants.ts
- FOUND: tests/rls/program-cross-tenant.test.ts
- FOUND: tests/rls/program-version-cross-tenant.test.ts
- FOUND: tests/rls/program-rule-cross-tenant.test.ts
- FOUND: tests/rls/rule-citation-cross-tenant.test.ts
- FOUND: tests/rls/lender-overlay-cross-tenant.test.ts
- FOUND: tests/rls/global-setup.ts (modified)
- FOUND: tests/rls/setup.ts (modified)

**Commits exist:**
- FOUND: 7fb3b86 (Task 1: harness extension)
- FOUND: 3ecef04 (Task 2: 3 cross-tenant pen tests)
- FOUND: b6c0ea9 (Task 3: program_rule + lender_overlay pen tests)

**Tests pass:**
- pnpm typecheck — exit 0
- pnpm test:rls --run — 12 files / 56 cases passing

## Next Phase Readiness

- **Phase 2 close ready.** Wave 3 of Phase 2 is complete: Plans 02-07 + 02-08 + 02-09 all green. STATE.md / ROADMAP.md updates owned by orchestrator.
- **Phase 3 (audit + agency rules) can start.** All Phase 2 schema (program family + agency family + lender_overlay) is verified at structural and behavioral levels.
- **Phase 12 LOV-01..03 commit-transaction guard requirement is captured** in `tests/rls/lender-overlay-cross-tenant.test.ts` JSDoc and this SUMMARY. When the brokerage LENDER_OVERLAY author UI lands in Phase 12, the commit transaction MUST add the `program.tenant_id = current_setting('app.tenant_id', true)::uuid` check before promoting an overlay draft to canonical.

---
*Phase: 02-rule-schema*
*Completed: 2026-04-30*
