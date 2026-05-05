---
phase: 02-rule-schema
fixed_at: 2026-05-01T00:00:00Z
review_path: .planning/phases/02-rule-schema/02-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 2: Code Review Fix Report

**Fixed at:** 2026-05-01T00:00:00Z
**Source review:** `.planning/phases/02-rule-schema/02-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (1 Critical + 5 Warnings; Info findings excluded by `fix_scope: critical_warning`)
- Fixed: 6
- Skipped: 0

All Critical and Warning findings from the Phase 2 review were addressed. Two
fixes (CR-01, WR-02) carry logic-tradeoff implications and should be confirmed
by a human before the phase advances to verification — see notes per finding
below.

## Fixed Issues

### CR-01: `detect_loosenings` derog_seasoning branch joins on rule_kind only — Cartesian across event_types

**Files modified:** `db/migrations/0006_detect_loosenings.sql`, `tests/schema/detect-loosenings.test.ts`
**Commit:** `47bddc5`
**Applied fix:** Added `AND p.overlay_body->>'event_type' = p.agency_body->>'event_type'` to the `derog_seasoning` UNION branch in the `detect_loosenings` SQL function. A BK7 overlay row is now only ever compared against the BK7 agency row, not against the FORECLOSURE agency row (which would otherwise Cartesian-explode the JOIN once an `agency_rule_version` holds multiple `derog_seasoning` rows — one per `derogEventType`). Added a regression test that seeds agency FORECLOSURE 84mo + agency BK7 48mo + overlay BK7 24mo and asserts `detect_loosenings` emits exactly one `derog_seasoning` row (BK7-vs-BK7) with no cross-event Cartesian pair.
**Verification status:** Tier 1 (re-read confirmed) + Tier 2 (TypeScript check on modified test file produced no errors specific to the file). The SQL function semantics depend on Phase 3 fixture shape — recommend running the full schema test suite under docker-compose to confirm the new test passes against a live Postgres before declaring the regression sealed.

### WR-01: `detect_loosenings` numeric branch lacks shape safety on rule_body

**Files modified:** `db/migrations/0006_detect_loosenings.sql`
**Commit:** `d5a6135`
**Applied fix:** Added `AND p.overlay_body ? 'value' AND p.agency_body ? 'value'` structural guards before the `::numeric` cast on both the `<=` branch (`ltv_max` / `cltv_max` / `hcltv_max` / `dti_max`) and the `>=` branch (`fico_min` / `reserves_min`). The function no longer fails open when a malformed `rule_body` is missing the `value` key — the row is excluded from the comparison rather than silently filtered via `NULL > NULL = NULL`.
**Verification status:** Tier 1 (re-read confirmed). Pure SQL DDL; no TypeScript surface to syntax-check. Recommend running the existing `tests/schema/detect-loosenings.test.ts` suite to confirm the happy-path numeric assertions still pass.

### WR-02: `jsonb_min_numeric` will raise on non-numeric jsonb values, blocking inserts

**Files modified:** `db/migrations/0004_program_constraints.sql`, `tests/schema/min-confidence-generated.test.ts`
**Commit:** `18085a6`
**Applied fix:** Added a regex predicate `WHERE value ~ '^-?[0-9]+(\.[0-9]+)?$'` to the `jsonb_min_numeric` IMMUTABLE wrapper so non-numeric entries (e.g. `{"flag": true}`, `{"x": "high"}`) are skipped rather than raising `invalid input syntax for type numeric` inside the GENERATED ALWAYS AS STORED expression. Added two regression tests: mixed-shape input lands `min_confidence=0.8` (skipping the boolean), all-non-numeric input lands `NULL` (same semantics as the existing empty-jsonb case).
**Verification status:** Tier 1 (re-read confirmed) + Tier 2 (TypeScript check on modified test file produced no errors specific to the file). **REQUIRES HUMAN VERIFICATION:** This fix is a logic tradeoff — silent recovery (the resilient wrapper option) vs loud failure (the original behavior plus the documented-invariant option). I chose the resilient path because the `field_confidence` shape is not constrained by the rule_kind dispatch table, so a Phase 7 extractor regression could otherwise silently break every row write. The Phase 7 extraction pipeline should still validate `field_confidence` shape upstream regardless; the resilient wrapper is the safety net at the DB layer. Human should confirm this matches the project's data-quality posture before phase advances.

### WR-03: Allow-list Zod schemas reject empty/missing `values` (no `.default([])`) — inconsistent with sibling schemas

**Files modified:** `lib/rules/schemas/occupancy-allow.ts`, `lib/rules/schemas/purpose-allow.ts`, `lib/rules/schemas/property-type-allow.ts`, `lib/rules/schemas/doc-type-allow.ts`, `tests/rules/allow-list-kinds.test.ts`
**Commit:** `0a34dbc`
**Applied fix:** Added `.default([])` to the `values` array on `occupancyAllowSchema`, `purposeAllowSchema`, `propertyTypeAllowSchema`, and `docTypeAllowSchema`. Parsing `{}` now yields `{ values: [] }` for all four schemas — consistent with `geoStateSchema`, `geoCountySchema`, `manualUwPathSchema.compensatingFactors`, `miRequiredSchema.providers`, `derogSeasoningSchema.notes_citations`, and `derogSeasoningSchema.post_event_LTV_caps`. Added four regression tests asserting the empty-default behavior.
**Verification status:** Tier 1 (re-read confirmed) + Tier 2 (TypeScript check on all five modified files produced no errors specific to the files).

### WR-04: `geoStateSchema` mutual-exclusion deferred to AM commit but not enforced anywhere yet

**Files modified:** `tests/rules/allow-list-kinds.test.ts`
**Commit:** `7d16efb`
**Applied fix:** Added a regression test that explicitly documents the deferral: `geoStateSchema.parse({ allowList: ['CA'], denyList: ['CA'] })` returns the body unchanged. The test header explains the Phase 4 evaluator's overlap-handling semantics ("if allow non-empty: ∈ allow; if deny non-empty: ∉ deny" — deny wins) and notes that any future Phase 8 task that adds structural enforcement here will surface the change as a visible test failure rather than a silent behavior shift.
**Verification status:** Tier 1 (re-read confirmed) + Tier 2 (TypeScript check produced no errors specific to the file). No source-schema change — this is a documentation-via-test fix as the reviewer suggested.

### WR-05: `tests/rls/seedTwoTenants.ts` and `tests/schema/fixtures/seed.ts` duplicate the system-tenant + agency-version bootstrap

**Files modified:** `tests/_shared/agency-fixture.ts` (new), `tests/rls/seedTwoTenants.ts`, `tests/schema/fixtures/seed.ts`
**Commit:** `de68c26`
**Applied fix:** Created a shared `tests/_shared/agency-fixture.ts` module exporting `seedAgencyVersion(adminPool, options): AgencyFixtureSeed`. Both `seedSharedAgency` (in `seedTwoTenants.ts`) and the agency-bootstrap section of `seedAgencyDerogRule` (in `seed.ts`) now delegate the SYSTEM-tenant lookup/create + GUC + citation INSERT + agency_rule_version INSERT to the shared module. Per-rule_kind / per-tenant INSERTs remain in their respective callers. The COMMIT-before-return semantics are preserved on both sides; cross-run cleanup ownership is unchanged.
**Verification status:** Tier 1 (re-read confirmed) + Tier 2 (TypeScript check on all three modified files produced no errors specific to the files). The reviewer explicitly classified this as "a refactor candidate, not a v1 blocker" — recommend running both test suites (`tests/rls/**` and `tests/schema/**`) under docker-compose to confirm no regression in the duplicated-logic-extraction path.

## Skipped Issues

None — every in-scope finding was fixed.

## Notes for Reviewer

- **Worktree isolation deviation:** The `setup_worktree` step in the fixer prompt directs the agent to create an isolated git worktree before touching files, but the `feat/phase-2` branch was already checked out in the main worktree (`git worktree add` rejects re-checking out a branch held elsewhere). Working tree was confirmed clean before fixes began; no foreground session was racing the branch. All commits landed cleanly on `feat/phase-2` in the main checkout.
- **GitNexus index staleness:** Hooks reported the GitNexus index is stale (`last indexed: 29fea90`) on every Bash call. No GitNexus MCP tools were used during this fix run — the cited findings pointed at specific files/lines, so direct `Read`/`Edit` was sufficient. Recommend running `npx gitnexus analyze` before the next exploratory task that needs the call graph.
- **`gsd-sdk query commit` unavailable:** The locally-installed `gsd-sdk` is v0.1.0 (per the documented memory, `npm i -g @gsd-build/sdk` regresses to that version), which lacks the `query commit` subcommand. All commits used `git commit` directly with the `fix(02): {ID} {description}` convention specified in the prompt.
- **Two findings flagged for human verification:** CR-01 (event_type qualifier semantics depend on Phase 3 fixture shape) and WR-02 (silent recovery vs loud failure tradeoff). Confirm both before phase advances.

---

_Fixed: 2026-05-01T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
