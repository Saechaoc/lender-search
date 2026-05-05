<!-- generated-by: gsd-doc-writer -->
# Deployment

> **Status: No production deployment exists at the time of writing.** Lender Search is at
> Phase 3 of a 15-phase rebuild (`.planning/STATE.md`). Phases 1 (Tenant Isolation Foundation)
> and 2 (Rule Schema) have shipped — both are database-tier and CI-tier only. The Next.js
> application skeleton, Vercel project, Supabase project, and Inngest worker pool all land
> in Phase 6+. This document describes the **planned** runtime topology from
> `.planning/research/STACK.md` and `CLAUDE.md`, alongside the **shipped** CI pipeline that
> already runs on every push and pull request to `main`.
>
> Sections marked **Shipped** describe artifacts that exist in the repository today.
> Sections marked **Planned** describe deployment behavior that is documented but not yet
> provisioned; those sections carry `<!-- VERIFY: ... -->` markers for any infrastructure
> claim that cannot be confirmed against the current repository.

---

## Deployment targets

The phased deployment posture is:

| Target | Status | Owns | Source of truth |
|---|---|---|---|
| GitHub Actions (CI) | **Shipped** | Lint, typecheck, schema constraints, RLS pen tests on every PR + push to `main` | `.github/workflows/ci.yml` |
| Vercel (Web + Server Actions) | **Planned (Phase 6+)** | Next.js 16.2 production + per-PR preview deployments; Server Actions runtime; Vercel Cron for the agency-poll job | `.planning/research/STACK.md`, `CLAUDE.md` Technology Stack |
| Inngest (Durable workers) | **Planned (Phase 6+)** | Extraction pipeline + agency cascade; survives Vercel's 60s function ceiling | `.planning/research/STACK.md`, `CLAUDE.md` Technology Stack |
| Supabase (Managed Postgres + Auth) | **Planned (Phase 6+)** | Postgres 16 with `FORCE ROW LEVEL SECURITY`; Supabase Auth issues `tenant_id`-bearing JWTs | `.planning/research/STACK.md`, `CLAUDE.md` Technology Stack |
| Supabase Storage | **Planned (Phase 7)** | Source PDFs + page renders for AM review | `.planning/research/STACK.md` |

There is **no** Dockerfile, `docker-compose.yml` for production, `vercel.json`, `fly.toml`,
`netlify.toml`, `serverless.yml`, or `.github/workflows/deploy*.yml` in the repository at
this time. The single `docker-compose.yml` at the project root provisions a **local-only**
Postgres 16 container for development and is not a production artifact.

<!-- VERIFY: Vercel project, Supabase project, and Inngest organization have not been
provisioned at Phase 3; specific URLs, project IDs, and team identifiers are not yet
captured in the repository. -->

---

## Build pipeline (Shipped — CI only)

The current build/verify pipeline is `.github/workflows/ci.yml`. It runs on every pull
request to `main` and every push to `main`, with concurrency cancellation on the same
branch (`group: ${{ github.workflow }}-${{ github.ref }}`, `cancel-in-progress: true`).

### Trigger

```yaml
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
```

### Service container

```yaml
services:
  postgres:
    image: postgres:16-alpine
    env:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: lender_search_test
    ports: [5432:5432]
    options: >-
      --health-cmd "pg_isready -U postgres"
      --health-interval 5s
      --health-timeout 3s
      --health-retries 10
```

The Postgres 16 service container is the same major version as the planned production
Supabase target. Health-check options block the workflow until `pg_isready` returns
healthy so subsequent `psql` and `drizzle-kit migrate` steps cannot race against a
half-booted database.

### Pipeline steps

The `verify` job (single job at Phase 1+; multi-job fan-out is a Phase 6+ concern) runs in
this exact order — each step is a merge-gate:

1. **Checkout** (`actions/checkout@v4`).
2. **Install pnpm** (`pnpm/action-setup@v4`). Version is read from
   `package.json` `packageManager` (Corepack convention). Setting `with.version` would
   collide with `packageManager` and throw `ERR_PNPM_BAD_PM_VERSION`.
