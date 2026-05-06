<!-- generated-by: gsd-doc-writer -->
# Configuration

Configuration for **lender-search** is centralized in a single typed schema (`lib/env.ts`) backed by `@t3-oss/env-core` + Zod. Direct `process.env.*` access is intentionally banned from application paths by ESLint; every Phase 1+ runtime path reads from `env.*` so missing or malformed values fail boot synchronously, before the first DB connection.

This document covers:

- Every environment variable, where it is validated, and why it exists.
- The three Vitest config variants (`rls`, `schema`, `env-boot`) and why they are split.
- The two custom ESLint rules that enforce the env-segregation contract.
- Per-environment overrides (local docker, CI, future Phase 6 Supabase).

For runtime-specific wiring (drizzle, postgres-js client, RLS policies) see `DEVELOPMENT.md`. For deployment-time secret material see `DEPLOYMENT.md`.

---

## Environment variables

The canonical list is `.env.local.example` at the project root. Variables are validated by `lib/env.ts` (`createEnv` from `@t3-oss/env-core`); a typo'd empty value (e.g. `DATABASE_URL=`) is converted to `undefined` via `emptyStringAsUndefined: true`, so Zod's required-check fires instead of letting an empty string pass through.

| Variable | Required | Default | Validated by | Description |
|---|---|---|---|---|
| `DATABASE_URL` | Yes | — | `lib/env.ts` (`z.string().url()` + `postgresql://`/`postgres://` refinement) | Runtime / pen-test connection string. Must connect as `app_user` (`NOBYPASSRLS NOSUPERUSER`) so `FORCE ROW LEVEL SECURITY` is meaningful — superusers bypass RLS silently and would make pen tests vacuous. Consumed by `lib/db/client.ts` (postgres-js) and `tests/rls/setup.ts` (node-postgres). |
| `DATABASE_MIGRATION_URL` | Conditional | falls back to `DATABASE_URL` | `drizzle.config.ts` (manual non-empty check) | Migration-only connection string (postgres superuser). Required because only the table owner can `ALTER TABLE … FORCE ROW LEVEL SECURITY`, `CREATE TABLE`, and `CREATE POLICY`. Consumed by `drizzle-kit generate` / `drizzle-kit migrate` and by `tests/rls/global-setup.ts` for migrate + GRANT steps. Falls back to `DATABASE_URL` when only the privileged connection is available (e.g., the CI workflow). |
| `RLS_TEST_JWT_SECRET` | Optional | — (boot-validated min 16 chars **if set**) | `lib/env.ts` (`z.string().min(16).optional()`) | HS256 signing secret used by `tests/rls/fixtures/jwt.ts` (`mintJWT`, `forgeJWT`) to mint pen-test JWTs. Optional so production-style boots without test secrets still pass; the pen-test suite throws explicitly if absent. Phase 6 swaps to RS256 + Supabase JWKS verification. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional (Phase 1) | — | `lib/env.ts` (`z.string().optional()`) | Phase 1 placeholder. **Intentionally absent from CI** — `tests/rls/service-role-boundary.test.ts` asserts at runtime that this var is not present in the test process env (T-01-04 mitigation). The matching ESLint rule blocks reads of this var from `app/`, `pages/`, and `src/`. Phase 6 tightens the schema to `z.string().min(20)`. |
| `NODE_ENV` | Optional | `development` | `lib/env.ts` (`z.enum(['development','test','production']).default('development')`) | Standard Node runtime mode. Constrained to the three documented values so a typo (e.g., `prodution`) fails boot rather than silently behaving like `development`. |

**Discoverable via `process.env.*` only (not in `lib/env.ts`):**

| Variable | Where it is read | Notes |
|---|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `docker-compose.yml`, `scripts/init-db.sh` | Docker entry-point env. Consumed only by the local Postgres container provisioning flow; never read by application code. |
| `PGPASSWORD` | `.github/workflows/ci.yml` | `psql` convention used by CI to provision `app_user` and `system_role` against the GitHub Actions Postgres service. |

> All five `lib/env.ts`-validated names are intentionally the entire authorized surface for application code. Adding a new var requires a schema update in `lib/env.ts` plus, if it is sensitive, an entry in the ESLint `no-restricted-properties` allow-list. See "ESLint enforcement" below.

### Boot-fail-closed contract

`lib/env.ts` is imported eagerly by `lib/db/client.ts` (and any future server entry point). Importing it throws synchronously if any required server var is missing or malformed. The contract is regression-tested by `tests/rls/env-boot.test.ts`, which uses `vi.stubEnv` + `vi.resetModules()` to dynamically re-import the schema under each invalid case:

- Empty `DATABASE_URL` → throws (the `emptyStringAsUndefined` path).
- Non-URL `DATABASE_URL` → throws (`z.string().url()`).
- Valid URL but wrong scheme (e.g. `https://…`) → throws (the `postgresql://` refinement).
- `RLS_TEST_JWT_SECRET` set but shorter than 16 chars → throws.
- `SUPABASE_SERVICE_ROLE_KEY` omitted → succeeds (optional at Phase 1).
- `NODE_ENV` empty → resolves to `development`.

---

## Config files

There is no JSON/YAML application config beyond `.env.local`. Tooling configuration is split into focused files at the project root:

| File | Purpose |
|---|---|
| `package.json` | pnpm workspace root; `engines` pin Node `>=20.9.0` and pnpm `>=9.0.0`; `packageManager` pins pnpm `9.15.0` (Corepack). Scripts cover db lifecycle, migrations, two test suites, lint, and typecheck. |
| `pnpm-workspace.yaml` | Single-package monorepo (`packages: ["."]`). Forward-looking: real workspaces arrive in Phase 6+. |
| `tsconfig.json` | TypeScript 5.7 strict mode + `noUncheckedIndexedAccess` + `noImplicitOverride`; module/resolution `NodeNext`; `target` ES2022. `include` covers `lib/**`, `db/**`, `tests/**`, `drizzle.config.ts`, `vitest.config.ts`. The legacy `src/` (CRA prototype) is excluded. |
| `drizzle.config.ts` | Drizzle Kit config: schema at `./db/schema/index.ts`, migrations out at `./db/migrations`, dialect `postgresql`. Loads `.env.local` then `.env` via `dotenv` — `dotenv` does not override pre-set env vars, so CI / Vercel secrets win. |
| `eslint.config.mjs` | Flat config with two custom restrictions (see "ESLint enforcement"). |
| `vitest.config.ts` | RLS pen-test runner (default). |
| `vitest.schema.config.ts` | Phase 2 schema-constraint + Zod-unit runner. |
| `vitest.env-boot.config.ts` | Standalone runner for `env-boot.test.ts` (see "Vitest config variants"). |
| `docker-compose.yml` | Local Postgres 16-alpine + healthcheck; mounts `scripts/init-db.sh` to provision `app_user` and `system_role`. |

### Drizzle migration vs. runtime split

`drizzle.config.ts` deliberately resolves the connection in this order:

```ts
const migrationUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
```

Two distinct strings exist because:

- **Runtime / pen tests** must connect as `app_user` (`NOBYPASSRLS NOSUPERUSER`) so `FORCE RLS` is meaningful. That URL is `DATABASE_URL`.
- **Migrations** must connect as the `postgres` superuser — the table owner — because only the owner can run `ALTER TABLE … FORCE ROW LEVEL SECURITY` (per migration `0001_force_rls.sql`) and `CREATE POLICY`. That URL is `DATABASE_MIGRATION_URL`.

If `DATABASE_MIGRATION_URL` is unset, drizzle-kit falls back to `DATABASE_URL`. This matches the CI workflow, which exports the privileged URL only at the moment migrations run.

---

## Vitest config variants

Three Vitest config files exist because the test suites have different DB-setup requirements and run at different points in the migration timeline.

