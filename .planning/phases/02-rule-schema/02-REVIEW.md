---
phase: 02-rule-schema
reviewed: 2026-04-30T00:00:00Z
depth: standard
files_reviewed: 70
files_reviewed_list:
  - db/migrations/0002_program_schema.sql
  - db/migrations/0003_force_rls_program.sql
  - db/migrations/0004_program_constraints.sql
  - db/migrations/0005_force_rls_agency.sql
  - db/migrations/0006_detect_loosenings.sql
  - db/schema/_types/daterange.ts
  - db/schema/agency-rule-version.ts
  - db/schema/agency-rule.ts
  - db/schema/index.ts
  - db/schema/lender-overlay-rule.ts
  - db/schema/program-rule.ts
  - db/schema/program-version.ts
  - db/schema/program.ts
  - db/schema/rule-citation.ts
  - db/schema/system-role.ts
  - lib/rules/schemas/cltv-max.ts
  - lib/rules/schemas/derog-seasoning.ts
  - lib/rules/schemas/doc-type-allow.ts
  - lib/rules/schemas/dscr-method.ts
  - lib/rules/schemas/dti-max.ts
  - lib/rules/schemas/fico-min.ts
  - lib/rules/schemas/geo-county.ts
  - lib/rules/schemas/geo-state.ts
  - lib/rules/schemas/hcltv-max.ts
  - lib/rules/schemas/income-doc-method.ts
  - lib/rules/schemas/index.ts
  - lib/rules/schemas/ltv-max.ts
  - lib/rules/schemas/manual-uw-path.ts
  - lib/rules/schemas/mi-required.ts
  - lib/rules/schemas/occupancy-allow.ts
  - lib/rules/schemas/property-type-allow.ts
  - lib/rules/schemas/purpose-allow.ts
  - lib/rules/schemas/reserves-min.ts
  - package.json
  - scripts/init-db.sh
  - tests/rls/cross-tenant-select.test.ts
  - tests/rls/cross-tenant-write.test.ts
  - tests/rls/global-setup.ts
  - tests/rls/guc-reset.test.ts
  - tests/rls/index-scan.test.ts
  - tests/rls/jwt-tampering.test.ts
  - tests/rls/lender-overlay-cross-tenant.test.ts
  - tests/rls/program-cross-tenant.test.ts
  - tests/rls/program-rule-cross-tenant.test.ts
  - tests/rls/program-version-cross-tenant.test.ts
  - tests/rls/rule-citation-cross-tenant.test.ts
  - tests/rls/seedTwoTenants.ts
  - tests/rls/setup.ts
  - tests/rules/allow-list-kinds.test.ts
  - tests/rules/derog-seasoning.test.ts
  - tests/rules/dispatch-table.test.ts
  - tests/rules/dscr-method.test.ts
  - tests/rules/fixtures/fnma-foreclosure.ts
  - tests/rules/income-doc-method.test.ts
  - tests/rules/numeric-kinds.test.ts
  - tests/schema/agency-cross-tenant-readable.test.ts
  - tests/schema/agency-rule-version-exclude.test.ts
  - tests/schema/citation-fk.test.ts
  - tests/schema/citation-source-check.test.ts
  - tests/schema/derog-rule-roundtrip.test.ts
  - tests/schema/detect-loosenings.test.ts
  - tests/schema/fixtures/seed.ts
  - tests/schema/min-confidence-generated.test.ts
  - tests/schema/program-rule-layer-check.test.ts
  - tests/schema/program-version-exclude.test.ts
  - tests/schema/setup.ts
  - vitest.schema.config.ts
findings:
  critical: 1
  warning: 5
  info: 7
  total: 13
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-04-30T00:00:00Z
**Depth:** standard
**Files Reviewed:** 67
**Status:** issues_found

## Summary

Phase 2 lands the core rule schema (program / program_version / program_rule / agency_rule_version / agency_rule / lender_overlay_rule / rule_citation), the bitemporal EXCLUDE constraints, the `min_confidence` generated column with its IMMUTABLE wrapper, the `detect_loosenings` SQL function, the 17-kind Zod dispatch table, and the cross-tenant pen-test extension. The structural shape closely follows the plan's CONTEXT.md decisions (D-01 through D-20) and the project's antitrust posture (RLS + FORCE RLS + tenant-scoped citations + system_role-gated agency writes).

