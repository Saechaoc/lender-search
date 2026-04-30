---
phase: 01-tenant-isolation-foundation
plan: 05
subsystem: database
tags: [drizzle-kit, migration, custom-migration, force-rls, postgres-16, rls, schema-push]

# Dependency graph
requires:
  - phase: 01
    provides: db/migrations/0000_initial.sql + drizzle metadata (Plan 04 — TS schema + initial migration); docker-compose Postgres 16 + app_user (Plan 01); lib/tenant/context.ts GUC primitive (Plan 03)
provides:
  - db/migrations/0001_force_rls.sql — hand-authored ALTER TABLE FORCE ROW LEVEL SECURITY for tenant + _rls_canary
  - db/migrations/meta/_journal.json (updated) + meta/0001_snapshot.json — drizzle-kit bookkeeping for the new migration
  - Live docker Postgres 16 with both migrations applied; pg_class.relforcerowsecurity = t for both tables
  - app_user GRANT SELECT/INSERT/UPDATE/DELETE on tenant + _rls_canary (post-migrate fixup)
  - drizzle.config.ts loading .env.local + DATABASE_MIGRATION_URL split (forward-looking deviation from Plan 04 fixed)
affects: [01-06 pen-test harness, 01-07 pen tests, 01-08 CI workflow]

# Tech tracking
tech-stack:
  added: []  # all deps installed in Plan 01-01; this plan exercises drizzle-kit migrate for the first time
  patterns:
    - "drizzle-kit generate --custom for raw-SQL DDL the schema API doesn't model (FORCE ROW LEVEL SECURITY) — append-only migration that survives schema regeneration (Pitfall 2)"
    - "Two-connection-string pattern in drizzle.config.ts: DATABASE_MIGRATION_URL (postgres superuser, owns tables, can ALTER FORCE) prefers; DATABASE_URL (app_user NOBYPASSRLS, runtime + pen tests) fallback. CI inherits this contract verbatim"
    - "Migration ownership = postgres superuser; runtime + pen-test ownership = app_user (NOBYPASSRLS NOSUPERUSER). FORCE ROW LEVEL SECURITY closes the table-owner-bypass gap so even postgres scripts are subject to policy"
    - "Per-table GRANT after drizzle-kit migrate: drizzle-kit creates tables owned by postgres; ALTER DEFAULT PRIVILEGES from init-db.sh covers FUTURE tables, but tables created in this transaction need explicit GRANT to app_user. Plan 06/08 codifies the GRANT in test setup + CI"

key-files:
  created:
    - db/migrations/0001_force_rls.sql
    - db/migrations/meta/0001_snapshot.json
    - .planning/phases/01-tenant-isolation-foundation/01-05-SUMMARY.md
  modified:
    - db/migrations/meta/_journal.json
    - drizzle.config.ts
    - .env.local.example

key-decisions:
  - "Generated 0001_force_rls.sql via drizzle-kit generate --custom --name=force_rls (empty file shell), then hand-wrote the two ALTER TABLE FORCE ROW LEVEL SECURITY statements — verbatim from RESEARCH §Pattern 2. The --custom mechanism is append-only: re-running drizzle-kit generate cannot silently overwrite this file (Pitfall 2 mitigation)"
  - "Migration applied as postgres superuser (postgresql://postgres:postgres@...), NOT as app_user. Only the table owner can ALTER TABLE FORCE — app_user is NOBYPASSRLS NOSUPERUSER and would fail. After FORCE applies, even postgres is subject to policy on subsequent reads"
  - "Post-migrate GRANT step required: drizzle-kit migrate creates tables owned by postgres; init-db.sh's ALTER DEFAULT PRIVILEGES covers tables created in FUTURE schema runs but not the ones created during the migrate. Explicitly GRANT SELECT/INSERT/UPDATE/DELETE ON TABLE tenant, _rls_canary TO app_user. Plan 08 CI workflow needs this same GRANT step after migrate"
  - "Forward-looking deviation from Plan 04 fixed: drizzle.config.ts now loads .env.local first (gitignored), then .env. Added DATABASE_MIGRATION_URL with fallback to DATABASE_URL — prefers privileged migration connection, falls back to runtime connection. CI's GitHub Actions secrets take precedence (dotenv won't override existing env vars). Local-dev workflow is now `pnpm drizzle-kit migrate` with no inline env prefix"

