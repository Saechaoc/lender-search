<!-- generated-by: gsd-doc-writer -->
# Testing

The lender-search test suite is the load-bearing gate for two architectural commitments that
the rest of the system depends on:

1. **Tenant isolation enforced at the database, never at the application layer.** Every
   tenant-scoped table has `FORCE ROW LEVEL SECURITY` plus a policy keyed on
   `current_setting('app.tenant_id', true)::uuid`. The RLS pen-test suite at `tests/rls/`
   exercises the D-03 attack matrix (cross-tenant SELECT, write, JWT tampering,
   service-role boundary, GUC reset, index scan) on every PR. **Cross-tenant data exposure
   is a release-blocker.**
2. **Citation discipline + bitemporal versioning + structured rule schemas as schema
   constraints.** The schema-constraint suite at `tests/schema/` and the Zod-unit suite at
   `tests/rules/` assert that `program_rule.primary_citation_id` cannot be NULL, that
   overlapping active `program_version` ranges are blocked by the `EXCLUDE USING gist`
   constraint, that `min_confidence` is a `GENERATED STORED` column, and that all 17
   `rule_kind` Zod schemas reject malformed bodies.

Both gates run in CI (`.github/workflows/ci.yml` job `verify`) on every PR + push to main,
and both gate the merge button. There is no local pre-push hook today; the CI workflow is
the source of truth (see DEVELOPMENT.md for the manual pre-push contract).

---

## Test framework and setup

| Concern | Tool | Version | Config |
| --- | --- | --- | --- |
| Test runner | `vitest` | 4.1.5 (devDependency) | three configs (see below) |
| Test isolation | Vitest `pool: 'forks'` | each `*.test.ts` file in its own process | shared global pg pools |
| Schema validation unit tests | `zod@4.4.1` + Vitest | no DB | `vitest.schema.config.ts` includes `tests/rules/` |
| DB driver in tests | `pg@8.20.0` (node-postgres) | direct `client.query()` — bypasses Drizzle | tests exercise the SQL contract |
| JWT fixtures | `jose@6.2.3` | HS256 with `RLS_TEST_JWT_SECRET` | `tests/rls/fixtures/jwt.ts` |

### Three Vitest config files

The repo ships **three** Vitest configs because Phase 1 and Phase 2 have non-overlapping
DB-setup needs and one Phase 1 unit test must run before any DB harness exists:

| Config file | Pattern | Purpose |
| --- | --- | --- |
| `vitest.config.ts` | `tests/rls/**/*.test.ts` | RLS pen-test suite (Phase 1 + Phase 2 D-19 extension). Connects as `app_user` (NOBYPASSRLS NOSUPERUSER). Runs `globalSetup` (TRUNCATE + drizzle-kit migrate + GRANT) and `setupFiles` (FORCE-RLS sanity check). |
| `vitest.schema.config.ts` | `tests/schema/**/*.test.ts` + `tests/rules/**/*.test.ts` | Phase 2 schema-constraint suite + Zod-unit suite. Skips RLS-canary FORCE check (Plan 02-08 owns its own setup). Skips drizzle-kit migrate (the schema suite assumes Plan 02-07's blocking migrate already ran). |
| `vitest.env-boot.config.ts` | `tests/rls/env-boot.test.ts` | Standalone runner for the `lib/env.ts` boot-fail-closed unit test. Exists because the env-boot test was written at Plan 01-02 (Wave 1) before Plan 01-06 added `tests/rls/global-setup.ts` — using the main config would hit "module not found." Will be deleted once the test is verified green inside `vitest.config.ts`. |

### Connection model — `app_user` vs `system_role` vs `postgres`

The pen tests are **only meaningful** if the connection role cannot bypass RLS. Three roles
are involved:

| Role | Origin | Pen-test usage | Privilege |
| --- | --- | --- | --- |
| `app_user` | `scripts/init-db.sh` (local) / `.github/workflows/ci.yml` step "Provision app_user + system_role" (CI) | `globalThis.__pgPool` — every cross-tenant pen test connects here | `LOGIN`, `NOBYPASSRLS`, `NOSUPERUSER`, DML on tenant-scoped tables |
| `postgres` (superuser) | docker / CI postgres service | `globalThis.__pgAdminPool` — used by `seedTwoTenants` and `seedAgencyVersion` for system-owned `agency_rule_version` writes (Pitfall G) | superuser; bypasses RLS |
| `system_role` | CI provisioning step + Phase 2 migration 0002 | `agency_rule.system_write` policy targets `TO system_role`; granted to `postgres` so admin-pool writes pass the policy | `NOLOGIN`, `NOBYPASSRLS`, `NOSUPERUSER` |

`tests/rls/setup.ts` performs a **non-negotiable sanity check** (`Pitfall 4`): it queries
`pg_roles WHERE rolname = current_user` and aborts the suite if `rolbypassrls = true`. If
you accidentally point `DATABASE_URL` at the postgres superuser, the suite refuses to run
rather than passing vacuously.

`tests/rls/setup.ts` also asserts (`Pitfall 6`) that `relforcerowsecurity = true` on all
seven tenant-scoped tables (`tenant`, `_rls_canary`, `program`, `program_version`,
`program_rule`, `rule_citation`, `lender_overlay_rule`) and that the seven required RLS
policies exist. Either check failing aborts the suite — pen tests should not pass for the
wrong reason.

### Required env vars

The test harness reads three env vars (validated by `lib/env.ts` for Phase 1 app paths;
read directly by the test setup files which are exempt from the `no-restricted-properties`
rule):

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | `app_user` Postgres connection. Pen tests reject `postgres:postgres@` patterns at runtime. |
| `DATABASE_MIGRATION_URL` | optional (derived if unset) | postgres-superuser URL used by `globalSetup` to run `drizzle-kit migrate` and `GRANT`s, and by `__pgAdminPool` for system-owned writes. Falls back to substituting `app_user:app_user_password` → `postgres:postgres` in `DATABASE_URL`. |
| `RLS_TEST_JWT_SECRET` | yes (min 16 chars) | HS256 signing key used by `tests/rls/fixtures/jwt.ts` to mint the forged JWTs in the JWT-tampering test. CI uses `ci-fixture-jwt-secret-min-16-chars`; local dev pulls from `.env.local`. |

`SUPABASE_SERVICE_ROLE_KEY` is **intentionally absent** from the test env. The
`tests/rls/service-role-boundary.test.ts` suite asserts its absence at runtime (T-01-04
mitigation) — see "Service-role boundary" below.

See CONFIGURATION.md for the full env-validation contract.

---

## Running tests

All test commands are wired into `package.json` `scripts`:

```bash
# Phase 1 + Phase 2 D-19 cross-tenant pen-test suite (16 test files in tests/rls/)
pnpm test:rls
pnpm test:rls:watch          # watch mode for local development

# Phase 2 D-20 schema-constraint suite + Zod-unit suite (16 test files across tests/schema/ + tests/rules/)
pnpm test:schema

# Single test file (pass --config explicitly because the configs differ)
pnpm vitest run --config vitest.config.ts tests/rls/cross-tenant-select.test.ts
pnpm vitest run --config vitest.schema.config.ts tests/schema/program-version-exclude.test.ts

# Single test by name pattern (Vitest 4 syntax; -t matches `it(...)` description)
pnpm vitest run --config vitest.config.ts -t 'returns 0 rows when GUC is set to Tenant A'
```

There is **no** umbrella `pnpm test` script today — the two suites have different setup
requirements (the RLS suite owns the migrate step; the schema suite assumes it already
ran), so they are kept distinct. CI runs them sequentially in the `verify` job: schema
first, then RLS.

### Local prerequisites

Before running either suite locally:

1. Start Postgres: `pnpm db:up` (docker-compose; `scripts/init-db.sh` provisions
   `app_user` + `system_role` on first run).
2. Apply migrations: `pnpm db:migrate` (drizzle-kit; runs as the `postgres` superuser via
   `DATABASE_MIGRATION_URL`).
3. Confirm `.env.local` has all three required vars (see `.env.local.example`).

The `pnpm test:rls` suite re-runs `drizzle-kit migrate` from `globalSetup` — this is
idempotent, but if the local DB has drifted (rare; see "Migration replay protocol" below)
you may need to manually replay migrations via `psql` first.

### Migration replay protocol (Phase 02 UAT artifact)

Phase 02 UAT surfaced a case where `drizzle-kit migrate` reported an incomplete journal
state on a partially-migrated DB — the `_rls_canary` and `tenant` tables existed from
Phase 1, but the Phase 2 migration journal entry for `0006_*` had not been recorded. The
recovery is to replay the migration manually as `postgres`:

```bash
# Replace 0006_xxx.sql with the actual migration filename in db/migrations/
PGPASSWORD=postgres psql \
  -h localhost -U postgres -d lender_search_dev \
  -v ON_ERROR_STOP=1 \
  -f db/migrations/0006_xxx.sql

# Then mark the journal entry so drizzle-kit doesn't try to re-apply
PGPASSWORD=postgres psql -h localhost -U postgres -d lender_search_dev <<'SQL'
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
VALUES ('<hash-from-meta/_journal.json>', extract(epoch from now()) * 1000);
SQL
```

If `pnpm db:reset && pnpm db:up && pnpm db:migrate` works, prefer that — it is the
clean-slate path. The manual `psql` replay is the recovery procedure when a fresh DB
isn't an option (e.g., you have local fixture data you want to keep).

---

## What each suite covers

### `tests/rls/` — RLS pen-test suite (Phase 1 baseline + Phase 2 D-19 extension)

Phase 1 ships the D-03 attack matrix against the canary table; Phase 2 D-19 extends every
matrix row to the five new tenant-scoped tables (`program`, `program_version`,
`program_rule`, `rule_citation`, `lender_overlay_rule`).

| Test file | D-03 row(s) closed | What it asserts |
| --- | --- | --- |
| `cross-tenant-select.test.ts` | #1 (read) | `SELECT id FROM _rls_canary WHERE id = $1` returns 0 rows when GUC is A and target id is B's. Also: `connectAsAnonymous` (no GUC ever set) returns 0 rows; in-tenant SELECT returns the in-tenant row (sanity); the `tenant` self-filter policy returns only the calling tenant's row. |
| `cross-tenant-write.test.ts` | #2, #3 | INSERT with `tenant_id = B` while GUC is A is rejected by the `WITH CHECK` clause (Postgres error `42501` "row-level security"). UPDATE/DELETE on B's row from A's GUC affect 0 rows (USING clause filters before WITH CHECK can fire). Sanity: in-tenant INSERT succeeds. |
| `jwt-tampering.test.ts` | #4 | `forgeJWT` mints a JWT with a tampered `app_metadata.tenant_id`; `extractTenantIdFromJWT` round-trips the tampered value; setting the GUC to the tampered id still returns 0 rows for queries against the user's "real" tenant. The structural property: **the GUC determines visibility, not the user's claimed identity.** Phase 6 layers JWT signature verification on top. |
| `service-role-boundary.test.ts` | #5 | `process.env.SUPABASE_SERVICE_ROLE_KEY` is `undefined` in the test process; `DATABASE_URL` does not match the `postgres:postgres@` superuser pattern; no env key contains `SERVICE_ROLE`. Defense-in-depth: the corresponding ESLint `no-restricted-imports` rule (proven by `pnpm lint:fixture`) is the second layer. |
| `guc-reset.test.ts` | #6 | After `connectAsTenant` ROLLBACKs, the `app.tenant_id` GUC value does not match the tenant id that was previously set (Postgres 16 quirk: `current_setting` returns NULL on a fresh session and `''` on a touched-then-RESET session — both fail closed under the policy). Two consecutive `connectAsTenant(A)` then `connectAsTenant(B)` calls do not leak A's GUC into B. |
| `index-scan.test.ts` | TNT-03 | `rls_canary_tenant_idx` is listed in `pg_indexes`. With `SET LOCAL enable_seqscan = off` (defeats the small-table planner heuristic), `EXPLAIN (FORMAT JSON)` of a tenant-scoped lookup contains `Index Scan` (or `Bitmap Index Scan`) and references `rls_canary_tenant_idx`. The test validates the index exists and is usable; planner choice under realistic data volumes is a Phase 2+ concern. |
| `program-cross-tenant.test.ts` | D-19 6-case matrix | Same six assertions as the canary, against `program`. |
| `program-version-cross-tenant.test.ts` | D-19 6-case matrix | Same six assertions, against `program_version`. |
| `program-rule-cross-tenant.test.ts` | D-19 6-case matrix | Same six assertions, against `program_rule`. |
| `rule-citation-cross-tenant.test.ts` | D-19 6-case matrix | Same six assertions, against `rule_citation`. |
| `lender-overlay-cross-tenant.test.ts` | D-19 6-case matrix + Pitfall 3.5 edge | The standard six, plus the FK-to-foreign-program edge case (Postgres FK target check bypasses RLS by design — observed and asserted). The data-integrity gap is documented as a Phase 12 LOV-01..03 commit-transaction guard requirement. |
| `env-boot.test.ts` | CFG-05 | `lib/env.ts` throws on empty / non-URL / non-Postgres-scheme `DATABASE_URL`; throws on `RLS_TEST_JWT_SECRET` shorter than 16 chars; succeeds on valid URLs; defaults `NODE_ENV` to `development`. Module re-import per case via `vi.resetModules()` + `vi.stubEnv`. No DB. |

### `tests/schema/` — schema-constraint suite (Phase 2 D-20)

| Test file | Constraint / function | Assertion |
| --- | --- | --- |
| `citation-fk.test.ts` | `program_rule.primary_citation_id` NOT NULL + FK | INSERT without `primary_citation_id` fails NOT NULL; INSERT with non-existent uuid fails FK; valid INSERT succeeds. Closes D-01 / SCH-13. |
| `citation-source-check.test.ts` | `rule_citation_has_source` CHECK | INSERT with both `source_pdf_sha256` and `source_url` NULL is rejected with `check constraint "rule_citation_has_source"`. INSERT with only one of them succeeds. |
| `program-rule-layer-check.test.ts` | `program_rule_layer` pgEnum | `INVESTOR_OVERLAY` and `PRODUCT_FEATURE` accepted; `AGENCY_BASE` rejected (it is a layer for `agency_rule`, not `program_rule`). |
| `program-version-exclude.test.ts` | `program_version` `EXCLUDE USING gist` | Two overlapping `state='active'` rows for the same `(tenant_id, program_id)` raise `conflicting key value violates exclusion constraint`. Adjacent (non-overlapping) ranges allowed (Pitfall A — half-open daterange). Different states allowed (state participates in the EXCLUDE WHERE clause). |
| `agency-rule-version-exclude.test.ts` | `agency_rule_version` `EXCLUDE USING gist` | Same constraint at the agency level: two overlapping FNMA versions blocked; FNMA + FHLMC overlapping ranges allowed. Test uses randomized year ranges (3000+/4000+) so it does not collide with leftover data from the seed pool's 2100+ random range. |
| `min-confidence-generated.test.ts` | `program_rule.min_confidence` `GENERATED STORED` + `jsonb_min_numeric` SQL function | Computes MIN over numeric values in `field_confidence` jsonb. Returns NULL for empty jsonb. Skips non-numeric entries (WR-02 — without the regex filter, `(value)::numeric` would raise on `{"flag": true}`). Direct INSERT to `min_confidence` rejected with `cannot insert a non-DEFAULT value into column "min_confidence"`. |
| `derog-rule-roundtrip.test.ts` | SC#2 acceptance | Insert FNMA post-foreclosure fixture (`tests/rules/fixtures/fnma-foreclosure.ts`); query by `rule_kind = 'derog_seasoning' AND rule_body->>'event_type' = 'FORECLOSURE'`; assert `base_waiting_months = 84`, `extenuating_circumstances_waiting_months = 36`, `post_event_LTV_caps[0].max_LTV = 90`. Asserts the partial expression index supports the SC#2 query path via `EXPLAIN`. |
| `agency-cross-tenant-readable.test.ts` | `agency_rule.world_read` policy | SELECT from `agency_rule` succeeds under `connectAsTenant(A)` AND under `connectAsAnonymous` (world_read = visible to everyone). INSERT from `app_user` is rejected by the `system_write` policy (which only `system_role` / `postgres` satisfy). |
| `detect-loosenings.test.ts` | `detect_loosenings(uuid)` SQL function (D-12 / D-14) | When an INVESTOR_OVERLAY ltv_max is `97` and the agency value is `95`, the function emits a row with `dimension = 'ltv_max'`. Includes the CR-01 regression: an overlay BK7 derog row with shorter wait is NOT cross-paired against the FORECLOSURE agency row (the UNION branch JOINs on `event_type` so multiple `derog_seasoning` rows in one ARV don't Cartesian-explode). |

### `tests/rules/` — Zod schema unit tests (Phase 2 SCH-04..09)

These tests import `lib/rules/schemas/*` directly and need no DB. They run inside the
`vitest.schema.config.ts` include glob.

| Test file | Schemas covered | Notes |
| --- | --- | --- |
| `dispatch-table.test.ts` | `lib/rules/schemas/index.ts` dispatch table | Asserts `ruleKinds` has exactly 17 values in D-09 order; every `ruleKind` has a matching entry in `ruleBodySchemas`; `parseRuleBody('ltv_max', ...)` routes to `ltvMaxSchema`; `parseRuleBody('fico_min', { value: 80 })` rejects (LTV body in FICO slot). |
| `numeric-kinds.test.ts` | `ltv_max`, `cltv_max`, `hcltv_max`, `fico_min`, `dti_max`, `reserves_min` | Range checks (LTV ≤ 100, CLTV / HCLTV ≤ 120, FICO 300-850 integer, DTI 0-100). `reservesMinSchema` requires the `unit` enum (`months` or `dollars`). |
| `allow-list-kinds.test.ts` | `occupancy_allow`, `purpose_allow`, `property_type_allow`, `doc_type_allow`, `geo_state`, `geo_county`, `mi_required`, `manual_uw_path` | Allow-list enum membership; missing `values` key parses to `[]` (WR-03 default consistency). |
| `derog-seasoning.test.ts` | `derogSeasoningSchema` (SCH-04) | Parse-good using the FNMA `fnmaForeclosure` fixture (SC#2). Reject-bad: missing `event_type`, invalid `event_type`, negative `base_waiting_months`, `max_LTV > 100`, missing `mortgage_included_in_bk_rule` (Pitfall 1.6), invalid `purposeAllowList` element. |
| `income-doc-method.test.ts` | `incomeDocMethodSchema` (SCH-06 / Pitfall 1.8) | Parse 12-month bank-statement body with `comingling_treatment = 'SEASONED'`; parse minimal `FULL_DOC`; reject malformed combinations. |
| `dscr-method.test.ts` | `dscrMethodSchema` (SCH-07 / Pitfall 1.9) | Parse lease-only with LTV tiers; parse no-ratio DSCR with `no_ratio_max_ltv = 65`; assert tier ordering / DSCR-by-LTV constraints. |

---

## Coverage requirements

There is **no coverage threshold configured**. Coverage is not enforced today; the
suites are gated on pass/fail. The test posture is "every PR runs every test file in
both suites; CI is green or the merge button is locked." Coverage tooling will land
when the evaluation engine arrives in Phase 4 (where mutation testing on the pure-TS
core is the more useful signal than line coverage).

Both `vitest.config.ts` and `vitest.schema.config.ts` set `pool: 'forks'`,
`isolate: true`, `sequence: { concurrent: false }` so each test file runs in its own
process and tests inside a file run sequentially — important for pen tests that share
a `globalThis.__pgPool` and for schema tests that depend on `seedAgencyVersion`'s
randomized-but-not-collision-free daterange.

---

## CI integration

The `verify` job in `.github/workflows/ci.yml` is the merge gate. Triggered on
`pull_request` to `main` and `push` to `main`. Concurrency-keyed on
`{workflow}-{ref}` with `cancel-in-progress: true` so superseded PR runs are killed
automatically.

| Step | Command | Gate |
| --- | --- | --- |
| Install pnpm | `pnpm/action-setup@v4` | corepack picks version from `packageManager` field |
| Setup Node.js | `actions/setup-node@v4` (`node-version: 20`, `cache: pnpm`) | matches `package.json` `engines.node` (`>=20.9.0`) |
| Install dependencies | `pnpm install --frozen-lockfile` | rejects lockfile drift |
| Provision `app_user` + `system_role` | inline `psql` heredoc | replicates `scripts/init-db.sh` for the CI postgres service container |
| Typecheck | `pnpm typecheck` (`tsc --noEmit`) | gate |
| Lint | `pnpm lint` (excludes the intentional ESLint fixture) | gate |
| Lint fixture | `pnpm lint:fixture` | proves `no-restricted-properties` + `no-restricted-imports` rules fire |
| Apply migrations + grant DML | `pnpm drizzle-kit migrate` + inline `GRANT` | replicates `globalSetup` for the schema suite (which does not run migrate itself) |
| Verify FORCE RLS is on | `psql` query against `pg_class` + `grep` | TNT-01 gate; fails if `relforcerowsecurity` is `false` on `tenant` or `_rls_canary` |
| Run schema-constraint suite | `pnpm test:schema` | gate (Phase 2 D-20 + D-10) |
| Run RLS pen-test suite | `pnpm test:rls` | gate (TNT-04 merge gate) |

The `services.postgres` block uses `postgres:16-alpine` with healthcheck. Env vars set
on the job:

- `DATABASE_URL=postgresql://app_user:app_user_password@localhost:5432/lender_search_test`
  (NOBYPASSRLS — pen tests connect here)
- `DATABASE_MIGRATION_URL=postgresql://postgres:postgres@localhost:5432/lender_search_test`
  (postgres superuser — runs migrations + grants)
- `RLS_TEST_JWT_SECRET=ci-fixture-jwt-secret-min-16-chars` (HS256 fixture)
- `SUPABASE_SERVICE_ROLE_KEY` is **intentionally not set** — `service-role-boundary.test.ts`
  asserts its absence

---

## Writing new tests

### Naming convention

- RLS pen tests: `tests/rls/{table-or-concern}-cross-tenant.test.ts` for the D-03 matrix;
  `tests/rls/{concern}.test.ts` for non-matrix tests (`guc-reset`, `index-scan`,
  `service-role-boundary`, `jwt-tampering`).
- Schema-constraint tests: `tests/schema/{constraint-name}.test.ts`. One file per
  constraint or SQL function.
- Zod-unit tests: `tests/rules/{kind-name}.test.ts` (matches the schema file name in
  `lib/rules/schemas/`).

### Shared helpers

| Helper | Path | Purpose |
| --- | --- | --- |
| `connectAsTenant(pool, tenantId, fn)` | `tests/rls/fixtures/connection.ts` | BEGIN, `set_config('app.tenant_id', $1, true)`, run `fn(client)`, ROLLBACK. The is_local=true ensures the GUC dies with the transaction, so pooled-connection reuse cannot leak GUC state across tests. |
| `connectAsAnonymous(pool, fn)` | `tests/rls/fixtures/connection.ts` | Opens a **fresh** `pg.Client` (NOT pooled) so no prior `set_config` has touched the session — `current_setting('app.tenant_id', true)` returns NULL → policies fail closed → 0 rows. Works around the Postgres 16 placeholder-GUC quirk (a touched-then-RESET GUC stays as `''`, which fails to cast to uuid). |
| `seedTwoTenants(pool, adminPool?)` | `tests/rls/seedTwoTenants.ts` | Creates two tenants + canary + program + program_version + program_rule + rule_citation per tenant + a shared agency_rule_version (under `adminPool`). Returns IDs for both tenants. Uses the Pitfall 7 bootstrap pattern (generate UUID, set_config, INSERT with id=GUC). |
| `seedAgencyVersion(adminPool, opts)` | `tests/_shared/agency-fixture.ts` | Get-or-create the SYSTEM tenant; INSERT a `rule_citation` and `agency_rule_version` under it. Randomized non-overlapping daterange so the EXCLUDE constraint doesn't trip across multiple seeds in one run. |
| `seedAgencyDerogRule(adminPool, agency, _hint, body)` | `tests/schema/fixtures/seed.ts` | Layers a `derog_seasoning` `agency_rule` on top of `seedAgencyVersion`. |
| `seedTenantWithProgramAndCitation(pool, adminPool, agencyRuleVersionId)` | `tests/schema/fixtures/seed.ts` | Schema-suite analogue of `seedTwoTenants` — one tenant with one program + one citation + one draft program_version. |
| `mintJWT({ tenantId, userId? })` / `forgeJWT({ tenantId, tamperedTenantId })` | `tests/rls/fixtures/jwt.ts` | HS256-signed JWT with `app_metadata.tenant_id`. Used only by `jwt-tampering.test.ts`. |
| `fnmaForeclosure` | `tests/rules/fixtures/fnma-foreclosure.ts` | Canonical SC#2 fixture: FNMA Selling Guide B3-5.3-07 post-foreclosure 7-year baseline / 3-year extenuating / 90% LTV cap on the 3-to-7-year band. Used by both `tests/rules/derog-seasoning.test.ts` and the schema round-trip + detect-loosenings tests. |

### Pattern: a new D-03 matrix test for a Phase 3+ table

When a future phase introduces a new tenant-scoped table (e.g. `evaluation_event` in
Phase 4):

1. Add the table name to `FORCED_TABLES` in `tests/rls/setup.ts` so the FORCE-RLS sanity
   check covers it.
2. Add the policy name(s) to the `required` array in `tests/rls/setup.ts` so the policy
   sanity check fails-closed if the migration regresses.
3. Extend `globalSetup`'s TRUNCATE list and the GRANT lists.
4. Extend `seedTwoTenants` to seed rows in the new table for tenants A and B (return
   their IDs in `SeedResult`).
5. Create `tests/rls/{table}-cross-tenant.test.ts` mirroring `program-cross-tenant.test.ts`:
   six it-blocks (cross-tenant SELECT, anonymous, in-tenant SELECT, cross-tenant INSERT,
   cross-tenant UPDATE 0 rowCount, cross-tenant DELETE 0 rowCount).

### Pattern: a new schema-constraint test

When Phase 3+ adds a CHECK / EXCLUDE / GENERATED / SQL function:

1. Create `tests/schema/{constraint-name}.test.ts` and import
   `connectAsTenant` from `../rls/fixtures/connection.js` plus `seedTenantWithProgramAndCitation`
   and `seedAgencyDerogRule` from `./fixtures/seed.js`.
2. Use a `SAVEPOINT` before any test action that you expect to fail with a constraint
   error — Postgres aborts the outer transaction on a constraint violation, and you need
   `ROLLBACK TO SAVEPOINT` to keep the transaction usable for follow-up assertions
   (see `program-version-exclude.test.ts` and `agency-rule-version-exclude.test.ts`).
3. Match the error with a regex against the constraint name or the well-known Postgres
   error text (e.g. `/check constraint "rule_citation_has_source"/i`,
   `/conflicting key value violates exclusion constraint/i`,
   `/violates foreign key constraint/i`).

### Pattern: a new Zod schema unit test

When Phase 3+ adds a new `rule_kind`:

1. Add the new kind to `ruleKinds` in `lib/rules/schemas/index.ts` and create
   `lib/rules/schemas/{kind-name}.ts`.
2. Update `tests/rules/dispatch-table.test.ts`:
   - Bump the `toHaveLength(17)` count.
   - Add the new kind to the verbatim `toEqual([...])` array (in D-09 order).
   - Add a `parseRuleBody` happy-path test routing to the new schema.
3. Create `tests/rules/{kind-name}.test.ts` with at minimum: one parse-good test
   exercising every required field, and one reject-bad test per refinement / boundary.

---

## Failure-mode reference (debugging guide)

| Failure signature | Likely cause | Fix |
| --- | --- | --- |
| `Pen tests connected as BYPASSRLS role 'postgres'. RLS is silently bypassed; tests would be vacuous. Aborting.` | `DATABASE_URL` points at the postgres superuser. | Point it at `app_user`. CI sets the right value automatically; locally check `.env.local`. |
| `Table 'X' does NOT have FORCE ROW LEVEL SECURITY. Plan 05/Plan 02-06 migration may not have applied. Aborting.` | A migration was rolled back or the DB is partially-migrated. | Run `pnpm db:reset && pnpm db:up && pnpm db:migrate` (clean slate), or replay the missing migration via `psql` (see "Migration replay protocol"). |
| `Expected RLS policies [...]; missing [...].` | Migration 0006 (Phase 2 D-19) did not run, or the policy was dropped. | Same as above. |
| `Expected pg_class to list all 7 tenant-scoped tables [...]; got N rows [...]. Migrations may not have applied.` | Schema is on Phase 1 but tests expect Phase 2 tables. | Run `pnpm db:migrate`. |
| `globalSetup: drizzle-kit migrate failed. Ensure the docker postgres container is up...` | Postgres container not running, or `DATABASE_URL` unreachable. | `pnpm db:up` and check `pnpm db:logs` for healthcheck. |
| `seedTwoTenants requires adminPool ... for agency_rule_version seeding (Pitfall G)` | The schema or RLS setup file did not construct `__pgAdminPool` (Vitest 4 module-context boundary). | The setup files (`tests/rls/setup.ts` and `tests/schema/setup.ts`) construct `__pgAdminPool` defensively in `beforeAll`. If you wrote a new test file that runs before any `*.test.ts`, ensure it does not bypass the setup file (don't write a file-level `beforeAll` that pre-empts setup). |
| `RLS_TEST_JWT_SECRET must be set (min 16 chars)` | Missing or short JWT signing secret. | Set in `.env.local`; CI sets it inline. |
| `cannot insert a non-DEFAULT value into column "min_confidence"` (in a non-test context) | Application code is trying to write directly to a `GENERATED STORED` column. | Drop the column from the INSERT — `min_confidence` is computed from `field_confidence` by `jsonb_min_numeric`. The test asserts this rejection. |
| `conflicting key value violates exclusion constraint "agency_rule_version_no_overlap"` (in tests) | Two seeds in the same run picked overlapping random year ranges. | Vanishingly unlikely — the random window is 100k years. If it happens, re-run; if it persists, seed pool sizing is the bug. |

---

## Cross-references

- **DEVELOPMENT.md** — manual pre-push contract (`pnpm typecheck && pnpm lint && pnpm test:schema && pnpm test:rls`); branching + PR conventions.
- **CONFIGURATION.md** — full `lib/env.ts` schema, ESLint env-segregation rules, per-environment overrides for the three test env vars.
- **ARCHITECTURE.md** — RLS policy shape, FORCE ROW LEVEL SECURITY rationale, the three-layer rule model that the schema-constraint suite enforces.