The cross-tenant pen-test coverage is comprehensive — every new tenant-scoped table has the full D-03 matrix (cross-tenant SELECT/INSERT/UPDATE/DELETE + anonymous + in-tenant). The `lender_overlay_rule` test deliberately documents and asserts the Postgres FK-target-bypass-RLS edge case (a real hardening gap deferred to Phase 12 LOV-01..03 with an explicit data-integrity note), which is the right call for v1.

The most consequential issue is in **`detect_loosenings`**: the `derog_seasoning` UNION branch joins agency rules on `rule_kind` only, producing a Cartesian pairing across `event_type`s that yields false positives once any agency_rule_version has more than one `derog_seasoning` row (CR-01). The fixture in Phase 2 has only FORECLOSURE, masking the bug; Phase 3 hand-authoring will surface it immediately.

A handful of warnings cover null-safety in the same function, type-coercion failure modes in `jsonb_min_numeric`, and minor schema-defaulting inconsistencies in the allow-list Zod schemas. Several informational items document brittleness in test infrastructure (hardcoded credentials, fixture COMMIT side effects, brittle text equality in numeric assertions) that are acceptable for v1 but should be tracked.

## Critical Issues

### CR-01: `detect_loosenings` derog_seasoning branch joins on rule_kind only — Cartesian across event_types

**File:** `db/migrations/0006_detect_loosenings.sql:54-65,88-100`
**Issue:** The `paired` CTE joins `agency_rule` to overlay rules ON `ar.rule_kind = ovr.rule_kind`. For `rule_kind='derog_seasoning'`, an agency_rule_version typically holds many rows (one per `event_type`: BK7, BK13_DISCHARGED, FORECLOSURE, MULTIPLE_BK, etc., per Phase 3 hand-authoring per `derogEventType` enum in `lib/rules/schemas/derog-seasoning.ts:35-46`). An overlay containing one `derog_seasoning` row (say, BK7 with `base_waiting_months=24`) gets paired with EVERY agency `derog_seasoning` row. The UNION branch at line 94-100 then compares the BK7 overlay's `base_waiting_months` against the FORECLOSURE agency's `base_waiting_months=84` and flags a "loosening" — but they are different events, so the comparison is meaningless and produces false positives that will block legitimate AM commits in Phase 8.

The Phase 2 test fixture (`tests/rules/fixtures/fnma-foreclosure.ts`) has only one `derog_seasoning` event (FORECLOSURE), and `tests/schema/detect-loosenings.test.ts` only tests `ltv_max` — so the bug is not exercised. As soon as Phase 3 lands BK7 + BK13 + FORECLOSURE under one `agency_rule_version`, the function emits spurious loosenings.

**Fix:**

```sql
-- derog_seasoning: overlay's base_waiting_months and
-- extenuating_circumstances_waiting_months must be >= agency. Match on
-- event_type so BK7 overlay is compared only against BK7 agency, not against
-- FORECLOSURE agency (which would Cartesian-explode the JOIN).
SELECT
  p.overlay_id, p.agency_id, p.rule_kind::text,
  p.agency_body, p.overlay_body
FROM paired p
WHERE p.rule_kind = 'derog_seasoning'
  AND p.overlay_body->>'event_type' = p.agency_body->>'event_type'  -- ADD THIS
  AND (
    COALESCE((p.overlay_body->>'base_waiting_months')::int, 0) <
      COALESCE((p.agency_body->>'base_waiting_months')::int, 0)
    OR COALESCE((p.overlay_body->>'extenuating_circumstances_waiting_months')::int, 0) <
      COALESCE((p.agency_body->>'extenuating_circumstances_waiting_months')::int, 0)
  )
```

Add a corresponding test in `tests/schema/detect-loosenings.test.ts`:

```typescript
it('derog_seasoning: overlay BK7 with shorter wait is NOT flagged when agency has FORECLOSURE 84mo (different event_type)', async () => {
  // Seed agency FORECLOSURE 84mo + agency BK7 48mo + overlay BK7 24mo.
  // Expect: detect_loosenings flags BK7 (24 < 48) but NOT BK7-vs-FORECLOSURE.
});
```

