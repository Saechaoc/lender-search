---
phase: 01-tenant-isolation-foundation
plan: 02
subsystem: env
tags: [t3-env, zod, env-core, vitest, fail-closed, cfg-05]

# Dependency graph
requires:
  - phase: 01-tenant-isolation-foundation
    plan: 01
    provides: "package.json deps (@t3-oss/env-core 0.13.11, zod 4.4.1, vitest 4.1.5), tsconfig include lib/**/*.ts + tests/**/*.ts, vitest.config.ts shell"
provides:
  - "lib/env.ts: typed `env` constant + `Env` type — single source of truth for env-var access in Phase 1"
  - "Boot-fail-closed contract: importing lib/env.ts throws synchronously when DATABASE_URL is missing or malformed"
  - "tests/rls/env-boot.test.ts: 8-case smoke test proving the CFG-05 contract"
  - "vitest.env-boot.config.ts: minimal standalone runner that bypasses Plan 06's setup files (Wave 1 timing escape hatch)"
  - "Phase 6 migration contract: schema swap @t3-oss/env-core → env-nextjs reuses these Zod schemas unchanged"
affects: [01-03-db-client-tenant-context, 01-06-pen-test-harness, 01-07-pen-tests, 01-08-ci-eslint-verification]

# Tech tracking
tech-stack:
  added: []  # All deps already installed by Plan 01-01; Plan 02 only consumes them
  patterns:
    - "Boot-time validation at module load: createEnv() executes synchronously on import; failures throw before any DB connection"
    - "Server-only schema separation: client: {} placeholder + clientPrefix: '' satisfies env-core 0.13.11 type signature; Phase 6 swaps clientPrefix to 'NEXT_PUBLIC_' and populates client schema"
    - "Test isolation via vi.stubEnv + vi.resetModules + dynamic import: each case gets a fresh module evaluation with controlled process.env state"
    - "Standalone vitest config (vitest.env-boot.config.ts) for Wave-1-before-Plan-06 timing: avoids the missing setup-file references in the main vitest.config.ts"

key-files:
  created:
    - "lib/env.ts"
    - "tests/rls/env-boot.test.ts"
    - "vitest.env-boot.config.ts"
  modified: []
  deleted: []

key-decisions:
  - "Added clientPrefix: '' to lib/env.ts (not in plan's verbatim snippet) so @t3-oss/env-core@0.13.11's ClientOptions type signature accepts client: {} — empty-string prefix is the type-system-equivalent of 'no prefix'; Phase 6 swaps to 'NEXT_PUBLIC_'"
  - "Created vitest.env-boot.config.ts as a minimal standalone runner because the plan's prescribed `--config=\"\"` workaround is broken in Vitest 4.1.5 (interprets empty string as path 'true'); the config file is the equivalent escape hatch the plan also documents"
  - "Used .js extensions on dynamic imports in env-boot.test.ts (NodeNext requirement from Plan 01-01's tsconfig); the plan's verbatim extensionless form predated this constraint"

patterns-established:
  - "lib/env.ts is the canonical env-var access path for Phase 1+. Every later runtime file reads env.X, never process.env.X (Plan 08 ESLint rule will enforce)"
  - "Phase 6 migration is a one-line swap: change `from '@t3-oss/env-core'` to `from '@t3-oss/env-nextjs'`; tighten SUPABASE_SERVICE_ROLE_KEY from .optional() to .min(20); set clientPrefix: 'NEXT_PUBLIC_' and populate client: {}"
  - "DB-independent smoke tests live in tests/rls/ alongside the pen-test files Plan 06 lands; vi.stubEnv + dynamic import is the pattern for any future env-validation regressions"

requirements-completed: [CFG-05]
requirements-contributed: []  # CFG-05 fully landed here

# Metrics
duration: 4 min
completed: 2026-04-30
---

# Phase 1 Plan 02: t3-env Boot-Fail-Closed Validation Summary

**JWT-ready env contract at lib/env.ts using @t3-oss/env-core + Zod 4 with a server-only schema and 8-case Vitest smoke test that proves DATABASE_URL is fail-closed at module load.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-30T04:44:06Z
- **Completed:** 2026-04-30T04:49:00Z
- **Tasks:** 2 / 2
- **Files created:** 3 (lib/env.ts, tests/rls/env-boot.test.ts, vitest.env-boot.config.ts)
- **Files modified:** 0
- **Files deleted:** 0

## Accomplishments

