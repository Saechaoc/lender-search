---
last_mapped_commit: 78f1733137651248ed0cf7e02bf3cf8ad36f1c83
analysis_date: 2026-05-01
scope: db, lib, tests, scripts (src/ legacy prototype excluded)
---

# Architecture

**Analysis Date:** 2026-05-01

## Pattern Overview

**Overall:** Postgres-centric layered monolith with database-enforced multi-tenant isolation. Phase 1 + Phase 2 ship the foundation: schema-as-TypeScript (Drizzle), `FORCE ROW LEVEL SECURITY` policies, bitemporal versioned rule store, and a Zod-typed `rule_body` dispatch table. No application server, no UI, no Next.js app code yet — the rebuild is data-layer-first.

**Key Characteristics:**
- **Database is the security perimeter.** Tenant filtering lives in RLS policies (`USING tenant_id = current_setting('app.tenant_id', true)::uuid`) on every tenant-scoped table, plus `ALTER TABLE ... FORCE ROW LEVEL SECURITY` so even the table owner cannot bypass. A "forgot a `WHERE` clause" bug becomes "no rows returned" not data exfiltration.
- **Layered rule schema.** `agency_rule_version` (system-owned, world-readable, system-write only) → `program_version` (tenant-scoped, FK to agency version) → `program_rule` (with `program_rule_layer` enum: `INVESTOR_OVERLAY` | `PRODUCT_FEATURE`) → `rule_citation` (tenant-scoped; required NOT NULL FK from every rule row). `lender_overlay_rule` carries the `LENDER_OVERLAY` layer implicitly.
- **Citation discipline as schema constraint.** `program_rule.primary_citation_id`, `agency_rule.primary_citation_id`, and `lender_overlay_rule.primary_citation_id` are all NOT NULL FKs to `rule_citation(id)`. A rule cannot persist without a citation.
- **Bitemporal versioning.** `program_version` and `agency_rule_version` carry `effective_period daterange` + `EXCLUDE USING gist` constraints (`btree_gist` extension required) that prevent overlapping active versions. Half-open `[start,end)` daterange convention so adjacent ranges do not overlap.
- **Schema validation in two places.** Database-level: `jsonb_typeof = 'object'` CHECK on every `rule_body`, pgEnum constraints on `rule_kind` (17 values) and `program_rule_layer` (2 values), CHECK constraint on `agency_rule_version.agency` (5 values: `FNMA | FHLMC | FHA | VA | USDA`), CHECK on `program_version.state` (5 values: `draft | in_review | active | deprecated | sunset`). TypeScript-level: 17 per-kind Zod schemas at `lib/rules/schemas/` validate `rule_body` shape; dispatch via `parseRuleBody(kind, body)` at `lib/rules/schemas/index.ts`.
- **Two roles, two connection strings.** `app_user` (`NOBYPASSRLS NOSUPERUSER`) for runtime + pen tests. `postgres` superuser for migrations + agency-side seeds (the `system_role` policy on agency tables grants writes only to `system_role`, which is granted to `postgres`).

## Layers

**Schema Layer (`db/schema/`):**
- Purpose: Drizzle ORM table definitions in TypeScript. Each table file co-locates the column definitions, indexes, RLS policies, and TypeScript types.
- Location: `db/schema/`
- Contains: 9 table files (`tenant.ts`, `canary.ts`, `program.ts`, `program-version.ts`, `program-rule.ts`, `rule-citation.ts`, `agency-rule-version.ts`, `agency-rule.ts`, `lender-overlay-rule.ts`), 1 role file (`system-role.ts`), 1 custom type (`_types/daterange.ts`), barrel index (`index.ts`).
- Depends on: `drizzle-orm/pg-core`, `drizzle-orm` for `sql` template tag.
- Used by: `drizzle.config.ts` (migration generator points to `./db/schema/index.ts`), runtime app code (Phase 6+, not yet present).

**Migration Layer (`db/migrations/`):**
- Purpose: Versioned SQL migrations. Generated migrations carry table/index/policy DDL; `--custom` migrations carry features Drizzle 0.45 cannot model (`FORCE RLS`, `EXCLUDE USING gist`, `GENERATED ALWAYS AS STORED`, partial expression indexes, `CREATE FUNCTION`, `CHECK` constraints).
- Location: `db/migrations/`
- Contains: 7 migrations (0000–0006), Drizzle journal at `db/migrations/meta/_journal.json`.
- Depends on: `db/schema/` (generator input).
- Used by: `drizzle-kit migrate` (run by CI, `tests/rls/global-setup.ts`, and developers).