## Warnings

### WR-01: `detect_loosenings` numeric branch lacks event_type qualifier safety on rule_body shape

**File:** `db/migrations/0006_detect_loosenings.sql:67-84`
**Issue:** The numeric comparisons cast `rule_body->>'value'` to `numeric` without checking that the JSON key exists. If a malformed `program_rule.rule_body` is missing `value`, the cast `(NULL)::numeric` returns NULL; `NULL > NULL` returns NULL; the row is silently filtered from results. The function thus fails open: a malformed overlay rule that should be flagged as a data-quality error is invisible. This is mitigated upstream by the Zod schemas (parsed pre-INSERT in Phase 7+) but `rule_body` is structurally only constrained to `jsonb_typeof = 'object'` at the database layer (migration 0004 line 89-100). A direct admin INSERT or a Phase 7 extraction bug could land a malformed row.

**Fix:** Add explicit shape filtering or COALESCE-with-distinct-failure-marker:

```sql
WHERE p.rule_kind IN ('ltv_max', 'cltv_max', 'hcltv_max', 'dti_max')
  AND p.overlay_body ? 'value'   -- structural guard
  AND p.agency_body ? 'value'    -- structural guard
  AND (p.overlay_body->>'value')::numeric > (p.agency_body->>'value')::numeric
```

Optionally surface "missing value key" rows as a separate dimension (e.g., `'__malformed__'`) so AM review catches them.

### WR-02: `jsonb_min_numeric` will raise on non-numeric jsonb values, blocking inserts

**File:** `db/migrations/0004_program_constraints.sql:46-53,59-65`
**Issue:** `jsonb_min_numeric` does `MIN((value)::numeric) FROM jsonb_each_text(j)` over every key in the input. If `field_confidence` ever contains a non-numeric value (e.g., a stray `{"flag": true}` or `{"x": "high"}`), the cast raises `invalid input syntax for type numeric`. Because this expression powers a GENERATED ALWAYS AS STORED column, the failure surfaces at INSERT/UPDATE time and rejects the entire row. There's no test in `tests/schema/min-confidence-generated.test.ts` covering this failure mode — only the happy-path numeric case (line 10-23) and the empty case (line 25-38).

The Zod schemas don't constrain `field_confidence` shape (it isn't even in the dispatch table — it's a separate per-field metadata object the extraction pipeline writes). A Phase 7 extractor regression could produce non-numeric values and silently reject every row.

**Fix:** Either (a) document the invariant strongly and add a test that asserts the failure, or (b) make the wrapper resilient by filtering to numeric-shaped values:

```sql
CREATE OR REPLACE FUNCTION jsonb_min_numeric(j jsonb) RETURNS numeric
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  RETURNS NULL ON NULL INPUT
AS $$
  SELECT MIN((value)::numeric)
  FROM jsonb_each_text(j)
  WHERE value ~ '^-?[0-9]+(\.[0-9]+)?$'
$$;
```

Then add a test:

```typescript
it('handles field_confidence with non-numeric values gracefully', async () => {
  // INSERT with field_confidence = {"flag": true, "score": 0.8} should
  // either reject loudly or compute min_confidence=0.8 (skip non-numeric).
});
```

### WR-03: Allow-list Zod schemas reject empty/missing `values` (no `.default([])`) — inconsistent with sibling schemas

**File:** `lib/rules/schemas/occupancy-allow.ts:13-15`, `lib/rules/schemas/purpose-allow.ts:13-22`, `lib/rules/schemas/property-type-allow.ts:14-23`, `lib/rules/schemas/doc-type-allow.ts:14-25`
**Issue:** These four schemas all declare `values: z.array(z.enum([...]))` without `.default([])`. Sibling schemas DO default: `geoStateSchema` (allowList/denyList default `[]`), `geoCountySchema` (entries default `[]`), `manualUwPathSchema.compensatingFactors`, `miRequiredSchema.providers`, `derogSeasoningSchema.notes_citations` and `post_event_LTV_caps`. This means parsing `{}` succeeds for `geoState` but throws on `occupancyAllow`. The shape inconsistency is a footgun for the Phase 7 extraction pipeline — a missing key in extracted JSON sometimes parses, sometimes throws, depending on rule_kind.