- Landed the CFG-05 boot-fail-closed contract: `lib/env.ts` exports a typed `env` constant; importing the module throws synchronously when `DATABASE_URL` is missing, malformed, or has the wrong scheme.
- Server-only schema with `DATABASE_URL` (URL + `postgresql://`/`postgres://` prefix refine), `SUPABASE_SERVICE_ROLE_KEY` (optional@P1; Phase 6 tightens), `RLS_TEST_JWT_SECRET` (≥16 chars when present, optional), `NODE_ENV` (default `development`).
- 8-case Vitest smoke test at `tests/rls/env-boot.test.ts` covers: empty string → required violated, malformed URL, wrong scheme (`https://`), valid `postgresql://`, valid `postgres://`, short JWT secret, missing optional service-role key, NODE_ENV default. All pass in 91ms.
- Phase 6 migration path documented in lib/env.ts JSDoc — `@t3-oss/env-core` → `@t3-oss/env-nextjs` is a single-line swap; the Zod schemas carry forward unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create lib/env.ts with t3-env boot-fail-closed schema** — `6984414` (feat)
2. **Task 2: Write tests/rls/env-boot.test.ts proving fail-closed behavior** — `112b80f` (test)

**Plan metadata:** _will be commit `<final>` after this SUMMARY lands (docs: complete plan)_

## Files Created/Modified

