<!-- generated-by: gsd-doc-writer -->
# Development

Day-to-day workflow for **lender-search** contributors. Pairs with:

- `docs/GETTING-STARTED.md` — first-time clone-to-green-tests setup.
- `docs/CONFIGURATION.md` — env vars, ESLint guards, three Vitest configs.
- `docs/TESTING.md` — pen-test harness, schema suite, env-boot smoke test.
- `docs/ARCHITECTURE.md` — Postgres-centric Next.js monolith design and shipped vs. planned components.
- `CLAUDE.md` § GSD Workflow Enforcement — required entry points for any repo edit.
- `AGENTS.md` — GitNexus code-intelligence usage (impact analysis is mandatory before edits).

This document is the loop you live in once the repo runs green: branch → plan via GSD → migrate → code → run the pre-push gate → push → CI.

---

## Local setup

> The full clone-to-green-tests path lives in `docs/GETTING-STARTED.md`. The condensed daily-driver setup is below.

```bash
# 1. Install dependencies (pnpm 9 required — npm/yarn are not supported)
pnpm install --frozen-lockfile

# 2. Copy the env template and edit if needed
cp .env.local.example .env.local

# 3. Bring up local Postgres 16 (provisions app_user + system_role on first boot)
pnpm db:up

# 4. Apply migrations (uses DATABASE_MIGRATION_URL — postgres superuser)
pnpm db:migrate

# 5. Confirm the suite is green before changing anything
pnpm typecheck
pnpm lint
pnpm lint:fixture
pnpm test:schema
pnpm test:rls
```

Toolchain pins live in `package.json`:

- `engines.node`: `>=20.9.0`
- `engines.pnpm`: `>=9.0.0`
- `packageManager`: `pnpm@9.15.0` (Corepack convention; the CI `pnpm/action-setup@v4` step picks this up automatically — do not duplicate it via `with.version`).

`.npmrc` locks `save-exact=true` and `save-prefix=` so `pnpm add` can never reintroduce caret/tilde ranges and silently break CI reproducibility. Keep it that way.

The local Postgres container (`docker-compose.yml`) runs `postgres:16-alpine` with `scripts/init-db.sh` mounted as a docker entry-point. That script creates `app_user` (`NOBYPASSRLS NOSUPERUSER`) and `system_role` (`NOLOGIN NOBYPASSRLS NOSUPERUSER`) on first boot only. If you change role provisioning, run `pnpm db:reset` (drops the volume + re-runs the entry-point) — the script does not re-execute on existing volumes.

---

## Daily workflow

### Branching

- The default branch is `main`. PRs target `main`.
- Phase work uses long-lived feature branches named `feature/phase-{N}` (e.g. the current branch is `feature/phase-3`). Earlier phases also used `feat/phase-{N}` and `task/uat-phase-{N}` shapes; either form is fine for new work, but stay consistent within a phase.
- Land work via squash-merge PR. The merged commit on `main` follows the form `Phase NN: {Phase Name} (#PR)` (see `52eefa1 Phase 02: Rule Schema (#2)` and `220c898 fix: UAT Testing complete phase 1 (#1)`).
- `main` is the only branch CI cares about; the workflow runs on `pull_request` targeting `main` and on `push` to `main` (see `.github/workflows/ci.yml`).

### Commit conventions

Commit messages follow Conventional Commits with a phase/plan scope. The scope is `(NN)` for phase-level work and `(NN-PP)` for plan-level work (where `NN` is the phase number and `PP` is the plan number within the phase).

Verified prefixes from `git log`:

| Prefix | Use for | Example |
|---|---|---|
| `feat(NN-PP)` | New code that ships behavior | `feat(02-02): add 4 tenant-scoped Phase 2 tables` |
| `fix(NN-PP)` | Bug fixes (and CI fixes) | `fix(ci): FORCE RLS gate boolean rendering` |
| `test(NN-PP)` | Test-only changes | `test(02-08): land 9 schema-constraint tests + setup + seed fixture` |
| `docs(NN)` / `docs(NN-PP)` | Doc + planning artifacts | `docs(01-08): complete eslint flat config + CI workflow + PR gate plan` |
| `chore(NN-PP)` | Dependencies, config, lockfile | `chore(01-04): generate initial migration via drizzle-kit` |
| `ci(NN-PP)` | GitHub Actions workflow changes | `ci(01-08): add GitHub Actions CI workflow with Postgres 16 service` |