3. **Setup Node.js** (`actions/setup-node@v4`) — Node 20 with `cache: pnpm`.
4. **Install dependencies** — `pnpm install --frozen-lockfile` (rejects any drift between
   `package.json` and `pnpm-lock.yaml`).
5. **Provision `app_user` + `system_role`** — runs an inline `psql` heredoc that mirrors
   `scripts/init-db.sh`:
   - `CREATE ROLE app_user LOGIN PASSWORD '...' NOBYPASSRLS NOSUPERUSER` — so `FORCE ROW
     LEVEL SECURITY` is meaningful (a superuser implicitly bypasses RLS even without the
     `BYPASSRLS` flag).
   - `CREATE ROLE system_role NOLOGIN NOBYPASSRLS NOSUPERUSER` (idempotent
     `IF NOT EXISTS` guard) — owner of agency-side INSERTs whose RLS policy is
     `to: system_role`.
   - `GRANT system_role TO postgres` so the migration role can issue `SET ROLE
     system_role` for agency-side operations.
6. **Typecheck** — `pnpm typecheck` (`tsc --noEmit`). Strict mode + `noUncheckedIndexedAccess`
   per `tsconfig.json`.
7. **Lint** — `pnpm lint` (ESLint flat config; ignores the intentional fixture).
8. **Lint fixture** — `pnpm lint:fixture` runs ESLint against `app/.eslint-fixture.ts` and
   inverts the exit code: a passing run **proves** the `no-restricted-properties` (on
   `process.env`) and `no-restricted-imports` (on `**/service-role*` and `**/admin-db*`)
   rules fire on real violations. Forward-looking — `app/` does not yet exist at Phase 3.
9. **Apply migrations + grant DML** — `pnpm drizzle-kit migrate` runs as the `postgres`
   superuser (`DATABASE_URL` is overridden inline for this step only because **only the
   table owner** can execute `ALTER TABLE … FORCE ROW LEVEL SECURITY` and `CREATE POLICY`).
   Followed by `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO
   app_user` because tables created during `migrate` are not covered by
   `init-db.sh`'s `ALTER DEFAULT PRIVILEGES` (which applies to **future** tables only).
10. **Verify FORCE ROW LEVEL SECURITY** (TNT-01 gate) — queries `pg_class.relforcerowsecurity`
    via `psql -t -A -F'|'` and `grep`s for `^tenant|t$` and `^_rls_canary|t$`. The plain
    `||` SQL concatenation operator was rejected during Plan 01-08 because Postgres casts
    `bool` to text as `true`/`false`, breaking the grep. The current form uses psql's
    field separator instead.
11. **Schema constraint suite** — `pnpm test:schema` (Phase 2 D-20 + D-10 gates).
12. **RLS pen-test suite** — `pnpm test:rls` (TNT-04 merge gate).

The job has `timeout-minutes: 10` — Phase 1 typically finishes in under a minute (RLS
pen-test smoke run reported 596ms locally per `.planning/STATE.md`).

### CI environment variables

| Variable | Value | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://app_user:app_user_password@localhost:5432/lender_search_test` | Pen-test connection string. `app_user` is `NOBYPASSRLS NOSUPERUSER` per Plan 01-01. |
| `DATABASE_MIGRATION_URL` | `postgresql://postgres:postgres@localhost:5432/lender_search_test` | Migration-only connection (table owner). Used by `drizzle-kit migrate` in step 9. |
| `RLS_TEST_JWT_SECRET` | `ci-fixture-jwt-secret-min-16-chars` | HS256 secret for pen-test JWT minting. ≥16 chars per `lib/env.ts` schema. Phase 6+ swaps to RS256 + Supabase JWKS. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Intentionally unset** | `tests/rls/service-role-boundary.test.ts` asserts at runtime that this var is **not** present in the CI process env (T-01-04 mitigation per Plan 07). |
| `PGPASSWORD` | `postgres` (per-step) | psql convention. Set only on steps that talk to Postgres directly. |

