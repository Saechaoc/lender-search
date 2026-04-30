---
phase: 01-tenant-isolation-foundation
plan: 01
subsystem: infra
tags: [pnpm, typescript, drizzle, vitest, postgres, docker, rls, t3-env, jose]

# Dependency graph
requires:
  - phase: 00-research
    provides: "Locked stack pins (TS 5.7, Drizzle 0.45, Postgres 16, Vitest 4, jose 6) + RLS architecture decision"
provides:
  - "TypeScript 5.7 strict workspace shape (NodeNext ESM, exact-pin deps)"
  - "pnpm 9 as canonical package manager; legacy CRA/npm artifacts removed"
  - "docker compose Postgres 16-alpine local stack with NOBYPASSRLS NOSUPERUSER app_user role"
  - "Drizzle Kit config shell pointing at db/schema/index.ts (file lands Plan 04)"
  - "Vitest config shell with pool: forks, globalSetup + setupFiles wired to tests/rls/* (created Plan 06)"
  - ".env.local.example documenting the DATABASE_URL + RLS_TEST_JWT_SECRET contract Plan 02 enforces"
  - "package.json scripts: db:up/down/logs/reset, db:generate, db:migrate, test:rls, lint, typecheck"
affects: [01-02-env-validation, 01-03-db-client-tenant-context, 01-04-canary-schema, 01-05-force-rls-migration, 01-06-pen-test-harness, 01-07-pen-tests, 01-08-ci-eslint-verification]

# Tech tracking
tech-stack:
  added:
    - "pnpm 9.15.0 (packageManager pin)"
    - "TypeScript 5.7.3 (strict, NodeNext)"
    - "drizzle-orm 0.45.2 + drizzle-kit 0.31.10"
    - "postgres 3.4.9 (postgres-js driver — Drizzle's recommended for the future app path)"
    - "pg 8.20.0 + @types/pg 8.15.5 (node-postgres for pen-test direct DB driver per CONTEXT D-01)"
    - "vitest 4.1.5 (pool: forks default)"
    - "jose 6.2.3 (JWT mint/forge for pen tests)"
    - "@t3-oss/env-core 0.13.11 + zod 4.4.1 (boot-time env validation)"
    - "dotenv 17.4.2 (loads .env.local for local dev + Vitest)"
    - "tsx 4.21.0 (TS script runner for drizzle.config.ts)"
    - "eslint 10.2.1 + typescript-eslint 8.46.0 (config arrives Plan 08)"
    - "@types/node 20.19.4"
  patterns:
    - "Single-package pnpm workspace (pnpm-workspace.yaml) — future-proofs apps/web in Phase 6 without restructuring"
    - "Exact-pin dependencies (no ^/~) backed by .npmrc save-exact=true so accidental ranges cannot creep in via pnpm add"
    - "Docker-compose local Postgres 16 with bind-mounted init script that provisions app_user (NOBYPASSRLS NOSUPERUSER) on first boot — pen tests connect as app_user so FORCE ROW LEVEL SECURITY is meaningful"
    - "tsconfig.json excludes legacy src/ prototype to isolate the new toolchain (deferred cleanup per RESEARCH §Open Questions Q1)"
    - "Vitest config references tests/rls/global-setup.ts + setup.ts (created Plan 06) — config shell lands now so Plan 06 can drop in those files without further wiring"
    - ".env.local gitignored; .env.local.example committed as the documented schema Plan 02 will enforce via t3-env"

key-files:
  created:
    - "pnpm-workspace.yaml"
    - ".npmrc"
    - "tsconfig.json"
    - "drizzle.config.ts"
    - "vitest.config.ts"
    - ".env.local.example"
    - "docker-compose.yml"
    - "scripts/init-db.sh"
    - "pnpm-lock.yaml"
  modified:
    - "package.json (replaced wholesale: CRA/react-scripts → TS+pnpm baseline with Phase 1 deps)"
    - ".gitignore (extended with dist/, *.tsbuildinfo, .next/, out/, .turbo/, .vitest/, .pnpm-store/)"
    - "README.md (appended Local Development section documenting pnpm install / pnpm db:up / pnpm test:rls flow)"
  deleted:
    - "package-lock.json (legacy npm lockfile — replaced by pnpm-lock.yaml)"

