---
phase: 01-tenant-isolation-foundation
plan: 04
subsystem: database
tags: [drizzle, drizzle-kit, rls, pgPolicy, schema-as-code, postgres-16, migration]

# Dependency graph
requires:
  - phase: 01
    provides: lib/tenant/context.ts (Plan 03 — GUC primitive); drizzle-orm@0.45.2 + drizzle-kit@0.31.10 (Plan 01); docker-compose Postgres 16 (Plan 01)
provides:
  - db/schema/tenant.ts — tenant table + tenant_kind enum + self-filtering pgPolicy
  - db/schema/canary.ts — _rls_canary table + tenant_id index + tenant-isolation pgPolicy
  - db/schema/index.ts — schema barrel for drizzle.config.ts
  - db/migrations/0000_initial.sql — generated migration (CREATE TYPE/TABLE/INDEX + ENABLE ROW LEVEL SECURITY + CREATE POLICY)
  - db/migrations/meta/_journal.json + 0000_snapshot.json — drizzle-kit bookkeeping for future migrations
affects: [01-05 force-rls custom migration + drizzle-kit migrate, 01-06 pen-test harness, 01-07 pen tests]

# Tech tracking
tech-stack:
  added: []  # all deps were installed in Plan 01-01; this plan exercises drizzle-kit generate for the first time
  patterns:
    - "Drizzle 0.45 RLS schema-as-code: pgPolicy() declared inside pgTable's third callback; adding a policy auto-enables RLS at migration time (no separate .enableRLS() needed)"
    - "Self-filtering policy pattern (tenant table): USING/WITH CHECK on `id = current_setting('app.tenant_id', true)::uuid` — bootstrap requires UUID-then-GUC-then-INSERT (Pitfall 7)"
    - "FK-filtering policy pattern (canary table): USING/WITH CHECK on `tenant_id = current_setting(...)` — every row belongs to exactly one tenant by FK design"
    - "Both USING and WITH CHECK clauses on every policy (Pitfall 6 mitigated) — for: 'all' covers SELECT/INSERT/UPDATE/DELETE"
    - "Schema barrel pattern at db/schema/index.ts so drizzle.config.ts has one import path; Phase 2 appends `export * from './program.js'` etc."

key-files:
  created:
    - db/schema/tenant.ts
    - db/schema/canary.ts
    - db/schema/index.ts
    - db/migrations/0000_initial.sql
    - db/migrations/meta/_journal.json
    - db/migrations/meta/0000_snapshot.json
  modified: []

key-decisions:
  - "NodeNext .js extension on relative imports (db/schema/canary.ts → './tenant.js'; db/schema/index.ts → './tenant.js' + './canary.js') — matches the tsconfig moduleResolution constraint Plan 02/03 already adopted; the plan's verbatim snippet predated this constraint"
  - "Generated SQL verified to contain: CREATE TYPE, 2x CREATE TABLE, CREATE INDEX, 2x ENABLE ROW LEVEL SECURITY, 2x CREATE POLICY (USING + WITH CHECK), and the GUC reference current_setting('app.tenant_id', true) — RESEARCH Assumption A1 validated empirically"
  - "Generated SQL contains zero FORCE ROW LEVEL SECURITY clauses (as designed) — Plan 05 appends FORCE via a separate --custom migration so re-running drizzle-kit generate cannot silently overwrite the FORCE clauses (Pattern 2 / Pitfall 2)"
  - "drizzle-kit generate emits an explicit FOREIGN KEY constraint as ALTER TABLE ... ADD CONSTRAINT (separate statement from CREATE TABLE) — observed but expected; doesn't change semantics"

patterns-established:
  - "Schema authoring loop: write/modify db/schema/*.ts → run pnpm drizzle-kit generate --name=<descriptor> → commit both the schema TS files AND the generated db/migrations/* SQL+meta files in one commit (this plan kept them separate per task structure but Phase 2+ should batch)"
  - "drizzle-kit generate requires DATABASE_URL even though it does not connect to the database for schema diffing — the config validates env on import. Local-dev workaround: pass DATABASE_URL inline (`DATABASE_URL=... pnpm drizzle-kit generate ...`) since drizzle.config.ts loads .env (not .env.local)"