patterns-established:
  - "Schema migration loop end-state: write/modify db/schema/*.ts → run pnpm drizzle-kit generate (drizzle.config.ts loads .env.local automatically) → for any DDL the schema API doesn't model, run pnpm drizzle-kit generate --custom --name=<descriptor> and hand-edit the empty SQL → commit schema TS + generated SQL + meta files atomically → apply via pnpm drizzle-kit migrate (uses DATABASE_MIGRATION_URL = postgres superuser)"
  - "Migration verification protocol: every plan that lands DDL must include a post-migrate psql introspection step to assert the live DB state matches the migration's intent. For RLS: SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN (...). Both flags must be t. For policies: SELECT polname, polrelid::regclass, polcmd FROM pg_policy WHERE polrelid::regclass::text IN (...). All expected policies present"
  - "Idempotent migration test: re-running pnpm drizzle-kit migrate against a fresh-or-already-bootstrapped database is a no-op — the journal hash check skips already-applied migrations. CI's fresh-DB-per-run workflow (Plan 08) and local-dev re-runs both rely on this"

requirements-completed:
  - TNT-01  # FORCE ROW LEVEL SECURITY now active on tenant + _rls_canary; verified via pg_class introspection

# Metrics
duration: 4 min
completed: 2026-04-30
---

# Phase 1 Plan 05: FORCE ROW LEVEL SECURITY Migration + Apply Summary

**Custom-migration `0001_force_rls.sql` adds `FORCE ROW LEVEL SECURITY` to `tenant` and `_rls_canary` (the only DDL Drizzle 0.45's schema API doesn't model), then `pnpm drizzle-kit migrate` applies all Phase 1 migrations to docker Postgres 16 — `pg_class.relforcerowsecurity = t` for both tables, closing the table-owner-bypass gap (Pitfall 2).**

## Performance

- **Duration:** ~4 min (start `2026-04-30T14:24:51Z`, end `2026-04-30T14:29:05Z`)
- **Tasks:** 2 / 2
- **Files created:** 3 (0001_force_rls.sql + 0001_snapshot.json + this SUMMARY)
- **Files modified:** 3 (_journal.json, drizzle.config.ts, .env.local.example)

## Accomplishments

- Generated empty `--custom` migration shell via `pnpm drizzle-kit generate --custom --name=force_rls` (RESEARCH §Pattern 2 / VERIFIED: orm.drizzle.team/docs/kit-custom-migrations).
- Hand-authored `db/migrations/0001_force_rls.sql` with two `ALTER TABLE ... FORCE ROW LEVEL SECURITY` statements — verbatim shape from RESEARCH §Pattern 2; comment block explains the Pitfall 2 / Pattern 2 rationale so future readers understand why this is a separate file.
- Applied all Phase 1 migrations to docker Postgres 16 via `pnpm drizzle-kit migrate` (exit 0). Both `0000_initial.sql` (Plan 04) and `0001_force_rls.sql` (this plan) are recorded in `drizzle.__drizzle_migrations`.
- **Verified `pg_class.relforcerowsecurity = t` for both `tenant` AND `_rls_canary`** — the load-bearing assertion of the entire plan; pen-test setup file (Plan 06) will assert the same in `beforeAll`.
- Verified both expected policies are present (`tenant_self_filter` on `tenant`, `canary_tenant_isolation` on `_rls_canary`, both `polcmd = '*'` for ALL).
- Granted DML on the new tables to `app_user` (`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tenant, _rls_canary TO app_user`) — required because drizzle-kit creates tables owned by `postgres` and the init-db.sh `ALTER DEFAULT PRIVILEGES` covers only FUTURE tables.
- Smoke-tested `app_user` connection: `SELECT count(*) FROM _rls_canary` returns 0 (table empty + RLS would filter; no permission error).
- Idempotent re-run verified: a second `pnpm drizzle-kit migrate` is a no-op (journal hash matches, no DDL re-applied, exit 0).
- Forward-looking deviation from Plan 04 fixed: `drizzle.config.ts` now loads `.env.local` first then `.env`, with `DATABASE_MIGRATION_URL` (postgres superuser) preferred over `DATABASE_URL` (app_user). Local dev no longer needs ad-hoc inline env prefixes; CI workflow (Plan 08) inherits this contract verbatim.

## Task Commits

