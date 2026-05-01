---
last_mapped_commit: 78f1733137651248ed0cf7e02bf3cf8ad36f1c83
mapped_at: 2026-05-01
focus: tech
scope: "db,tests,lib,scripts (excludes legacy src/App.js prototype)"
---

# External Integrations

**Analysis Date:** 2026-05-01

> **Scope note:** This document describes the **rebuild's** integrations. Phases 1 and 2 just landed (tenant isolation foundation + rule schema). Many integrations declared in the research stack — Supabase Auth, Inngest, Reducto, Anthropic SDK, Sentry, Axiom — are **decided but not yet integrated** into code. Each is flagged below.

## APIs & External Services

**Currently integrated (code calls SDK or service):**

- **None at the network layer.** The rebuild has not yet wired any external HTTP/API integration. The codebase under `db/`, `lib/`, `tests/`, `scripts/` only opens local Postgres connections and computes JWT fixtures locally with `jose`.

**Decided in research, NOT YET integrated:**

- **Anthropic Claude (Sonnet 4.6)** — server-side LLM via `@anthropic-ai/sdk@0.91+`. Phase 7 extraction pipeline + Phase 8 AM review surface will consume. Decided in `.planning/research/STACK.md`. **No package in `package.json:25-30`; no import in any `.ts` file.**
- **Reducto** — primary PDF / matrix extraction. MEDIUM-confidence pending Phase 5 acceptance test (10 non-QM matrices, ≥95% cell accuracy). Phase 7 extraction pipeline will call. **No SDK installed; no client code.**
- **Inngest 4.2** — durable workflow orchestration for the extraction pipeline (OCR → structural parse → LLM normalization → overlay diff → confidence scoring). Phase 7 introduction. **No package; no `inngest.config.ts`; no `app/api/inngest` route.**
- **Vercel Cron** — daily polling of FNMA / FHLMC / FHA / VA / USDA agency publications for the agency cascade trigger. Phase 7+. **Not configured.**

## Data Storage

**Databases:**

- **Postgres 16** (only data store)
  - Local development: Postgres 16-alpine via Docker Compose (`docker-compose.yml:3`)
  - CI: Postgres 16-alpine GitHub Actions service container (`.github/workflows/ci.yml:25`)
  - Production target: **Supabase** managed Postgres (decided in research; not yet wired)
  - Connection drivers:
    - `postgres` 3.4.9 (postgres-js) — application path via Drizzle in `lib/db/client.ts:21`
    - `pg` 8.20.0 (node-postgres) — pen-test fixtures only (`tests/rls/fixtures/connection.ts:26`, `tests/rls/seedTwoTenants.ts:33`, `tests/schema/setup.ts:13`)
  - Required extension: `btree_gist` (created by `db/migrations/0004_program_constraints.sql:37` for `EXCLUDE USING gist` overlap constraints on `program_version` and `agency_rule_version`)

**Connection roles (provisioned by `scripts/init-db.sh`):**

- `app_user` — `LOGIN`, **`NOBYPASSRLS`**, `NOSUPERUSER`. Used by `DATABASE_URL`. Application + pen tests connect as this role so RLS policies are meaningful (a BYPASSRLS role would silently make pen tests vacuous — guarded by `tests/rls/setup.ts:96-110`).
- `system_role` — `NOLOGIN`, `NOBYPASSRLS`, `NOSUPERUSER`. Group role GRANTed to `postgres`. Used as the policy target for system-owned writes on `agency_rule_version` + `agency_rule` (`db/schema/agency-rule-version.ts:53`, `db/schema/agency-rule.ts:57`). Phase 3 hand-authored agency rules will be inserted under this role.
- `postgres` — superuser, the table owner. Used by `DATABASE_MIGRATION_URL` for `drizzle-kit migrate` and for agency-side seeding in `tests/schema/fixtures/seed.ts:78` (per Pitfall G — only postgres has system_role GRANTed).

**Database schema (Phase 1 + Phase 2 landed; commit 78f1733):**