Two structural patterns to mirror:

- **TDD commits land RED+GREEN folded.** When the system under test already exists, the test commit message says `test(NN-PP): RED+GREEN {description}` to make the folding explicit (see `810ec05 test(01-07): RED+GREEN cross-tenant SELECT/INSERT/UPDATE/DELETE pen tests`). Do not write a fail-then-pass theater commit if the surface already exists.
- **Multi-line commit bodies reference touched paths and Plan IDs.** See the second-line trailers in `4f3fad1 docs: refresh codebase map after Phase 2 …`.

### GSD entry points (mandatory)

Per `CLAUDE.md` § GSD Workflow Enforcement, do **not** make direct repo edits outside a GSD command. Use these entry points:

| Entry point | Use for |
|---|---|
| `/gsd-quick` | Small fixes, doc updates, ad-hoc tasks |
| `/gsd-debug` | Investigation and bug fixing |
| `/gsd-execute-phase` | Planned phase work |

The current phase workflow generates artifacts under `.planning/phases/{NN}-{name}/` (e.g. `.planning/phases/02-rule-schema/`). Plans, summaries, verification, and reviews land there; do not move them.

### GitNexus impact analysis (mandatory before edits)

Per `CLAUDE.md` § Always Do, **run impact analysis before editing any function, class, or method.** The required calls (see `AGENTS.md` for the full reference):

- `gitnexus_impact({target: "symbolName", direction: "upstream"})` — report the blast radius (direct callers, affected processes, risk level) before changing the symbol.
- `gitnexus_detect_changes()` — run before committing to confirm the diff only touches the symbols you intended.
- `gitnexus_query({query: "concept"})` / `gitnexus_context({name: "symbolName"})` — preferred over grep when exploring unfamiliar code.

