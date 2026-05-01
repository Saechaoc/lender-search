---
last_mapped_commit: 78f1733137651248ed0cf7e02bf3cf8ad36f1c83
last_mapped_date: 2026-05-01
focus: concerns
scope_paths:
  - db
  - tests
  - lib
  - scripts
exclusions:
  - src
review_source: .planning/phases/02-rule-schema/02-REVIEW.md
review_findings:
  critical: 1
  warning: 5
  info: 7
  total: 13
---

# Codebase Concerns

**Analysis Date:** 2026-05-01

## Tech Debt

### Legacy React 19 Prototype Being Retired

**Issue:** The 1775-line single-file React 19 prototype at `src/App.js` carries hardcoded SEED_PROGRAMS / SEED_LENDERS, in-component scenario evaluation, and a localStorage-resident Claude API key. The October 2025 Optimal Blue antitrust posture, the citation-discipline contract, and the RLS-enforced multi-tenant architecture make the prototype unsalvageable.
- Files: `src/App.js` (excluded from active mapping scope)
- Status: **Deliberately retired** — Phase 2 onward targets the Next.js 16 + Supabase + Drizzle stack established in `.planning/research/STACK.md`. Do not extend the prototype. New code lands under `db/`, `lib/`, `tests/`, and (forward) `app/`.
- Replacement work in flight:
  - `db/schema/` (Drizzle TS schema) and `db/migrations/` (drizzle-kit + --custom DDL) replace the inline SEED_PROGRAMS data structure.
  - `lib/rules/schemas/` (17 Zod schemas) replaces ad-hoc field validation.
  - `lib/tenant/context.ts` (`setTenantContext` GUC primitive) replaces the prototype's single-user posture.
  - `tests/rls/` (cross-tenant pen tests with FORCE RLS sanity checks) replaces the prototype's "trust the client" model.
- Migration policy: no compatibility shim, no shared modules. The prototype is a reference for the eligibility-decision UX shape only; its code is not imported anywhere in `db/`, `lib/`, `tests/`, or `scripts/`.

### Reducto + Claude Vision Extraction Pipeline NOT YET WIRED

**Issue:** The research phase resolved the primary extraction stack (Reducto for OCR + Reducto + Claude Sonnet 4.6 vision consensus-pass mitigation as fallback per `.planning/research/STACK.md`) but no code exists yet. The `lib/extraction/` and `lib/staging/` directories are absent.
- Files: `lib/extraction/` (does not exist), `lib/staging/` (does not exist)
- Impact: Phase 7 work — blocks the AM matrix-PDF upload → staging-table draft path. Until this lands, every `program_rule` row is hand-authored or test-fixture-only. The `extraction_run_id uuid` column on `program_rule` (`db/schema/program-rule.ts:80`) is a NULL plain column waiting on the FK target table.
- Fix approach: Phase 7 lands `staging.draft_rule` / `staging.draft_rule_field_confidence` / `staging.extraction_run` tables + the Inngest durable workflow + Reducto SDK wiring. The Phase 2 schema is forward-compatible — Phase 7 adds the staging schema as a parallel namespace and the FK-add migration to `program_rule.extraction_run_id`.

### Pure-TS Evaluator at `lib/eval/` NOT IMPLEMENTED

**Issue:** Phase 4 work — the canonical `evaluate(scenario, snapshot)` entry point per `CLAUDE.md` (Architecture §2) does not exist. The 17 Zod schemas in `lib/rules/schemas/` carry rule-shape documentation referencing a Phase 4 evaluator that the codebase cannot yet exercise (e.g., `lib/rules/schemas/ltv-max.ts:2-3`, `lib/rules/schemas/occupancy-allow.ts:8`).
- Files: `lib/eval/` (does not exist)
- Impact: Phase 2 ships the rule schema + storage + dispatch table only. There is no synchronous eligibility-decision hot path. Phase 3 hand-authoring + Phase 5 golden-set acceptance both require this directory.
- Fix approach: Phase 4 lands `lib/eval/evaluate.ts` (canonical entry point) + per-`rule_kind` reducer functions + the `RuleSnapshot` hydrator. The evaluator is dependency-free (no DB, no framework, no I/O) so it stays portable per `CLAUDE.md` (Conventions §"Pure-TS evaluation engine").

### Allow-list Zod Schema Defaulting Inconsistency (WR-03 from 02-REVIEW.md)

**Issue:** Four allow-list schemas reject `{}` without `.default([])`, while sibling schemas accept `{}` with array defaults. The shape inconsistency is a footgun for the Phase 7 extraction pipeline — a missing key in extracted JSON sometimes parses, sometimes throws, depending on `rule_kind`.
- Files:
  - `lib/rules/schemas/occupancy-allow.ts:13-15` (no default)
  - `lib/rules/schemas/purpose-allow.ts:13-23` (no default)
  - `lib/rules/schemas/property-type-allow.ts:14-23` (no default)
  - `lib/rules/schemas/doc-type-allow.ts:14-25` (no default)
  - `lib/rules/schemas/geo-state.ts:21-24` (allowList/denyList default `[]`)
  - `lib/rules/schemas/geo-county.ts:16-22` (entries default `[]`)
  - `lib/rules/schemas/manual-uw-path.ts:14-17` (compensatingFactors default `[]`)
  - `lib/rules/schemas/mi-required.ts:12-15` (providers default `[]`)
  - `lib/rules/schemas/derog-seasoning.ts:90,94` (post_event_LTV_caps + notes_citations default `[]`)