| Table | Tenant-scoped? | RLS Policy | File |
|-------|---------------|------------|------|
| `tenant` | Self-filter on `id` | `tenant_self_filter` | `db/schema/tenant.ts` |
| `_rls_canary` | Yes (FK `tenant_id`) | `canary_tenant_isolation` | `db/schema/canary.ts` |
| `program` | Yes | `program_tenant_isolation` | `db/schema/program.ts` |
| `program_version` | Yes | `program_version_tenant_isolation` | `db/schema/program-version.ts` |
| `program_rule` | Yes | `program_rule_tenant_isolation` | `db/schema/program-rule.ts` |
| `rule_citation` | Yes | `rule_citation_tenant_isolation` | `db/schema/rule-citation.ts` |
| `lender_overlay_rule` | Yes | `lender_overlay_rule_tenant_isolation` | `db/schema/lender-overlay-rule.ts` |
| `agency_rule_version` | **No** (system-owned) | `*_world_read` (SELECT public) + `*_system_write` (ALL system_role) | `db/schema/agency-rule-version.ts` |
| `agency_rule` | **No** (system-owned) | `*_world_read` + `*_system_write` | `db/schema/agency-rule.ts` |

All tenant-scoped tables have `FORCE ROW LEVEL SECURITY` applied via `--custom` migrations (`0001_force_rls.sql`, `0003_force_rls_program.sql`, `0005_force_rls_agency.sql`). Drizzle 0.45 does not model FORCE — it ships only `ENABLE ROW LEVEL SECURITY`.

**Migrations directory:** `db/migrations/` (7 files, `0000_initial.sql` through `0006_detect_loosenings.sql`); journal at `db/migrations/meta/`.

**File Storage:**

- **None.** No object storage (S3, R2, GCS, Supabase Storage) wired in the rebuild scope. Source PDFs for extraction land via Phase 7 (decided), with `source_pdf_sha256` columns already provisioned in `rule_citation` and `agency_rule_version` for content-addressed addressing.

**Caching:**

- **None.** No Redis, no upstash, no in-process cache. Phase 4 evaluator's `RuleSnapshot` hydration will introduce caching guidance later; Phase 2 has no cache layer.

## Authentication & Identity

**Auth Provider:**

- Production target: **Supabase Auth** (decided in research; not yet wired)
  - JWT shape will carry `sub` + `app_metadata.tenant_id` (mirrored by pen-test fixtures in `tests/rls/fixtures/jwt.ts:8-12`)
  - JWT signing in production: RS256 with Supabase JWKS verification (Phase 6)
- Phase 1 fixture: HS256 with `RLS_TEST_JWT_SECRET` (min 16 chars) — `tests/rls/fixtures/jwt.ts:21`. Used solely for pen-test scenarios (e.g., `tests/rls/jwt-tampering.test.ts`); no production auth path consumes it.
- JWT library: `jose` 6.2.3 (`SignJWT` for minting; manual base64url decode for fixture-time tenant extraction).

**Tenant context propagation (the load-bearing pattern):**

- Postgres GUC `app.tenant_id` set per-transaction via `set_config('app.tenant_id', $1, true)` (third arg `true` = transaction-local, dies on COMMIT/ROLLBACK).
- Single source of truth helper: `lib/tenant/context.ts:57` `setTenantContext(tx, tenantId)`.
- Canonical GUC name constant: `lib/tenant/context.ts:70` `TENANT_GUC_NAME = 'app.tenant_id'`.
- The literal string `'app.tenant_id'` legitimately appears in only three places (per the comment in `lib/tenant/context.ts:13-16`): the helper, every `pgPolicy()` declaration in `db/schema/*.ts`, and the pen tests in `tests/rls/`.
- RLS policy expression universally: `using id = current_setting('app.tenant_id', true)::uuid` (note `, true` for missing-OK semantics — returns NULL when GUC unset rather than raising; policy fails closed when NULL).

## Monitoring & Observability

**Error Tracking:**

- **Not yet integrated.** Sentry is decided in research for errors + performance traces.

**Logs:**

- Local: stdout/stderr only. Vitest's `pool: 'forks'` writes per-worker output; `globalSetup` uses `execFileSync('pnpm', ['drizzle-kit', 'migrate'], { stdio: 'inherit' })` (`tests/rls/global-setup.ts:100`).
- Production: Axiom is decided in research for log retention beyond Vercel's 1-day window. Not wired.

**Migration / DDL audit:**

