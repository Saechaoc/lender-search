---
last_mapped_commit: 78f1733137651248ed0cf7e02bf3cf8ad36f1c83
mapped_at: 2026-05-01
focus: tech
scope: "db,tests,lib,scripts (excludes legacy src/App.js prototype)"
---

# Technology Stack

**Analysis Date:** 2026-05-01

> **Scope note:** This document describes the **rebuild** stack (`db/`, `lib/`, `tests/`, `scripts/`, root configs). The legacy React 19 prototype at `src/App.js` is explicitly out of scope — `tsconfig.json` excludes `src` and `eslint.config.mjs` ignores it (see lines 32 / 77 respectively). New work targets the Next.js 16 + Postgres 16 + Drizzle 0.45 stack documented below.

## Languages

**Primary:**
- TypeScript 5.7.3 — every file under `db/`, `lib/`, `tests/`, `scripts/` (except shell), plus root configs (`drizzle.config.ts`, `vitest.config.ts`, `vitest.schema.config.ts`, `vitest.env-boot.config.ts`, `eslint.config.mjs`)
- SQL — Drizzle-generated migrations (`db/migrations/0000_initial.sql`, `0002_program_schema.sql`) and hand-authored `--custom` migrations (`0001_force_rls.sql`, `0003_force_rls_program.sql`, `0004_program_constraints.sql`, `0005_force_rls_agency.sql`, `0006_detect_loosenings.sql`)

**Secondary:**
- Bash — `scripts/init-db.sh` (Postgres role provisioning: `app_user` NOBYPASSRLS NOSUPERUSER + `system_role` NOLOGIN)

**Compiler config (`tsconfig.json`):**
- `target: ES2022`, `lib: ["ES2022"]`
- `module: NodeNext`, `moduleResolution: NodeNext` (forces `.js` extensions on relative imports — see `lib/db/client.ts:22` `from '../env.js'`)
- `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`
- `include`: `lib/**/*.ts`, `db/**/*.ts`, `tests/**/*.ts`, `drizzle.config.ts`, `vitest.config.ts`
- `exclude`: `node_modules`, `dist`, `src`, `build`, `.next`

## Runtime

**Environment:**
- Node.js >= 20.9.0 (engines pin in `package.json:8`; CI uses Node 20 per `.github/workflows/ci.yml:64`)
- ESM only (`"type": "module"` in `package.json:5`)

**Package Manager:**
- pnpm 9.15.0 (Corepack convention via `packageManager` field in `package.json:6`); >= 9.0.0 enforced by engines
- Lockfile present: `pnpm-lock.yaml` (~85k lines)
- pnpm settings (`.npmrc`): `save-exact=true`, `save-prefix=` (every dependency is exact-pinned — no `^` / `~`), `auto-install-peers=true`
- Workspace: single-package workspace declared in `pnpm-workspace.yaml` (`packages: ["."]`)

**Postgres:**
- Postgres 16-alpine via Docker Compose (`docker-compose.yml:3`); CI uses the same image as a service container (`.github/workflows/ci.yml:25`)
- Required extensions: `btree_gist` (created by `db/migrations/0004_program_constraints.sql:37` for EXCLUDE USING gist constraints)
- `gen_random_uuid()` built-in (Postgres 13+); pgcrypto explicitly NOT required per `scripts/init-db.sh:4`

## Frameworks

**ORM / Query Layer:**
- `drizzle-orm` 0.45.2 — schema-as-code in `db/schema/*.ts` files; barrel re-export at `db/schema/index.ts`
- `drizzle-kit` 0.31.10 — migration generator + runner; config at `drizzle.config.ts`
- Driver: `postgres` 3.4.9 (postgres-js) for the application path; `pg` 8.20.0 (node-postgres) used only by pen-test fixtures (`tests/rls/fixtures/connection.ts`, `tests/rls/seedTwoTenants.ts`, `tests/schema/setup.ts`)
- Drizzle client wired with `prepare: false` (`lib/db/client.ts:29`) — non-negotiable for the Supabase Supavisor pooler