- `lib/env.ts` (NEW, 50 lines)
  - `import { createEnv } from '@t3-oss/env-core'` + `import { z } from 'zod'`
  - `server`: DATABASE_URL (z.string().url() + .refine on `postgresql://`/`postgres://` prefix), SUPABASE_SERVICE_ROLE_KEY (optional), RLS_TEST_JWT_SECRET (min 16, optional), NODE_ENV (enum default development)
  - `client: {}` + `clientPrefix: ''` (the empty-prefix is required by env-core 0.13.11's ClientOptions type signature when `client` is set; Phase 6 changes to `'NEXT_PUBLIC_'`)
  - `runtimeEnv: process.env` + `emptyStringAsUndefined: true`
  - Exports: `env` (const) + `Env` (type)
  - Phase 6 migration path documented in JSDoc header

- `tests/rls/env-boot.test.ts` (NEW, 75 lines)
  - 8 `it(` blocks under one `describe('lib/env (CFG-05 boot-fail-closed)')`
  - `beforeEach`: `vi.resetModules()` + `vi.stubEnv` to clear DATABASE_URL/SUPABASE_SERVICE_ROLE_KEY/RLS_TEST_JWT_SECRET (each case re-stubs as needed); NODE_ENV=`'test'`
  - `afterEach`: `vi.unstubAllEnvs()`
  - Pattern: dynamic `import('../../lib/env.js')` per case so the schema re-evaluates with current stubbed env
  - VALID_DB_URL constant: `postgresql://user:pw@localhost:5432/lender_search_test`

- `vitest.env-boot.config.ts` (NEW, 31 lines)
  - Minimal standalone runner (`pool: 'forks'`, `isolate: true`, `include: ['tests/rls/env-boot.test.ts']`)
  - Does NOT reference `tests/rls/global-setup.ts` or `tests/rls/setup.ts` (those are Plan 06)
  - Header documents WHY (broken `--config=""` in Vitest 4.1.5; missing Plan-06 setup references in the main config) and lifecycle (Plan 07/08 evaluates whether to keep)

## Decisions Made

- **`clientPrefix: ''` added to lib/env.ts** (not in plan's verbatim RESEARCH §"Pattern 6" snippet): @t3-oss/env-core@0.13.11's `ClientOptions<TPrefix, TClient>` type union requires `clientPrefix` whenever `client` is non-undefined. Empty-string prefix preserves the `client: {}` line verbatim (per the plan's acceptance criterion) while satisfying the type system. Phase 6 swaps to `'NEXT_PUBLIC_'` when adding real client-side keys.
- **`vitest.env-boot.config.ts` standalone config** rather than mutating `vitest.config.ts`: the main config is owned by Plan 01-01 (which intentionally pre-wired Plan 06's `globalSetup` / `setupFiles` paths). The standalone config is the documented "minimal config that doesn't include the missing setup" fallback; this approach keeps Plan 02's diff scoped to env-validation files.
- **`.js` extensions on dynamic imports** in env-boot.test.ts: Plan 01-01's `tsconfig.json` set `module: NodeNext` + `moduleResolution: NodeNext`, which requires explicit extensions on relative imports. The plan's verbatim test snippet predates this constraint; updated to `import('../../lib/env.js')` to keep typecheck clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Action vs. Type System Conflict] `client: {}` requires `clientPrefix` in @t3-oss/env-core@0.13.11**
- **Found during:** Task 1 (`pnpm typecheck` after lib/env.ts was written verbatim per RESEARCH §"Pattern 6")
- **Issue:** TypeScript error `TS2345`: "Property 'clientPrefix' is missing in type '{ ... client: {} ... }' but required in type 'ClientOptions<TPrefixFormat, {}>'." The verbatim RESEARCH snippet was authored against an older env-core API; v0.13.11's `ServerClientOptions` union types `ClientOptions<TPrefix, TClient>` requires `clientPrefix` whenever `client` is present (even as `{}`).
- **Fix:** Added `clientPrefix: ''` (empty-string prefix) immediately above `client: {}`. The empty string is valid per the type signature line `TPrefix extends "" ? TServer[TKey] : ...`, satisfies the `Server + Client` branch of the union, and preserves the `client: {}` line verbatim (per Task 1 acceptance criterion). Phase 6 will swap this to `'NEXT_PUBLIC_'` when populating the client schema.
- **Files modified:** `lib/env.ts`
- **Verification:** `pnpm typecheck` exits 0; all Task 1 acceptance criteria still satisfied (file contains `client: {}`, all required imports/exports/literal patterns present).
- **Committed in:** `6984414` (Task 1 commit body documents the change explicitly)

**2. [Rule 3 — Plan's CLI Workaround Broken in Vitest 4.1.5] `--config=""` is not interpreted as "skip config"**
- **Found during:** Task 2 (running the plan's verify gate `pnpm exec vitest run tests/rls/env-boot.test.ts --config="" --reporter=basic`)
- **Issue:** Vitest 4.1.5 interprets the empty-string argument as a literal config path of `"true"` (the shell-eval'd argument after `--config=`), failing with `[UNRESOLVED_ENTRY] Cannot resolve entry module true`. Separately, the `--reporter=basic` flag fails because Vitest 4.x dropped string-identifier reporter resolution (it now expects an importable module). The plan's `<behavior>` block anticipated this exact scenario: *"the test uses `pnpm exec vitest run --config vitest.config.ts tests/rls/env-boot.test.ts` ... [if it errors] use [`--config=""`] for verification only, until Plan 06 lands the setup files. ... a minimal config that doesn't include the missing setup."* — i.e., the prescribed CLI form is the **first** workaround the plan proposes, with "minimal config" as the explicit fallback.
- **Fix:** Created `vitest.env-boot.config.ts` — a minimal standalone runner (no globalSetup, no setupFiles, includes only `tests/rls/env-boot.test.ts`) and ran via `pnpm exec vitest run --config vitest.env-boot.config.ts`. All 8 tests pass in 91ms.
- **Files modified:** `vitest.env-boot.config.ts` (new file; was not in the plan's `<files>` list — Rule 3 auto-add to fix the blocker; documented in the file's own JSDoc header).
- **Verification:** `pnpm exec vitest run --config vitest.env-boot.config.ts` → `Tests 8 passed (8)`. Plan's intent (run env-boot test before Plan 06 lands setup files) preserved.
- **Committed in:** `112b80f` (Task 2 commit body documents the rationale)

**3. [Rule 1 — NodeNext Module Resolution] Plan's verbatim extensionless `import('../../lib/env')` doesn't typecheck**
- **Found during:** Task 2 (`pnpm typecheck` after writing tests/rls/env-boot.test.ts verbatim per plan)
- **Issue:** TypeScript error `TS2835`: "Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../../lib/env.js'?" Plan 01-01 set `moduleResolution: NodeNext` in `tsconfig.json`; the plan's verbatim test snippet uses extensionless imports which violates that rule. Plan-acceptance-criterion #4 specified the literal substring `import('../../lib/env')`.
- **Fix:** Changed all 8 dynamic imports in env-boot.test.ts from `import('../../lib/env')` to `import('../../lib/env.js')`. The `.js` extension is the TypeScript NodeNext convention for resolving `.ts` source files at compile time and the runtime-resolved JS extension. The semantic intent (importing the lib/env module) is preserved; only the literal substring of the acceptance criterion changes.
- **Files modified:** `tests/rls/env-boot.test.ts`
- **Verification:** `pnpm typecheck` exits 0; `pnpm exec vitest run --config vitest.env-boot.config.ts` → `Tests 8 passed (8)`; all 8 it() blocks present (≥7 required); positive case `expect(mod.env.DATABASE_URL).toBe(VALID_DB_URL)` present; vi.stubEnv calls present; rejects.toThrow patterns present (4 cases).
- **Committed in:** `112b80f` (Task 2 commit body)

---

**Total deviations:** 3 auto-fixed (1 type-signature mismatch in plan's verbatim snippet, 1 broken CLI workaround in Vitest 4.1.5, 1 NodeNext extension requirement). All three are conformance fixes against installed-tooling actuals, not scope changes.

**Impact on plan:** None of the three changes the plan's behavior contract. lib/env.ts still throws synchronously on missing/malformed DATABASE_URL; the 8-case smoke test still proves the fail-closed contract; the env-boot test still runs cleanly without depending on Plan 06's setup files. Phase 6's documented migration path (env-core → env-nextjs) is unchanged.

## Issues Encountered

- The plan's prescribed `--config=""` workaround is broken in Vitest 4.1.5; documented in Deviation 2 above. Plan 07 (CI + verification) will need to re-run the env-boot test inside the full `vitest.config.ts` suite once Plan 06 lands `tests/rls/setup.ts` and `tests/rls/global-setup.ts` — at that point either the standalone `vitest.env-boot.config.ts` is deleted, or it's kept as a fast-path regression runner.
- `z.string().url()` is marked `@deprecated` in Zod 4.4.1 (the recommended form is `z.url()`). Plan's verbatim snippet uses the deprecated form. Both forms produce identical schemas at runtime; deprecation is non-blocking. Future deprecation work (likely a Phase 6 lint pass or a Zod-major-version migration) can swap to `z.url()` without behavior change.

## Authentication Gates

None — no external service authentication required.

## User Setup Required

None — `lib/env.ts` validates env vars at boot. Local devs running Plan 02 work need `.env.local` populated per `.env.local.example` (committed by Plan 01-01) before any code that imports `lib/env.ts` runs. The pen test (`tests/rls/env-boot.test.ts`) does NOT need a real `.env.local` because each case stubs env vars via `vi.stubEnv`.

## Verification Results

Plan-level `<verification>` block:

1. **lib/env.ts exists, typechecks, exports env + Env:**
   - File exists: `[OK] /Users/chrissaechao/IdeaProjects/lender-search/lib/env.ts`
   - `export const env`: `[OK]` (1 occurrence)
   - `export type Env`: `[OK]` (1 occurrence)
   - `pnpm typecheck`: `[OK] exit 0`

2. **tests/rls/env-boot.test.ts exists and passes 7+ cases:**
   - File exists: `[OK]`
   - `it()` blocks: `[OK] 8` (plan requires ≥7)
   - `pnpm exec vitest run --config vitest.env-boot.config.ts`: `[OK] Tests 8 passed (8)` in 91ms

3. **pnpm typecheck across workspace:**
   - `[OK] exit 0` — env.ts in tsconfig include set; tests/rls/env-boot.test.ts under tests/**/*.ts include

All 11 Task 1 acceptance criteria + all 7 Task 2 acceptance criteria pass (intent preserved; deviations documented).

## Next Phase Readiness

Plan 01-03 (db client + `setTenantContext`) is unblocked:
- `lib/env.ts` exports `env.DATABASE_URL` (typed `string`, validated to be a Postgres URL) — Plan 03's Drizzle client config consumes this directly
- The single-source-of-truth contract is in place: Plan 03 imports `env` from `lib/env`, never reads `process.env.DATABASE_URL`

Plan 01-06 (pen-test harness) is unblocked:
- `lib/env.ts` exports `env.RLS_TEST_JWT_SECRET` (typed `string | undefined`, ≥16 chars when present) — Plan 06's `tests/rls/fixtures/jwt.ts` consumes this for HS256 fixture JWT minting
- `tests/rls/env-boot.test.ts` is a sibling smoke test that runs alongside Plan 06's pen tests; once Plan 06 lands `tests/rls/setup.ts` and `tests/rls/global-setup.ts`, Plan 07 can fold env-boot.test.ts into the main `pnpm test:rls` flow

Plan 01-08 (CI + ESLint) is unblocked:
- Plan 08's `no-restricted-properties` rule on `process.env` enforces that every later runtime file reads `env.X` from `lib/env.ts` (the contract this plan establishes)

No blockers to wave-2 dependents.

## Self-Check

Verifying claims before finalizing:

**Files created — exist on disk:**
- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/lib/env.ts`
- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/tests/rls/env-boot.test.ts`
- `[FOUND] /Users/chrissaechao/IdeaProjects/lender-search/vitest.env-boot.config.ts`

**Commits exist in `git log`:**
- `[FOUND] 6984414` — feat(01-02): add t3-env validation at lib/env.ts
- `[FOUND] 112b80f` — test(01-02): add env-boot fail-closed smoke test

**Acceptance criteria across both tasks:** All passed (Tasks 1, 2 verification blocks above; deviations documented and intent-preserving).

**Plan-level verification block:** All 3 sections passed (typecheck, test pass, full-workspace typecheck).

## Self-Check: PASSED

---
*Phase: 01-tenant-isolation-foundation*
*Plan: 02 — t3-env Boot-Fail-Closed Validation*
*Completed: 2026-04-30*