- Impact: Extraction-pipeline regressions could silently route some rule_kinds through `parseRuleBody` without `values` and others throw — making the extraction error budget rule-kind-dependent.
- Fix approach: Either (a) add `.default([])` to the four allow-list schemas for symmetry, or (b) document explicitly per-schema that an empty `values` array is structurally rejected (an allow-list with no values is meaningless). Pick one posture and codify in `lib/rules/schemas/index.ts`.

### Duplicated SYSTEM Tenant + Agency-Version Bootstrap (WR-05 from 02-REVIEW.md)

**Issue:** `tests/rls/seedTwoTenants.ts` and `tests/schema/fixtures/seed.ts` implement nearly identical SYSTEM-tenant lookup/create + agency_rule_version daterange-randomization logic. Both files use `2100 + Math.floor(Math.random() * 100000)` as the start year. Any future change to widen the random range or use a different daterange shape needs to land in both files.
- Files:
  - `tests/rls/seedTwoTenants.ts:67-127` (`seedSharedAgency` helper)
  - `tests/schema/fixtures/seed.ts:77-147` (`seedAgencyDerogRule` helper)
- Impact: Drift risk — a subtle change to one fixture's COMMIT semantics or agency-tenant bootstrap could leave the other fixture broken in CI without surfacing the divergence at code-review time.
- Fix approach: Extract a shared `tests/_shared/agency-fixture.ts` module that both suites import. Refactor candidate, not a v1 blocker.

### Test-Suite Brittleness — Numeric Text Equality (IN-02 from 02-REVIEW.md)

**Issue:** `tests/schema/min-confidence-generated.test.ts:21` asserts `expect(result.rows[0]?.min_confidence).toBe('0.7')`. The Postgres `pg` driver returns `numeric` columns as text; the literal stringification of `0.7` is `'0.7'` today but the column is typed `numeric` (no precision/scale) which can yield `'0.70000000000000000000'` under some configurations or future precision changes.
- Files: `tests/schema/min-confidence-generated.test.ts:21`
- Impact: Future Postgres or `pg` driver upgrade could flip the format and cause a brittle CI failure unrelated to the underlying GENERATED-column semantics.
- Fix approach: Compare numerically: `expect(Number(result.rows[0]?.min_confidence)).toBeCloseTo(0.7, 5)`.

### Vitest Schema Config Couples Zod-Only Tests to DB Setup (IN-04 from 02-REVIEW.md)

**Issue:** `vitest.schema.config.ts:24` includes both `tests/schema/**/*.test.ts` (DB-bound) and `tests/rules/**/*.test.ts` (pure-Zod) under the same `tests/schema/setup.ts` which constructs `pg.Pool` connections that the Zod tests don't need.
- Files: `vitest.schema.config.ts:24`, `tests/schema/setup.ts:40-47`
- Impact: On a fresh checkout without docker-compose running, the Zod tests fail because the pool can't connect even though they don't query the DB.
- Fix approach: Split into two configs — `vitest.zod.config.ts` (no DB setup, includes only `tests/rules/**`) and `vitest.schema.config.ts` (DB setup, includes only `tests/schema/**`). Update `package.json` `test:schema` to run both.

## Known Bugs

### Latent: `detect_loosenings` numeric branch fails-open on missing `value` key (WR-01 from 02-REVIEW.md)

**Issue:** The numeric-comparison `UNION ALL` branch casts `rule_body->>'value'` to `numeric` without first checking the JSON key exists. If a malformed `program_rule.rule_body` is missing `value`, the cast `(NULL)::numeric` returns NULL; `NULL > NULL` returns NULL; the row is silently filtered from results. The function thus fails open: a malformed overlay rule that should be flagged as a data-quality error is invisible.
- Files: `db/migrations/0006_detect_loosenings.sql:67-84`
- Trigger: A direct admin INSERT or a Phase 7 extraction-pipeline regression that lands an overlay row missing the `value` key for an `ltv_max` / `cltv_max` / `hcltv_max` / `dti_max` / `fico_min` / `reserves_min` rule_kind. The `program_rule.rule_body` column is structurally constrained only to `jsonb_typeof = 'object'` (`db/migrations/0004_program_constraints.sql:89-100`); shape validation is enforced in `lib/rules/schemas/` at the application layer, not the database.
- Workaround: Pre-INSERT `parseRuleBody(kind, body)` in `lib/rules/schemas/index.ts:83` will throw on shape mismatch, masking the gap — but only if the caller actually uses the dispatch table. Direct admin INSERTs bypass it.
- Fix: Add structural guards before the cast:
  ```sql
  WHERE p.rule_kind IN ('ltv_max', 'cltv_max', 'hcltv_max', 'dti_max')
    AND p.overlay_body ? 'value'
    AND p.agency_body ? 'value'
    AND (p.overlay_body->>'value')::numeric > (p.agency_body->>'value')::numeric
  ```
  Optionally surface "missing value key" rows as a separate `dimension='__malformed__'` so AM review catches them. Same pattern applies to the allow-list comparison (IN-05) on `db/migrations/0006_detect_loosenings.sql:109-114`.