**Fix:** Either add `.default([])` to the four allow-list schemas for consistency:

```typescript
export const occupancyAllowSchema = z.object({
  values: z.array(z.enum(['PRIMARY', 'SECOND_HOME', 'INVESTMENT'])).default([]),
});
```

Or document explicitly in each schema's header why an empty `values` is structurally rejected (presumably: an allow-list with no values is meaningless). The current state is silently inconsistent.

### WR-04: `geoStateSchema` mutual-exclusion deferred to AM commit but not enforced anywhere yet

**File:** `lib/rules/schemas/geo-state.ts:18-25`
**Issue:** The header comment (lines 7-10) explicitly defers mutual exclusion of `allowList` and `denyList` to AM commit (Phase 8). At Phase 2, a rule_body of `{ allowList: ['CA'], denyList: ['CA'] }` parses without error and would land in the database. The Phase 4 evaluator (per the comment) would handle this as "if allow non-empty: ∈ allow; if deny non-empty: ∉ deny" — for CA, both conditions evaluate, and the deny condition wins (CA fails). But this is implicit; a rule author who unintentionally double-lists may produce confusing eligibility outcomes.

The deferred boundary is valid (AM commit is a reasonable enforcement point), but currently nothing tracks the deferral except a code comment. There is no test asserting "schema accepts overlapping allow/deny" (which would document the intent).

**Fix:** Add a test that documents the deferral:

```typescript
// tests/rules/allow-list-kinds.test.ts
it('geoStateSchema accepts overlapping allow/deny lists at parse time (mutual-exclusion deferred to Phase 8 AM commit)', () => {
  const body = { allowList: ['CA'], denyList: ['CA'] };
  expect(geoStateSchema.parse(body)).toEqual(body);
});
```

And ensure the Phase 8 AM commit task (02-CONTEXT.md `<deferred>` section, if any) explicitly tracks this guard.

### WR-05: `tests/rls/seedTwoTenants.ts` and `tests/schema/fixtures/seed.ts` duplicate the system-tenant + agency-version bootstrap

**File:** `tests/rls/seedTwoTenants.ts:67-127`, `tests/schema/fixtures/seed.ts:77-147`
**Issue:** Both files implement the same logic: look up or create a `kind='SYSTEM'` tenant via the postgres adminPool, set `app.tenant_id` GUC, INSERT a citation, INSERT an `agency_rule_version` with a randomized non-overlapping daterange. The implementations have drifted slightly — `seedTwoTenants.ts:104` uses `2100 + random(100000)` for the start year, identical to `seed.ts:88`, but the magic constants are duplicated and any future change (e.g., to widen the random range to avoid collisions in long CI runs) needs to land in both files.

The COMMIT pattern in both files (line 115 of seedTwoTenants, line 135 of seed) means the SYSTEM tenant and the agency_rule_version persist across test runs without truncation. The randomized daterange protects against EXCLUDE collisions, but the SYSTEM tenant accumulates leftover rows over many runs.

**Fix:** Extract a shared `tests/_shared/agency-fixture.ts` module that both suites import. This is a refactor candidate, not a v1 blocker.

## Info

### IN-01: Hardcoded `app_user_password` in `scripts/init-db.sh`

**File:** `scripts/init-db.sh:5`
**Issue:** `CREATE ROLE app_user LOGIN PASSWORD 'app_user_password'` hardcodes the dev-database password. This is acceptable for local docker-compose bootstrap (the file ships in source so dev parity is guaranteed), but the same string presumably appears in `.env.local` defaults consumed by `tests/rls/setup.ts:62` (`replace('app_user:app_user_password', 'postgres:postgres')`). If anyone copies this pattern into a non-dev environment, the credential leaks.
**Fix:** Document that this script is dev-only; consider parameterizing via env var (`${APP_USER_PASSWORD:-app_user_password}`) so prod / staging deployments can override without editing the script.

### IN-02: `min-confidence-generated.test.ts` brittle text equality on numeric serialization