**Testing:**
- Vitest 4.1.5 — three configs:
  - `vitest.config.ts` — pen-test suite (`tests/rls/**/*.test.ts`); 12 test files, ~1k lines; `pool: 'forks'`, `isolate: true`, `sequence.concurrent: false`
  - `vitest.schema.config.ts` — schema-constraint + Zod-unit suite (`tests/schema/**/*.test.ts` + `tests/rules/**/*.test.ts`)
  - `vitest.env-boot.config.ts` — standalone smoke runner for `tests/rls/env-boot.test.ts` (CFG-05 boot-fail-closed contract)
- Coverage / spec count: 12 RLS pen tests, 9 schema-constraint tests, 6 Zod-unit tests (~1,940 LOC across all `*.test.ts`)

**Linting:**
- ESLint 10.2.1 (flat config at `eslint.config.mjs`)
- `typescript-eslint` 8.59.1 (peer-dep-aligned with eslint 10; pinned in `package.json:41`)
- Three load-bearing rules in `eslint.config.mjs`:
  1. `no-restricted-properties` blocks `process.env` reads from `app/`, `pages/`, `src/` paths (single source of truth: `lib/env.ts`)
  2. `no-restricted-imports` blocks `service-role*` / `admin-db*` patterns from app paths
  3. `tseslint.configs.recommended` for type-aware static analysis

**Build / Dev:**
- `tsx` 4.21.0 — TypeScript-aware Node runner (devDependency; not currently invoked by any `package.json` script)
- `dotenv` 17.4.2 — local `.env.local` / `.env` loader for `drizzle.config.ts` and pen-test setup files
- TypeScript compiler emits to `./dist`; build info at `./.tsbuildinfo` (incremental compilation enabled)

## Key Dependencies

**Application runtime (`package.json:25-30`):**
- `@t3-oss/env-core` 0.13.11 — runtime env validation; `lib/env.ts` is the only sanctioned env reader (Phase 6 swaps to `@t3-oss/env-nextjs`)
- `drizzle-orm` 0.45.2 — Postgres ORM with RLS-aware policy declarations via `pgPolicy()` (e.g., `db/schema/tenant.ts:48`)
- `postgres` 3.4.9 — pure-JS Postgres driver (postgres-js); pinned with `prepare: false` for Supavisor compatibility
- `zod` 4.4.1 — schema validation; powers `lib/rules/schemas/*.ts` (17 per-rule_kind shapes) and `lib/env.ts` env contract

**Dev / test (`package.json:31-43`):**
- `@types/node` 20.19.4, `@types/pg` 8.15.5
- `dotenv` 17.4.2, `drizzle-kit` 0.31.10
- `eslint` 10.2.1, `typescript-eslint` 8.59.1
- `jose` 6.2.3 — JWT minting/forging in `tests/rls/fixtures/jwt.ts` (HS256 fixture for pen tests; Phase 6 swaps to RS256 + Supabase JWKS)
- `pg` 8.20.0 — node-postgres for pen-test fixtures only (per RESEARCH §Pitfall 5: tests exercise SQL contract, not Drizzle TS abstraction)
- `tsx` 4.21.0, `typescript` 5.7.3, `vitest` 4.1.5

**Critical postures (decided, not negotiable):**
- `prepare: false` on the Drizzle/postgres-js client (Supavisor pooler does not support prepared statements)
- Exact-pin every dependency (`.npmrc` `save-exact=true` / `save-prefix=`)
- `noUncheckedIndexedAccess` in `tsconfig.json` (forces `array[i]!` or `if (row)` guards in pen tests — see `tests/rls/setup.ts:102`)

## Configuration

