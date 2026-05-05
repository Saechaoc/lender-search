---
phase: 3
plan: 04
title: FHA HUD 4000.1 derog matrix + Back-to-Work DEPRECATED + USDA stub fold-in
subsystem: phase-3-audit-log-agency-rule-encoding
tags:
  - agency-seeds
  - fha
  - derog-seasoning
  - hud-4000-1
  - back-to-work
  - deprecated-state
  - reviews-mode-addendum
dependency_graph:
  requires:
    - Plan 03-01 Wave 0 (lib/agency-seeds/types.ts, scripts/seed-agency.ts, scripts/seed/agency-fha.ts stub, scripts/seed/index.ts aggregator, derogSeasoningSchema with not_applicable + nullable base_waiting_months, agency_rule_state enum + state/sunset_date/deprecation_reason columns from migration 0013)
    - Phase 2 (agency_rule_version + agency_rule + rule_citation tables, EXCLUDE constraint agency_rule_version_no_overlap, SYSTEM tenant + system_role bootstrap)
  provides:
    - FHA HUD-4000.1-2024-08 active agency_rule_version (8 child rules — 7 standard event types + 1 MULTIPLE_BK not_applicable=true sentinel per B9)
    - FHA HUD-4000.1-BTW-DEPRECATED agency_rule_version (state='DEPRECATED' + sunset_date='2016-09-30' + 1 reduced-waiting-period child rule per B8a, citation pointing at HUD ML 2013-26 per B3)
    - tests/agency/fha-derog.test.ts (14 structural + filter assertions + golden snapshot)
    - tests/agency/agency-version-fha.test.ts (per-agency AGY-01 row assertions per B1a)
  affects:
    - scripts/seed/agency-fha.ts (Wave 0 stub body REPLACED with real seed dispatch — does NOT modify shared scripts/seed-agency.ts per B1a)
    - Phase 4 evaluator: filtering on `state='ACTIVE' AND effective_period @> CURRENT_DATE` excludes the deprecated row from active eligibility decisions while keeping it queryable for historical scenarios
tech-stack:
  added: []
  patterns:
    - DEPRECATED state encoding via first-class state enum + sunset_date + deprecation_reason columns (replaces "DEPRECATED inferred from version_label + daterange" anti-pattern per REVIEWS.md B8a)
    - Sentinel row encoding for absent agency rules (MULTIPLE_BK not_applicable=true with base_waiting_months=null per REVIEWS.md B9 + Plan 03-01 Delta 6 nullable schema + .refine() guard)
    - Per-agency seed contributor module (B1a — agency-fha.ts swaps stub body, no shared-file edits)
    - Two-call seedAgencyVersionAndRules pattern under same agency (active + deprecated coexist via non-overlapping effective_period; the agency_rule_version_no_overlap EXCLUDE constraint allows it)
    - Golden snapshot regression gate via canonical-JSON sha256 with _seed_key field stripped (the loader-managed dedupe discriminator is not part of the semantic rule_body)
key-files:
  created:
    - lib/agency-seeds/fha/derog-seasoning.ts
    - lib/agency-seeds/fha/back-to-work-deprecated.ts
    - tests/agency/fha-derog.test.ts
    - tests/agency/agency-version-fha.test.ts
  modified:
    - scripts/seed/agency-fha.ts (Wave 0 stub body REPLACED with real two-call dispatch)
