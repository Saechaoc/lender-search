---
phase: 01-tenant-isolation-foundation
plan: 03
subsystem: database
tags: [drizzle, postgres-js, rls, guc, set_config, tenant-context, supabase-pooler-posture]

requires:
  - phase: 01
    provides: lib/env.ts with validated env.DATABASE_URL (Plan 01-02); package.json deps including drizzle-orm@0.45.2 + postgres@3.4.9 (Plan 01-01)
provides:
  - Drizzle 0.45 postgres-js client at lib/db/client.ts with prepare:false (Supabase pooler posture)
  - setTenantContext(tx, tenantId) primitive at lib/tenant/context.ts using set_config(..., is_local=true)
  - TENANT_GUC_NAME exported constant — documentation source for the literal string 'app.tenant_id'
affects: [01-04 schema, 01-06 pen-test harness, 01-07 pen tests, 06 withTenantContext request wrapper]

tech-stack:
  added: [drizzle-orm/postgres-js, postgres-js connection pooling]
  patterns:
    - "Driver split: app/migrations use postgres-js (Drizzle); pen tests use node-postgres directly to exercise raw SQL contract"
    - "Single source of truth for GUC name: literal 'app.tenant_id' lives only in lib/tenant/context.ts (extends to db/schema/* in Plan 04 and tests/rls/* in Plans 06-07; any other reference is a smell)"
    - "Transaction-scoped GUC via is_local=true; GUC dies on COMMIT/ROLLBACK; no manual reset needed"

key-files:
  created:
    - lib/db/client.ts
    - lib/tenant/context.ts
  modified:
    - .planning/STATE.md
    - .planning/ROADMAP.md

key-decisions:
  - "postgres-js connection: prepare:false, max:10, idle_timeout:30, ssl:false at Phase 1 (Phase 6 raises max + sets ssl:'require' for Supabase)"
  - "TENANT_GUC_NAME exported as constant for documentation only; runtime code calls setTenantContext, never hard-codes the string"
  - "setTenantContext signature accepts PgTransaction OR PgDatabase to support both Phase 1 pen-test direct calls and Phase 6 server-action transaction-wrapped calls without rework"
  - "tenantId parameter passed via Drizzle sql template tag (parameterized), making SQL injection structurally impossible even if upstream input validation fails"

patterns-established:
  - "GUC primitive pattern: set_config('app.tenant_id', $tenantId, true) — third arg true (is_local) is non-negotiable; is_local=false would persist GUC across pooled-connection reuse and cause cross-tenant leaks (Pitfall 3)"
  - "Phase 1 / Phase 6 contract for setTenantContext: Phase 1 pen tests call set_config directly via pg (driver split); Phase 6 withTenantContext middleware wraps every server action / route handler with this helper"
  - "Bootstrap pattern for self-filtering tenant table (RESEARCH §Pitfall 7): generate UUID client-side → setTenantContext with new UUID → INSERT row with same UUID → WITH CHECK passes because id == GUC"

requirements-completed:
  - CFG-02
  - TNT-02

duration: ~10min
completed: 2026-04-29
---

# Phase 1 Plan 03 Summary

**Drizzle 0.45 postgres-js client with `prepare:false` posture + `setTenantContext` GUC primitive — single source of truth for the literal `'app.tenant_id'` and the seam Phase 6's `withTenantContext` request wrapper consumes unchanged.**

## Performance

- **Duration:** ~10 min (executor stream timed out before metadata commit — see Issues Encountered; metadata recovered by orchestrator)
- **Started:** 2026-04-29T21:51:xxZ (commit `ec7ea03`)
- **Completed:** 2026-04-29T21:54:xxZ (commit `347d60b`)
- **Tasks:** 2
- **Files created:** 2

## Accomplishments