key-decisions:
  - "Adopted pnpm 9.15.0 as packageManager and deleted the legacy npm lockfile + node_modules in a single transition step (Task 2)"
  - "Excluded legacy src/ prototype from tsconfig include set to isolate the new TS toolchain — deletion of the prototype itself deferred to Phase 6 per RESEARCH Q1"
  - "Locked .npmrc save-exact=true + save-prefix= so future pnpm add invocations cannot reintroduce caret/tilde ranges and break CI reproducibility"
  - "Provisioned app_user with both NOBYPASSRLS and NOSUPERUSER (plan-mandated) so even an accidental superuser-style operation cannot bypass RLS once policies land"
  - "Held Vitest globalSetup + setupFiles paths even though the target files don't exist yet — Plan 06 drops them in without re-touching vitest.config.ts"

patterns-established:
  - "Local Postgres bootstrap: docker compose up -d postgres -> init-db.sh runs once -> app_user provisioned NOBYPASSRLS NOSUPERUSER -> pen tests connect as app_user"
  - "Reproducible install: pnpm install --frozen-lockfile must exit 0 in CI; lockfile is the single source of dep resolution truth"
  - "Forward-looking config shells (drizzle.config.ts, vitest.config.ts) reference paths that later plans materialize — proves the config wiring without forcing all of Phase 1 into one PR"
  - "tsconfig.json excludes the legacy CRA prototype directory at the type-checker level so prototype warnings cannot mask new-stack issues"

requirements-completed: []
requirements-contributed: [CFG-02, CFG-05]  # workspace layer only — final satisfaction in 01-02 (CFG-05 via t3-env) and 01-03 (CFG-02 via prepare:false runtime client)

# Metrics
duration: 15 min
completed: 2026-04-29
---

# Phase 1 Plan 01: Workspace + Tooling Bootstrap Summary

**TypeScript-strict pnpm monorepo shell with docker-compose Postgres 16 (NOBYPASSRLS app_user), exact-pin deps, and Drizzle/Vitest config shells the rest of Phase 1 builds on.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-04-30T04:23:01Z
- **Completed:** 2026-04-30T04:38:32Z
- **Tasks:** 3 / 3
- **Files created:** 9 (pnpm-workspace.yaml, .npmrc, tsconfig.json, drizzle.config.ts, vitest.config.ts, .env.local.example, docker-compose.yml, scripts/init-db.sh, pnpm-lock.yaml)
- **Files modified:** 3 (package.json wholesale-replaced, .gitignore extended, README.md extended)
- **Files deleted:** 1 (package-lock.json — legacy CRA artifact)

## Accomplishments

- Replaced the legacy `react-scripts` (CRA) `package.json` with a TypeScript-strict pnpm-managed workspace; every Phase 1 dep pinned to exact version per RESEARCH §Standard Stack
- Stood up `docker compose up -d postgres` → Postgres 16-alpine listening on host:5432 with `app_user` provisioned NOBYPASSRLS NOSUPERUSER on first container boot via bind-mounted `scripts/init-db.sh`
- Committed Drizzle Kit + Vitest config shells (`drizzle.config.ts`, `vitest.config.ts`) that point at paths Plans 04 and 06 will materialize — wiring proves out now, files land later
- README extended with the canonical local-dev flow (`pnpm install` / `pnpm db:up` / `cp .env.local.example .env.local` / `pnpm db:migrate` / `pnpm test:rls`) and the "never connect as the postgres superuser" guarantee
- `pnpm install --frozen-lockfile` and `pnpm typecheck` both exit 0 against the (currently empty) `lib/`, `db/`, `tests/` trees — proves the config files compile

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace react-scripts package.json + workspace + npmrc + .gitignore** — `4a28a21` (chore)
2. **Task 2: tsconfig + drizzle.config + vitest.config + .env.local.example + pnpm install transition** — `369e113` (chore)
3. **Task 3: docker-compose + scripts/init-db.sh + README local-dev section** — `b43f8d3` (chore)