**Database Client Layer (`lib/db/`, `lib/env.ts`):**
- Purpose: Postgres connection + boot-time env validation.
- Location: `lib/db/client.ts` (postgres-js + Drizzle, `prepare: false` for the Supabase pooler), `lib/env.ts` (t3-env / Zod boot validation).
- Depends on: `drizzle-orm/postgres-js`, `postgres`, `@t3-oss/env-core`, `zod`.
- Used by: future Server Actions / route handlers (Phase 6+). Not exercised by app code yet; pen tests use `pg` directly per the contract documented in `lib/tenant/context.ts`.

**Tenant Context Layer (`lib/tenant/`):**
- Purpose: Single source of truth for the `app.tenant_id` Postgres GUC. `setTenantContext(tx, tenantId)` calls `set_config('app.tenant_id', $tenantId, true)` so RLS policies filter on `current_setting('app.tenant_id', true)::uuid`. The `is_local=true` third argument is non-negotiable — it scopes the GUC to the transaction so pooled-connection reuse cannot leak.
- Location: `lib/tenant/context.ts`
- Depends on: `drizzle-orm`, generic `PgDatabase` / `PgTransaction` types.
- Used by: future `withTenantContext` request middleware (Phase 6+). Pen tests use raw `pg.Client.query` to exercise the SQL contract, not the helper.

**Rule Validation Layer (`lib/rules/schemas/`):**
- Purpose: 17 Zod schemas — one per `rule_kind` value — validate `rule_body` jsonb shape. Database-level validation is minimal (`jsonb_typeof = 'object'` + enum membership); heavy shape validation lives here in TypeScript so migrations do not churn on shape changes.
- Location: `lib/rules/schemas/`
- Contains: 17 per-kind schema files, 1 dispatch barrel (`index.ts`).
- Depends on: `zod`.
- Used by: future Phase 4 evaluator (read-path validation), Phase 7 extraction validator (write-path), Phase 8 AM commit (final validation). Currently only exercised by `tests/rules/` unit tests and the schema constraint round-trip test at `tests/schema/derog-rule-roundtrip.test.ts`.

**Test Layer (`tests/`):**
- Purpose: Three orthogonal test suites — RLS pen tests (`tests/rls/`), schema-constraint tests (`tests/schema/`), Zod-unit tests (`tests/rules/`).
- Location: `tests/rls/`, `tests/schema/`, `tests/rules/`
- Depends on: `pg` (raw Postgres driver, not Drizzle), `vitest`, `jose` (JWT minting), `zod`.
- Used by: `pnpm test:rls` (vitest with `vitest.config.ts`), `pnpm test:schema` (vitest with `vitest.schema.config.ts`).