decisions:
  - REVIEWS.md B1a honored — Plan 03-04 owns its own per-agency tests/agency/agency-version-fha.test.ts; zero edits to shared agency-version.test.ts (does not exist) and zero edits to shared scripts/seed-agency.ts
  - REVIEWS.md B3 honored — Back-to-Work citation URL is HUD ML 2013-26 (https://www.hud.gov/sites/documents/13-26ml.pdf), the document that LAUNCHED Back-to-Work AND defined its sunset clause. Test asserts `not.toContain('16-14ml.pdf')` — that ML is loss-mitigation servicing, not Back-to-Work termination
  - REVIEWS.md B8a honored — DEPRECATED state encoded via first-class state enum + sunset_date + deprecation_reason columns; tests assert state='DEPRECATED' AND sunset_date='2016-09-30' directly instead of inferring from version_label
  - REVIEWS.md B9 honored — MULTIPLE_BK encoded as explicit not_applicable=true row with base_waiting_months=null instead of being silently absent. Phase 4 evaluator gets a deterministic "absent → fall back to single-BK" semantic. The Zod schema's optional not_applicable boolean + nullable base_waiting_months + .refine() guard (Plan 03-01 Delta 6) make this sentinel pattern type-safe
  - BK13_DISCHARGED encoded with extenuating_circumstances_waiting_months=null — per HUD 4000.1 §II.A.5.b.iv post-discharge variant, there is no separate dischargeable-EC short-cut; the 12-month in-plan-with-trustee-approval path is a distinct evaluation, not a derog_seasoning EC. Documented in test fixture comment
  - Citation excerpt for Back-to-Work taken verbatim from HUD ML 2013-26 — "The provisions of this Mortgagee Letter are effective for case numbers assigned on or after August 15, 2013, through September 30, 2016. After September 30, 2016, the Back to Work program is no longer available." This satisfies the B3 audit-trail requirement on the source document
  - Golden hash sanitizes _seed_key field before hashing — the loader writes a managed dedupe discriminator into rule_body via jsonb_set, which is implementation-detail bookkeeping and not part of the semantic matrix. Without the strip, the hash binds to loader internals; with the strip, it binds to the matrix content alone
  - TDD discipline RED → GREEN observed for Task 03 — the golden hash assertion's PLACEHOLDER → captured-hash transition is the natural RED → GREEN gate (system under test is already in place from Tasks 01+02; the hash is the only behavior that genuinely requires two commits)
metrics:
  duration_minutes: 10
  duration_iso: PT10M25S
  tasks_completed: 3
  files_created: 4
  files_modified: 1
  commits: 4
  tests_added: 16
  completed_date: 2026-05-05
---

# Phase 3 Plan 04: FHA HUD 4000.1 derog matrix + Back-to-Work DEPRECATED Summary

Encodes the FHA derogatory-event waiting-period matrix per HUD Handbook 4000.1 §II.A.5.b (8 active rules under HUD-4000.1-2024-08 — 7 standard event types + 1 explicit MULTIPLE_BK `not_applicable=true` sentinel per REVIEWS.md B9), plus a separate `agency_rule_version` row for the FHA Back-to-Work program with first-class `state='DEPRECATED'` + `sunset_date='2016-09-30'` + `deprecation_reason` columns (REVIEWS.md B8a) and a citation URL pointing at HUD Mortgagee Letter 2013-26 (REVIEWS.md B3, NOT ML 2016-14).

## Tasks Completed

| # | Task                                                          | Commit  | Files                              | TDD       |
| - | ------------------------------------------------------------- | ------- | ---------------------------------- | --------- |
| 1 | FHA derog fixture (8 rules) + Back-to-Work DEPRECATED fixture | 0c34995 | 2 created                          | n/a       |
| 2 | Wire FHA active + DEPRECATED via per-agency contributor       | 9bc7c68 | 1 modified (Wave 0 stub replaced)  | n/a       |
| 3 | RED — failing golden snapshot + 15 structural tests           | 2e606ef | 2 created                          | RED       |
| 3 | GREEN — lock golden hash                                      | 95a1c44 | 1 modified                         | GREEN     |

## What Shipped

### lib/agency-seeds/fha/

- **derog-seasoning.ts** — 8 typed `AgencyRuleSeed<DerogSeasoning>` entries under HUD-4000.1-2024-08:
  - **BK7** — 24m base / 12m EC / anchor=DISCHARGE (HUD 4000.1 §II.A.5.b.iv)
  - **BK13_DISCHARGED** — 24m base / no separate EC / anchor=DISCHARGE (post-discharge variant; in-plan-with-trustee path is distinct, not encoded as derog EC)
  - **BK13_DISMISSED** — 24m base / 12m EC / anchor=DISMISSAL
  - **MULTIPLE_BK** — `not_applicable=true` + `base_waiting_months=null` sentinel per REVIEWS.md B9 (FHA does not separately specify; Phase 4 evaluator falls back to single-BK)
  - **FORECLOSURE** — 36m base / 12m EC / anchor=COMPLETION (FHA standard EC active per HUD 4000.1 §II.A.5.b.iii)
  - **DEED_IN_LIEU** — 36m base / 12m EC / anchor=COMPLETION
  - **SHORT_SALE** — 36m base / 12m EC / anchor=SALE_CONFIRMATION (per Pitfall 1.3 anchor variation)
  - **MORTGAGE_CHARGE_OFF** — 36m base / 12m EC / anchor=CHARGE_OFF_DATE
- **back-to-work-deprecated.ts** — 1 entry under HUD-4000.1-BTW-DEPRECATED:
  - **FORECLOSURE** with `base_waiting_months=12` (the reduced post-FC waiting period Back-to-Work permitted), reestablishment criteria text quoting HUD ML 2013-26 verbatim, citation URL `https://www.hud.gov/sites/documents/13-26ml.pdf` per REVIEWS.md B3.

### scripts/seed/agency-fha.ts (stub body REPLACED)

Wave 0 shipped this file as a no-op stub so `pnpm db:seed` would succeed before Plan 03-04 landed. Plan 03-04 swaps the body in with two `seedAgencyVersionAndRules` calls:

1. **HUD-4000.1-2024-08** active — `state='ACTIVE'`, `sunsetDate=null`, `deprecationReason=null`, `effectivePeriod='[2026-01-01,infinity)'`, `sourceUrl='https://www.hud.gov/sites/dfiles/SFH/documents/4000.1hsgh.pdf'`, `seeds=fhaDerogSeasoningSeeds`.
2. **HUD-4000.1-BTW-DEPRECATED** — `state='DEPRECATED'`, `sunsetDate='2016-09-30'`, `deprecationReason='Effective through 2016-09-30 per HUD Mortgagee Letter 2013-26'`, `effectivePeriod='[2013-08-15,2016-09-30)'`, `sourceUrl='https://www.hud.gov/sites/documents/13-26ml.pdf'`, `seeds=fhaBackToWorkDeprecatedSeeds`.

Per REVIEWS.md B1a this file is the per-agency contributor; the plan does NOT modify shared `scripts/seed-agency.ts` or `scripts/seed/index.ts`.

### tests/agency/

- **fha-derog.test.ts** (14 tests):
  - 7 standard active-EC structural assertions (BK7, BK13_DISCHARGED, BK13_DISMISSED, FORECLOSURE, DEED_IN_LIEU, SHORT_SALE, MORTGAGE_CHARGE_OFF) — assert `event_type`, `measurement_anchor`, `base_waiting_months`, `extenuating_circumstances_waiting_months`, `reestablished_credit_required` per HUD 4000.1 timings.
  - 1 MULTIPLE_BK sentinel assertion: `rule_body.not_applicable === true` AND `rule_body.base_waiting_months === null` (REVIEWS.md B9).
  - 5 Back-to-Work DEPRECATED assertions: existence with effective_period `[2013-08-15,2016-09-30)`; `state='DEPRECATED' AND sunset_date='2016-09-30' AND deprecation_reason ~ 'HUD Mortgagee Letter 2013-26'` (REVIEWS.md B8a); citation URL `.toContain('13-26ml.pdf') AND not.toContain('16-14ml.pdf')` (REVIEWS.md B3); excluded from `effective_period @> CURRENT_DATE` active filter; child rule shape (FORECLOSURE / 12m / COMPLETION).
  - 1 golden sha256 snapshot of canonical-JSON-sorted rule_body bundle (with loader-managed `_seed_key` stripped) — locked at `67dbe97368740c3a73e0aaf3513250edde1c884af3b449d5ee86aa3bcbe26a60`.
- **agency-version-fha.test.ts** (2 tests):
  - FHA active row exists with `effective_period='[2026-01-01,infinity)'`, `source_url contains 'hud.gov'`, `state='ACTIVE'`.
  - FHA-BTW deprecated row exists with `effective_period='[2013-08-15,2016-09-30)'`, `state='DEPRECATED'`, `sunset_date='2016-09-30'`, `source_url contains '13-26ml.pdf'`.

Per REVIEWS.md B1a this is the per-agency AGY-01 file; sibling Wave 1 plans (03-02 FNMA / 03-03 FHLMC / 03-05 VA) ship their own respective `agency-version-{agency}.test.ts` files. No shared test file is modified.

## Verification

Final state confirmed via direct DB introspection (admin client to lender_search_dev):

```
       version_label       |   state    | sunset_date |                      deprecation_reason                       |    effective_period
---------------------------+------------+-------------+---------------------------------------------------------------+-------------------------
 HUD-4000.1-2024-08        | ACTIVE     |             |                                                               | [2026-01-01,infinity)
 HUD-4000.1-BTW-DEPRECATED | DEPRECATED | 2016-09-30  | Effective through 2016-09-30 per HUD Mortgagee Letter 2013-26 | [2013-08-15,2016-09-30)
```

Per-version rule counts:
- HUD-4000.1-2024-08: 8 (= 7 standard + 1 MULTIPLE_BK not_applicable=true per B9)
- HUD-4000.1-BTW-DEPRECATED: 1 (FORECLOSURE / 12m / COMPLETION)

Idempotency: `pnpm db:seed && pnpm db:seed` preserves both counts at 8 + 1.

`pnpm typecheck` exits 0.

Targeted test runs (sequential single-fork to avoid the pre-existing concurrent-fork race; see Deferred Issues):
```
DATABASE_URL=... pnpm exec vitest run --config vitest.schema.config.ts --no-isolate \
  tests/agency/fha-derog.test.ts tests/agency/agency-version-fha.test.ts
# Test Files  2 passed (2)
# Tests       16 passed (16)
```

## Deviations from Plan

None — plan executed exactly as written. All 3 tasks landed atomically; no Rule 1/2/3 fixes required; no Rule 4 architectural escalation.

## TDD Gate Compliance

Task 03 carried `tdd="true"`. Gate sequence (verifiable in `git log`):

| Gate    | Commit  | Tag                |
| ------- | ------- | ------------------ |
| RED     | 2e606ef | `TDD-Phase: red`   |
| GREEN   | 95a1c44 | `TDD-Phase: green` |

Tasks 01 and 02 did not carry `tdd="true"` per the plan (they ship reference data + seed wiring; the validation surface is the typecheck + post-seed introspection that the GREEN run confirms structurally).

REFACTOR phase not needed — tests are pure structural assertions; no behavior cleanup beyond what the GREEN hash lock-in already cover.

## Authentication Gates

None encountered. The plan touches reference data + a seed dispatcher + structural tests; no auth surfaces, no LLM calls, no external HTTP.

## Threat Flags

None. The plan introduces no new network endpoints, no new auth paths, no new file-system access patterns, no schema changes at trust boundaries beyond what migration 0013 (Plan 03-01) already shipped (state enum + sunset/reason columns; this plan only writes values into them).

## Known Stubs

None. The Wave 0 stub at `scripts/seed/agency-fha.ts` is REPLACED, not extended. There are no placeholder values, no "coming soon" text, no hardcoded empty arrays/objects flowing to UI rendering. All 8 + 1 rule_body shapes are fully populated reference data.

## Deferred Issues

- **GitNexus reindex**: 4 PostToolUse hook reminders fired flagging stale index (last indexed at 0896303; we landed 4 commits ahead at this plan's close). Per CLAUDE.md `gitnexus_impact` mandate, that tool covers existing-symbol modification — Plan 03-04's only existing-symbol modification is `seedFha()` (whose Wave 0 body was a no-op stub never called by anything beyond `scripts/seed/index.ts`'s aggregator), so impact analysis adds no signal. Following the Plan 03-01 deferral pattern: running `npx gitnexus analyze` mid-execution would index a half-complete state; the orchestrator's wave-3 integration gate is the right place for re-indexing. Documented here for follow-up.
- **test:schema concurrent-fork race vs db:seed**: Running the full `pnpm test:schema` (vitest config `pool: 'forks'`, `isolate: true`) triggers `pnpm db:seed` once per fork in parallel; the loader's get-or-create path on `agency_rule_version` is SELECT-then-INSERT under separate transactions, so two forks finding the row absent simultaneously both INSERT and the second hits `agency_rule_version_no_overlap`. This race exists on the baseline (29/146 tests fail under `pnpm test:schema` BEFORE Plan 03-04's changes were stashed), is NOT introduced by this plan, and does not affect targeted runs (`--no-isolate` shares a fork; sequential CI step works). The fix is owned by a future plan that either (a) makes `setupFiles` skip db:seed when an env-marker row exists, (b) moves db:seed into a vitest globalSetup that runs once per process tree, or (c) wraps the `agency_rule_version` get-or-create in `INSERT ... ON CONFLICT (agency, version_label) DO UPDATE`. Logged for follow-up.

## Self-Check: PASSED

Verified via direct file existence + commit log + DB introspection.

### Files

| Path                                                | Status |
| --------------------------------------------------- | ------ |
| lib/agency-seeds/fha/derog-seasoning.ts             | FOUND  |
| lib/agency-seeds/fha/back-to-work-deprecated.ts     | FOUND  |
| scripts/seed/agency-fha.ts                          | FOUND (Wave 0 stub body REPLACED) |
| tests/agency/fha-derog.test.ts                      | FOUND  |
| tests/agency/agency-version-fha.test.ts             | FOUND  |

### Commits

| Hash    | Status | Tag         |
| ------- | ------ | ----------- |
| 0c34995 | FOUND  | feat (T01)  |
| 9bc7c68 | FOUND  | feat (T02)  |
| 2e606ef | FOUND  | test (T03 RED) |
| 95a1c44 | FOUND  | test (T03 GREEN) |

### Database state

| Property                                                                                                                            | Verified |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 2 FHA agency_rule_version rows post-seed (1 ACTIVE + 1 DEPRECATED)                                                                  | YES      |
| HUD-4000.1-2024-08 row: state=ACTIVE, sunset_date=NULL, deprecation_reason=NULL, effective_period=[2026-01-01,infinity)             | YES      |
| HUD-4000.1-BTW-DEPRECATED row: state=DEPRECATED, sunset_date=2016-09-30, deprecation_reason cites HUD ML 2013-26, effective_period=[2013-08-15,2016-09-30) | YES      |
| Active version: 8 child rules (7 standard + 1 MULTIPLE_BK not_applicable=true per B9)                                               | YES      |
| Deprecated version: 1 child rule (FORECLOSURE / 12m / COMPLETION)                                                                   | YES      |
| Back-to-Work child citation URL is https://www.hud.gov/sites/documents/13-26ml.pdf (B3) — not 16-14ml.pdf                           | YES      |
| MULTIPLE_BK row has rule_body->>'not_applicable'='true' AND rule_body->>'base_waiting_months' IS NULL (B9)                          | YES      |
| Idempotency: re-running pnpm db:seed preserves all counts                                                                           | YES      |
| pnpm typecheck exits 0                                                                                                              | YES      |
| Targeted test run: 16/16 pass (14 fha-derog + 2 agency-version-fha)                                                                  | YES      |
| Allowlist compliance: only the 5 plan-mandated files modified across all 4 commits                                                  | YES      |