Warn the user explicitly before proceeding on HIGH or CRITICAL risk findings. Never rename symbols with find-and-replace; use `gitnexus_rename`, which understands the call graph. If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` (external CLI; not a project dep) in a terminal first.

### Pre-push gate

Run all five checks locally before pushing. Any failure blocks merge in CI; running them locally turns the round-trip from minutes into seconds.

```bash
pnpm typecheck && \
pnpm lint && \
pnpm lint:fixture && \
pnpm test:schema && \
pnpm test:rls
```

What each check guarantees:

| Command | Asserts |
|---|---|
| `pnpm typecheck` | TypeScript compiles under strict mode (`tsc --noEmit`). |
| `pnpm lint` | App code does not access `process.env` directly; no `service-role*` / `admin-db*` import patterns. Excludes `app/.eslint-fixture.ts`. |
| `pnpm lint:fixture` | The intentional ESLint fixture violates `no-restricted-properties` + `no-restricted-imports` and is rejected. Inverted exit code: a passing run proves the rules fire. |
| `pnpm test:schema` | Phase 2 schema constraints (FORCE RLS, EXCLUDE, CHECK, GENERATED columns, FK, jsonb min) and per-`rule_kind` Zod schemas. |
| `pnpm test:rls` | Cross-tenant attacks return zero rows or are rejected. RLS regressions are treated as security incidents. |

CI replicates the same sequence in `.github/workflows/ci.yml`: `Typecheck → Lint → Lint fixture → Apply migrations + GRANT → FORCE RLS gate (psql introspection) → test:schema → test:rls`. There is one extra CI-only step — a `psql` check that `pg_class.relforcerowsecurity = t` for both `tenant` and `_rls_canary` (uses `psql -A -F'|'` boolean rendering as `t`/`f`; SQL `||` text-cast renders `true`/`false` and would silently break the grep gate, per `d2b6eb6 fix(ci): FORCE RLS gate boolean rendering`).

---

## Build commands

The full script inventory from `package.json`:

| Script | Command | Description |
|---|---|---|
| `db:up` | `docker compose up -d postgres` | Start the local Postgres 16 container in the background. |
| `db:down` | `docker compose down` | Stop the container, preserve the volume. |
| `db:logs` | `docker compose logs -f postgres` | Tail the container logs. |
| `db:reset` | `docker compose down -v && docker compose up -d postgres` | Drop the volume + re-run `scripts/init-db.sh`. Use after changing `init-db.sh` (the script does not re-execute on existing volumes). |
| `db:generate` | `drizzle-kit generate` | Diff `db/schema/*.ts` against the last snapshot and emit a new SQL migration to `db/migrations/`. |
| `db:migrate` | `drizzle-kit migrate` | Apply pending migrations against `DATABASE_MIGRATION_URL` (falls back to `DATABASE_URL`). |
| `test:rls` | `vitest run --config vitest.config.ts` | RLS pen-test suite (D-03 matrix). Connects as `app_user`. |
| `test:rls:watch` | `vitest --config vitest.config.ts` | Same suite in watch mode. |
| `test:schema` | `vitest run --config vitest.schema.config.ts` | Phase 2 schema-constraint suite + per-`rule_kind` Zod unit tests. |
| `lint` | `eslint . --ignore-pattern 'app/.eslint-fixture.ts'` | Flat-config lint over the repo. Excludes the fixture. |
| `lint:fixture` | `eslint app/.eslint-fixture.ts && exit 1 || exit 0` | Inverts the exit code so a fixture *failure* is a passing run. Proves the `no-restricted-*` rules fire. |
| `typecheck` | `tsc --noEmit` | Strict TS check; emits no JS. |

There is intentionally **no** `build` script at Phase 1 — the runtime app does not exist until Phase 6 lands `app/`. `tsc --noEmit` is the only TypeScript invocation; `tsc` outputs would only generate `dist/` artifacts that have no consumer today.

---

## Schema migration workflow

Migrations are the single most-touched surface in Phases 1-3. The drizzle-kit pattern in this repo has two important wrinkles.

### 1. Two connection strings (runtime vs. migration)

`drizzle.config.ts` resolves the connection in this exact order:

```ts
const migrationUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
```

- `DATABASE_URL` is the runtime / pen-test connection (`app_user`, `NOBYPASSRLS NOSUPERUSER`). Pen tests connect with this so `FORCE ROW LEVEL SECURITY` is meaningful — superusers bypass RLS silently.
- `DATABASE_MIGRATION_URL` is the migration-only connection (`postgres` superuser, the table owner). Required because only the owner can `ALTER TABLE … FORCE ROW LEVEL SECURITY` (per `0001_force_rls.sql`) and `CREATE POLICY`.

If `DATABASE_MIGRATION_URL` is unset, drizzle-kit falls back to `DATABASE_URL` — covering the CI shape where only the privileged URL is exported at the moment migrations run.

### 2. `--custom` migrations for DDL Drizzle does not model

`drizzle-kit generate` (the schema-driven path) emits `CREATE TABLE`, indexes, FKs, and policies declared via `pgPolicy(...)`. It does **not** emit:

- `ALTER TABLE … FORCE ROW LEVEL SECURITY`
- `CREATE EXTENSION btree_gist`
- `EXCLUDE USING gist`
- `GENERATED ALWAYS AS … STORED` referencing IMMUTABLE functions
- `CREATE FUNCTION`

Those land via `drizzle-kit generate --custom`, which produces a hand-edited SQL file. Existing examples in `db/migrations/`:

- `0001_force_rls.sql` — FORCE RLS on `tenant` + `_rls_canary`.
- `0003_force_rls_program.sql` — FORCE RLS on the five tenant-scoped Phase 2 tables.
- `0004_program_constraints.sql` — `btree_gist` extension + EXCLUDE constraints + `jsonb_min_numeric` IMMUTABLE function + GENERATED columns.
- `0005_force_rls_agency.sql` — GRANTs + agency-table policy enablement.
- `0006_detect_loosenings.sql` — `detect_loosenings(uuid)` SQL function.

Mirror this split when you add new schema. The standard generate handles tables; `--custom` handles the policy and constraint surface.

### Authoring a new migration

```bash
# 1. Edit db/schema/*.ts — pgTable, pgEnum, pgPolicy, indexes, FKs
$EDITOR db/schema/program-rule.ts

# 2. Generate the schema-driven migration
pnpm db:generate

# 3. (If needed) hand-author a follow-on --custom migration for FORCE RLS / EXCLUDE / functions
pnpm exec drizzle-kit generate --custom

# 4. Apply locally
pnpm db:migrate

# 5. Confirm the suite is still green
pnpm test:schema
pnpm test:rls
```

### Replaying migrations against a live volume

`drizzle-kit migrate` is idempotent at the migration-row level (the journal in `db/migrations/meta/_journal.json` records what has already run). If a migration fails partway through and leaves the DB in an inconsistent state — a real risk for `--custom` migrations that mutate multiple objects — replay via `psql` directly so the next attempt picks up cleanly:

```bash
PGPASSWORD=postgres psql \
  -h localhost -U postgres -d lender_search_dev \
  -v ON_ERROR_STOP=1 \
  -f db/migrations/0006_detect_loosenings.sql
```

The Phase 02 UAT cycle (commit `6f6cfef fix(02-07): operator-precedence parens in detect_loosenings + apply migrations`) used exactly this pattern to re-apply a corrected `--custom` migration without bumping the migration number. Reserve it for fixing local state during development; production replays go through Vercel + Supabase per `docs/DEPLOYMENT.md`.

When in doubt, `pnpm db:reset` drops the volume entirely and reapplies everything from scratch.

### CI migration nuance

CI applies migrations as the postgres superuser (`DATABASE_MIGRATION_URL`), then runs an explicit `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;` step. This is required because tables created during a `drizzle-kit migrate` run are owned by `postgres`, and `init-db.sh`'s `ALTER DEFAULT PRIVILEGES` only covers tables created **after** the GRANT runs — not retroactively. Local-dev hits this through the same `--custom` migration path. If `pnpm test:rls` fails with a `permission denied for table {tenant,_rls_canary,program,…}` error after a fresh migrate, a missing GRANT is the first thing to check.

---

## Code style

### TypeScript

`tsconfig.json` is strict with extras:

- `strict: true`
- `noUncheckedIndexedAccess: true` — array/index access yields `T | undefined`. Branch on the undefined case explicitly.
- `noImplicitOverride: true` — `override` keyword required.
- `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`.
- `include` covers `lib/**`, `db/**`, `tests/**`, `drizzle.config.ts`, `vitest.config.ts`. The legacy `src/` (CRA prototype) is excluded by design and Phase 6 deletes it; do not extend it.

NodeNext-specific: relative imports between `.ts` files require the `.js` extension (e.g. `import { setTenantContext } from './context.js'`). This is a hard requirement of the resolver, not a stylistic choice.

### ESLint (flat config)

`eslint.config.mjs` is a flat config with three load-bearing rules:

1. **`no-restricted-properties` blocks `process.env` reads from app paths.** The single sanctioned env-reader is `lib/env.ts` (t3-env validated). Scoped to `app/**`, `pages/**`, `src/**`. Sanctioned exclusions: `lib/env.ts` itself, `db/migrations/**`, `tests/**`, `scripts/**`, `*.config.*`.
2. **`no-restricted-imports` blocks `**/service-role*` / `**/admin-db*` patterns.** Service-role connections carry `BYPASSRLS` and must never appear in the application graph. Migration scripts and CI tools may import them; app code may not.
3. **typescript-eslint recommended rules** for type-aware static analysis. Pinned to `8.59.1` (peer-compatible with `eslint@10.2.1`).

Both restrictions are forward-looking — `app/` does not exist until Phase 6 — but a smoke fixture at `app/.eslint-fixture.ts` exercises them today via `pnpm lint:fixture`. Adding new code under `app/`, `pages/`, or `src/` immediately opts into the guard.

To add a new sanctioned env-reader path, update the `files` glob in `eslint.config.mjs`. Do not work around the rule with `eslint-disable` comments in app code — the rule exists because the env-segregation contract is the antitrust safety net.

### Imports

- Read env vars via `import { env } from '@/lib/env'` (or relative path until Phase 6 wires path aliases).
- DB access goes through `lib/db/client.ts` — `import { db, sql } from '@/lib/db/client'`.
- The single GUC name `'app.tenant_id'` is referenced from exactly three places: `lib/tenant/context.ts`, `pgPolicy(...)` declarations in `db/schema/*.ts`, and pen-test files in `tests/rls/`. Any other reference is a smell.

### Formatting

There is no Prettier or Biome config in the repo at Phase 1. Match the existing file style; run typecheck + lint before committing.

---

## Testing

The detail lives in `docs/TESTING.md`. The summary you need for daily flow:

| Suite | Command | What it covers |
|---|---|---|
| RLS pen tests | `pnpm test:rls` | Cross-tenant SELECT/INSERT/UPDATE/DELETE, JWT tampering, service-role boundary, GUC reset, index scan. Connects as `app_user`. |
| Schema constraints | `pnpm test:schema` | FORCE RLS, EXCLUDE, CHECK, GENERATED columns, FKs, dispatch-table coverage, per-`rule_kind` Zod unit tests. |
| Env boot | `vitest run --config vitest.env-boot.config.ts` | Standalone runner — boot-fail-closed contract. Cannot share setup with the RLS suite because it deliberately mutates `DATABASE_URL`. |

The three configs are split because the pen-test suite needs a live migrated DB + an `app_user` connection that asserts FORCE RLS, while the schema suite needs a postgres-superuser pool to seed agency-side rows whose policy is `to: system_role`, and the env-boot test must not touch the global setup at all.

`pool: 'forks'`, `isolate: true`, `sequence.concurrent: false` are shared across all three configs — pen tests and schema tests share DB state and must not race.

---

## Pull request flow

1. Branch from `main` (or your phase feature branch). Use `feature/phase-{N}` shape for phase work.
2. Run a GSD command (`/gsd-quick`, `/gsd-debug`, or `/gsd-execute-phase`) — do not edit the repo outside one. Planning artifacts land under `.planning/phases/`; do not move or rename them.
3. Run `gitnexus_impact` on every symbol you intend to change, before changing it. Warn the user on HIGH/CRITICAL findings.
4. Make changes. Use `gitnexus_rename` for renames; never find-and-replace.
5. Run `gitnexus_detect_changes()` before staging — confirm the diff only touches the symbols you intended.
6. Run the full pre-push gate locally (`typecheck → lint → lint:fixture → test:schema → test:rls`).
7. Open a PR against `main`. CI runs the same gate plus the FORCE-RLS `psql` introspection check.
8. Squash-merge once green. The merged commit on `main` follows `Phase NN: {Phase Name} (#PR)`.

RLS pen-test regressions are treated as security incidents (per `README.md` § PR Gate and `.planning/research/PITFALLS.md` § 3.1, citing the October 2025 *Smith v. Optimal Blue* class action). Do not bypass them with skipped tests.

---

## See also

- `docs/GETTING-STARTED.md` — first-time setup walkthrough.
- `docs/CONFIGURATION.md` — every env var, ESLint allow-list, Vitest config split.
- `docs/TESTING.md` — pen-test harness internals, schema test seed pattern.
- `docs/ARCHITECTURE.md` — shipped vs. planned components and the Phase 1-3 build order.
- `docs/DEPLOYMENT.md` — CI workflow and (Phase 6+) Vercel deployment.
- `CLAUDE.md` § GSD Workflow Enforcement — entry-point requirements.
- `AGENTS.md` — GitNexus tools, resources, and impact-analysis contract.
- `.planning/STATE.md` — current phase status and shipped work log.
- `.planning/ROADMAP.md` — phase sequencing and KPI gates.
- `.github/workflows/ci.yml` — exact CI pipeline definition.