**File:** `tests/schema/min-confidence-generated.test.ts:21`
**Issue:** `expect(result.rows[0]?.min_confidence).toBe('0.7')`. Postgres returns `numeric` type as text via the `pg` driver; the literal stringification of `0.7` is `'0.7'` in practice but the column is typed `numeric` (no precision/scale) which can yield `'0.70000000000000000000'` under some configurations or future precision changes. The `::text` cast in the SELECT makes this stable today, but the equality check is brittle.
**Fix:** Compare numerically: `expect(Number(result.rows[0]?.min_confidence)).toBeCloseTo(0.7, 5)`.

### IN-03: `seedTwoTenants(pool)` works without explicit adminPool because of globalThis fallback (brittle)

**File:** `tests/rls/cross-tenant-select.test.ts:13,24,32,42`, `tests/rls/seedTwoTenants.ts:241-247`
**Issue:** Phase 1 baseline tests at lines 13/24/32/42 call `seedTwoTenants(globalThis.__pgPool)` with one argument. The function signature accepts an optional second `adminPool` and falls back to `globalThis.__pgAdminPool`. Phase 2 D-19 tests (e.g., `program-cross-tenant.test.ts:22`) pass both. The mixed convention is documented in the function header but is easy to misuse.
**Fix:** Either standardize on always-passing-both at all call sites, or remove the optional parameter and always read from globalThis (with a clearer error message if missing).

### IN-04: `vitest.schema.config.ts` includes Zod-only tests under DB-required setup

**File:** `vitest.schema.config.ts:24`
**Issue:** `include: ['tests/schema/**/*.test.ts', 'tests/rules/**/*.test.ts']` runs both DB-bound schema tests AND pure-Zod unit tests under the same setup. The setup constructs `pg.Pool` connections (`tests/schema/setup.ts:40-47`) that the Zod tests don't need. On a fresh checkout without docker-compose running, the Zod tests fail because the pool can't connect even though they don't query the DB.
**Fix:** Split into two configs: `vitest.zod.config.ts` (no DB setup, includes only `tests/rules/**`) and `vitest.schema.config.ts` (DB setup, includes only `tests/schema/**`). Update `package.json` `test:schema` to run both. Defer if not blocking.

### IN-05: `detect_loosenings` allow-list comparison silently passes on missing `values` key

**File:** `db/migrations/0006_detect_loosenings.sql:109-114`
**Issue:** `NOT ((p.agency_body->'values') @> (p.overlay_body->'values'))` — if either side has no `values` key, the JSON path returns NULL, the `@>` comparison returns NULL, and `NOT NULL` is NULL. The row is filtered out (treated as not-a-loosening). A malformed allow-list overlay (missing `values`) thus does not get flagged.
**Fix:** Add structural guards: `AND p.overlay_body ? 'values' AND p.agency_body ? 'values'` before the comparison. Same as WR-01 pattern.

### IN-06: `detect_loosenings` SECURITY INVOKER + RLS interaction is fail-closed but undocumented in test

**File:** `db/migrations/0006_detect_loosenings.sql:33-65`, `tests/schema/detect-loosenings.test.ts`
**Issue:** The function's `program_rule` FROM clause is RLS-policed (the function runs as the caller). If the caller's GUC doesn't match the program_version's tenant_id, the JOIN returns zero rows and the function silently emits an empty result. This is correct fail-closed behavior, but no test exercises it. A future regression (e.g., changing to `SECURITY DEFINER` for performance) would silently break the antitrust posture.
**Fix:** Add a test: "calling detect_loosenings with a program_version_id from another tenant returns 0 rows even when the program has known loosenings."

### IN-07: `tests/rls/setup.ts` checks `tenant.kind` column existence via `seedTwoTenants` only indirectly

**File:** `tests/rls/setup.ts:85-160`, `tests/rls/seedTwoTenants.ts:161-163,84-87`
**Issue:** The fixtures INSERT `kind='BROKERAGE'` and `kind='SYSTEM'` (lines 84 and 161 of seedTwoTenants), but the setup.ts `beforeAll` doesn't validate that the `tenant.kind` column exists before tests run. If Phase 1's `tenant` schema were modified to drop `kind`, the failure surfaces deep inside the fixture rather than as an upfront sanity check.
**Fix:** Extend the policy/relforcerowsecurity sanity check at `tests/rls/setup.ts:113-159` to also verify `tenant.kind` exists. Low priority — Phase 1's schema is stable.

---

_Reviewed: 2026-04-30T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