- Drizzle migration journal at `db/migrations/meta/`; `drizzle-kit migrate` is idempotent.
- Phase 1+2 explicitly defends against silent owner-bypass via `pg_class.relforcerowsecurity` introspection in `tests/rls/setup.ts:113-132` (every tenant-scoped table must report `t`).

## CI/CD & Deployment

**Hosting:**

- Production target: **Vercel Pro** (decided in research; required for 60s function ceiling). Not yet wired — there is no `next.config.js`, no `vercel.json`, no `app/` directory at the rebuild scope.

**CI Pipeline:**

- GitHub Actions workflow: `.github/workflows/ci.yml`
  - Trigger: `pull_request` to `main` + `push` to `main`
  - Steps: `pnpm install --frozen-lockfile` → typecheck → lint → lint:fixture → provision `app_user` role → `pnpm drizzle-kit migrate` (as postgres superuser) → verify FORCE RLS via `pg_class` query → `pnpm test:rls`
  - Service container: `postgres:16-alpine` with healthcheck (`pg_isready -U postgres`)
  - Concurrency: `${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress: true`
  - Timeout: 10 minutes
  - Pen-test JWT secret: `ci-fixture-jwt-secret-min-16-chars` (CI fixture only; production uses Vercel encrypted env)
  - **Intentional omission:** `SUPABASE_SERVICE_ROLE_KEY` is NOT set; `tests/rls/service-role-boundary.test.ts` asserts its absence as a T-01-04 mitigation.

**Deployment:**

- Not yet configured. No `pnpm build`, `pnpm start`, or `pnpm deploy` scripts in `package.json:11-23`.

## Environment Configuration

**Required env vars (`.env.local.example` + `lib/env.ts:22-48`):**

- `DATABASE_URL` (required) — `postgresql://app_user:app_user_password@localhost:5432/lender_search_dev`. Validated by Zod in `lib/env.ts:24-30` to require `postgresql://` or `postgres://` scheme.
- `DATABASE_MIGRATION_URL` (optional, falls back to `DATABASE_URL`) — `postgresql://postgres:postgres@localhost:5432/lender_search_dev`. Read by `drizzle.config.ts:25` and pen-test setup files.
- `RLS_TEST_JWT_SECRET` (optional in env contract; required at fixture-mint time per `tests/rls/fixtures/jwt.ts:25`) — min 16 chars.
- `SUPABASE_SERVICE_ROLE_KEY` (optional at Phase 1; Phase 6 tightens to `.min(20)`).
- `NODE_ENV` — `'development' | 'test' | 'production'`; defaults to `'development'`.

**Secrets handling:**

- `lib/env.ts` is the only sanctioned `process.env` reader.
- ESLint `no-restricted-properties` rule (`eslint.config.mjs:43-50`) blocks `process.env.*` from `app/`, `pages/`, `src/` paths.
- Production secrets target: Vercel encrypted env (declared in `lib/env.ts:11`); `t3-env` runtime-validated.
- `.env.local` is gitignored (`.gitignore` listed); `.env.local.example` committed as template.

## Webhooks & Callbacks

**Incoming:**

- **None.** No webhook handlers in the rebuild scope. Phase 7 will introduce Inngest event handlers + Phase 7+ Vercel Cron callbacks for agency-publication polling.

**Outgoing:**

- **None.** No `fetch` / `http` calls anywhere in `db/`, `lib/`, `tests/`, `scripts/`. Phase 7 extraction pipeline will call Reducto + Anthropic.

## Database Functions (executed in-DB, not via external integration)

- `jsonb_min_numeric(jsonb) RETURNS numeric` — IMMUTABLE PARALLEL SAFE wrapper used by `program_rule.min_confidence` and `agency_rule.min_confidence` GENERATED STORED columns. Defined in `db/migrations/0004_program_constraints.sql:46-53`.
- `detect_loosenings(p_program_version_id uuid) RETURNS TABLE` — STABLE SECURITY INVOKER function returning rows where an INVESTOR_OVERLAY rule loosens the corresponding AGENCY_BASE rule. Used by Phase 8 AM commit pre-check (deferred wiring). Defined in `db/migrations/0006_detect_loosenings.sql:34-115`.

---

*Integration audit: 2026-05-01*