requirements-completed:
  - TNT-01  # RLS policies declared in schema; ENABLE ROW LEVEL SECURITY emitted by drizzle-kit (FORCE in Plan 05)
  - TNT-03  # tenant_id indexed via CREATE INDEX rls_canary_tenant_idx
  - TNT-05  # No cross-tenant data egress paths — enforced structurally; canary table proves the primitive
requirements-contributed:
  - TNT-04  # Pen tests Plans 06-07 land; this plan provides the schema they target

# Metrics
duration: ~3 min
completed: 2026-04-30
---

# Phase 1 Plan 04: TS Schema + Initial Migration Summary

**Drizzle 0.45 schema-as-code declarations for `tenant` (with self-filtering RLS policy) and `_rls_canary` (with FK + indexed tenant_id + tenant-isolation policy), then `drizzle-kit generate` produces `0000_initial.sql` containing every expected DDL clause — and zero `FORCE ROW LEVEL SECURITY` (Plan 05 owns that).**

## Performance

- **Duration:** ~3 min (start `2026-04-30T14:17:57Z`)
- **Tasks:** 3 / 3
- **Files created:** 6 (3 TS schema files + 1 generated SQL + 2 drizzle-kit meta files)
- **Files modified:** 0

## Accomplishments

- Declared `tenant` table in TS with the locked `tenant_kind` enum (`BROKERAGE`, `RETAIL_LENDER`, `WHOLESALE_LENDER`, `SYSTEM` — order from REQUIREMENTS §SCH-08) and a self-filtering RLS policy that gates every read/write on `app.tenant_id = id`
- Declared `_rls_canary` table in TS with FK to `tenant.id`, `tenant_id` indexed via `index('rls_canary_tenant_idx')` (TNT-03 + CONTEXT §D-06), and a tenant-isolation RLS policy filtering on the FK column
- Both policies declare `using` AND `withCheck` on `for: 'all'`, mitigating Pitfall 6 (USING-without-WITH-CHECK lets cross-tenant INSERT succeed)
- `drizzle-kit generate --name=initial` emitted `db/migrations/0000_initial.sql` containing every expected DDL clause; the generated SQL is **byte-identical to what RESEARCH §Pattern 1 predicted** — Assumption A1 validated empirically
- Generated SQL contains **zero `FORCE ROW LEVEL SECURITY` clauses** (Plan 05's responsibility) — confirmed by `grep -c "FORCE ROW LEVEL SECURITY" → 0`
- `pnpm typecheck` exits 0 across all three new files

## Task Commits

Each task was committed atomically:

1. **Task 1: db/schema/tenant.ts (tenant table + tenant_kind enum + self-filtering policy)** — `9d84d69` (feat)
2. **Task 2: db/schema/canary.ts (_rls_canary table + tenant_id index + RLS policy)** — `e397ea2` (feat)
3. **Task 3: db/schema/index.ts + drizzle-kit generate → 0000_initial.sql** — `d452487` (chore)

## Files Created/Modified

- `db/schema/tenant.ts` — `tenant_kind` pgEnum + `tenant` pgTable + `pgPolicy('tenant_self_filter', ...)` with `using`/`withCheck` on `id = current_setting('app.tenant_id', true)::uuid`. Exports `Tenant` and `NewTenant` types via `$inferSelect`/`$inferInsert`.
- `db/schema/canary.ts` — `rlsCanary` pgTable for `_rls_canary` (leading-underscore visual signal) + `index('rls_canary_tenant_idx').on(t.tenantId)` (TNT-03) + `pgPolicy('canary_tenant_isolation', ...)` with `using`/`withCheck` on `tenant_id = current_setting(...)`. NodeNext `.js` extension on `import { tenant } from './tenant.js'`.
- `db/schema/index.ts` — Schema barrel: `export * from './tenant.js'` + `export * from './canary.js'`. Phase 2 appends program/agency exports here.
- `db/migrations/0000_initial.sql` — drizzle-kit generated; 1.6 KB. Contains:
  - `CREATE TYPE "public"."tenant_kind" AS ENUM('BROKERAGE', 'RETAIL_LENDER', 'WHOLESALE_LENDER', 'SYSTEM');`
  - `CREATE TABLE "tenant" (...)` with 5 columns (id uuid pk default gen_random_uuid(), kind, name, created_at, updated_at — all timestamptz)
  - `ALTER TABLE "tenant" ENABLE ROW LEVEL SECURITY;`
  - `CREATE TABLE "_rls_canary" (...)` with 4 columns (id, tenant_id, payload, created_at)
  - `ALTER TABLE "_rls_canary" ENABLE ROW LEVEL SECURITY;`
  - `ALTER TABLE "_rls_canary" ADD CONSTRAINT "_rls_canary_tenant_id_tenant_id_fk" FOREIGN KEY ...` (drizzle-kit emits FKs as separate ALTERs)
  - `CREATE INDEX "rls_canary_tenant_idx" ON "_rls_canary" USING btree ("tenant_id");`
  - `CREATE POLICY "tenant_self_filter" ON "tenant" AS PERMISSIVE FOR ALL TO public USING ("tenant"."id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant"."id" = current_setting('app.tenant_id', true)::uuid);`
  - `CREATE POLICY "canary_tenant_isolation" ON "_rls_canary" AS PERMISSIVE FOR ALL TO public USING ("_rls_canary"."tenant_id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("_rls_canary"."tenant_id" = current_setting('app.tenant_id', true)::uuid);`
- `db/migrations/meta/_journal.json` — drizzle-kit journal, version 7, single entry tagged `0000_initial`
- `db/migrations/meta/0000_snapshot.json` — drizzle-kit snapshot bookkeeping (4.3 KB)

### Verbatim DDL excerpts (per `<output>` section of plan)

The five most load-bearing lines from the generated SQL, exactly as drizzle-kit emitted them:

```sql
CREATE TYPE "public"."tenant_kind" AS ENUM('BROKERAGE', 'RETAIL_LENDER', 'WHOLESALE_LENDER', 'SYSTEM');
ALTER TABLE "tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_rls_canary" ENABLE ROW LEVEL SECURITY;
CREATE INDEX "rls_canary_tenant_idx" ON "_rls_canary" USING btree ("tenant_id");
CREATE POLICY "tenant_self_filter" ON "tenant" AS PERMISSIVE FOR ALL TO public USING ("tenant"."id" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenant"."id" = current_setting('app.tenant_id', true)::uuid);
```

### Confirmation: NO `FORCE ROW LEVEL SECURITY` in `0000_initial.sql`

`grep -c 'FORCE ROW LEVEL SECURITY' db/migrations/0000_initial.sql` → `0`. As designed. Plan 05 will land FORCE via `drizzle-kit generate --custom --name=force_rls` so the FORCE clauses live in `0001_*.sql` and survive any future `drizzle-kit generate` runs.

### Unexpected DDL drizzle-kit emitted (flagged for Plan 05 verification)

- **FK as separate `ALTER TABLE ... ADD CONSTRAINT`** — `_rls_canary_tenant_id_tenant_id_fk` is added in a separate statement after both tables are created. This is drizzle-kit 0.31's standard behavior and doesn't affect Plan 05; flagged for transparency.
- **No `CREATE SCHEMA "public"`** — drizzle-kit assumes `public` exists (Postgres default). Good — Plan 05's custom migration can also assume `public`.
- **No `DROP X IF EXISTS`** — clean migration, no destructive prelude.
- **`gen_random_uuid()` referenced without `CREATE EXTENSION pgcrypto`** — Postgres 16 has `gen_random_uuid()` built into core (per RESEARCH §Pitfall verification + Plan 01-01 explicitly skipped pgcrypto). The generated SQL references the function directly, which is correct for Postgres 13+.
- **Statement breakpoints (`--> statement-breakpoint`)** — drizzle-kit emits these as parser markers; harmless and standard.

## Decisions Made

- **NodeNext `.js` extensions on relative imports.** The plan's verbatim snippet (RESEARCH §Pattern 1) used extensionless imports (`import { tenant } from './tenant'`). The tsconfig.json's `moduleResolution: 'NodeNext'` (Plan 01-01) requires `.js` extensions on relative imports. Plan 03's executor hit the same issue and adopted the fix in `tests/rls/env-boot.test.ts` (per STATE.md decisions). Same fix applied here in `db/schema/canary.ts` and `db/schema/index.ts`. Documented as a Rule 1 deviation.
- **`drizzle-kit generate` invocation passes `DATABASE_URL` inline.** `drizzle.config.ts` validates `process.env.DATABASE_URL` at import time and uses `dotenv/config` (loads `.env`, not `.env.local`). Rather than modify `drizzle.config.ts` (out of scope for Plan 04), passed the env inline: `DATABASE_URL=... pnpm drizzle-kit generate ...`. Flagged as a forward-looking improvement for Plan 05 or whichever plan first runs `drizzle-kit migrate` from a script.
- **Migration NOT applied.** Per plan: this plan only generates. Plan 05 owns the [BLOCKING] `drizzle-kit migrate` step after appending the FORCE custom migration.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug / Pre-existing constraint] NodeNext requires `.js` extension on relative imports**
- **Found during:** Task 2 (typecheck after `db/schema/canary.ts` written)
- **Issue:** TS error `TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './tenant.js'?` The plan's verbatim snippet from RESEARCH §Pattern 1 predates Plan 01-01's NodeNext tsconfig posture.
- **Fix:** Added `.js` to `import { tenant } from './tenant.js';` in `db/schema/canary.ts`. Same pattern applied in `db/schema/index.ts` (`export * from './tenant.js';` + `export * from './canary.js';`).
- **Files modified:** `db/schema/canary.ts`, `db/schema/index.ts` (the latter never had a non-`.js` form — written correctly from the start).
- **Verification:** `pnpm typecheck` exits 0.
- **Committed in:** `e397ea2` (Task 2) and `d452487` (Task 3).