Each task was committed atomically (Task 2 was the [BLOCKING] schema push and modified no source files; the deviation fix it surfaced was committed separately):

1. **Task 1: Generate `--custom` migration shell + hand-author FORCE ALTERs** — `0a6c9e6` (feat)
2. **Task 2: [BLOCKING] Apply migrations to docker Postgres 16 + verify FORCE** — no source files modified (only live DB state); verification recorded in this SUMMARY
3. **Deviation fix: drizzle.config.ts loads .env.local + DATABASE_MIGRATION_URL split** — `4026ca9` (chore)

**Plan metadata commit:** pending (final step of this run; will land alongside STATE.md / ROADMAP.md updates).

## Files Created/Modified

### Created

- `db/migrations/0001_force_rls.sql` (~870 bytes) — Header comment explains why this is a separate migration (Pitfall 2 / RESEARCH §Pattern 2), then:
  ```sql
  ALTER TABLE "tenant" FORCE ROW LEVEL SECURITY;
  ALTER TABLE "_rls_canary" FORCE ROW LEVEL SECURITY;
  ```
- `db/migrations/meta/0001_snapshot.json` — drizzle-kit snapshot bookkeeping (4.3 KB; identical to `0000_snapshot.json` structure since `--custom` doesn't change the schema graph)
- `.planning/phases/01-tenant-isolation-foundation/01-05-SUMMARY.md` — this file

### Modified

- `db/migrations/meta/_journal.json` — drizzle-kit appended entry `idx: 1, tag: "0001_force_rls", breakpoints: true`. Both `0000_initial` and `0001_force_rls` listed.
- `drizzle.config.ts` — Replaced `import 'dotenv/config'` (loads `.env` only) with `loadDotenv({ path: '.env.local' })` + `loadDotenv({ path: '.env' })`. Added `DATABASE_MIGRATION_URL` (postgres superuser) preferred, `DATABASE_URL` (app_user) fallback. Comment block explains the two-connection-string architecture.
- `.env.local.example` — Added `DATABASE_MIGRATION_URL` line so contributors set up both vars.
- `.env.local` (gitignored, NOT committed) — Same `DATABASE_MIGRATION_URL` addition for local dev.

### Verbatim psql verification output

This is the load-bearing assertion of the plan; pasted exactly as `psql` returned it:

```
   relname   | relrowsecurity | relforcerowsecurity 
-------------+----------------+---------------------
 _rls_canary | t              | t
 tenant      | t              | t
(2 rows)
```

Policy presence:

```
         polname         |  polrelid   | polcmd 
-------------------------+-------------+--------
 tenant_self_filter      | tenant      | *
 canary_tenant_isolation | _rls_canary | *
(2 rows)
```

`app_user` smoke test:

```
 count 
-------
     0
(1 row)
```

### Exact migrate command shape used in this run (for Plan 08 CI to copy)

After the deviation fix, the shape is:

```bash
# Local dev: drizzle.config.ts loads .env.local automatically
pnpm drizzle-kit migrate

# CI (no .env.local): set DATABASE_MIGRATION_URL inline OR via GitHub Actions env block
DATABASE_MIGRATION_URL=postgresql://postgres:postgres@localhost:5432/lender_search_test \
  pnpm drizzle-kit migrate

# Post-migrate (both contexts): GRANT app_user DML on the freshly-created tables
psql -U postgres -d $DB -c \
  "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tenant, _rls_canary TO app_user"
```

The original `DATABASE_URL=postgresql://postgres:...` inline-prefix approach (used during the initial Task 2 run before the deviation fix landed) still works as a fallback because `drizzle.config.ts` falls back to `DATABASE_URL` when `DATABASE_MIGRATION_URL` is unset.

## Decisions Made

- **`--custom` migration over hand-edit of 0000_initial.sql.** Plan-mandated and Pitfall-2-mandated. Re-running `drizzle-kit generate` after a future schema change cannot silently overwrite `0001_force_rls.sql` because `--custom` migrations are append-only.
- **Migrate as `postgres` superuser; runtime + pen tests as `app_user`.** Only the table owner can `ALTER TABLE FORCE`. After FORCE applies, even `postgres` is subject to policy on subsequent reads — closing the Pitfall 2 gap. The two-connection-string split codifies this in `drizzle.config.ts` so the operating contract is documented in code.
- **Post-migrate GRANT to `app_user`.** Drizzle-kit creates tables owned by `postgres`; `init-db.sh`'s `ALTER DEFAULT PRIVILEGES` only covers FUTURE tables. Explicit GRANT applied. Plan 08 CI workflow needs the same GRANT step after migrate (called out in `<output>` requirements).
- **Forward-looking deviation fix landed in this plan (not deferred).** Plan 04 SUMMARY flagged that `drizzle.config.ts` only loaded `.env`. Fixing it in Plan 05 (rather than deferring) means Plan 06's pen-test harness, Plan 07's pen tests, and Plan 08's CI workflow all inherit the working pattern; no future plan needs to relitigate the env-loading question.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] drizzle.config.ts only loaded `.env`, not `.env.local`**

- **Found during:** Task 2 (initial drizzle-kit migrate invocation; Plan 04 SUMMARY had pre-flagged this as a forward-looking issue)
- **Issue:** Plan 04 SUMMARY pre-flagged: "Plan 05's `pnpm db:migrate` invocation will hit this same issue." The original `drizzle.config.ts` did `import 'dotenv/config'` which loads `.env` only. With `.env.local` (the gitignored local-dev contract per Plan 01-01/02) holding `DATABASE_URL`, `drizzle-kit migrate` failed with `DATABASE_URL is required` unless invoked with an inline `DATABASE_URL=... pnpm drizzle-kit migrate` prefix. This pattern would propagate into Plan 08's CI workflow and into every future schema migration.
- **Fix:** Replaced `import 'dotenv/config'` with `loadDotenv({ path: '.env.local' })` + `loadDotenv({ path: '.env' })`. Added `DATABASE_MIGRATION_URL` (postgres superuser) preference with fallback to `DATABASE_URL`. dotenv won't override existing env vars, so CI's GitHub Actions secrets / Vercel env take precedence over committed dotfiles. Updated `.env.local` and `.env.local.example` to set both vars.
- **Files modified:** `drizzle.config.ts`, `.env.local.example` (committed); `.env.local` (gitignored, contributor-side update).
- **Verification:** `unset DATABASE_URL DATABASE_MIGRATION_URL && pnpm drizzle-kit migrate` exits 0; the dotenv loader output confirms 3 vars loaded from `.env.local`. `pnpm typecheck` exits 0. `pg_class.relforcerowsecurity = t` for both tables (unchanged after the fix).
- **Committed in:** `4026ca9` (`chore(01-05): load .env.local in drizzle.config + DATABASE_MIGRATION_URL split`).

---

**Total deviations:** 1 auto-fixed ([Rule 3 — Blocking] drizzle.config.ts env loading + DATABASE_MIGRATION_URL split).
**Impact on plan:** Deviation does not change the artifacts the plan committed to. The migration applied successfully; FORCE is on; policies are present; app_user can connect. The fix is a forward-improvement that unblocks Plan 06/07/08's workflow without ad-hoc env prefixes — exactly the disposition Plan 04 SUMMARY recommended.

## Issues Encountered

- **GitNexus index is stale** (last indexed `2a1b9c9`, before this phase started). Per CLAUDE.md: "the current GitNexus index reflects the legacy React prototype at `src/App.js`. The project is being rebuilt from scratch ... re-run `npx gitnexus analyze` after the new code lands so impact analysis covers the new symbols." Re-indexing every commit during Phase 1 mid-build would thrash the index; deferring re-index to phase close is intentional. Hooks fired stale warnings 2 times during this plan (after each commit) — non-blocking.
- **Initial migrate hang during deviation diagnostic.** While exploring whether to load `.env.local` only (without `DATABASE_MIGRATION_URL` split), `pnpm drizzle-kit migrate` hung because `app_user` (NOBYPASSRLS NOSUPERUSER) lacked the privilege to read drizzle-kit's `__drizzle_migrations` table during the diff phase. Killed with `pkill`, redesigned to the two-connection-string pattern. No state damage — migrations had already applied successfully via the inline DATABASE_URL postgres-superuser invocation in the initial Task 2 run.

## Authentication Gates

None — local docker postgres only; no external service auth.

## User Setup Required

**Existing contributors must add `DATABASE_MIGRATION_URL` to their `.env.local`** (matches `.env.local.example`):

```bash
DATABASE_MIGRATION_URL=postgresql://postgres:postgres@localhost:5432/lender_search_dev
```

Without this, `pnpm drizzle-kit migrate` falls back to `DATABASE_URL` (app_user) which cannot apply DDL because it doesn't own the tables. New contributors copying `.env.local.example` get both vars by default.

## Verification Results

Plan-level `<verification>` block — all 6 items PASS:

1. **`db/migrations/0001_force_rls.sql` exists with both ALTER TABLE statements** — confirmed (3 grep matches: 1 comment + 2 statements). Lines 18–19 are the verbatim `ALTER TABLE "tenant" FORCE ROW LEVEL SECURITY;` and `ALTER TABLE "_rls_canary" FORCE ROW LEVEL SECURITY;`. ✓
2. **`pnpm drizzle-kit migrate` applies cleanly (exit 0); journal updated** — confirmed; `drizzle.__drizzle_migrations` shows 2 rows (one per migration). ✓
3. **`pg_class.relforcerowsecurity = true` for both `tenant` and `_rls_canary`** — confirmed via psql introspection. Output pasted verbatim above. ✓
4. **`pg_policy` lists both `tenant_self_filter` and `canary_tenant_isolation`** — confirmed; both with `polcmd = '*'` (ALL). ✓
5. **`app_user` can connect and query (with 0 rows due to RLS + empty data) without permission errors** — confirmed via `PGPASSWORD=app_user_password psql -U app_user -h localhost -d lender_search_dev -c "SELECT count(*) FROM _rls_canary"` returning `count = 0`. ✓
6. **Re-running `pnpm drizzle-kit migrate` is a no-op** — confirmed; second run exits 0 without applying any new statements; migration count stays at 2. ✓

## Next Phase Readiness

**Plan 01-06 (pen-test harness) is unblocked:**
- `db/schema/*.ts` symbols available; `db/migrations/*.sql` applied to live DB.
- `pg_class.relforcerowsecurity = t` for both tables — Plan 06's `tests/rls/setup.ts` `beforeAll` sanity check will succeed.
- `app_user` (NOBYPASSRLS NOSUPERUSER) is granted DML on both tables; `setup.ts` BYPASSRLS sanity check (per RESEARCH) will succeed because `app_user` has `rolbypassrls = f`.
- `lib/tenant/context.ts::setTenantContext` (Plan 03) targets the same `'app.tenant_id'` GUC literal that the policies reference — end-to-end contract validated.
- `drizzle.config.ts` loads `.env.local` automatically; Plan 06 + Plan 07 inherit the same env-loading pattern.

**Plan 01-07 (pen tests) is unblocked** — schema is live, FORCE is on, both policies are present, `app_user` is the (correct, NOBYPASSRLS) test connection role.

**Plan 01-08 (CI workflow) is unblocked** — has the exact migrate command shape it needs (documented in this SUMMARY's "Files Created/Modified" section). The post-migrate GRANT step is documented as a deviation surfacing.

**No blockers carried forward.**

## Self-Check

Verifying claims before finalizing.

**Files created — exist on disk:**

- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/db/migrations/0001_force_rls.sql`
- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/db/migrations/meta/0001_snapshot.json`
- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/.planning/phases/01-tenant-isolation-foundation/01-05-SUMMARY.md`

**Files modified — exist on disk:**

- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/db/migrations/meta/_journal.json`
- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/drizzle.config.ts`
- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/.env.local.example`

**Commits exist in `git log`:**

- `[FOUND] 0a6c9e6` — feat(01-05): add FORCE ROW LEVEL SECURITY custom migration
- `[FOUND] 4026ca9` — chore(01-05): load .env.local in drizzle.config + DATABASE_MIGRATION_URL split

**Live DB state (psql introspection — the load-bearing assertion):**

- `[FOUND] _rls_canary|true|true` (relrowsecurity=t, relforcerowsecurity=t)
- `[FOUND] tenant|true|true` (relrowsecurity=t, relforcerowsecurity=t)

**Acceptance criteria across both tasks:** All passed (Tasks 1, 2 verification blocks above).

**Plan-level verification block:** All 6 sections passed (see "Verification Results").

## Self-Check: PASSED

---
*Phase: 01-tenant-isolation-foundation*
*Plan: 05 — FORCE RLS custom migration + apply migrations*
*Completed: 2026-04-30*