- Drizzle 0.45.2 postgres-js client landed with `prepare: false` (the contract that lets Phase 6 swap to the real Supavisor pooler with a DATABASE_URL change, not a client refactor)
- `setTenantContext(tx, tenantId)` primitive landed using `set_config('app.tenant_id', $1, true)` — `is_local=true` makes the GUC transaction-scoped, so pooled-connection reuse cannot leak the GUC across requests (Pitfall 3 mitigated)
- `TENANT_GUC_NAME = 'app.tenant_id'` exported as a documentation constant; runtime callers use the helper, not the literal
- Single source of truth verified: at end of this plan, `'app.tenant_id'` literal appears only in `lib/tenant/context.ts` (5 occurrences — JSDoc + impl + constant). Plan 04 will add it to db/schema/*; Plans 06-07 to tests/rls/*. Any other reference to the literal is a code smell.

## Task Commits

1. **Task 1: Drizzle postgres-js client with prepare:false** — `ec7ea03` (feat)
2. **Task 2: setTenantContext GUC primitive** — `347d60b` (feat)

**Plan metadata:** (committed in this orchestrator-driven recovery commit — see Issues Encountered)

## Files Created/Modified

- `lib/db/client.ts` — Drizzle 0.45 + postgres-js client; imports `env.DATABASE_URL` from `lib/env.ts`; exports `db`, `sql`, `Db` type
- `lib/tenant/context.ts` — `setTenantContext` async function + `TENANT_GUC_NAME` constant; uses Drizzle `sql` tagged template for parameterized injection-safe call to `set_config`

## Decisions Made

- **`prepare: false` non-negotiable at Phase 1** even though Phase 1 uses direct connection (no pooler in test loop) — codifies the Phase 6 Supabase posture so the migration is a config change, not a refactor
- **Driver split formalized in JSDoc** at top of `lib/db/client.ts`: app/migrations use postgres-js (Drizzle's recommended driver); pen tests use node-postgres (`pg`) directly because they need raw transaction control to exercise the GUC SQL contract without the TS abstraction
- **`PgTransaction | PgDatabase` typed parameter** so Phase 6's `withTenantContext` (which calls `setTenantContext` inside a Drizzle transaction) and Phase 1 pen tests (which would call from any handle) both type-check unchanged
- **Connection pool sized small (max: 10)** at Phase 1 since there's no app load — Phase 6 wiring notes will raise this for Vercel concurrency

## Deviations from Plan

None — both files match the plan's `<action>` blocks exactly. The `<verification>` section in 01-03-PLAN.md said "the literal `'app.tenant_id'` appears in exactly two files" (per the plan-checker INFO note); the JSDoc at the top of `lib/tenant/context.ts` correctly documents the file count as "exactly three places" (this file + Plan 04 schema + Plans 06-07 tests), forward-looking. At end of Plan 03 in isolation, the literal appears only in `lib/tenant/context.ts` — verified.

## Issues Encountered

- **Subagent stream idle timeout (#2410)** — the Plan 03 executor agent completed both code commits (`ec7ea03`, `347d60b`) and verified all acceptance criteria, but the SSE return signal timed out before the metadata-commit step (SUMMARY.md + STATE.md/ROADMAP.md update + final docs commit). The orchestrator detected this via spot-check (working tree clean, SUMMARY.md missing, both source files present and committed), re-verified acceptance criteria (`pnpm typecheck` exits 0; literal `'app.tenant_id'` only in `lib/tenant/context.ts`), and completed the metadata step manually. No code or commit was lost; the work is byte-identical to what the agent produced.

## Next Phase Readiness

- **Wave 2 unblocked.** Plan 04 (schema declarations) imports the Drizzle handle (`db`) from `lib/db/client.ts` and references the GUC literal via `pgPolicy()` declarations on `tenant` and `_rls_canary` (where the literal IS expected to land — that's the second of the three sanctioned places in the codebase).
- **Phase 6 contract documented in JSDoc.** When Phase 6's `withTenantContext` request wrapper is built, it imports `setTenantContext` directly with no signature change — the type accepts both `PgDatabase` and `PgTransaction` for exactly this reason.

---
*Phase: 01-tenant-isolation-foundation*
*Completed: 2026-04-29*
