---
phase: 02
phase_name: "rule-schema"
project: "Lender Search"
generated: "2026-05-04"
counts:
  decisions: 15
  lessons: 11
  patterns: 16
  surprises: 7
missing_artifacts: []
---

# Phase 02 Learnings: rule-schema

## Decisions

### Drizzle customType wrapper for `daterange`
Wrap the unmodeled Postgres `daterange` type via `customType<{ data: string }>` with pass-through `fromDriver`/`toDriver` at `db/schema/_types/daterange.ts`.

**Rationale:** Drizzle 0.45 has no native daterange (issue #2647). Postgres serializes daterange as text, so a pass-through wrapper is sufficient and unblocks `program_version.effective_period` + `agency_rule_version.effective_period`.
**Source:** 02-01-SUMMARY.md

---

### `system_role` declared via `pgRole().existing()` (not `.new()`)
Drizzle does not manage the role lifecycle; `scripts/init-db.sh` owns bootstrap (`CREATE ROLE system_role NOLOGIN NOBYPASSRLS NOSUPERUSER`).

**Rationale:** Externally-managed Postgres roles should not be CREATE/DROP'd by ORM tooling. `pgPolicy({ to: systemRole })` only references the role; infrastructure scripts own provisioning.
**Source:** 02-01-SUMMARY.md

---

### Compile-time exhaustiveness on `ruleBodySchemas` dispatch table
Use `as const satisfies Record<RuleKind, z.ZodType>` so adding a `rule_kind` enum value without a matching schema is a TypeScript build error.

**Rationale:** D-09's 17 enum values must be in lockstep with `lib/rules/schemas/*.ts`; compile-time checks catch missing schemas before runtime.
**Source:** 02-01-SUMMARY.md

---

### Standalone `vitest.schema.config.ts` (not an extension of `vitest.config.ts`)
Separate Vitest config for `tests/schema/` + `tests/rules/` so `pnpm test:schema` doesn't drag in `tests/rls/global-setup.ts`.

**Rationale:** rls globalSetup re-runs `drizzle-kit migrate` on every Vitest invocation; Plan 02-07 already migrated. Inheritance would silently double-migrate.
**Source:** 02-01-SUMMARY.md

---

### Zod schemas are TypeScript-only; DB-level validation kept minimal
DB enforces `NOT NULL` + `jsonb_typeof` + `rule_kind` enum only. Body-shape validation lives in Zod at the write boundary.

**Rationale:** Shape changes don't churn migrations (D-08 / RESEARCH §Pattern 6). The dispatch table is the single source of truth for body-shape evolution.
**Source:** 02-01-SUMMARY.md

---

### `program_rule.layer` enum has exactly 2 values
`('INVESTOR_OVERLAY','PRODUCT_FEATURE')` — `AGENCY_BASE` is implicit on `agency_rule` (no layer column); `LENDER_OVERLAY` is implicit on `lender_overlay_rule` (no layer column).

**Rationale:** Anti-Pattern 1 (single `layer` column on every rule table) avoided. Each layer's table is its own structural marker.
**Source:** 02-02-SUMMARY.md

---

### `rule_kind` pgEnum reused across `program_rule` + `agency_rule` + `lender_overlay_rule`
Single Drizzle pgEnum imported into 3 tables produces one Postgres ENUM type at migration generate time.

**Rationale:** Adding a kind requires Drizzle migration AND matching Zod schema in the same PR — keeps the rule taxonomy consistent across tenant-scoped, system-owned, and brokerage-overlay surfaces.
**Source:** 02-02-SUMMARY.md, 02-03-SUMMARY.md

---

### Two-policy shape for system-owned tables (`agency_rule_version`, `agency_rule`)
`world_read` SELECT policy + `system_role` ALL policy; tables intentionally NOT FORCEd.

**Rationale:** RESEARCH §Pattern 2. Pitfall E avoidance — separate write policy keeps the public read policy from also opening writes. World-read enables cross-tenant agency cascade reads.
**Source:** 02-03-SUMMARY.md, 02-05-SUMMARY.md

---

### `lender_overlay_rule.applies_to_program_id` is NULLABLE
NULL = "applies to all programs at this brokerage tenant"; non-NULL = scoped to one program.

**Rationale:** Useful for blanket overlays like "720+ FICO regardless of investor floor". Ships at Phase 2 even though no UI populates it (Pitfall 4.1 — schema instability cascades).
**Source:** 02-03-SUMMARY.md

---

### `EXCLUDE` on `program_version` uses `WHERE (state='active')` partial; agency_rule_version has no partial
Program-side: only one active version per program; deprecated/sunset versions can overlap. Agency-side: one version per agency at a time, period (no `state` column per D-16).

**Rationale:** Different lifecycles: program versions support historical replay; agency versions are linear.
**Source:** 02-06-SUMMARY.md

---

### `detect_loosenings` is `SECURITY INVOKER` (default)
Caller's RLS applies; agency_rule's world_read policy makes the JOIN work regardless of caller tenant.

**Rationale:** RESEARCH Assumption A6. Avoids a security definer that would have to manage tenant context manually.
**Source:** 02-06-SUMMARY.md

---

### `jsonb_min_numeric` is `RETURNS NULL ON NULL INPUT`
Empty `field_confidence='{}'` produces NULL `min_confidence`, not `'0'`.

**Rationale:** Phase 8 queue `WHERE min_confidence < 0.85` treats empty-body rows as missing-data, not low-confidence — semantically distinct.
**Source:** 02-06-SUMMARY.md

---

### FK-to-foreign-program edge case asserted with real assertion (Approach (a))
B-tenant's INSERT into `lender_overlay_rule` with `applies_to_program_id=A_program_id` SUCCEEDS — Postgres FK target check bypasses RLS by design. Test asserts `expect(result.rowCount).toBe(1)`.

**Rationale:** Plan revision 2026-04-30 / Issue W5. Real assertion catches future Postgres patches that might propagate RLS into FK target checks; data-integrity gap documented as a Phase 12 LOV-01..03 commit-transaction guard requirement.
**Source:** 02-09-SUMMARY.md

---

### Relocated seed fixture from `tests/rls/fixtures/tenants.ts` to top-level `tests/rls/seedTwoTenants.ts`
Single source of truth — one seed file, not two.

**Rationale:** Plan stipulated the top-level path; Phase 1 baseline placed it under `fixtures/`. Cleaner to honor the plan's path and update 5 Phase 1 imports than to maintain divergent paths.
**Source:** 02-09-SUMMARY.md

---

### Approach A: single 0002 schema migration covers all 7 new tables
Renumbered `--custom` files: 0003 (force_rls_program), 0004 (constraints, Plan 06), 0005 (force_rls_agency), 0006 (detect_loosenings, Plan 06).

**Rationale:** drizzle-kit emits one diff per generate pass; interleaving --custom files between schema files keeps the journal linear and the FORCE/CHECK/EXCLUDE ordering correct.
**Source:** 02-05-SUMMARY.md, 02-06-SUMMARY.md

---

## Lessons

### `drizzle-kit migrate` stdout/spinner can hang on a fresh DB
drizzle-kit 0.31.10 entered a stuck spinner on the first `pnpm db:migrate` against `db:reset` state.

**Context:** Bypass: apply each migration via `docker compose exec -T postgres psql -v ON_ERROR_STOP=1 < <file>`, then populate `drizzle.__drizzle_migrations` manually with sha256 hashes. Subsequent `pnpm db:migrate` no-ops in <1s.
**Source:** 02-07-SUMMARY.md

---

### Postgres `->` binds tighter than `@>`
`agency_body->'values' @> overlay_body->'values'` parses as `((agency_body->'values' @> overlay_body) -> 'values')` — boolean → text type error.

**Context:** RESEARCH §Pattern 5's allow-list branch shipped this verbatim and broke on the live DB. Fix: wrap each side in parentheses: `(agency_body->'values') @> (overlay_body->'values')`. Caught during Plan 02-07 introspection — would have been masked behind the drizzle-kit hang otherwise.
**Source:** 02-07-SUMMARY.md

---

### Postgres 16's GENERATED column error message changed
Actual error is `cannot insert a non-DEFAULT value into column` (not `cannot insert.*generated column` as RESEARCH suggested).

**Context:** Test regex updated in `min-confidence-generated.test.ts`. Generic substring matches that target Postgres error text are version-fragile.
**Source:** 02-08-SUMMARY.md

---

### Vitest 4.1.5 doesn't accept `--reporter=basic`
The reporter name changed; Vitest 4 resolves `basic` as a path and errors with `Cannot find module 'basic'`. Default reporter is fine; use `--reporter=verbose` for per-task verification.

**Context:** Plans inherited verify scripts from Phase 1 baseline that predated Vitest 4. Plans 02-04 and 02-09 both hit this.
**Source:** 02-04-SUMMARY.md, 02-09-SUMMARY.md

---

### Vitest 4 globalSetup and setupFiles run in distinct module contexts
A `globalThis` set in globalSetup is best-effort across the boundary; setupFiles must defensively construct its own resources.

**Context:** Plan 02-09 setup.ts now constructs `__pgAdminPool` itself (in addition to global-setup.ts setting it). Same pattern Phase 1 hit with dotenv loading.
**Source:** 02-09-SUMMARY.md

---

### `drizzle-kit migrate` treats `__drizzle_migrations` as idempotent — in-place .sql edits don't re-apply
Once a migration is recorded, subsequent edits to the .sql file (e.g., the CR-01 fix to 0006_detect_loosenings.sql) do not re-apply on `pnpm db:migrate`. The deployed function in the running DB stays the pre-fix version.

**Context:** Surfaced as "stale deployment" gaps in UAT — CR-01 (detect_loosenings) and WR-02 (jsonb_min_numeric) both source-correct in commits but failing tests until manual psql replay of the `CREATE OR REPLACE FUNCTION` body. Convention to adopt: post-merge fixes ship as a NEW migration (0007, 0008, …), not in-place edits.
**Source:** 02-UAT.md (Gaps CR-01, WR-02)

---

### `SAVEPOINT` / `ROLLBACK TO SAVEPOINT` for expected-failure tests inside outer transactions
Without it, the expected EXCLUDE failure aborts the outer transaction and the test can't continue to verify the partial WHERE allows different states.

**Context:** Plan 02-08's `program-version-exclude.test.ts` uses this pattern; reusable for any constraint-rejection test that needs to keep asserting after the failure.
**Source:** 02-08-SUMMARY.md

---

### Random non-overlapping daterange per `seedAgencyDerogRule` invocation
Each call needs a unique daterange because the seed COMMITs and the `agency_rule_version_no_overlap` EXCLUDE constraint fires across invocations within a single test run.

**Context:** Year 2100+ random ranges chosen to stay clear of any realistic test data. Same pattern in `seedTwoTenants::seedSharedAgency`.
**Source:** 02-08-SUMMARY.md, 02-09-SUMMARY.md

---

### Stale `eslint-disable` directives accumulate as code modernizes
Underlying lines change (`var` → `let`/`const`, refactors that move patterns) but eslint-disable comments are left behind. ESLint's `reportUnusedDisableDirectives` flags them as warnings.

**Context:** UAT Test 6 surfaced 3 such warnings on `declare global` blocks; `pnpm lint --fix` auto-removes them but leaves whitespace that needs manual cleanup.
**Source:** 02-UAT.md (Gap: Test 6)

---

### Cartesian-join risk in multi-branch CTE function (`detect_loosenings` derog branch)
JOIN on `rule_kind` alone Cartesian-explodes once an `agency_rule_version` holds multiple `derog_seasoning` rows (one per `derogEventType`).

**Context:** Phase 2 fixture has only FORECLOSURE so the bug was masked; surfaced as CR-01 in code review. Fix: add `AND p.overlay_body->>'event_type' = p.agency_body->>'event_type'`. Will recur with any structured rule_kind whose body discriminates by an inner enum.
**Source:** 02-REVIEW-FIX.md (CR-01)

---

### `jsonb_min_numeric` raises on non-numeric jsonb values without a guard
`{"flag": true}` or `{"x": "high"}` in `field_confidence` raises `invalid input syntax for type numeric` inside a GENERATED column expression, blocking the row INSERT entirely.

**Context:** WR-02 fix added `WHERE value ~ '^-?[0-9]+(\.[0-9]+)?$'` to the wrapper. Tradeoff: silent recovery (chosen — Phase 7 extractor regression doesn't break every row write) vs. loud failure (would force shape discipline upstream). Resilience at the DB layer is the safety net.
**Source:** 02-REVIEW-FIX.md (WR-02)

---

## Patterns

### `customType` wrapper at `db/schema/_types/`
For Postgres types Drizzle 0.45 doesn't model natively (daterange, future: tstzrange, ltree).

**When to use:** Any time a column needs a Postgres-native type that Drizzle's column builders don't expose. Pass-through fromDriver/toDriver works when serialization is text-based.
**Source:** 02-01-SUMMARY.md

---

### `pgRole().existing()` for externally-managed roles
Roles whose lifecycle is owned by infrastructure scripts (`scripts/init-db.sh`).

**When to use:** Any Postgres role that exists in production via DBA workflow rather than ORM-managed migrations. Drizzle just references; doesn't CREATE/DROP.
**Source:** 02-01-SUMMARY.md

---

### Per-rule_kind Zod dispatch with `parseRuleBody(kind, body)` entry point
Single function consumed by Phase 4 evaluator + Phase 7 extraction validator + Phase 8 AM commit.

**When to use:** Any discriminated-union shape stored as jsonb where the discriminator column is a pgEnum. Extensible by adding enum value + matching schema; exhaustiveness enforced at compile time.
**Source:** 02-01-SUMMARY.md

---

### Separate Vitest config per test domain
`vitest.schema.config.ts` for `tests/schema/` + `tests/rules/`; `vitest.config.ts` for `tests/rls/`.

**When to use:** When test domains have incompatible globalSetup needs (e.g., DB migrations vs. pure unit). Avoids hidden coupling and double-execution.
**Source:** 02-01-SUMMARY.md

---

### Tenant-scoped table pattern
`tenant_id NOT NULL FK + tenant_idx + canonical pgPolicy with current_setting('app.tenant_id', true)::uuid`.

**When to use:** Every new tenant-scoped Phase 2+ table. Phase 1 D-06 contract carries forward; Phase 2 added 5 tables under this shape.
**Source:** 02-02-SUMMARY.md

---

### Bitemporal table pattern
`effective_period daterange + state text + recorded_at timestamptz` on the table; `EXCLUDE USING gist` declared via `--custom` migration (Drizzle 0.45 doesn't model EXCLUDE natively).

**When to use:** Any versioned record where overlapping active periods must be prevented. State-conditional uniqueness uses `WHERE (state='active')` partial.
**Source:** 02-02-SUMMARY.md, 02-06-SUMMARY.md

---

### System-owned table pattern
NO `tenant_id`; two `pgPolicy` declarations (one for SELECT to public, one for ALL to `system_role`).

**When to use:** Tables that should be cross-tenant readable but only system-writable (agency rules, system reference data). Pitfall E avoidance: separate read+write policies.
**Source:** 02-03-SUMMARY.md

---

### IMMUTABLE wrapper for subquery aggregate in GENERATED column
Postgres rejects subquery aggregates directly in GENERATED ALWAYS AS expressions; wrap in an IMMUTABLE SQL function (`jsonb_min_numeric`).

**When to use:** Any GENERATED column that needs to aggregate over a jsonb sibling column. Pitfall C. Add `RETURNS NULL ON NULL INPUT` and `PARALLEL SAFE` to keep planner happy.
**Source:** 02-06-SUMMARY.md

---

### Partial expression index on jsonb-extracted column
`CREATE INDEX ... ON agency_rule ((rule_body->>'event_type')) WHERE rule_kind='derog_seasoning'`.

**When to use:** Hot-path lookups by an inner discriminator inside a jsonb body. Keeps the index small + fast for the specific dimension's query path.
**Source:** 02-06-SUMMARY.md

---

### SQL CTE function with UNION ALL branches per dimension
`detect_loosenings` uses 4 SELECT branches + 3 UNION ALL — Postgres optimizer handles each branch independently.

**When to use:** Functions that fan out comparisons across heterogeneous shapes (numeric ≤, numeric ≥, derog, allow-list). Easier to extend than a giant CASE.
**Source:** 02-06-SUMMARY.md

---

### drizzle-kit single-file generate + `--custom` for non-modeled DDL
`pnpm drizzle-kit generate` emits one file per pass; FORCE / EXCLUDE / functions / extensions ship as `--custom` files interleaved by index in `_journal.json`.

**When to use:** Any constraint Drizzle doesn't model (FORCE RLS, EXCLUDE, GENERATED via subquery, extensions, SQL functions). Renumber existing entries if the order matters.
**Source:** 02-05-SUMMARY.md

---

### Post-migrate GRANT pattern
`init-db.sh` ALTER DEFAULT PRIVILEGES covers FUTURE tables only; tables created during the migrate need explicit `GRANT DML ON TABLE ...` to `app_user`.

**When to use:** Every new tenant-scoped or app-readable table. Plan 02-05 Task 2 + Task 3 own the explicit GRANTs for Phase 2's 7 new tables.
**Source:** 02-05-SUMMARY.md

---

### Cross-tenant pen-test file naming: `tests/rls/{table}-cross-tenant.test.ts`
One file per tenant-scoped table; D-03 6-case matrix per file (cross-tenant SELECT + anonymous SELECT + in-tenant SELECT + cross-tenant INSERT/UPDATE/DELETE).

**When to use:** Every new tenant-scoped table. New tables in Phase 4+ add new test files; harness in `seedTwoTenants` extended in lockstep.
**Source:** 02-09-SUMMARY.md

---

### Approach (a) for cross-tenant edge cases Postgres semantics permit
Assert OBSERVED behavior with real assertion; document data-integrity gap as a future commit-transaction guard requirement. Documentation theater (`typeof boolean`) forbidden.

**When to use:** When RLS doesn't propagate (FK target checks, foreign keys to invisible rows). Real assertion catches future Postgres patches that might flip the behavior silently.
**Source:** 02-09-SUMMARY.md

---

### Per-schema Zod test pattern: ≥1 parse-good + ≥1 reject-bad case per VALIDATION D8 dimension
Tests group by kind family (numeric / allow-list+geo+special / structured derog+income+dscr) for compactness without sacrificing coverage.

**When to use:** Every Zod schema in `lib/rules/schemas/`. Add a dispatch-table runtime regression test alongside to catch the `as const satisfies` regression where a key gets removed after typecheck passes.
**Source:** 02-04-SUMMARY.md

---

### Shared fixture module pattern (`tests/_shared/agency-fixture.ts`)
Extract duplicated bootstrap (SYSTEM-tenant lookup/create + GUC + citation INSERT + agency_rule_version INSERT) across `seedTwoTenants` and `seedAgencyDerogRule`. Per-rule_kind / per-tenant INSERTs stay in callers.

**When to use:** When two test seeds duplicate non-trivial bootstrap with the same COMMIT-before-return semantics. WR-05 refactor pattern.
**Source:** 02-REVIEW-FIX.md (WR-05)

---

## Surprises

### `drizzle-kit migrate` hung on first run against fresh DB
drizzle-kit 0.31.10 stuck-spinner on `pnpm db:migrate` against `db:reset` state; never-resolved root cause.

**Impact:** Established psql-direct migration application + manual `__drizzle_migrations` population as the bypass protocol. Subsequent `pnpm db:migrate` no-ops in <1s once journal is in sync. Discovered the 0006 operator-precedence bug in the process — would have surfaced as an opaque hang otherwise.
**Source:** 02-07-SUMMARY.md

---

### Postgres FK target check bypasses RLS by design
Tenant B's INSERT into `lender_overlay_rule` with `applies_to_program_id=A_program_id` SUCCEEDS (rowCount=1). Postgres walks `pg_class` to verify the target row, bypassing RLS that would otherwise hide A's program from B's SELECTs.

**Impact:** Data-integrity gap (B-tenant overlay structurally bound to A-tenant program) is documented Postgres behavior, not a bug. Phase 12 LOV-01..03 commit-transaction MUST add `program.tenant_id = current_setting('app.tenant_id', true)::uuid` check before promoting overlay drafts to canonical.
**Source:** 02-09-SUMMARY.md

---

### drizzle-kit migration idempotency masks source-correct fixes
CR-01 + WR-02 fixes were source-correct in commits 47bddc5 + 18085a6 but tests still failed because the deployed function in `lender_search_dev` was the pre-fix version. drizzle-kit treats `__drizzle_migrations` records as final; in-place .sql edits never re-apply.

**Impact:** Diagnosed as "stale deployment" gaps in UAT, not source bugs. Resolved by manual `psql` replay of `CREATE OR REPLACE FUNCTION` bodies. Convention emerging: post-merge fixes to migration files ship as NEW migrations (0007, 0008, …) so drizzle-kit's idempotency guarantee actually applies. Migration-replay protocol is an open documentation follow-up.
**Source:** 02-UAT.md (Gaps CR-01, WR-02)

---

### Postgres `->` operator binds tighter than `@>`
`a->'k' @> b->'k'` parses as `((a->'k' @> b) -> 'k')` (boolean → text — invalid). Intuitive grouping is wrong.

**Impact:** Bug shipped from RESEARCH §Pattern 5 verbatim into 0006_detect_loosenings.sql; surfaced during Plan 02-07 psql introspection. Fix: wrap both sides in parens. General lesson: any composite jsonb expression with `->` and `@>`/`?` operators needs explicit grouping, even when the spacing reads naturally.
**Source:** 02-07-SUMMARY.md

---

### Initial executor agent hit runtime usage limit mid-plan
Plan 02-01: agent committed Task 1 (cdce6ee) then hit a usage limit. Tasks 2 + 3 were written to disk but uncommitted.

**Impact:** Continuation orchestrator completed Task 2 (commit `lib/rules/schemas/`) and Task 3 (`vitest.schema.config.ts` + `package.json`) directly without re-spawning, since work product was already on disk and verified via `pnpm typecheck`. Pattern: when subagent dies mid-task, check disk before re-spawning.
**Source:** 02-01-SUMMARY.md

---

### `pnpm lint --fix` leaves empty whitespace lines after removing eslint-disable directives
3 stale `eslint-disable no-var` directives auto-removed cleanly, but residual whitespace inside `declare global` blocks needed manual cleanup before `pnpm lint` ran 0/0.

**Impact:** UAT Test 6 surfaced this as a follow-on cleanup step; not a tooling bug per se but a small ergonomics gap. Post-`--fix` always re-read modified files and tidy.
**Source:** 02-UAT.md (Gap: Test 6)

---

### Plan-stipulated path conflict with Phase 1 baseline layout
Plan 02-09 referenced `tests/rls/seedTwoTenants.ts` (top-level) but Phase 1 placed the seed at `tests/rls/fixtures/tenants.ts`.

**Impact:** Treated as a single relocation rather than maintaining divergent paths — created the new file at the plan path, deleted the fixture, updated 5 Phase 1 imports. Tracked as a Rule 3 (blocking) auto-fix. Plans that change file layout from a prior phase need explicit relocation tasks, not just files_modified entries pointing at the new path.
**Source:** 02-09-SUMMARY.md