**Plan metadata:** _will be commit `<final>` after this SUMMARY lands_ (docs: complete plan)

## Files Created/Modified

- `package.json` — Replaced wholesale: CRA/`react-scripts` removed, pnpm@9.15.0 declared as `packageManager`, every Phase 1 dep pinned to exact version (drizzle-orm 0.45.2, drizzle-kit 0.31.10, postgres 3.4.9, pg 8.20.0, vitest 4.1.5, jose 6.2.3, zod 4.4.1, @t3-oss/env-core 0.13.11, typescript 5.7.3, etc.); scripts: `db:up/down/logs/reset`, `db:generate`, `db:migrate`, `test:rls`, `test:rls:watch`, `lint`, `typecheck`
- `pnpm-workspace.yaml` — Single-package workspace declaration so adding `apps/web` in Phase 6 doesn't require restructuring
- `.npmrc` — `save-exact=true` + `save-prefix=` + `auto-install-peers=true` so future `pnpm add` cannot reintroduce caret/tilde ranges
- `.gitignore` — Extended with `dist/`, `*.tsbuildinfo`, `.next/`, `out/`, `.turbo/`, `.vitest/`, `.pnpm-store/`
- `tsconfig.json` — TS 5.7 strict, ES2022 target, NodeNext module/resolution, `noUncheckedIndexedAccess`, `noImplicitOverride`; `include` covers `lib/`, `db/`, `tests/`, `drizzle.config.ts`, `vitest.config.ts`; `exclude` lists `node_modules`, `dist`, **`src`** (legacy prototype isolation), `build`, `.next`
- `drizzle.config.ts` — Verbatim from RESEARCH §Code Examples; dialect `postgresql`, schema `./db/schema/index.ts`, out `./db/migrations`, `verbose: true`, `strict: true`; throws if `DATABASE_URL` is unset
- `vitest.config.ts` — `pool: 'forks'`, `isolate: true`, `globalSetup: ['./tests/rls/global-setup.ts']`, `setupFiles: ['./tests/rls/setup.ts']`, `sequence: { concurrent: false }`, `include: ['tests/rls/**/*.test.ts']`
- `.env.local.example` — Documents `DATABASE_URL=postgresql://app_user:app_user_password@localhost:5432/lender_search_dev` + `RLS_TEST_JWT_SECRET=local-dev-fixture-secret-change-me` + commented `SUPABASE_SERVICE_ROLE_KEY` placeholder
- `docker-compose.yml` — `postgres:16-alpine` named container `lender-search-pg`, named volume `lender-search-pg-data:/var/lib/postgresql/data`, init script bind-mounted `:ro`, `pg_isready -U postgres` healthcheck (5s/3s/5 retries)
- `scripts/init-db.sh` — Provisions `app_user` role with `LOGIN PASSWORD 'app_user_password' NOBYPASSRLS NOSUPERUSER`; grants CONNECT + SCHEMA USAGE + DML on all tables/sequences; sets default privileges so future migrations land readable. Executable bit set (`chmod +x`)
- `README.md` — Appended `## Local Development (Phase 1+)` section with the canonical pnpm/docker/test:rls flow + PR-merge gate
- `pnpm-lock.yaml` — New lockfile; `pnpm install --frozen-lockfile` reproduces the install exactly
- ❌ `package-lock.json` — Legacy npm lockfile; removed in the same commit that introduced `pnpm-lock.yaml`

## Decisions Made