### Latent: `jsonb_min_numeric` raises on non-numeric values (WR-02 from 02-REVIEW.md)

**Issue:** `jsonb_min_numeric(j jsonb)` does `MIN((value)::numeric) FROM jsonb_each_text(j)` over every key in the input. If `field_confidence` ever contains a non-numeric value (e.g., a stray `{"flag": true}` or `{"x": "high"}`), the cast raises `invalid input syntax for type numeric`. Because this expression powers a GENERATED ALWAYS AS STORED column on `program_rule.min_confidence` and `agency_rule.min_confidence`, the failure surfaces at INSERT/UPDATE time and rejects the entire row.
- Files: `db/migrations/0004_program_constraints.sql:46-53,59-65`
- Trigger: A Phase 7 extraction-pipeline regression that produces non-numeric values in `field_confidence` (which isn't constrained in the Zod dispatch table — it's a separate per-field metadata object the extraction pipeline writes).
- Test coverage: `tests/schema/min-confidence-generated.test.ts` covers only the happy-path numeric case (line 10-23) and the empty-default case (line 25-38). No test exercises the failure mode.
- Workaround: None at the application layer — the failure is in the GENERATED expression.
- Fix: Either (a) document the invariant strongly and add an explicit failure test, or (b) make the wrapper resilient by filtering to numeric-shaped values:
  ```sql
  CREATE OR REPLACE FUNCTION jsonb_min_numeric(j jsonb) RETURNS numeric
    LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT
  AS $$
    SELECT MIN((value)::numeric)
    FROM jsonb_each_text(j)
    WHERE value ~ '^-?[0-9]+(\.[0-9]+)?$'
  $$;
  ```

### Resolved (regression risk): `detect_loosenings` Cartesian-explosion fix (CR-01 from 02-REVIEW.md)

**Issue:** The Phase 2 implementation of `detect_loosenings` originally JOINed `agency_rule` to overlay rules ON `rule_kind` only. For `rule_kind='derog_seasoning'`, an `agency_rule_version` typically holds many rows (one per `event_type`: BK7, BK13_DISCHARGED, FORECLOSURE, MULTIPLE_BK, etc., per the `derogEventType` enum at `lib/rules/schemas/derog-seasoning.ts:35-46`). An overlay containing one `derog_seasoning` row (BK7 with `base_waiting_months=24`) was paired with EVERY agency `derog_seasoning` row, producing Cartesian comparisons like BK7-vs-FORECLOSURE that yielded false-positive loosening flags. Phase 2's single-event FORECLOSURE fixture (`tests/rules/fixtures/fnma-foreclosure.ts`) masked the bug; it would have surfaced in Phase 3 hand-authoring fan-out.
- Files: `db/migrations/0006_detect_loosenings.sql:88-104` (fixed in commit `6f6cfef`)
- Status: Fixed — the `derog_seasoning` UNION branch now JOINs on `event_type` (`db/migrations/0006_detect_loosenings.sql:98`) and the regression test at `tests/schema/detect-loosenings.test.ts:38-111` asserts BK7-vs-FORECLOSURE never cross-pairs.
- Regression risk: A future migration that drops the `event_type` qualifier (e.g., during a refactor that switches to a generic comparison-helper function) silently re-introduces the false-positive flag. The regression test must run on every PR touching `0006_detect_loosenings.sql`.

## Security Considerations

### CRITICAL: FK-to-foreign-program data-integrity gap (Pitfall 3.5)

**Risk:** Postgres FK target row check bypasses RLS by design — it walks `pg_class` directly to verify the target row exists, without applying the policy that would otherwise hide tenant A's program from tenant B. Tenant B can INSERT a `lender_overlay_rule` with `applies_to_program_id` pointing at tenant A's `program.id` and the INSERT succeeds (`rowCount=1`).
- Files: `tests/rls/lender-overlay-cross-tenant.test.ts:122-174` (test deliberately documents the OBSERVED Postgres behavior with a real assertion, not documentation theater)
- Schema: `db/schema/lender-overlay-rule.ts:40` (`appliesToProgramId` FK references `program(id)` without RLS-aware predicate)
- Current mitigation:
  - RLS still prevents tenant B from SEEING tenant A's program — the inconsistency is purely structural (B's overlay row references a program it cannot read).
  - Cross-tenant SELECT pen test (`tests/rls/lender-overlay-cross-tenant.test.ts:73-120`) confirms B's overlays remain invisible to A even when admin-inserted.
- Recommendations: **Phase 12 LOV-01..03 commit transaction MUST add an application-layer guard** before promoting overlay drafts to canonical:
  ```sql
  -- Application-layer check during Phase 12 LOV commit transaction
  SELECT 1 FROM program WHERE id = $applies_to_program_id
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  -- Reject the commit if zero rows.
  ```
  This is the explicit Phase 12 boundary tracked in `02-CONTEXT.md` `<deferred>` section under "Brokerage LENDER_OVERLAY author UI — Phase 12 v2 (LOV-01..03)". Pitfall 3.5 (tenant isolation breached by shared overlay) is a stronger variant of this — the Phase 12 commit guard closes both.

### Hardcoded `app_user_password` in `scripts/init-db.sh` (IN-01 from 02-REVIEW.md)