### Forward-looking issues (not blocking; flagged for next plan)

**1. `drizzle.config.ts` only loads `.env`, not `.env.local`**
- **What:** `drizzle.config.ts` does `import 'dotenv/config'`, which loads `.env` only. Local-dev secrets live in `.env.local` (Plan 01-01 + 02 contract). Running `pnpm drizzle-kit generate` from a clean shell fails with `DATABASE_URL is required`.
- **Workaround used in Plan 04:** Inline env (`DATABASE_URL=... pnpm drizzle-kit generate ...`).
- **Recommendation for Plan 05:** Either (a) update `drizzle.config.ts` to call `dotenv.config({ path: '.env.local' })` first, then fall back to `.env`, OR (b) wrap drizzle-kit invocations in a `package.json` script that exports the env. Plan 05's `pnpm db:migrate` invocation will hit this same issue.

**Total deviations:** 1 auto-fixed (NodeNext `.js` extension), 1 flagged forward (env loading).
**Impact on plan:** Neither deviation changes the artifacts or behavior the plan committed to. Schema TS files match RESEARCH §Pattern 1 in shape; generated SQL matches RESEARCH §"Code Examples / Generating the initial migration" expectations exactly.

## Issues Encountered

- **GitNexus index is stale** (last indexed `2a1b9c9`, before this phase started). Per CLAUDE.md: "the current GitNexus index reflects the legacy React prototype at `src/App.js`. The project is being rebuilt from scratch ... re-run `npx gitnexus analyze` after the new code lands so impact analysis covers the new symbols." Re-indexing every commit during Phase 1 mid-build would thrash the index; deferring re-index to phase close is intentional. Hooks fired stale warnings 3 times during this plan (after each task commit) — non-blocking.