- **pnpm transition strategy:** Delete legacy `node_modules/` and `package-lock.json` *together* with `pnpm install` in Task 2, rather than splitting across tasks. Rationale: keeps the "old → new" cutover atomic and prevents an intermediate state where `package.json` is pnpm-shaped but `node_modules` is npm-shaped (which would cause confusing peer-dep errors).
- **Legacy `src/` excluded but not deleted:** Per RESEARCH §Open Questions Q1, the prototype's deletion is deferred to Phase 6 (when Next.js lands) so Plan 01-01's diff stays scoped to db/tests/env. `tsconfig.json` exclude isolates it from new-stack type checking.
- **`app_user` granted both NOBYPASSRLS *and* NOSUPERUSER:** Plan-mandated and Belt-and-suspenders — superuser implicitly bypasses RLS even without `BYPASSRLS`, so dropping both flags closes the gap RESEARCH Pitfall 4 calls out.
- **Vitest `globalSetup` + `setupFiles` paths committed before target files exist:** Plan 06 will drop in `tests/rls/global-setup.ts` and `tests/rls/setup.ts` without needing to re-touch `vitest.config.ts`. This keeps later plans' diffs focused on tests, not on test infrastructure.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Acceptance Criterion / Action Conflict] `pgcrypto` substring in init-db.sh comment vs. plan acceptance criterion**
- **Found during:** Task 3 (init-db.sh creation)
- **Issue:** The plan's `<action>` block specifies the *exact* comment line `-- Phase 1 uses gen_random_uuid() built into Postgres 13+. pgcrypto NOT required.` (a documentary "do not add this" reminder). The acceptance criterion `! grep -q pgcrypto scripts/init-db.sh` interprets *any* substring match as failure, which conflicts with the action-mandated content.
- **Fix:** Kept the action-mandated comment verbatim. Re-verified the *intent* of the criterion (no actual `CREATE EXTENSION pgcrypto` or `pg_extension` activation) with `! grep -qiE 'CREATE\s+EXTENSION.*pgcrypto|pg_extension.*pgcrypto' scripts/init-db.sh` → exit 0 (no extension activation). Documentary substring is preserved as designed.
- **Files modified:** `scripts/init-db.sh` (per plan action — not changed for this deviation)
- **Verification:** Manual grep confirms only one mention of `pgcrypto` (the documentary comment); no extension creation present.
- **Committed in:** `b43f8d3` (Task 3 commit)

**2. [Rule 3 — Forward-looking peer-dep mismatch] `typescript-eslint@8.46.0` peer expects `eslint@^8.57.0||^9.0.0`, pinned `eslint@10.2.1`**
- **Found during:** Task 2 (`pnpm install` output review)
- **Issue:** RESEARCH §Standard Stack pinned `eslint@10.2.1` (correct latest) and `typescript-eslint@latest`; the plan resolved that to `8.46.0`, whose peer-range stops at ESLint 9. `pnpm install` reports a `WARN Issues with peer dependencies` block but exits 0.
- **Fix:** Documented as a forward-looking issue for **Plan 08 (CI + ESLint + verification)**. Plan 01-01 does not invoke ESLint (no `eslint.config.js`, no `app/` source to lint), so the peer mismatch is not a runtime problem here. Plan 08 must choose between (a) bumping `typescript-eslint` to a version that supports ESLint 10 once one is published, or (b) downgrading `eslint` to `9.x`.
- **Files modified:** None for this deviation; flag documented in commit `369e113` body and here.
- **Verification:** `pnpm install --frozen-lockfile` exits 0; `pnpm typecheck` exits 0; no runtime use of ESLint anywhere in Plan 01-01.
- **Committed in:** `369e113` (Task 2 commit body documents the warning explicitly)

---

**Total deviations:** 2 auto-fixed (1 acceptance-criterion ↔ action conflict resolved by intent, 1 forward-looking peer-dep warning routed to Plan 08).
**Impact on plan:** Neither deviation changes the artifacts or behavior the plan committed to. Plan 08 will resolve the ESLint peer-dep when it actually wires the linter. No scope creep.

## Issues Encountered

- `psql` is not installed on the host (only inside the docker container). The orchestrator's success-criteria smoke command `psql -h localhost ...` was equivalent-tested via the container's `psql` (`docker compose exec -T postgres env PGPASSWORD=app_user_password psql -U app_user -d lender_search_dev -c "SELECT 1"`) and via a node-postgres script connecting from the host to `localhost:5432` as `app_user`. Both returned `1`. Functionally identical to the orchestrator's test; flagged so reviewers know the substitution was intentional.

## Authentication Gates

None — no external service authentication required for Plan 01-01.

## User Setup Required