| Config | npm script | Includes | Setup files | Why it exists |
|---|---|---|---|---|
| `vitest.config.ts` | `pnpm test:rls`, `pnpm test:rls:watch` | `tests/rls/**/*.test.ts` | `globalSetup: ./tests/rls/global-setup.ts` (truncates tables, runs `drizzle-kit migrate` as postgres, GRANTs DML to `app_user`); `setupFiles: ./tests/rls/setup.ts` (opens `__pgPool` as `app_user` and `__pgAdminPool` as postgres; asserts `relforcerowsecurity = true` on every tenant-scoped table; verifies the connection role is **not** `BYPASSRLS`) | RLS pen-test merge gate (TNT-04). Pen tests connect as `app_user` so RLS is meaningful, but need a postgres-superuser pool to seed agency-side rows whose policy uses `to: system_role`. |
| `vitest.schema.config.ts` | `pnpm test:schema` | `tests/schema/**/*.test.ts`, `tests/rules/**/*.test.ts` | `setupFiles: ./tests/schema/setup.ts` (opens both pools; **does not** run migrate or the FORCE-RLS canary check) | Schema-constraint suite (Phase 2 D-20) and Zod-unit rule suite (D-10) have different needs: agency-side INSERTs require the postgres superuser, and Zod tests don't need the DB at all. The Phase 1 FORCE-RLS sanity check is irrelevant to schema-constraint assertions. Migrations are assumed already applied by the [BLOCKING] migrate step in CI. |
| `vitest.env-boot.config.ts` | (no script; invoked directly) | `tests/rls/env-boot.test.ts` | _none_ | Standalone runner for the env-validation regression test. The main `vitest.config.ts` references `tests/rls/global-setup.ts` and `tests/rls/setup.ts`, which the env-boot test cannot use (it deliberately mutates `DATABASE_URL`, which would crash the global setup's `pg.Pool`). The plan's documented `--config=""` workaround is broken in Vitest 4.1.5; this minimal config is the documented fallback. |

All three share `pool: 'forks'`, `isolate: true`, and `sequence: { concurrent: false }` — pen tests and schema tests must not race against shared DB state.

---

## ESLint enforcement

`eslint.config.mjs` is the runtime contract for the env-segregation posture. Two flat-config rules are load-bearing:

### 1. `no-restricted-properties` on `process.env`

```js
// eslint.config.mjs (excerpt)
'no-restricted-properties': [
  'error',
  {
    object: 'process',
    property: 'env',
    message:
      'Read env vars from `lib/env.ts` (t3-env) only. Direct `process.env` access in app paths bypasses runtime validation (CFG-05).',
  },
],
```

**Scope:** files matching `app/**/*.ts`, `app/**/*.tsx`, `pages/**/*.ts`, `pages/**/*.tsx`, `src/**/*.ts`, `src/**/*.tsx`. The single sanctioned env-reader is `lib/env.ts`.

**Sanctioned exclusions** (paths the rule does not reach because they don't match the `files` glob):

- `lib/env.ts` itself — the t3-env schema.
- `db/migrations/**` — drizzle artifacts; no logic.
- `tests/**` — pen-test env access (`vi.stubEnv` etc.).
- `scripts/**` — local-dev maintenance.
- `*.config.*` — `drizzle.config.ts`, `vitest.config.ts`, etc.

### 2. `no-restricted-imports` on service-role / admin-db patterns

```js
// eslint.config.mjs (excerpt)
'no-restricted-imports': [
  'error',
  {
    patterns: [
      {
        group: ['**/service-role*', '**/admin-db*'],
        message:
          'service_role / admin DB clients must not be imported from app paths. Only migration scripts and CI tools may use them (TNT-02 / D-02).',
      },
    ],
  },
],
```

`SUPABASE_SERVICE_ROLE_KEY` connects with `BYPASSRLS` — it must never appear in the application graph. The rule is forward-looking (no `app/` code exists at Phase 1) but `app/.eslint-fixture.ts` exercises it: `pnpm lint:fixture` deliberately runs ESLint against a file with three violations (`process.env.DATABASE_URL`, `process.env.SUPABASE_SERVICE_ROLE_KEY`, and forbidden import patterns) and inverts the exit code so a passing run proves the rules fire.

The main `pnpm lint` script ignores the fixture via `--ignore-pattern 'app/.eslint-fixture.ts'`.

### Defense layers

The env-segregation contract is enforced at three layers:

1. **Schema (`lib/env.ts`)** — `SUPABASE_SERVICE_ROLE_KEY` is `.optional()` at Phase 1; tightening to `.min(20)` lands in Phase 6.
2. **Lint (`eslint.config.mjs`)** — direct `process.env.*` reads from app paths and service-role imports both fail CI.
3. **Runtime (`tests/rls/service-role-boundary.test.ts`)** — asserts at test time that `SUPABASE_SERVICE_ROLE_KEY` is **not** present in the CI process env (T-01-04 mitigation; CI explicitly does not export it).

---

## Required vs. optional settings

**Required for any boot path that imports `lib/env.ts`:**

- `DATABASE_URL` — must be a `postgresql://` or `postgres://` URL.

**Required for `drizzle-kit migrate` / `drizzle-kit generate`:**

- `DATABASE_MIGRATION_URL` **or** `DATABASE_URL` (one of the two; `drizzle.config.ts` throws if neither is set).

**Required for the RLS pen-test suite (`pnpm test:rls`):**

- `DATABASE_URL` — must point at `app_user` (the FORCE-RLS sanity check fails on superuser connections).
- `DATABASE_MIGRATION_URL` (or a `DATABASE_URL` that can be string-substituted to the postgres role) — needed for migrate + agency-side seeds.
- `RLS_TEST_JWT_SECRET` — `mintJWT()` throws explicitly without it.

**Optional everywhere at Phase 1:**

- `SUPABASE_SERVICE_ROLE_KEY` — must remain absent from the CI process env (asserted).
- `NODE_ENV` — defaults to `development`.

---

## Defaults

| Setting | Default | Source |
|---|---|---|
| `NODE_ENV` | `development` | `lib/env.ts` Zod schema |
| postgres-js `prepare` | `false` | `lib/db/client.ts` (Supabase Supavisor pooler does not support prepared statements; non-negotiable) |
| postgres-js `max` connections | `10` | `lib/db/client.ts` (Phase 1 — no app load yet) |
| postgres-js `idle_timeout` | `30` seconds | `lib/db/client.ts` (matches Supabase pooler defaults) |
| postgres-js `ssl` | `false` | `lib/db/client.ts` (Phase 1 docker; Phase 6 sets `'require'`) |
| Vitest `testTimeout` / `hookTimeout` (rls + schema) | `10_000` ms | `vitest.config.ts`, `vitest.schema.config.ts` |
| Vitest `testTimeout` / `hookTimeout` (env-boot) | `5_000` ms | `vitest.env-boot.config.ts` |
| Local Postgres image | `postgres:16-alpine` | `docker-compose.yml` |
| Local Postgres host port | `5432:5432` | `docker-compose.yml` |
| Local docker `POSTGRES_DB` | `lender_search_dev` | `docker-compose.yml` |
| CI Postgres `POSTGRES_DB` | `lender_search_test` | `.github/workflows/ci.yml` |

---

## Per-environment overrides

`dotenv` is loaded in this order in every entry point that touches the DB (`drizzle.config.ts`, `tests/rls/global-setup.ts`, `tests/rls/setup.ts`, `tests/schema/setup.ts`):

```ts
loadDotenv({ path: '.env.local' });
loadDotenv({ path: '.env' });
```

Two consequences flow from this:

1. `.env.local` (gitignored — see `.gitignore`) wins over `.env` for committed defaults.
2. `dotenv` does **not** override pre-existing env vars, so CI's GitHub Actions secrets and Vercel encrypted env (Phase 6) take precedence over either dotfile.

### Local development

Copy the example file:

```bash
cp .env.local.example .env.local
```

The example values are:

```
DATABASE_URL=postgresql://app_user:app_user_password@localhost:5432/lender_search_dev
DATABASE_MIGRATION_URL=postgresql://postgres:postgres@localhost:5432/lender_search_dev
RLS_TEST_JWT_SECRET=local-dev-fixture-secret-change-me
# SUPABASE_SERVICE_ROLE_KEY=     # left commented; Phase 6 wires the real Supabase project
```

The `lender_search_dev` database is provisioned by `docker compose up -d postgres` (`pnpm db:up`); the `scripts/init-db.sh` entry point creates `app_user` (`NOBYPASSRLS NOSUPERUSER`) and `system_role` (`NOLOGIN NOBYPASSRLS NOSUPERUSER`) automatically on first start.

### CI (GitHub Actions)

`.github/workflows/ci.yml` exports its own values for the `lender_search_test` database (provisioned by the `postgres:16-alpine` service container):

```yaml
env:
  DATABASE_URL: postgresql://app_user:app_user_password@localhost:5432/lender_search_test
  DATABASE_MIGRATION_URL: postgresql://postgres:postgres@localhost:5432/lender_search_test
  RLS_TEST_JWT_SECRET: ci-fixture-jwt-secret-min-16-chars
  # SUPABASE_SERVICE_ROLE_KEY is intentionally NOT set here.
```

The workflow then replicates `scripts/init-db.sh` inline (CREATE ROLE `app_user` + `system_role` + GRANTs) before running migrations as the postgres superuser. Test-suite invocation is `pnpm typecheck` → `pnpm lint` → `pnpm lint:fixture` → `drizzle-kit migrate` → `pnpm test:schema` → `pnpm test:rls`.

### Production (Phase 6+)

<!-- VERIFY: Production env management uses Vercel encrypted env per CLAUDE.md technology stack; specific Vercel project / team URLs are not yet provisioned at Phase 1. -->

The production posture documented in `CLAUDE.md` is:

- Vercel encrypted env stores all server-side secrets.
- `lib/env.ts` (`@t3-oss/env-core`) validates them at boot — same schema, same fail-closed contract.
- Phase 6 swaps `@t3-oss/env-core` → `@t3-oss/env-nextjs` (same Zod schemas) and adds `NEXT_PUBLIC_*` keys when the app exists.
- `SUPABASE_SERVICE_ROLE_KEY` tightens from `.optional()` to `z.string().min(20)`.
- `RLS_TEST_JWT_SECRET` is **not** present in production env; the production auth path uses RS256 + Supabase JWKS verification instead of the HS256 test fixture.

No production deployment exists at the time of writing. See `DEPLOYMENT.md` for current deployment status.

---

## Cross-references

- `DEVELOPMENT.md` — local setup, `pnpm` scripts, drizzle migration commands.
- `DEPLOYMENT.md` — runtime infrastructure and CI pipeline detail.
- `ARCHITECTURE.md` — why RLS + role separation drives the two-DB-URL split.
- `lib/env.ts` — single source of truth for the validated schema.
- `.env.local.example` — single source of truth for the env-var inventory.