The `PGPASSWORD` and `DATABASE_URL` overrides on the migrate step are the only two places
where the CI workflow uses the postgres-superuser role; the pen-test job re-inherits the
top-level `app_user` `DATABASE_URL` so RLS is meaningful when the test suite runs.

---

## Build pipeline (Planned — Phase 6+)

<!-- VERIFY: Vercel project, build settings, output directory, and per-PR preview URLs are
not yet provisioned. -->

The planned Vercel pipeline (per `.planning/research/STACK.md`):

1. PR opened → Vercel triggers a preview deployment from the PR branch.
2. Vercel runs `pnpm install --frozen-lockfile` then the planned `pnpm build` (Next.js 16.2 build, once the Next.js app skeleton lands in Phase 6+). <!-- VERIFY: Phase 6+ planned, build script does not exist yet at Phase 1 -->
3. On merge to `main`, the same build deploys to the production environment.
4. Vercel encrypted env injects `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the
   Anthropic / Reducto / Inngest / Sentry / Axiom keys at runtime.

Inngest is deployed separately (Vercel Marketplace one-click integration) so the worker
pool survives Vercel's 60s function ceiling. Migrations remain a manual `pnpm db:migrate`
step run against `DATABASE_MIGRATION_URL` (the table-owner connection); they do **not** run
on Vercel deploy. Whether migrations run via a GitHub Actions deploy job or a Supabase CLI
release flow is an open Phase 6 decision. <!-- VERIFY: migration release flow is not
chosen yet; the Phase 6 plan owns this decision. -->

---

## Environment setup (Planned — production)

Production environment variables track the schema in `lib/env.ts` (see
[`CONFIGURATION.md`](CONFIGURATION.md) for the full table). The relevant differences
between local/CI and production are:

| Variable | Local / CI value | Production value | Source |
|---|---|---|---|
| `DATABASE_URL` | local docker / GitHub service Postgres | Supabase pooler URL (postgres-js with `prepare: false`) | Vercel encrypted env |
| `DATABASE_MIGRATION_URL` | postgres superuser on local/CI | Supabase direct connection (table owner) | Vercel encrypted env or release runner |
| `RLS_TEST_JWT_SECRET` | HS256 fixture | **Not present** — production auth uses RS256 + Supabase JWKS | Removed from production env |
| `SUPABASE_SERVICE_ROLE_KEY` | **Intentionally absent** in CI | Required (`z.string().min(20)` in Phase 6 schema) | Vercel encrypted env |
| `NODE_ENV` | `development` / `test` | `production` | Vercel automatic |
| Anthropic / Reducto / Inngest / Sentry / Axiom keys | not present | required at boot | Vercel encrypted env |

<!-- VERIFY: Specific Anthropic, Reducto, Inngest, Sentry, and Axiom key names and values
are documented in `.planning/research/STACK.md` but not yet wired into `lib/env.ts`. -->

The schema in `lib/env.ts` already enforces the **boot-fail-closed contract** for the
Phase 1 vars — production deployment inherits the same contract. A missing or malformed
required var crashes the function cold-start before the first DB connection, which means
"forgot to set the env var" presents as `Internal Server Error` on every request rather
than a silent default that exfiltrates data.

The ESLint posture (`no-restricted-properties` on `process.env` and `no-restricted-imports`
on `**/service-role*`) prevents new app-path code from sidestepping the validated schema or
reaching for the service-role connection. Phase 6's first `app/` PR is gated on these rules
without anyone having to remember to add them; the `lint:fixture` step proves they fire.

---

## Rollback procedure (Planned)

<!-- VERIFY: Rollback procedure is documented at the architectural level only; no Vercel
project exists yet to define rollback through the platform UI. -->

Three rollback layers are documented in `.planning/research/ARCHITECTURE.md` and
`.planning/PROJECT.md`:

### 1. Application code rollback (Vercel)

Vercel keeps every prior deployment immutable. To roll back:

1. Open the Vercel project → Deployments tab.
2. Locate the last known-good deployment.
3. Promote it to production via the "Promote to Production" action.

Rollback is **fast** (seconds) and does not require a rebuild. The previous Docker image /
Vercel build artifact is reused.

### 2. Database migrations

Migrations are **not** auto-rolled-back. The repository does not ship a `down.sql` for any
migration in `db/migrations/`. The deliberate posture is forward-only migrations with two
guardrails:

- **Bitemporal versioning** of `program_version` and `agency_rule_version` means rule
  corrections at runtime are inserts (new active version + expire old version), not
  destructive updates.
- **Append-only `evaluation_event`** — `REVOKE UPDATE, DELETE` is enforced at the database
  level (planned Phase 3 change) so there is no audit-log row to "roll back."

If a structural migration must be reverted, the operator writes a forward migration that
undoes the prior one. There is no `drizzle-kit drop` shortcut for an applied migration.

### 3. Rule corruption rollback (Phase 4+)

`evaluation_event` records the `ruleset_snapshot_id` used for every evaluation
(content-addressed sha256 of the canonical rule bundle). Replaying any prior evaluation is
deterministic against that snapshot ID, which means a rule-content mistake is bounded by:
"all evaluations between snapshot A and snapshot B used the bad rule; here is the exact
list." Re-evaluating affected scenarios after a corrective rule version is **the** rule-
corruption rollback path.

<!-- VERIFY: `evaluation_event` table is planned for Phase 3 and does not exist in the
shipped schema (Phase 1+2). -->

---

## Monitoring (Planned)

<!-- VERIFY: No monitoring is wired up at Phase 3 — Sentry, Axiom, OpenTelemetry, and
Inngest dashboards are documented in `.planning/research/STACK.md` but not provisioned.
Specific dashboard URLs and alert webhook endpoints are not in the repository. -->

The planned observability stack (per `CLAUDE.md` and `.planning/research/STACK.md`):

| Tool | Purpose | Phase |
|---|---|---|
| **Sentry** | Errors + performance traces for Server Actions, Route Handlers, and the Inngest worker pool | Phase 6+ |
| **Axiom** | Log retention beyond Vercel's 1-day window | Phase 6+ |
| **LLM call traces** | Token cost + latency per Claude / Reducto call, joined to `extraction_run_id` | Phase 7 (alongside the extraction pipeline) |
| **Inngest dashboard** | Workflow run history, retries, dead-letter queue | Phase 6+ |
| **Supabase dashboard** | Database health, slow-query log, connection pool usage | Phase 6+ |

The dependency manifest at `package.json` has **no** Sentry, Axiom, OpenTelemetry, New
Relic, or Datadog packages installed at the time of writing — the wire-up lands when the
first Vercel-hosted code does. Phase 1's posture is "the database is the system; CI is the
deploy target" and the CI logs themselves are the only observability surface required.

The `evaluation_event` audit log is the **system of record** for evaluation outcomes —
not a logging tool. It is queryable, partitioned by month, and content-addressed by rule
snapshot. Sentry and Axiom complement it for application-tier signals (errors, slow
queries, performance regressions); they do not replace it.

---

## CI badge

<!-- VERIFY: README does not currently embed a CI badge; `.github/workflows/ci.yml`
status URL would be
`https://github.com/<org>/<repo>/actions/workflows/ci.yml/badge.svg` once the
public-facing repository slug is decided. -->

---

## Cross-references

- [`CONFIGURATION.md`](CONFIGURATION.md) — full env-variable inventory, validation, and
  per-environment override behavior.
- [`DEVELOPMENT.md`](DEVELOPMENT.md) — local docker setup, pnpm scripts, and the
  drizzle migration commands referenced above.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — why the deployment shape (Postgres-centric Next.js
  + separate Inngest pool) maps to the eligibility-evaluation domain.
- `.planning/research/STACK.md` — research-grade rationale for Vercel + Supabase + Inngest
  vs. alternatives.
- `.github/workflows/ci.yml` — the CI pipeline as it actually runs today.