**Environment files:**
- `.env.local` — local-dev secrets (gitignored); takes precedence over `.env`
- `.env.local.example` — committed template; documents the four expected vars:
  - `DATABASE_URL` (app_user runtime connection — NOBYPASSRLS so RLS is meaningful)
  - `DATABASE_MIGRATION_URL` (postgres superuser; only the owner can `ALTER TABLE FORCE ROW LEVEL SECURITY`)
  - `RLS_TEST_JWT_SECRET` (HS256 pen-test fixture; min 16 chars)
  - `SUPABASE_SERVICE_ROLE_KEY` (Phase 1 optional; Phase 6 tightens to required `.min(20)`)
- `.env.local` is present in the repo root (file exists; contents not inspected per security policy)
- Env validation lives in `lib/env.ts` via `@t3-oss/env-core` with `emptyStringAsUndefined: true`

**Build config:**
- `tsconfig.json` — TS compiler config (see Languages section above)
- `drizzle.config.ts` — drizzle-kit config; uses `DATABASE_MIGRATION_URL` (falls back to `DATABASE_URL`); schema source: `./db/schema/index.ts`; out: `./db/migrations`
- `eslint.config.mjs` — flat config; ignores `src/App.js`, `src/index.js`, `src/setupTests.js`, `.next/`, `build/`, `dist/`, `node_modules/`
- `vitest.config.ts` / `vitest.schema.config.ts` / `vitest.env-boot.config.ts` — three Vitest configs (see Frameworks)

**Container config:**
- `docker-compose.yml` — single Postgres 16-alpine service; mounts `scripts/init-db.sh` to `/docker-entrypoint-initdb.d/init-db.sh` for first-boot role provisioning
- `scripts/init-db.sh` — creates `app_user` (LOGIN, NOBYPASSRLS, NOSUPERUSER) + `system_role` (NOLOGIN, NOBYPASSRLS, NOSUPERUSER) with appropriate GRANTs

**CI:**
- `.github/workflows/ci.yml` — GitHub Actions; pull_request + push on `main`; jobs: typecheck → lint → lint:fixture → drizzle-kit migrate → FORCE RLS verification → `pnpm test:rls`
- `concurrency.cancel-in-progress: true`; 10-minute timeout
- CI explicitly does NOT set `SUPABASE_SERVICE_ROLE_KEY` (T-01-04 mitigation; `tests/rls/service-role-boundary.test.ts` asserts its absence)

## Platform Requirements

**Development:**
- Node.js >= 20.9.0
- pnpm >= 9.0.0
- Docker (for `pnpm db:up` → Postgres 16-alpine container)
- Local Postgres listening on `localhost:5432`; `lender_search_dev` database

**Production (decided in research, NOT YET integrated):**
- Vercel Pro for Next.js 16 hosting (60s function ceiling required; Hobby tier excluded)
- Supabase for managed Postgres + Auth + Supavisor pooler
- Inngest 4.2 worker pool for durable workflows (separate from Vercel functions; survives 60s ceiling)
- Sentry (errors + performance) + Axiom (logs beyond Vercel's 1-day retention)
- All five above are documented in `.planning/research/STACK.md`; **no code in the rebuild scope imports SDK packages for any of them yet**

## Phase 6 Migration Path (declared in code comments)

Forward-looking changes documented inline:
- `lib/env.ts:13` — swap `@t3-oss/env-core` → `@t3-oss/env-nextjs`; tighten `SUPABASE_SERVICE_ROLE_KEY` to `.min(20)`; add `client` keys (`NEXT_PUBLIC_*`)
- `lib/db/client.ts:35` — set `ssl: 'require'` (currently `false` for local Docker)
- `lib/tenant/context.ts:20` — wrap with `withTenantContext({ tenantId, fn })` middleware for every Server Action / route handler
- `tests/rls/fixtures/jwt.ts:6` — swap HS256 fixture to RS256 + Supabase JWKS verification

---

*Stack analysis: 2026-05-01*