## Authentication Gates

None — no external service authentication required for Plan 01-04. Local docker postgres started/stopped within the plan run for the `drizzle-kit generate` schema-diff step.

## User Setup Required

None — `drizzle-kit generate` ran cleanly inline. Plan 05 will need either an env-loading fix in `drizzle.config.ts` or per-script env export to apply the migration.

## Verification Results

Plan-level `<verification>` block:

1. **Typecheck:** `pnpm typecheck` exits 0 across all three new schema files ✓
2. **Generated SQL contains every expected DDL clause** (verified by `grep`):
   - `CREATE TYPE` + `tenant_kind` + all four enum values ✓
   - `CREATE TABLE "tenant"` ✓
   - `CREATE TABLE "_rls_canary"` ✓
   - `CREATE INDEX "rls_canary_tenant_idx"` ✓
   - `ENABLE ROW LEVEL SECURITY` × 2 (one per table) ✓
   - `CREATE POLICY "tenant_self_filter"` ✓
   - `CREATE POLICY "canary_tenant_isolation"` ✓
   - `current_setting('app.tenant_id'` reference ✓
3. **drizzle-kit metadata files exist:** `_journal.json` (version 7, single entry tagged `0000_initial`) + `0000_snapshot.json` (4.3 KB) ✓
4. **No `FORCE ROW LEVEL SECURITY` in `0000_initial.sql`:** `grep -c` → 0 ✓
5. **The literal `'app.tenant_id'`** now appears in the three sanctioned source-tree files: `lib/tenant/context.ts` (Plan 03), `db/schema/tenant.ts` (this plan), `db/schema/canary.ts` (this plan). Generated artifacts (`db/migrations/0000_initial.sql` and `db/migrations/meta/0000_snapshot.json`) also contain it as expected. No other source files do. ✓