**Risk:** `CREATE ROLE app_user LOGIN PASSWORD 'app_user_password' NOBYPASSRLS NOSUPERUSER` hardcodes the dev-database password. The same string then appears in `tests/rls/setup.ts:62` and `tests/rls/global-setup.ts:44` as the `app_user:app_user_password` → `postgres:postgres` substitution rule.
- Files: `scripts/init-db.sh:5`, `tests/rls/setup.ts:62`, `tests/rls/global-setup.ts:44`, `tests/schema/setup.ts:32`
- Current mitigation:
  - The script is dev-only (local docker-compose bootstrap); the password ships in source so dev parity is guaranteed.
  - app_user has `NOBYPASSRLS NOSUPERUSER` so a leaked password still cannot read other tenants' data — the RLS policies enforce isolation regardless of who connects.
  - Phase 6 wires Supabase Auth + JWT-based `app.tenant_id` GUC (per `CLAUDE.md` §Technology Stack); the password-based posture goes away when production deploys land.
- Recommendations:
  - Document explicitly in `scripts/init-db.sh:1-2` that this script is dev-only.
  - Parameterize via env var: `CREATE ROLE app_user LOGIN PASSWORD '${APP_USER_PASSWORD:-app_user_password}'` so prod / staging deployments can override without editing the script.
  - Verify CI's GitHub Actions secrets path takes precedence over committed `.env` defaults (already handled by `loadDotenv` not overriding pre-set env vars in `tests/rls/global-setup.ts:36-37`).

### `geoStateSchema` mutual-exclusion deferred to AM commit (WR-04 from 02-REVIEW.md)