**Database Provisioning Layer (`scripts/`):**
- Purpose: Bash init script run by Postgres docker-entrypoint on first boot.
- Location: `scripts/init-db.sh`
- Contains: `CREATE ROLE app_user LOGIN PASSWORD 'app_user_password' NOBYPASSRLS NOSUPERUSER`, `CREATE ROLE system_role NOLOGIN NOBYPASSRLS NOSUPERUSER`, GRANTs on `public` schema, `ALTER DEFAULT PRIVILEGES`.
- Used by: `docker-compose.yml` (mounts the script into Postgres container's `/docker-entrypoint-initdb.d/`).

## Data Flow

**Migration Flow (apply schema changes):**

1. Author Drizzle table file in `db/schema/<table>.ts`.
2. Add export to `db/schema/index.ts` barrel.
3. Run `pnpm db:generate` (`drizzle-kit generate`) — emits a numbered SQL file under `db/migrations/`.
4. For features Drizzle cannot model (FORCE RLS, EXCLUDE, GENERATED, CHECK constraints, CREATE FUNCTION), author a separate `--custom` migration in `db/migrations/` (numbered after the auto-generated migration so it runs in order). Examples: `0001_force_rls.sql`, `0003_force_rls_program.sql`, `0004_program_constraints.sql`, `0005_force_rls_agency.sql`, `0006_detect_loosenings.sql`.
5. Run `pnpm db:migrate` (`drizzle-kit migrate`) using `DATABASE_MIGRATION_URL` (postgres superuser) — only the table owner can ALTER TABLE FORCE RLS.
6. CI verifies: typecheck, lint, lint-fixture, RLS pen tests (which run `drizzle-kit migrate` in `tests/rls/global-setup.ts` and assert `pg_class.relforcerowsecurity = true` for every tenant-scoped table in `tests/rls/setup.ts`).

**Tenant Read/Write Flow (target architecture for Phase 6+, primitive in place):**

1. Inbound request authenticates via Supabase Auth → JWT with `app_metadata.tenant_id` (Phase 6).
2. `withTenantContext({ tenantId, fn })` middleware (Phase 6) opens a Drizzle transaction.
3. Middleware calls `setTenantContext(tx, tenantId)` — `lib/tenant/context.ts` issues `SELECT set_config('app.tenant_id', $1, true)`.
4. User code runs queries inside the transaction. RLS policies on every tenant-scoped table filter `WHERE tenant_id = current_setting('app.tenant_id', true)::uuid`.
5. Transaction commits or rolls back; the `is_local=true` GUC dies with the transaction. Pooled-connection reuse cannot leak the GUC value.

**Pen-Test Bootstrap Flow (`tests/rls/seedTwoTenants.ts`):**

1. Connect to admin pool (`postgres` superuser) for agency-side writes (`agency_rule_version`, `agency_rule` are `system_role`-only via the `*_system_write` policy).
2. Lookup or insert SYSTEM tenant (`tenant.kind = 'SYSTEM'`).
3. `set_config('app.tenant_id', $systemTenantId, true)`, INSERT `rule_citation`, INSERT `agency_rule_version` with a unique non-overlapping daterange (random year 2100+ start to dodge the EXCLUDE constraint across test runs).
4. Open `app_user` pool, BEGIN.
5. Generate UUID client-side (`SELECT gen_random_uuid()`), `set_config('app.tenant_id', $newTenantId, true)`, INSERT `tenant (id, kind, name)` with id matching the GUC. The `tenant_self_filter` policy's WITH CHECK passes because `id = GUC`.
6. INSERT `_rls_canary`, `rule_citation`, `program`, `program_version` (state=`active`, daterange `[2026-01-01,2027-01-01)`), `program_rule` (`INVESTOR_OVERLAY ltv_max value=80`).
7. COMMIT for tenant A. Repeat in a fresh transaction for tenant B (the GUC resets on COMMIT).

**State Management:**
- All state lives in Postgres. No application-layer caching, no client-side state stores.
- `recorded_at timestamptz NOT NULL DEFAULT now()` is the system-time anchor on `program_version` and `agency_rule_version`. `effective_period daterange` is the valid-time anchor.

## Key Abstractions

**`tenant_kind` enum (`db/schema/tenant.ts`):**
- Purpose: Locked enum classifying every tenant. Values: `BROKERAGE | RETAIL_LENDER | WHOLESALE_LENDER | SYSTEM`.
- Files: `db/schema/tenant.ts`
- Pattern: pgEnum exported from the schema file. The SYSTEM tenant exists for hand-authored agency citations whose `rule_citation.tenant_id` must reference some tenant under RLS.

**`program_rule_layer` enum (`db/schema/program-rule.ts`):**
- Purpose: Constrain rules in `program_rule` to non-agency layers only. Values: `INVESTOR_OVERLAY | PRODUCT_FEATURE`. `AGENCY_BASE` and `LENDER_OVERLAY` are NEVER stored in this enum — agency rules live in `agency_rule` (where the layer is implicit on the table), and lender overlays live in `lender_overlay_rule` (where the layer is also implicit).
- Files: `db/schema/program-rule.ts`
- Pattern: pgEnum + RLS-policed table. Tested by `tests/schema/program-rule-layer-check.test.ts` (asserts `INSERT layer='AGENCY_BASE'` raises `invalid input value for enum program_rule_layer`).

**`rule_kind` enum (`db/schema/program-rule.ts`):**
- Purpose: 17-value enum identifying which rule shape the `rule_body` jsonb conforms to. The pgEnum literal at `db/schema/program-rule.ts` MUST match `ruleKinds` at `lib/rules/schemas/index.ts` verbatim. Values: `ltv_max, cltv_max, hcltv_max, fico_min, dti_max, reserves_min, derog_seasoning, income_doc_method, dscr_method, geo_state, geo_county, occupancy_allow, purpose_allow, property_type_allow, doc_type_allow, mi_required, manual_uw_path`.
- Files: `db/schema/program-rule.ts`, re-imported by `db/schema/agency-rule.ts` and `db/schema/lender-overlay-rule.ts`.
- Pattern: Single canonical enum source (`db/schema/program-rule.ts`) re-imported across all three rule tables so the enum is identical structurally.

**`daterange` custom type (`db/schema/_types/daterange.ts`):**
- Purpose: Drizzle 0.45 has no native daterange (drizzle-orm issue #2647). Custom type wraps Postgres daterange using string literal representation `[start,end)`.
- Files: `db/schema/_types/daterange.ts`
- Pattern: `customType<{ data: string; driverData: string }>` with `dataType()` returning `'daterange'` and identity converters.

**Per-rule_kind Zod dispatch (`lib/rules/schemas/index.ts`):**
- Purpose: Map each `rule_kind` enum value to its Zod schema. `parseRuleBody(kind, body)` is the single entry point; throws `ZodError` on shape mismatch.
- Files: `lib/rules/schemas/index.ts` (dispatch table), 17 per-kind files (`ltv-max.ts`, `cltv-max.ts`, ..., `manual-uw-path.ts`).
- Pattern: `const ruleBodySchemas = { ... } as const satisfies Record<RuleKind, z.ZodType>`. The `satisfies` clause makes adding a new `rule_kind` a compile error if its schema entry is missing.

**`detect_loosenings(uuid)` Postgres function (`db/migrations/0006_detect_loosenings.sql`):**
- Purpose: Compare every `INVESTOR_OVERLAY` rule on a `program_version` against the corresponding `AGENCY_BASE` rule on the linked `agency_rule_version`. Returns rows for each detected loosening (overlay more permissive than agency). `LANGUAGE sql STABLE SECURITY INVOKER`.
- Comparison rules per dimension:
  - `ltv_max | cltv_max | hcltv_max | dti_max`: overlay must be `<=` agency.
  - `fico_min | reserves_min`: overlay must be `>=` agency.
  - `derog_seasoning`: overlay's `base_waiting_months` and `extenuating_circumstances_waiting_months` must be `>=` agency.
  - Allow-list arrays (`occupancy_allow | purpose_allow | property_type_allow | doc_type_allow`): overlay's `values` must be a subset of agency's.
- Known issue: REVIEW.md CR-01 flagged a JOIN bug for `derog_seasoning` (function exists but the per-dimension JOIN does not pair on `event_type`).
- Files: `db/migrations/0006_detect_loosenings.sql`, exercised by `tests/schema/detect-loosenings.test.ts`.

## Entry Points

**`drizzle-kit migrate`:**
- Location: pnpm scripts `db:generate`, `db:migrate` in `package.json`.
- Triggers: developer running `pnpm db:migrate`, CI workflow, `tests/rls/global-setup.ts`.
- Responsibilities: apply numbered SQL migrations, write to `drizzle.__drizzle_migrations` journal.

**`vitest run --config vitest.config.ts` (RLS pen tests):**
- Location: `pnpm test:rls`.
- Triggers: developer locally, CI on every PR.
- Responsibilities: spin up two `pg.Pool` connections (`app_user` and `postgres` for agency seeds), run `drizzle-kit migrate` once via `tests/rls/global-setup.ts`, assert FORCE RLS sanity in `tests/rls/setup.ts`'s `beforeAll`, run cross-tenant pen tests in forked processes (`pool: 'forks'`, `isolate: true`, `sequence.concurrent: false`).

**`vitest run --config vitest.schema.config.ts` (schema + Zod-unit tests):**
- Location: `pnpm test:schema`.
- Triggers: developer locally; not yet wired into CI per the existing CI workflow.
- Responsibilities: schema-constraint tests (EXCLUDE, CHECK, FK, GENERATED, RLS policy enforcement) using both pools, Zod-unit tests (no DB).

**`docker compose up postgres`:**
- Location: `pnpm db:up`.
- Triggers: developer setting up local environment.
- Responsibilities: launch Postgres 16 container, run `scripts/init-db.sh` on first boot to provision `app_user` and `system_role`, mount data volume.

## Error Handling

**Strategy:** Fail-closed at every layer. Validation, RLS, and FK constraints all reject rather than silently degrade.

**Patterns:**
- **Boot-time env validation.** `lib/env.ts` uses `@t3-oss/env-core` + Zod. Importing the module throws synchronously if `DATABASE_URL` is missing/malformed or `RLS_TEST_JWT_SECRET` is shorter than 16 chars. `emptyStringAsUndefined: true` so `DATABASE_URL=` (typo'd empty) becomes the missing-var failure path, not an empty-string passthrough.
- **Bootstrap-pattern transactions.** Tenant creation requires generating the UUID client-side, calling `set_config` to that UUID, then INSERTing the row with the same UUID. The self-filtering policy's `WITH CHECK` clause then passes because `id = GUC`. Exemplified by `tests/rls/seedTwoTenants.ts` and `tests/schema/fixtures/seed.ts`.
- **SAVEPOINT before constraint violations in tests.** Tests that exercise EXCLUDE/CHECK rejection wrap the failing statement in `SAVEPOINT before_overlap` / `ROLLBACK TO SAVEPOINT before_overlap` so the outer transaction stays usable.
- **Sanity checks abort the suite.** `tests/rls/setup.ts`'s `beforeAll` aborts on three guards: connection role is BYPASSRLS (would silently bypass RLS), `pg_class.relforcerowsecurity = false` for any tenant-scoped table, missing expected RLS policy names. All three are existential — the only safe response is to abort.
- **Random non-overlapping dateranges in fixtures.** `seedAgencyDerogRule` and `seedSharedAgency` generate `[startYear-01-01, startYear+1-01-01)` with `startYear = 2100 + Math.floor(Math.random() * 100000)` so the `agency_rule_version_no_overlap` EXCLUDE constraint does not fire across multiple test invocations.

## Cross-Cutting Concerns

**Tenancy:** Database-enforced. Every tenant-scoped table has:
1. `tenant_id uuid NOT NULL REFERENCES tenant(id)` (or `id = current_setting(...)` for the `tenant` table itself).
2. `tenant_id` btree index (`*_tenant_idx`).
3. `pgPolicy('*_tenant_isolation', { for: 'all', to: 'public', using: tenant_id = GUC, withCheck: tenant_id = GUC })`.
4. `ALTER TABLE ... FORCE ROW LEVEL SECURITY` in a custom migration.
5. Explicit `GRANT SELECT, INSERT, UPDATE, DELETE ... TO app_user` after `CREATE TABLE` (in the same custom migration).

**Cross-tenant agency reads:** `agency_rule_version` and `agency_rule` carry no `tenant_id`. They have two policies:
- `*_world_read`: `FOR SELECT TO public USING (true)` — every authenticated tenant can read.
- `*_system_write`: `FOR ALL TO system_role USING (true) WITH CHECK (true)` — only `system_role` (granted to `postgres`) writes.
- Tested by `tests/schema/agency-cross-tenant-readable.test.ts` (asserts SELECT works under `connectAsTenant` and `connectAsAnonymous`; INSERT from `app_user` raises permission denied / RLS policy error).

**Validation:** Two-tier. Database CHECK constraints + pgEnums constrain top-level shape (`jsonb_typeof = 'object'`, enum membership, agency 5-value, state 5-value, citation has at least one source). Zod schemas at `lib/rules/schemas/` constrain `rule_body` shape per `rule_kind`. Schemas live in TypeScript so changes do not require migrations.

**Audit / immutability:** `program_version.recorded_at` and `agency_rule_version.recorded_at` are `DEFAULT now() NOT NULL`. The system-time anchor never moves; new versions of the same logical entity get new rows with new `recorded_at`. The append-only `evaluation_event` table referenced in CLAUDE.md is Phase 4+ and not yet present.

**Authentication:** Not in scope yet. Phase 1+2 ship the GUC primitive (`set_config('app.tenant_id', ...)` via `lib/tenant/context.ts`) and a JWT pen-test fixture (`tests/rls/fixtures/jwt.ts` mints HS256 JWTs with `app_metadata.tenant_id` for tampering tests). Phase 6 swaps to RS256 + Supabase JWKS verification + `withTenantContext` middleware.

**Pure-TS evaluation engine (`lib/eval/`):** Deferred. Per CLAUDE.md and the task brief, the evaluator is planned for Phase 4 and is NOT implemented yet. No `lib/eval/` directory exists in the current scope. When it lands, it will consume `RuleSnapshot` (hydrated by walking `program_version → program_rule → rule_citation` UNION agency UNION lender_overlay) and a `Scenario`, returning `{decision, rule_stack, deciding_rule, near_miss}` with no I/O and no framework deps.

---

*Architecture analysis: 2026-05-01*