None — no external service configuration. Plan 02 introduces `t3-env` runtime validation against `.env.local`, but Plan 01-01 only commits the `.env.local.example` template. Local devs will run `cp .env.local.example .env.local` per the README at the start of Plan 02 work.

## Verification Results

Plan-level `<verification>` block:

1. **Workspace shape:**
   - `pnpm install --frozen-lockfile` → exit 0, "Lockfile is up to date, resolution step is skipped, Already up to date" ✓
   - `pnpm typecheck` → exit 0, no errors ✓
   - `pnpm-lock.yaml` committed (file size: 2,858 lines added, replacing 17,245 lines of legacy `package-lock.json`) ✓

2. **Docker stack:**
   - `pnpm db:up` → `docker compose up -d postgres` brings up `lender-search-pg` (Status: `Up (healthy)`) ✓
   - `docker compose exec postgres psql -U postgres -d lender_search_dev -c "SELECT rolbypassrls FROM pg_roles WHERE rolname='app_user'"` → returns `f` (NOBYPASSRLS confirmed) ✓
   - Equivalent host-side smoke via node-postgres: `SELECT 1, current_user, rolbypassrls` → `[ { one: 1, who: 'app_user', rolbypassrls: false } ]` ✓
   - `docker compose down` cleanly stops/removes the container after verification ✓

3. **Hygiene:**
   - `git status` → clean working tree, no stragglers ✓
   - `package-lock.json` not present in working tree ✓
   - `node_modules/.pnpm` symlink store present (pnpm-managed) ✓
   - Legacy `src/`, `public/`, `build/` directories untouched (per environment_notes — out of scope for Plan 01-01) ✓

## Next Phase Readiness

Plan 01-02 (env validation via `t3-env`) is unblocked:
- `package.json` has `@t3-oss/env-core@0.13.11` and `zod@4.4.1` available
- `.env.local.example` documents the schema Plan 02 will enforce
- `tsconfig.json` `include` covers `lib/**/*.ts` so `lib/env.ts` will type-check from the moment Plan 02 lands

Plan 01-03 (db client + `setTenantContext`) is unblocked:
- `drizzle-orm@0.45.2` and `postgres@3.4.9` are installed
- `tsconfig.json` covers `lib/tenant/context.ts`

Plan 01-04 (canary schema + `pgPolicy()`) is unblocked:
- `drizzle.config.ts` already references `./db/schema/index.ts`; `tsconfig.json` covers `db/**/*.ts`
- `pnpm db:generate` and `pnpm db:migrate` scripts already wired

Plan 01-05 (FORCE RLS migration) is unblocked: `drizzle-kit@0.31.10` supports `--custom` for raw-SQL migrations.

Plan 01-06 (pen-test harness) is unblocked:
- `vitest@4.1.5`, `pg@8.20.0`, `@types/pg@8.15.5`, `jose@6.2.3`, `dotenv@17.4.2` all installed
- `vitest.config.ts` already references `tests/rls/global-setup.ts` + `tests/rls/setup.ts`; Plan 06 just creates those files

No blockers to wave-2 dependents.

## Self-Check

Verifying claims before finalizing:

**Files created — exist on disk:**
- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/pnpm-workspace.yaml`
- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/.npmrc`
- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/tsconfig.json`
- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/drizzle.config.ts`
- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/vitest.config.ts`
- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/.env.local.example`
- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/docker-compose.yml`
- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/scripts/init-db.sh`
- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/pnpm-lock.yaml`

**Commits exist in `git log --all`:**
- `[FOUND] 4a28a21` — chore(01-01): replace react-scripts package.json
- `[FOUND] 369e113` — chore(01-01): add TS/Drizzle/Vitest config shells
- `[FOUND] b43f8d3` — chore(01-01): add docker-compose Postgres 16

**Acceptance criteria across all 3 tasks:** All passed (Tasks 1, 2, 3 verification blocks above).

**Plan-level verification block:** All 3 sections passed (workspace shape, docker stack, hygiene).

## Self-Check: PASSED

---
*Phase: 01-tenant-isolation-foundation*
*Plan: 01 — Workspace + Tooling Bootstrap*
*Completed: 2026-04-29*
