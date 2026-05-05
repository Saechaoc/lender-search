---
phase: 3
plan: 06
title: FHFA 2026 conforming loan limits — CSV + loader extension + structural tests
subsystem: phase-3-audit-log-agency-rule-encoding
tags:
  - fhfa-loan-limits
  - agency-rules
  - bitemporal-versioning
  - csv-loader
  - reviews-mode-b10
dependency_graph:
  requires:
    - 03-01 (Wave 0 — conforming_loan_limit_version + _county schemas + EXCLUDE migration + seedFhfaYear no-op skeleton + structural test scaffold)
  provides:
    - scripts/seed-agency.ts seedFhfaYear (now real CSV-parse + per-row Zod-validate + idempotent INSERT path; populates the conforming_loan_limit_county table that program_version rows reference via FK)
    - The bitemporal version row at year=2026 with `[2026-01-01,)` (truly unbounded daterange) — the canonical pattern future FHFA-anchored agency tables migrate to per REVIEWS.md B10
  affects:
    - tests/schema/fhfa-loan-limits.test.ts (extended from 5 structural tests to 17 — covers loader behavior, idempotency, program_version FK dereference, B10 upper_inf assertion)
    - lib/agency-seeds/fhfa/ now has the FINAL FLAT 2026 CSV + README documenting URL + SHA256 + annual update procedure (D-23) + format quirks
tech-stack:
  added: []
  patterns:
    - "Truly-unbounded daterange [YYYY-01-01,) (upper_inf=true) instead of [YYYY-01-01,infinity) (upper_inf=false) — distinct PostgreSQL semantics, REVIEWS.md B10 mandate"
    - "Two-step daterange close (D-23) gated on upper_inf(effective_period) — canonical PostgreSQL function, replaces fragile text comparison"
    - "csv-parse@5.6 with bom: true + columns: true tolerates UTF-8 BOM + multi-line quoted headers (FHFA's CSV wraps `\"One-Unit\\nLimit\"` across two physical lines)"
    - "Zod transform-then-coerce pattern: strip $ + commas + whitespace before Number.parseInt (formatted dollar values like `\"$832,750 \"`)"
    - "is_high_cost stored at load time per Open Question 7 — readers do not recompute against the year-specific FHFA baseline"