**Risk:** A rule_body of `{ allowList: ['CA'], denyList: ['CA'] }` parses without error at the Zod layer. The Phase 4 evaluator (per the schema's header comment at `lib/rules/schemas/geo-state.ts:7-10`) would handle this as "if allow non-empty: ∈ allow; if deny non-empty: ∉ deny" — for CA, both conditions evaluate, and the deny condition wins (CA fails). Implicit handling means a rule author who unintentionally double-lists CA produces a confusing eligibility outcome.
- Files: `lib/rules/schemas/geo-state.ts:18-25`
- Current mitigation: The deferred boundary is valid (AM commit is the appropriate enforcement point). Nothing tracks the deferral except a code comment.
- Recommendations:
  - Add a documenting test in `tests/rules/allow-list-kinds.test.ts` that asserts the schema accepts overlapping allow/deny lists at parse time, with a comment pointing at the Phase 8 AM commit boundary.
  - Phase 8 AM commit task list must explicitly carry the `geo_state` mutual-exclusion check.

### Service-Role Boundary Test Surface

**Risk:** `agency_rule_version` and `agency_rule` are system-owned with the `*_world_read` (FOR SELECT TO public) and `*_system_write` (FOR ALL TO system_role) policy pair (`db/migrations/0002_program_schema.sql:127-129`). Pen tests must confirm a public INSERT against an agency table fails (Pitfall E).
- Files:
  - `tests/rls/service-role-boundary.test.ts` (1.7KB — present but small surface)
  - `db/schema/agency-rule.ts:54-60` (system_role write policy)
  - `db/schema/agency-rule-version.ts:50-56` (system_role write policy)
- Current mitigation: The system_role write boundary is structurally defined at the policy level. `agency_rule_version` does NOT have FORCE ROW LEVEL SECURITY (`db/migrations/0005_force_rls_agency.sql:14-16` documents the omission rationale: world_read makes FORCE redundant for SELECT and writes are gated by role).
- Recommendation: Extend `tests/rls/service-role-boundary.test.ts` to assert that an `app_user` connection (which lacks the system_role grant) cannot INSERT/UPDATE/DELETE on either agency table (Pitfall E coverage).

## Performance Bottlenecks

### `program_rule` Confidence-Sorted Queue (Phase 8 Hot Path)

**Problem:** Phase 8 AM review queue ORDERs by `min_confidence` ASC to surface low-confidence rows first. The `min_confidence` column is GENERATED ALWAYS AS STORED on every row, but a full table scan on `program_rule` at scale (Phase 11+ with thousands of programs and tens of thousands of rules per tenant) becomes the bottleneck.
- Files: `db/migrations/0004_program_constraints.sql:127-129` (partial index)
- Cause: Without an index, the queue query degrades to a sequential scan + sort.
- Improvement path: A partial index `program_rule_min_confidence_idx ON program_rule (min_confidence) WHERE min_confidence IS NOT NULL` already lands at Phase 2. The partial filter keeps the index small (rows with empty `field_confidence` have NULL `min_confidence` and are excluded). Phase 8 query plan must use this index — verify with `EXPLAIN ANALYZE` once row counts grow.

### `detect_loosenings` Function Latency at Scale

**Problem:** The function performs a self-JOIN on `paired` (overlay × agency_rule) followed by 4 UNION ALL filtered scans. For a program with 50 overlay rules and an agency_rule_version with 50 rows, the inner pairing produces up to 2500 row-pairs before per-kind filtering.
- Files: `db/migrations/0006_detect_loosenings.sql:46-65`
- Cause: No covering index on `agency_rule (agency_rule_version_id, rule_kind)` is targeted at the post-pairing filter; the existing `agency_rule_version_kind_idx` (`db/migrations/0002_program_schema.sql:120`) helps the inner JOIN but the per-kind UNION arms each re-scan `paired`.
- Improvement path: Phase 8 AM commit transaction calls this function pre-commit (per the function header comment at `db/migrations/0006_detect_loosenings.sql:11-12`). At Phase 8 scale (one program at a time, ~50 overlay rules), latency is acceptable. If Phase 11+ batch validates many programs in one pass, materialize `paired` as a CTE and verify the planner doesn't re-execute it per UNION arm.

### `agency_rule` Partial Expression Index — Phase 4 Evaluator Read Path

**Problem:** Phase 4 evaluator's SC#2 query path is `WHERE rule_kind='derog_seasoning' AND rule_body->>'event_type'='FORECLOSURE'`. Without a covering index, this becomes a sequential scan on `agency_rule` with a JSON-extraction filter.
- Files: `db/migrations/0004_program_constraints.sql:120-122`
- Current mitigation: The partial expression index `agency_rule_derog_event_idx ON agency_rule (rule_kind, (rule_body->>'event_type')) WHERE rule_kind = 'derog_seasoning'` covers the SC#2 query path. Phase 3 fills `agency_rule` with ~50 rows; Phase 4 evaluator hot path will hit this index.
- Improvement path: Verify with `EXPLAIN ANALYZE` once Phase 3 lands the full hand-authored agency rule set. If Phase 5 golden-set throughput requires it, extend the partial-index pattern to other high-cardinality `rule_body` extractions (e.g., `dscr_method.numerator_rule`, `income_doc_method.method`).

## Fragile Areas

### Vitest 4 Module-Context Boundary (Plan 01-06 §Rule 3 deviation)

**Issue:** Vitest 4's `globalSetup` and `setupFiles` run in DIFFERENT module contexts. The `globalThis.__pgAdminPool` set in `tests/rls/global-setup.ts:135-138` may not survive into `tests/rls/setup.ts`. The codebase works around this defensively by ALSO constructing an `__pgAdminPool` in `setup.ts:90-93`, but the duplication is brittle: any future contributor may assume one or the other is canonical.
- Files:
  - `tests/rls/global-setup.ts:53-61,135-138` (declare global + assign in globalSetup)
  - `tests/rls/setup.ts:50,90-93` (declare global + reassign in setupFiles)
  - `tests/schema/setup.ts:20-23,44-47` (same pattern in tests/schema)
- Why fragile: The defensive double-construction works as long as both paths use the same connection string. A future change to globalSetup-only logic that depends on globalThis state propagating to setupFiles will silently fail when the propagation doesn't happen.
- Safe modification: Update both `global-setup.ts` and `setup.ts` together; never assume the assignment in one survives into the other. Document the pattern at the top of each `setup.ts`. If Vitest 5+ ships a fix that unifies the contexts, drop the defensive construction.
- Test coverage: The pattern is exercised by every pen-test file's `beforeAll` — if propagation fails, `seedTwoTenants` raises with `'seedTwoTenants requires adminPool (or globalThis.__pgAdminPool) for agency_rule_version seeding (Pitfall G)'` (`tests/rls/seedTwoTenants.ts:243-247`). Failure is loud, not silent.

### Tenant Bootstrap Pattern (Pitfall 7)

**Issue:** The `tenant` table's self-filtering policy `using id = current_setting('app.tenant_id', true)::uuid` (`db/schema/tenant.ts:48-54`) means a new tenant insert needs `app.tenant_id` GUC matching the new tenant_id BEFORE the INSERT. The pattern is:
1. Generate the new tenant's UUID server-side (`gen_random_uuid()`).
2. `set_config('app.tenant_id', new_uuid, true)` in the same transaction.
3. INSERT INTO tenant (id, ...) VALUES (new_uuid, ...). WITH CHECK passes because id == GUC.
- Files:
  - `tests/rls/seedTwoTenants.ts:154-163` (canonical implementation)
  - `tests/schema/fixtures/seed.ts:27-36` (duplicated implementation)
  - `lib/tenant/context.ts:25-31` (documents the pattern; no helper yet)
- Why fragile: The pattern is enforced by RLS, not by code structure. A new contributor writing a tenant-seeding helper without the `set_config` line gets a silent `WITH CHECK` failure that surfaces only when the policy fires. The error message ("new row violates row-level security policy for table tenant") doesn't point at the missing GUC.
- Safe modification: Always wrap tenant creation in: BEGIN → SELECT gen_random_uuid → set_config → INSERT tenant → INSERT child rows → COMMIT. Phase 6 should land a `lib/tenant/createTenant.ts` helper that codifies this so future code can call `createTenant(adminPool, kind, name)` instead of re-implementing.

### Agency-Table Writes Require postgres adminPool (Pitfall G)

**Issue:** `agency_rule_version` and `agency_rule` have `agency_rule_*_system_write` policies that grant ALL to `system_role` only. The `app_user` role is NOBYPASSRLS NOSUPERUSER and is NOT a member of `system_role` — it can only SELECT (per `db/migrations/0005_force_rls_agency.sql:27-28`). Tests that try to INSERT agency rows via the `app_user`-backed pool fail with a non-obvious "new row violates row-level security policy" error.
- Files:
  - `db/schema/agency-rule.ts:54-60` (system_role write policy)
  - `db/schema/agency-rule-version.ts:50-56` (system_role write policy)
  - `tests/rls/seedTwoTenants.ts:67-127` (uses `adminPool` for agency seeds)
  - `tests/schema/fixtures/seed.ts:77-147` (uses `adminPool` for agency seeds)
- Why fragile: The role-routing requirement is enforced by the policy, not by code structure. A test author writing a new agency-fixture helper might use the wrong pool (the app_user pool) and get the policy-violation error without context. The pattern is codified in `seedSharedAgency` / `seedAgencyDerogRule` but not enforced.
- Safe modification: Always pass an `adminPool` parameter (postgres-superuser connection) to agency-side fixture helpers. Document at function header. Phase 3 hand-authoring CLI / route handler MUST connect via a postgres role granted `system_role` (per `scripts/init-db.sh:30-31` `GRANT system_role TO postgres`).

### Drizzle 0.45 Cannot Express FORCE RLS, EXCLUDE, GENERATED, CHECK, CREATE EXTENSION

**Issue:** Drizzle 0.45's schema API does not model:
1. `FORCE ROW LEVEL SECURITY` (Pitfall 2 / Plan 01-05 deviation)
2. `EXCLUDE USING gist` constraints (Pitfall I / Plan 02-06)
3. `GENERATED ALWAYS AS STORED` columns referencing IMMUTABLE functions (Pitfall C)
4. Multi-value `CHECK` constraints with elegant column-level syntax
5. `CREATE EXTENSION` (btree_gist required by EXCLUDE)
6. Partial expression indexes on jsonb-extracted columns
- Files:
  - `db/migrations/0001_force_rls.sql` — Phase 1 FORCE RLS workaround
  - `db/migrations/0003_force_rls_program.sql` — Phase 2 FORCE RLS workaround
  - `db/migrations/0004_program_constraints.sql` — all five DDL gaps as `--custom` SQL
  - `db/migrations/0005_force_rls_agency.sql` — partial-FORCE on lender_overlay_rule
- Why fragile: Hand-rolled `--custom` SQL bypasses drizzle-kit's diff-tracking. A subsequent `drizzle-kit generate` may miss schema-side changes that should also be reflected in the custom DDL. Plan 02-06's migration ordering matters (btree_gist FIRST, jsonb_min_numeric BEFORE the GENERATED column ALTER, EXCLUDE AFTER the columns exist).
- Safe modification:
  - Never edit `0002_program_schema.sql` by hand — drizzle-kit may regenerate it on the next schema change. Custom DDL goes in a NEW `--custom` migration file.
  - Maintain migration order: extension → wrapper function → ALTER columns → EXCLUDE → CHECK → indexes (per `0004_program_constraints.sql:16-29` ordering documentation).
  - When Drizzle ships native support for any of (1)-(6), migrate one at a time and verify the diff matches the existing custom SQL byte-for-byte.

## Scaling Limits

### Daterange Random Window Collision Risk (long CI runs)

**Issue:** `seedSharedAgency` and `seedAgencyDerogRule` generate non-overlapping `effective_period` ranges via `2100 + Math.floor(Math.random() * 100000)` start year (`tests/rls/seedTwoTenants.ts:104`, `tests/schema/fixtures/seed.ts:88`). The 100,000-year window is large enough that collision probability for a typical test run is negligible. But the SYSTEM tenant accumulates `agency_rule_version` rows across runs without truncation (the COMMIT in `seedSharedAgency` persists), so an extremely long-running CI environment (or a development DB that never gets truncated) could eventually accumulate enough rows to make collisions probable.
- Files: `tests/rls/seedTwoTenants.ts:104-105`, `tests/schema/fixtures/seed.ts:88-89`
- Current capacity: ~100,000 distinct daterange windows before collision probability becomes meaningful. With the EXCLUDE constraint at `db/migrations/0004_program_constraints.sql:78-80`, a collision raises `conflicting key value violates exclusion constraint`.
- Limit: Test runs cannot accumulate >100k SYSTEM-tenant `agency_rule_version` rows without TRUNCATE. The Phase 1 + Phase 2 globalSetup TRUNCATE handles fresh CI runs (`tests/rls/global-setup.ts:81-86`). Local development DBs are at risk after months of seed accumulation without truncation.
- Scaling path: (a) widen the random window to 1M years, or (b) add a CI-side step that truncates the SYSTEM-tenant rows on schedule, or (c) extract the daterange-randomization logic into a single shared helper so a future "use UUID-derived non-overlapping ranges" change applies uniformly.

### `program_rule` JSON Body Validation Throughput

**Issue:** Phase 7 extraction will INSERT thousands of `program_rule` rows per matrix-PDF upload. Each row requires `parseRuleBody(kind, body)` (`lib/rules/schemas/index.ts:83`) before INSERT. Zod parse cost per row is ~microseconds for simple shapes (`ltv_max`, `fico_min`), milliseconds for complex shapes (`derog_seasoning` with nested `post_event_LTV_caps`).
- Files: `lib/rules/schemas/index.ts:83-85`, `lib/rules/schemas/derog-seasoning.ts:85-95`
- Current capacity: Single-row latency dominates write batch latency at small scale. At Phase 7 scale (one matrix → ~30-50 rules), Zod parse adds <100ms total.
- Limit: At Phase 11 scale (multi-tenant batch re-validation across 200+ programs × 50+ rules), Zod parse becomes a 10-100s blocker on a single-process synchronous loop.
- Scaling path: Phase 7+ extraction pipeline runs under Inngest (per `CLAUDE.md` §Technology Stack); each rule parse can run in parallel within a fan-out step. Document the constraint in `lib/rules/schemas/index.ts` so future contributors don't add I/O inside `parseRuleBody`.

## Dependencies at Risk

### Drizzle 0.45 — Schema-API Gap Coverage

**Risk:** Six DDL features (listed in "Fragile Areas → Drizzle 0.45 Cannot Express ...") are hand-rolled `--custom` SQL because Drizzle 0.45 doesn't model them. A future Drizzle major release that ADDS native support could land features that conflict with the existing custom SQL.
- Files: `db/migrations/0004_program_constraints.sql`, `db/migrations/0001_force_rls.sql`, `db/migrations/0003_force_rls_program.sql`, `db/migrations/0005_force_rls_agency.sql`
- Impact: Drizzle upgrade may emit duplicate `CREATE EXTENSION btree_gist`, conflicting `ALTER TABLE ... FORCE ROW LEVEL SECURITY`, or schema-diff DDL that overlaps with hand-rolled migrations.
- Migration plan: When upgrading Drizzle, run `drizzle-kit generate --check` in dry-run mode against an empty database; verify the generated DDL matches existing migrations byte-for-byte. If Drizzle upgrades support ANY of FORCE / EXCLUDE / GENERATED / CHECK / EXTENSION / partial-expression-index natively, replace the `--custom` migration one feature at a time, with a regression test asserting `pg_class.relforcerowsecurity` / `pg_constraint` / `pg_attribute.attgenerated` semantics persist across the migration.

### Postgres 16 → Future Major (RLS + FK target check)

**Risk:** The FK-to-foreign-program data-integrity gap (`tests/rls/lender-overlay-cross-tenant.test.ts:122-174`) is documented Postgres behavior — FK target checks bypass RLS at the system level. A future Postgres major could change this (either propagate RLS into FK target checks, or surface a new opt-in policy attribute).
- Files: `tests/rls/lender-overlay-cross-tenant.test.ts:155-174` (test asserts CURRENT behavior with `expect(result.rowCount).toBe(1)`)
- Impact: A Postgres patch flipping the behavior from SUCCESS to FAILURE silently regresses the OBSERVED-behavior assertion. The test would break loudly (assertion fails), which is the desired outcome.
- Migration plan: When upgrading Postgres major versions, re-run the full pen-test suite and verify all FK-to-foreign-program tests still pass. If behavior flips, the Phase 12 LOV-01..03 application-layer guard becomes redundant (good news) — drop the guard and document why.

## Missing Critical Features

### Phase 4 Evaluator (`lib/eval/`)

**Problem:** No `evaluate(scenario, snapshot)` entry point exists. The 17 Zod schemas at `lib/rules/schemas/` document a Phase 4 evaluator that the codebase cannot exercise.
- Blocks:
  - Phase 5 Golden Set acceptance test (≥98% precision / ≥95% recall) — there's nothing to evaluate against.
  - Phase 0 exit gate.
  - All customer-visible UI work (Phase 6+).
- Files: `lib/eval/` (does not exist)
- Required surface: `evaluate(scenario, snapshot) → { decision, rule_stack, deciding_rule, near_miss }` per `CLAUDE.md` §Architecture §2.

### Phase 7 Extraction Pipeline (Reducto + Claude Sonnet 4.6)

**Problem:** The research-resolved primary extraction stack (Reducto for OCR, Reducto + Claude vision consensus pass as fallback) has no code. `staging.draft_rule` / `staging.draft_rule_field_confidence` / `staging.extraction_run` tables don't exist; the Inngest durable workflow isn't wired.
- Blocks: AM matrix-PDF upload UX (Phase 7 surface), the AM three-pane review (Phase 8), and the GTM exit gates (Phase 11).
- Files: `lib/extraction/` (does not exist), `lib/staging/` (does not exist)
- Required surface: Multi-step Inngest workflow: OCR → structural parse → LLM normalization → overlay diff → confidence scoring; idempotent per step; idempotency keys per matrix sha256.

### Append-Only `evaluation_event` Audit Log

**Problem:** Phase 0 sub-phase 3 (audit + agency rules) lands the append-only `evaluation_event` table with `REVOKE UPDATE, DELETE` from app_user enforced at the database level. The current Phase 2 schema does NOT include this table. Phase 4 evaluator must write to it on every evaluation.
- Blocks: Bitemporal replay (per `CLAUDE.md` §Conventions §"Append-only audit log"), forensic post-incident analysis, antitrust-defensible audit trail.
- Files: Not yet created.
- Required surface: `evaluation_event(id, ruleset_snapshot_id sha256, scenario_payload_hash, rule_stack jsonb, deciding_rule_id, created_at)` partitioned by month.

## Test Coverage Gaps

### `detect_loosenings` SECURITY INVOKER + Cross-Tenant RLS Interaction (IN-06 from 02-REVIEW.md)

**Issue:** The function's `program_rule` FROM clause is RLS-policed (the function runs as the caller, `LANGUAGE sql STABLE SECURITY INVOKER` per `db/migrations/0006_detect_loosenings.sql:42-44`). If the caller's GUC doesn't match the program_version's tenant_id, the JOIN returns zero rows and the function silently emits an empty result. This is correct fail-closed behavior, but no test exercises it.
- Files:
  - `db/migrations/0006_detect_loosenings.sql:33-45` (function definition)
  - `tests/schema/detect-loosenings.test.ts` (tests in-tenant cases only)
- Risk: A future regression (e.g., changing to `SECURITY DEFINER` for performance) would silently break the antitrust posture.
- Priority: Medium. Add a test: "calling `detect_loosenings` with a `program_version_id` from another tenant returns 0 rows even when the program has known loosenings."

### `jsonb_min_numeric` Failure-Mode Test

**Issue:** `tests/schema/min-confidence-generated.test.ts` covers happy-path (line 10-23), empty default (line 25-38), and rejection of explicit writes to GENERATED column (line 40-53). It does NOT cover the failure mode where `field_confidence` contains a non-numeric value and the cast raises.
- Files: `tests/schema/min-confidence-generated.test.ts`
- Risk: A Phase 7 extractor regression could land non-numeric confidence values and silently reject every row, surfacing as "extraction succeeded but no rows visible" downstream.
- Priority: High (paired with WR-02 fix). Add a test that asserts the failure with a clear error message.

### `tenant.kind` Schema Sanity Check (IN-07 from 02-REVIEW.md)

**Issue:** The `tests/rls/setup.ts` `beforeAll` validates FORCE RLS (line 113-132) and policy presence (line 138-159) but does not validate the `tenant.kind` column exists. Fixtures INSERT `kind='BROKERAGE'` (`tests/rls/seedTwoTenants.ts:161`) and `kind='SYSTEM'` (line 84). If Phase 1's `tenant` schema were modified to drop `kind`, the failure surfaces deep inside the fixture rather than as an upfront sanity check.
- Files: `tests/rls/setup.ts:85-160`, `tests/rls/seedTwoTenants.ts:84,161-163`
- Risk: Low priority. Phase 1's schema is stable, but adding the check is a cheap signal to future migrations.
- Priority: Low. Extend the policy/relforcerowsecurity sanity check at `tests/rls/setup.ts:113-159` to also verify `tenant.kind` exists.

### Allow-list `detect_loosenings` Branch (IN-05 from 02-REVIEW.md)

**Issue:** The allow-list comparison `NOT ((p.agency_body->'values') @> (p.overlay_body->'values'))` (`db/migrations/0006_detect_loosenings.sql:118`) silently passes on missing `values` key. If either side has no `values` key, the JSON path returns NULL, the `@>` comparison returns NULL, and `NOT NULL` is NULL — the row is filtered out (treated as not-a-loosening). A malformed allow-list overlay (missing `values`) thus does not get flagged.
- Files: `db/migrations/0006_detect_loosenings.sql:109-118`
- Risk: Same fail-open posture as WR-01. A direct admin INSERT bypassing the Zod dispatch table can produce undetectable malformed rows.
- Priority: Medium. Add structural guards: `AND p.overlay_body ? 'values' AND p.agency_body ? 'values'`.

### Zod-Only Vitest Config Split

**Issue:** Pure-Zod tests at `tests/rules/**` run under `vitest.schema.config.ts` which constructs `pg.Pool` connections. On a fresh checkout without docker-compose running, the Zod tests fail because the pool can't connect even though they don't query the DB.
- Files: `vitest.schema.config.ts:24`
- Risk: First-run friction for new contributors. Misleading error messages mask the actual issue (DB not running) as a Zod test failure.
- Priority: Low (not blocking). Split into `vitest.zod.config.ts` (no DB setup, includes `tests/rules/**`) and `vitest.schema.config.ts` (DB setup, includes `tests/schema/**`).

### `seedTwoTenants(pool)` Mixed-Convention Call Sites (IN-03 from 02-REVIEW.md)

**Issue:** Phase 1 baseline tests at `tests/rls/cross-tenant-select.test.ts:13,24,32,42` call `seedTwoTenants(globalThis.__pgPool)` with one argument. The function signature accepts an optional second `adminPool` and falls back to `globalThis.__pgAdminPool` (`tests/rls/seedTwoTenants.ts:241-247`). Phase 2 D-19 tests (e.g., `program-cross-tenant.test.ts:22`) pass both. The mixed convention is documented in the function header but is easy to misuse.
- Files: `tests/rls/cross-tenant-select.test.ts`, `tests/rls/seedTwoTenants.ts:237-247`
- Risk: A new test author may not pass the adminPool, get the globalThis fallback, and trip the Vitest 4 module-context boundary issue (the fallback may be `undefined` if propagation fails).
- Priority: Low. Either standardize on always-passing-both at all call sites, or remove the optional parameter and always read from globalThis (with a clearer error message if missing).

---

*Concerns audit: 2026-05-01*
*Source review: `.planning/phases/02-rule-schema/02-REVIEW.md` (1 Critical, 5 Warning, 7 Info)*
*Last mapped commit: `78f1733137651248ed0cf7e02bf3cf8ad36f1c83`*