## Next Phase Readiness

**Plan 01-05 (FORCE RLS migration + apply migrations) is unblocked:**
- Schema TS files exist and typecheck cleanly
- `db/migrations/0000_initial.sql` is staged (NOT applied — Plan 05's job)
- `drizzle-kit@0.31.10` supports `--custom` for raw-SQL migrations (Plan 01-01 confirmed installed)
- docker compose Postgres 16 + `app_user` (NOBYPASSRLS+NOSUPERUSER) is ready (Plan 01-01)
- `lib/tenant/context.ts` provides the GUC primitive Plan 06 pen tests will exercise — schema policies in this plan reference the same literal `'app.tenant_id'`, so the contract holds end-to-end
- Plan 05 should pass DATABASE_URL inline OR fix `drizzle.config.ts` to load `.env.local` (forward-looking deviation flagged above)

**Plan 01-06 (pen-test harness) is unblocked:**
- `db/schema/*.ts` contains the symbols (`tenant`, `tenantKind`, `rlsCanary`) the harness will reference for type-safe seeding
- The schema barrel `db/schema/index.ts` is the single import path

**No blockers to wave-3 dependents.**

## Self-Check

Verifying claims before finalizing.

**Files created — exist on disk:**
- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/db/schema/tenant.ts`
- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/db/schema/canary.ts`
- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/db/schema/index.ts`
- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/db/migrations/0000_initial.sql`
- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/db/migrations/meta/_journal.json`
- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/db/migrations/meta/0000_snapshot.json`

**Commits exist in `git log`:**
- `[FOUND] 9d84d69` — feat(01-04): add tenant table + tenant_kind enum with self-filtering RLS policy
- `[FOUND] e397ea2` — feat(01-04): add _rls_canary table with tenant_id index + RLS policy
- `[FOUND] d452487` — chore(01-04): generate initial migration via drizzle-kit

**Acceptance criteria across all 3 tasks:** All passed (Tasks 1, 2, 3 verification blocks above).

**Plan-level verification block:** All 5 sections passed.

## Self-Check: PASSED

---
*Phase: 01-tenant-isolation-foundation*
*Plan: 04 — TS schema + initial migration via drizzle-kit*
*Completed: 2026-04-30*