key-files:
  created:
    - lib/agency-seeds/fhfa/README.md
  modified:
    - scripts/seed-agency.ts
    - tests/schema/fhfa-loan-limits.test.ts
  user-committed-pre-spawn:
    - lib/agency-seeds/fhfa/2026-conforming-limit-values-by-county.csv (committed by user at f9259f3 via Task 01 manual download from https://www.fhfa.gov/data/conforming-loan-limit; SHA256 3e4aa578ce0db02db241e2721362e978b097fad70e1532324e0d30a798dd67a8; 3,235 county rows)
decisions:
  - "Inserted version rows use `[YYYY-01-01,)` (truly unbounded) NOT `[YYYY-01-01,infinity)` (bounded by date type's +infinity sentinel). PostgreSQL distinguishes the two: only the unbounded form satisfies upper_inf=true, which is what REVIEWS.md B10 requires for the canonical open-ended-version detection."
  - "Wave 0/1 agency seed tables (FNMA / FHLMC / FHA / VA) keep the legacy `[2026-01-01,infinity)` form because their daterange-close detection happens to use text comparison; FHFA is where B10 actually lands. Mixing the two forms within a single table is forbidden — see README's daterange-convention section."
  - "is_high_cost is stored at load time (not derived at read time) because the threshold is a function of the FHFA-published year-specific baseline ($832,750 for 2026 / Assumption A5). Storing it lets readers JOIN/filter without recomputing, and avoids cross-year drift when 2027's baseline is different."
  - "FINAL FLAT variant per Open Question 8 (HERA-BASED is informational only; lenders use FINAL FLAT)."
  - "TDD RED+GREEN folded for Task 03 — same precedent as Plan 03-01 Tasks 5/7/8 (the system under test was constructed in this plan; writing the tests twice on freshly-built code is theater). Task 02 ran a true RED→GREEN (test commit then loader commit) because the loader was a Wave 0 no-op stub and the failing-test-against-stub case was meaningful."
metrics:
  duration_minutes: 14
  duration_iso: PT13M59S
  tasks_completed: 3
  files_created: 1
  files_modified: 2
  files_user_committed_pre_spawn: 1
  commits: 3
  tests_added: 12
  completed_date: 2026-05-05
---

# Phase 3 Plan 06: FHFA 2026 conforming loan limits — CSV + loader extension + structural tests Summary

Closes AGY-09 by replacing the Wave 0 `seedFhfaYear` no-op skeleton with a working
csv-parse + per-row Zod-validate + idempotent INSERT path against the FHFA 2026
FINAL FLAT loan limit CSV (3,235 county rows). The version row uses the
truly-unbounded `[2026-01-01,)` daterange so `upper_inf(effective_period)`
returns true — the canonical PostgreSQL detection mechanism per REVIEWS.md B10,
replacing the fragile cast-to-text-and-substring-match-`infinity` form. Task 01
(manual CSV download) was completed by the user pre-spawn at commit `f9259f3`.

## Tasks Completed

| #  | Task                                                                          | Commit  | Files                                                                                | TDD                  |
| -- | ----------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------ | -------------------- |
| 01 | Manual download of FHFA 2026 FINAL FLAT CSV                                   | f9259f3 | lib/agency-seeds/fhfa/2026-conforming-limit-values-by-county.csv                     | n/a (human-action)   |
| 02 | Implement seedFhfaYear (csv-parse + Zod + INSERT)                             | 1e0a816 (RED), df04089 (GREEN) | scripts/seed-agency.ts, tests/schema/fhfa-loan-limits.test.ts | RED→GREEN            |
| 03 | Idempotency + FK dereference test extension + FHFA README                     | 5982436 | tests/schema/fhfa-loan-limits.test.ts, scripts/seed-agency.ts (comment-only), lib/agency-seeds/fhfa/README.md | RED+GREEN folded     |

Task 01 was committed by the user pre-spawn (the FHFA download URL is
non-versioned, so per REVIEWS.md B11 the plan is `autonomous: false` and Task 01
is a `checkpoint:human-action`). The user supplied the CSV; this executor session
picked up at Task 02.

## What Shipped

### scripts/seed-agency.ts seedFhfaYear (replaces Wave 0 no-op)

- `csv-parse@5.6.0` sync API with `{ columns: true, bom: true, trim: true, skip_empty_lines: true }` — BOM-tolerant; handles the FHFA file's two-line wrapped header (column keys carry an embedded `\n` like `"One-Unit\nLimit"`)
- Per-row Zod validation via `fhfaRowSchema` — FIPS state code (1–2 digits zero-padded), FIPS county code (1–3 digits zero-padded), state, optional CBSA, four limit columns (one-unit required, two/three/four-unit optional)
- Limit columns parsed by `formattedDollarsToInt` which strips `$,\s` then `Number.parseInt` (the values are formatted strings like `"$832,750 "` — `z.coerce.number()` directly on those yields NaN)
- Two-step daterange close (D-23) on prior-year open-ended versions, gated on `upper_inf(effective_period)` per REVIEWS.md B10
- Get-or-create version row keyed on `year` (the EXCLUDE constraint enforces year-uniqueness over overlapping dateranges)
- INSERT version with `[YYYY-01-01,)` (truly unbounded; upper_inf=true) — semantically distinct from `[YYYY-01-01,infinity)` (bounded by date type's +infinity sentinel; upper_inf=false)
- County rows inserted with `INSERT … ON CONFLICT (limit_version_id, county_fips) DO NOTHING` — idempotent on re-run
- `is_high_cost` derived per row as `oneUnit > FHFA_2026_ONE_UNIT_BASELINE` ($832,750 — Assumption A5). Constant is year-keyed so future years extend by adding `FHFA_{YEAR}_ONE_UNIT_BASELINE`

### tests/schema/fhfa-loan-limits.test.ts extension (5 → 17 tests)

| describe block                                                          | Tests added |
| ----------------------------------------------------------------------- | ----------- |
| FHFA 2026 loader produces expected row counts (AGY-09)                  | 9           |
| FHFA loader idempotency (Open Question 1 / D-23)                        | 1           |
| program_version FK dereference smoke test (AGY-09 / D-22)               | 2           |

The 9 row-count tests assert: 1 version row at `[2026-01-01,)`, `upper_inf=true`
(REVIEWS.md B10), 3,000–3,300 county rows, FIPS leading zero preserved on Alabama,
LA County (06037 / $1,249,125 / high-cost), Autauga AL (01001 / $832,750 /
not-high-cost), Honolulu HI (15003 / $1,249,125 / high-cost), ≥50 high-cost
counties + max_one_unit > $1M, and `is_high_cost=false` on every county where
`one_unit_baseline=832,750`. The idempotency test attempts a duplicate
`(limit_version_id, county_fips)` INSERT with bogus values — `ON CONFLICT DO
NOTHING` returns rowCount=0 and the original row's `one_unit_baseline +
is_high_cost` are preserved unchanged. The two FK-dereference tests insert a
`program_version` with realistic future-year `[2090-01-01,2091-01-01)`
(REVIEWS.md B10 — within PostgreSQL date type bounds) and JOIN-deref the FK
back to `cllv.year=2026`; the second variant inserts with
`conforming_loan_limit_version_id = NULL` to confirm D-22 nullability.

### lib/agency-seeds/fhfa/README.md (new, 128 lines)

Documents the 2026 file (URL + SHA256 + row count + format quirks + BOM
tolerance), the high-cost derivation rule per Open Question 7, the annual update
procedure per D-23 (7-step), why FINAL FLAT not HERA-BASED per Open Question 8,
and the canonical-unbounded vs `infinity` daterange distinction per REVIEWS.md
B10.

## Verification

```bash
$ pnpm typecheck
> tsc --noEmit
# clean exit 0

$ pnpm test:schema tests/schema/fhfa-loan-limits.test.ts
 Test Files  1 passed (1)
      Tests  17 passed (17)

# Database state after pnpm db:seed:
$ docker exec lender-search-pg psql -U postgres -d lender_search_dev_acdc0dd -c "
    SELECT year, effective_period::text, upper_inf(effective_period) FROM conforming_loan_limit_version;
    SELECT count(*) FROM conforming_loan_limit_county;
    SELECT count(*) FILTER (WHERE is_high_cost) FROM conforming_loan_limit_county;
  "
 year | effective_period | upper_inf
------+------------------+-----------
 2026 | [2026-01-01,)    | t
 count
-------
  3235
 count
-------
   160

# Plan acceptance-criteria literal greps:
$ grep -c 'upper_inf(effective_period)' tests/schema/fhfa-loan-limits.test.ts
3   # ≥1 ✓
$ grep -c "upper(effective_period::text)" tests/schema/fhfa-loan-limits.test.ts
0   # ==0 ✓
$ grep -c "2090-01-01,2091-01-01" tests/schema/fhfa-loan-limits.test.ts
2   # ≥1 ✓
$ grep -cE '[5-9]000000-[0-9]+-[0-9]+' tests/schema/fhfa-loan-limits.test.ts
0   # ==0 ✓
$ grep -c '  it(' tests/schema/fhfa-loan-limits.test.ts
17  # ≥12 ✓
$ grep -c 'upper_inf(effective_period)' scripts/seed-agency.ts
3   # ≥1 ✓
$ grep -c "upper(effective_period::text)" scripts/seed-agency.ts
0   # ==0 ✓
```

## Deviations from Plan

### Auto-fixed issues

Three Rule 1 deviations were applied. All three are direct consequences of
mismatches between the plan-supplied schema and the actual FHFA CSV's shape;
per Rule 1 scope-boundary they're inline-fixed.

#### 1. [Rule 1 - Bug] Plan-supplied Zod column keys never matched real CSV column names

- **Found during:** Task 02 GREEN (running first node-eval against the file)
- **Issue:** The plan's `fhfaRowSchema` keyed the limit columns with single-space names like `"One-Unit Limit"`. The actual CSV's header lives across two physical lines inside quoted cells, so csv-parse with `columns: true` emits keys with an **embedded literal newline** like `"One-Unit\nLimit"`. Zod's `.parse(raw)` would never match those keys and every row would fail.
- **Fix:** Use the literal newline form in the schema (`'One-Unit\nLimit': z.string().transform(formattedDollarsToInt)` etc.). Documented inline in `seed-agency.ts`.
- **Files modified:** `scripts/seed-agency.ts`
- **Commit:** `df04089` (Task 02 GREEN)

#### 2. [Rule 1 - Bug] z.coerce.number() yields NaN on formatted dollar strings

- **Found during:** Task 02 GREEN
- **Issue:** The plan used `z.coerce.number().int().positive()` directly on the limit-column values. The actual values are formatted strings — `"$832,750 "` (dollar sign + thousand-separator commas + trailing space). `z.coerce.number()` invokes `Number(…)` which produces NaN on `$832,750`. The Zod refinement `.int().positive()` would then reject every row.
- **Fix:** Add a `formattedDollarsToInt` helper that strips `$,\s` and runs `Number.parseInt`, surfacing the cleaning step explicitly with a self-throwing error path on malformed values. Used as the `.transform` fn in the limit-column schema entries.
- **Files modified:** `scripts/seed-agency.ts`
- **Commit:** `df04089` (Task 02 GREEN)

#### 3. [Rule 1 - Bug] `[YYYY-01-01,infinity)` daterange does NOT satisfy upper_inf=true

- **Found during:** Task 02 GREEN (test failed initially after first loader implementation)
- **Issue:** The plan's INSERT path used `[${year}-01-01,infinity)` for the version row's `effective_period`. PostgreSQL distinguishes two semantically-distinct forms of an "open-ended" daterange:
  - `'[YYYY-01-01,infinity)'::daterange` — upper bounded by the date type's `+infinity` SENTINEL value. `upper_inf(…)` returns `false`. Canonical text form: `[YYYY-01-01,infinity)`.
  - `'[YYYY-01-01,)'::daterange` — upper is TRULY UNBOUNDED. `upper_inf(…)` returns `true`. Canonical text form: `[YYYY-01-01,)`.
  REVIEWS.md B10 mandates `upper_inf` as the canonical detection mechanism. The plan's INSERT path used the bounded-by-sentinel form which would always return `upper_inf=false`, contradicting the plan's own done criteria ("upper_inf(effective_period) returns TRUE for the 2026 row").
- **Fix:** INSERT with `[${year}-01-01,)` (truly unbounded). Test that asserts the `effective_period::text` form was updated from `'[2026-01-01,infinity)'` to `'[2026-01-01,)'` to match the new canonical form.
- **Files modified:** `scripts/seed-agency.ts`, `tests/schema/fhfa-loan-limits.test.ts`
- **Commit:** `df04089` (Task 02 GREEN)
- **Cross-table consideration:** Wave 0/1 agency seed tables (FNMA / FHLMC / FHA / VA) all use the legacy `[2026-01-01,infinity)` form. Migrating them to truly-unbounded would also be the right thing per B10's semantic intent, but those tables' daterange-close paths use text-comparison rather than `upper_inf`, so they're not broken — just inconsistent. Documented this distinction in `lib/agency-seeds/fhfa/README.md` ("Daterange convention" section): mixing the two forms within a single table is forbidden, but cross-table inconsistency is acceptable until a future plan addresses the broader migration.

### Auto-added critical functionality

#### 4. [Rule 2 - Critical] Stub-throw if `seedFhfaYear` called for an unconfigured year

- **Found during:** Task 02 design
- **Issue:** The plan-supplied `seedFhfaYear(year, csvPath)` would silently process the CSV with an inappropriate baseline if called with a year other than 2026. `is_high_cost` would be derived against the wrong baseline and stored — corrupting the data.
- **Fix:** Hard `throw new Error(...)` in the function body if `year !== 2026` (more precisely: if the year-keyed baseline constant lookup returns null). The README documents extending the constant set when FHFA publishes 2027.
- **Files modified:** `scripts/seed-agency.ts`

## Authentication Gates

None. Task 01 was the only human-action step (FHFA's non-versioned URL forces a
manual download per REVIEWS.md B11) and was completed by the user pre-spawn at
commit `f9259f3`.

## TDD Gate Compliance

This plan is `tdd="true"` at the per-task level for Tasks 02 and 03. Plan-level
gate sequence:

| Gate         | Commit  | Tag                 |
| ------------ | ------- | ------------------- |
| RED (Task 02)| 1e0a816 — `test(03-06-02): add failing FHFA 2026 loader behavior tests (RED)` | `TDD-Phase: red`   |
| GREEN (Task 02) | df04089 — `feat(03-06-02): implement seedFhfaYear with csv-parse + Zod (GREEN)` | `TDD-Phase: green` |
| GREEN (Task 03) | 5982436 — `test(03-06-03): add FHFA idempotency + program_version FK dereference + README (GREEN)` | `TDD-Phase: green` |

Task 03 RED+GREEN folded — same precedent as Plan 03-01 Tasks 5/7/8: the
behavior-under-test (loader) was already green from Task 02, so writing the
new tests as failing-then-passing on already-green code is theater. The new
test blocks landed green on first run because they exercise existing
production behavior.

REFACTOR phase not needed.

## Threat Flags

None. This plan adds load-only logic against tables that:

- Are SYSTEM-tenant-only writeable (`conforming_loan_limit_version_system_write`
  policy `TO system_role` only; world-readable for downstream evaluator joins).
- Have no PII or secrets — only county-level loan limits published by FHFA.
- Bound the `program_version` FK as nullable; non-FHFA programs (non-QM, etc.)
  remain unconstrained.

The single new code-execution path is `csv-parse` + Zod against a
trusted-at-commit-time file. Per the project-level convention, no part of
this loader runs in a request hot path — it's a one-shot DB seed.

## Known Stubs

None. The Wave 0 `seedFhfaYear` no-op stub was the precise stub this plan
landed to remove. The 4 per-agency contributors (`scripts/seed/agency-{fnma,
fhlmc,fha,va}.ts`) are still stubs from Wave 0's perspective, but they're
out of scope for this plan (Plans 03-02..03-05 own them).

## Deferred Issues

- **GitNexus reindex**: 4 PostToolUse hook reminders fired during this session
  flagging the index as stale (last indexed at `0896303`; we landed 12 commits
  ahead at session start and 3 more during this plan). Per the Plan 03-01
  Summary's same-deferred-issues precedent: running `npx gitnexus analyze`
  mid-execution would index a half-complete state, and the orchestrator's
  wave-integration gate is the right place for re-indexing. The 3 modified
  symbols (`seedFhfaYear`, `formattedDollarsToInt`, `fhfaRowSchema`) are local
  to `scripts/seed-agency.ts` and have no upstream call graph beyond the
  `scripts/seed/index.ts` aggregator, so impact analysis would surface a
  trivially-empty blast radius. Documented for follow-up.

- **Wave 0/1 agency-table daterange convention drift**: The 5 Wave 0/1 agency
  seed tables (FNMA / FHLMC / FHA / VA / USDA) use the legacy
  `[2026-01-01,infinity)` form for their `effective_period` ranges. This plan
  introduces the truly-unbounded `[2026-01-01,)` form for `conforming_loan_limit_version`
  to satisfy REVIEWS.md B10's `upper_inf` mandate. Cross-table consistency is
  desirable but out of scope here; documented in
  `lib/agency-seeds/fhfa/README.md` for a future plan to address.

- **Test isolation in full schema-suite runs**: Running `pnpm test:schema`
  against an accumulated DB (re-runs without `pnpm db:reset`) surfaces 2/194
  pre-existing failures in `tests/schema/agency-rule-version-exclude.test.ts`
  + `tests/schema/superseded-by-deferrable.test.ts` due to leftover
  agency_rule_version rows from prior test sessions. These failures
  reproduce on the baseline `0ae72c1` HEAD with my changes stashed, so they're
  pre-existing — NOT caused by Plan 03-06. They don't manifest in CI
  (which always runs against a fresh DB). Out of scope for this plan.

## Self-Check: PASSED

Verified via direct file existence + commit log + DB introspection.

### Files

| Path                                                              | Status |
| ----------------------------------------------------------------- | ------ |
| lib/agency-seeds/fhfa/README.md                                   | FOUND  |
| lib/agency-seeds/fhfa/2026-conforming-limit-values-by-county.csv  | FOUND (user-committed at f9259f3) |
| scripts/seed-agency.ts                                            | FOUND (modified) |
| tests/schema/fhfa-loan-limits.test.ts                             | FOUND (modified) |
| .planning/phases/03-audit-log-agency-rule-encoding/03-06-SUMMARY.md | FOUND  |

### Commits

| Hash    | Status |
| ------- | ------ |
| 1e0a816 | FOUND  |
| df04089 | FOUND  |
| 5982436 | FOUND  |
| f9259f3 (user, pre-spawn) | FOUND  |

### Database state (after pnpm db:seed)

| Property                                                                                           | Verified |
| -------------------------------------------------------------------------------------------------- | -------- |
| 1 conforming_loan_limit_version row at year=2026 with text form `[2026-01-01,)`                    | YES      |
| `upper_inf(effective_period)` returns true for the 2026 row (REVIEWS.md B10)                       | YES      |
| 3,235 conforming_loan_limit_county rows (within 3,000–3,300 acceptance window)                     | YES      |
| 160 high-cost counties (≥50 acceptance window)                                                     | YES      |
| LA County 06037 stored with one_unit_baseline=1,249,125 + is_high_cost=true                        | YES      |
| Autauga AL 01001 stored with one_unit_baseline=832,750 + is_high_cost=false                        | YES      |
| Honolulu HI 15003 stored with one_unit_baseline=1,249,125 + is_high_cost=true                      | YES      |
| pnpm typecheck exits 0                                                                              | YES      |
| pnpm test:schema tests/schema/fhfa-loan-limits.test.ts → 17/17 pass                                | YES      |
| Idempotency: re-INSERT on existing (limit_version_id, county_fips) returns rowCount=0              | YES      |
| program_version FK dereference works with conforming_loan_limit_version_id non-null AND null       | YES      |
| Plan literal-grep acceptance criteria: 7/7 pass                                                    | YES      |
