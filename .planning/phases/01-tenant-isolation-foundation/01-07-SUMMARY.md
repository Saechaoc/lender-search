---
phase: 01-tenant-isolation-foundation
plan: 07
subsystem: testing
tags: [vitest, pen-tests, rls, force-rls, jwt-tampering, service-role, guc-reset, index-scan, d-03-coverage-matrix]

# Dependency graph
requires:
  - phase: 01
    provides: Plan 06 harness (tests/rls/global-setup.ts, setup.ts, fixtures/{jwt,tenants,connection}.ts); Plan 05 schema state (FORCE RLS + tenant_self_filter + canary_tenant_isolation policies + rls_canary_tenant_idx); Plan 02 t3-env contract; .env.local with DATABASE_URL + DATABASE_MIGRATION_URL + RLS_TEST_JWT_SECRET
provides:
  - tests/rls/cross-tenant-select.test.ts — TNT-02 read; A's GUC + B's row → 0 rows; unset GUC → 0 rows; sanity reads; tenant self-filtering
  - tests/rls/cross-tenant-write.test.ts — TNT-02 write; INSERT mismatched tenant_id → throws WITH CHECK; UPDATE/DELETE on B's row from A → 0 rows; in-tenant INSERT sanity
  - tests/rls/jwt-tampering.test.ts — T-01-03; forge + extract round-trip; forged JWT → non-existent tenant → 0 rows; tampered claim cannot read foreign rows
  - tests/rls/service-role-boundary.test.ts — T-01-04; SUPABASE_SERVICE_ROLE_KEY undefined; DATABASE_URL points at app_user; no SERVICE_ROLE-prefixed env keys
  - tests/rls/guc-reset.test.ts — T-01-05; post-ROLLBACK GUC value does not match prior tenant id (NULL or '' both fail closed); two consecutive connectAsTenant calls don't leak; set_config sanity
  - tests/rls/index-scan.test.ts — TNT-03 / T-01-08; rls_canary_tenant_idx in pg_indexes; EXPLAIN with enable_seqscan=off uses Index Scan via the canary index
affects:
  - 01-08 CI workflow (will run pnpm test:rls; the merge gate Phase 2+ inherits)
  - Phase 2+ tenant-scoped tables (extend tests/rls/ with the same coverage matrix per new table)

# Tech tracking
tech-stack:
  added: []  # all deps already installed; this plan exercises them in 6 new test files
  patterns:
    - "RED+GREEN folded TDD: per Plan 07's prompt, the system under test (RLS+FORCE+canary policy + tenant_self_filter + tenant_id index) was already in place from Plans 04-05, so the assertion code passes against the live schema on first run. Each commit message documents the folding (test(01-07): RED+GREEN ...). The structural value of the test is the regression gate, not the simulated red-then-green progression."
    - "connectAsAnonymous uses a fresh pg.Client (NOT the pool) — resolves Plan 06's forward finding that pool-reused connections raise 22P02 invalid uuid syntax for empty-string GUC. Investigated three resolutions: (1) RESET app.tenant_id — does not work in Postgres 16; placeholder GUCs once touched stay as '' rather than NULL after RESET / DISCARD ALL. (2) Fresh pg.Client — chosen; truly fresh session has never touched the placeholder, so current_setting returns NULL cleanly. (3) Assert 22P02 fail-closed — semantically valid but obscures the no-rows assertion the D-03 matrix calls for. Verified empirically via in-repo smoke."
    - "Test bodies are pure assertions; harness handles BEGIN/set_config/ROLLBACK. Per-test pattern: const seed = await seedTwoTenants(globalThis.__pgPool); await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => { /* assertions only */ });"
    - "EXPLAIN-uses-Index-Scan asserted with SET LOCAL enable_seqscan = off to defeat the small-table planner heuristic. Validates the index EXISTS and IS USABLE — not that the planner chooses it under realistic data volumes (Phase 2+ concern). The regex /Index (Scan|Only Scan)|Bitmap Index Scan/ accepts any flavor of index access; the literal 'rls_canary_tenant_idx' check binds the assertion to the specific index rather than any random one."
    - "GUC reset assertion model corrected for Postgres 16 placeholder-GUC semantics: the load-bearing property is 'the VALUE set by set_config does not survive ROLLBACK', not 'current_setting returns NULL'. Both NULL (truly fresh session) and '' (touched-then-RESET session) post-ROLLBACK are fail-closed outcomes under the policy. Test asserts matches_a === false."

key-files:
  created:
    - tests/rls/cross-tenant-select.test.ts
    - tests/rls/cross-tenant-write.test.ts
    - tests/rls/jwt-tampering.test.ts
    - tests/rls/service-role-boundary.test.ts
    - tests/rls/guc-reset.test.ts
    - tests/rls/index-scan.test.ts
    - .planning/phases/01-tenant-isolation-foundation/01-07-SUMMARY.md
  modified:
    - tests/rls/fixtures/connection.ts  # connectAsAnonymous switched to fresh pg.Client (Plan 06 forward fix)

key-decisions:
  - "connectAsAnonymous uses a fresh pg.Client, not pool.connect(). Plan 06's forward finding suggested option 1 (RESET app.tenant_id) as preferred but empirical probing of Postgres 16 placeholder-GUC semantics showed RESET / DISCARD ALL leave the GUC as '' rather than NULL on any session that has previously touched it. A truly fresh client is the only path that yields current_setting=NULL, which is what the D-03 'unset GUC → 0 rows' assertion requires. Trade-off: connectAsAnonymous is slightly heavier than connectAsTenant (TCP handshake + auth per call) but anonymous-case tests are rare (1 use across the 6 files) and Phase 1 has no perf budget pressure on test runtime (full suite stays at ~660ms)."
  - "GUC-reset test asserts matches_a===false (the previously-set value did NOT survive ROLLBACK), accepting both NULL and '' as fail-closed outcomes. Original RESEARCH §Pattern 4 and Plan 07's verbatim snippet asserted toBeNull() — but Postgres 16's placeholder-GUC semantics make that strictly impossible on a session that has touched the placeholder. The corrected assertion preserves the same security property (the value did not leak) while being honest about what the DB actually does. Documented inline in the test file's header comment."
  - "RED+GREEN commits folded into a single commit per task. Per Plan 07's prompt environment notes, the system under test was already built (Plans 04-05 landed RLS+FORCE+policies+index in Wave 2). Writing a test then watching it fail before the system exists is not meaningful when the system already exists. The structural value of these tests is the regression gate — every commit's message documents the folding."
  - "Cross-tenant-write.test.ts asserts the rejection error message matches /row-level security|policy/i (Postgres's 'new row violates row-level security policy' wording). Less brittle than asserting on the SQLSTATE code (42501) — the message is the user-facing artifact and is stable across Postgres point releases."
  - "Service-role-boundary tests assert env contract only at Phase 1; the ESLint static-analysis layer (no-restricted-properties / no-restricted-imports) is Plan 08's job. Each file's header comment notes this so future readers don't expect a static-import-block check that doesn't exist yet."

patterns-established:
  - "D-03 coverage matrix → file mapping: each row in the matrix maps to exactly one test file. Phase 2+ extends this by adding files (e.g., tests/rls/program-version-cross-tenant-select.test.ts) following the same naming convention. Never collapse multiple matrix rows into one file."
  - "EXPLAIN-based index assertion via JSON: capture EXPLAIN (FORMAT JSON), serialize the plan, regex-match for the node type AND assert containment of the literal index name. Two assertions instead of one prevents the test from passing if Postgres adds a different index (e.g., a constraint index) that happens to match the node-type regex."
  - "Anonymous (no-tenant-context) tests open a fresh pg.Client; tenant-context tests use connectAsTenant from the pool. The split is documented in tests/rls/fixtures/connection.ts's file header so Phase 2+ tests apply the right helper for each case."

requirements-completed:
  - TNT-04  # CI pen-test suite at tests/rls/ — file inventory complete; Plan 08 wires CI to enforce
  - TNT-05  # No cross-tenant data egress paths — verified by absence + assertion across all 6 files
  - TNT-06  # No aggregate competitive-analytics surface — structurally absent at Phase 1 (no UI, no admin view, no analytics route); test coverage assertion proves cross-tenant data is not visible from any code path

# Metrics
duration: ~7 min
completed: 2026-04-30
---

# Phase 1 Plan 07: Pen Tests (D-03 Coverage Matrix) Summary

**Six pen-test files closed the D-03 coverage matrix at `tests/rls/`: cross-tenant SELECT, cross-tenant write (INSERT/UPDATE/DELETE), JWT tampering, service-role boundary, GUC reset, and EXPLAIN-uses-Index-Scan — 19 new test cases across 6 files, plus the 8 existing env-boot cases from Plan 02. Full `pnpm test:rls` run is 27/27 in 665ms (well under the 30s hard ceiling, comfortably under the 10s target). The Plan 06 forward finding (connectAsAnonymous + pool-reused connection raises 22P02 instead of returning 0 rows) was resolved by switching connectAsAnonymous to a fresh pg.Client — the original "RESET app.tenant_id" hypothesis fails on Postgres 16's placeholder-GUC semantics, but a truly fresh session has never touched the placeholder so current_setting returns NULL cleanly.**

## Performance

- **Duration:** ~7 min (start `2026-04-30T14:46:19Z`, end `2026-04-30T14:53:21Z`)
- **Tasks:** 3 / 3 (each task = 2 test files; 6 test files total)
- **Files created:** 6 test files + this SUMMARY (7 total)
- **Files modified:** 1 (tests/rls/fixtures/connection.ts — connectAsAnonymous fresh-client fix)
- **Total LOC added:** ~280 lines (test files) + ~30 lines (connection.ts diff)
- **Test count:** 27 (19 new from Plan 07 + 8 existing env-boot from Plan 02) across 7 files
- **Full pnpm test:rls runtime:** 665ms

## Accomplishments

- **Task 1: cross-tenant-select.test.ts + cross-tenant-write.test.ts** (8 tests across 2 files)
  - SELECT cases: A's GUC + B's id → 0 rows; unset GUC (fresh client) → 0 rows; A's GUC + A's id → 1 row sanity; tenant self-filtering policy verified.
  - Write cases: INSERT with mismatched tenant_id throws WITH CHECK violation (matches /row-level security|policy/i); UPDATE on B-row from A → 0 rows; DELETE on B-row from A → 0 rows; INSERT with matching tenant_id sanity (rolled back via ROLLBACK in connectAsTenant).

- **Task 2: jwt-tampering.test.ts + service-role-boundary.test.ts** (6 tests across 2 files)
  - JWT cases: forgeJWT + extractTenantIdFromJWT round-trip the tampered tenant_id; forged JWT → non-existent tenant id → 0 rows from RLS; forged JWT claims B while user "belongs to" A → tampered GUC=B → query for A's id returns 0 (the GUC determines visibility, not the user's "real" tenant — Phase 6 layers signature verification on top).
  - Service-role cases: SUPABASE_SERVICE_ROLE_KEY undefined; DATABASE_URL contains 'app_user' and not 'postgres:postgres@'; zero env keys with 'SERVICE_ROLE' substring.

- **Task 3: guc-reset.test.ts + index-scan.test.ts** (5 tests across 2 files)
  - GUC reset cases: post-ROLLBACK, the VALUE set by set_config does not match the previously-set tenant id (matches_a===false); two consecutive connectAsTenant calls each see only their own tenant's row (no leak); set_config returns the new value sanity.
  - Index-scan cases: rls_canary_tenant_idx exists in pg_indexes (introspection); EXPLAIN (FORMAT JSON) with `SET LOCAL enable_seqscan = off` produces a plan whose serialized JSON contains both `/Index (Scan|Only Scan)|Bitmap Index Scan/` and the literal `rls_canary_tenant_idx`.

- **Plan 06 forward-finding resolution:** Switched `connectAsAnonymous` from a pool-reused connection to a fresh `pg.Client`. Empirical probing of Postgres 16 confirmed that placeholder GUCs (`app.*`) once touched in a session remain DEFINED for the life of the session — RESET / DISCARD ALL set them to `''` rather than truly NULL. The cast `''::uuid` in the policy expression then raises 22P02 (invalid uuid syntax), masking the intended "0 rows returned" assertion. A truly fresh client has never touched the placeholder, so `current_setting('app.tenant_id', true)` returns NULL on first reference, the cast is skipped (NULL = anything is NULL), and the policy fails closed cleanly. Documented in commit `68af9b7` and inline in `tests/rls/fixtures/connection.ts`'s header comment.

- **Smoke verification:** Three independent runs of `pnpm test:rls` (between Tasks 1, 2, 3, and the final full run) all green, all under 700ms.

## Task Commits

Atomic per-task commits (per the plan's TDD discipline). RED+GREEN folded per the prompt's note that the system under test is already in place from Plans 04-05.

1. **Pre-task fix: `connectAsAnonymous` uses a fresh pg.Client** — `68af9b7` (`fix(01-07)`)
2. **Task 1: cross-tenant SELECT + cross-tenant write** — `810ec05` (`test(01-07): RED+GREEN`)
3. **Task 2: JWT tampering + service-role boundary** — `c06bc9b` (`test(01-07): RED+GREEN`)
4. **Task 3: GUC reset + index scan** — `9b82859` (`test(01-07): RED+GREEN`)

**Plan metadata commit:** pending (final step of this run; will land alongside STATE.md / ROADMAP.md / REQUIREMENTS.md updates).

## Files Created/Modified

### Created

- `tests/rls/cross-tenant-select.test.ts` (2.3 KB; 4 it() blocks) — TNT-02 read coverage; sanity check that self-tenant reads work.
- `tests/rls/cross-tenant-write.test.ts` (2.7 KB; 4 it() blocks) — TNT-02 write coverage; WITH CHECK rejection + USING-clause invisibility for cross-tenant UPDATE/DELETE.
- `tests/rls/jwt-tampering.test.ts` (2.8 KB; 3 it() blocks) — T-01-03 spoofing structural defense; uses forgeJWT + extractTenantIdFromJWT from Plan 06 fixtures.
- `tests/rls/service-role-boundary.test.ts` (1.7 KB; 3 it() blocks) — T-01-04 elevation-of-privilege env contract; flags ESLint rule (Plan 08) inline as the static-analysis layer.
- `tests/rls/guc-reset.test.ts` (4.3 KB; 3 it() blocks) — T-01-05 GUC leak prevention; corrected assertion model for Postgres 16 placeholder-GUC semantics (matches_a===false; both NULL and '' post-ROLLBACK are fail-closed).
- `tests/rls/index-scan.test.ts` (2.2 KB; 2 it() blocks) — TNT-03 + T-01-08 index assertion; uses SET LOCAL enable_seqscan = off to defeat small-table planner heuristic.
- `.planning/phases/01-tenant-isolation-foundation/01-07-SUMMARY.md` — this file.

### Modified

- `tests/rls/fixtures/connection.ts` — `connectAsAnonymous` switched from `pool.connect()` to `new Client(opts)` so the anonymous case runs against a session that has never touched the `app.tenant_id` placeholder GUC. Header comment updated to document the Postgres 16 placeholder-GUC quirk and reference Plan 06 SUMMARY §Phase 7 Findings.

### Verbatim verification output

**Final `pnpm test:rls` (no filter):**

```
> lender-search@0.1.0 test:rls /Users/chrissaechao/IdeaProjects/lender-search
> vitest run --config vitest.config.ts


 RUN  v4.1.5 /Users/chrissaechao/IdeaProjects/lender-search

◇ injected env (3) from .env.local
◇ injected env (0) from .env
No config path provided, using default 'drizzle.config.ts'
Reading config file '/Users/chrissaechao/IdeaProjects/lender-search/drizzle.config.ts'
◇ injected env (0) from .env.local
◇ injected env (0) from .env
Using 'pg' driver for database querying
[⣷] applying migrations...[2K[1G[✓] migrations applied successfully!
 Test Files  7 passed (7)
      Tests  27 passed (27)
   Start at  07:52:43
   Duration  665ms (transform 104ms, setup 156ms, import 134ms, tests 307ms, environment 0ms)
```

7 test files, 27 tests, 665ms — all green. Tests breakdown (from a per-file count): env-boot 8 + cross-select 4 + cross-write 4 + jwt 3 + service-role 3 + guc-reset 3 + index-scan 2 = 27.

**EXPLAIN plan snippet (verified manually via psql so future Postgres-version upgrades can adjust the regex if needed):**

```json
{
  "Plan": {
    "Node Type": "Result",
    "One-Time Filter": "((current_setting('app.tenant_id'::text, true))::uuid = '...'::uuid)",
    "Plans": [
      {
        "Node Type": "Index Scan",
        "Index Name": "rls_canary_tenant_idx",
        "Relation Name": "_rls_canary",
        "Index Cond": "(tenant_id = '...'::uuid)"
      }
    ]
  }
}
```

The test's regex `/Index (Scan|Only Scan)|Bitmap Index Scan/` matches `"Node Type": "Index Scan"`. The literal-substring check `expect(planJson).toContain('rls_canary_tenant_idx')` matches the `"Index Name"` field. Both assertions hold against Postgres 16-alpine; if a future Postgres major release changes plan formatting, both would need to be revisited (regex first, then substring).

## Decisions Made

- **connectAsAnonymous uses a fresh pg.Client.** Per the empirical probing of Postgres 16 documented above, this is the only resolution among the three Plan 06 candidates that satisfies the D-03 "unset GUC → 0 rows" assertion. Heavier than pool-reuse but acceptable at Phase 1 scale.
- **GUC reset test asserts the value did not survive, not that current_setting returns NULL.** Both NULL (fresh session) and '' (touched-then-RESET session) post-ROLLBACK are fail-closed outcomes; the corrected assertion (matches_a === false, accept either NULL or '') is honest about what Postgres actually does and preserves the security property (no value leak).
- **RED+GREEN folded.** The system under test was already built; writing the same test twice (once "expecting failure," once "expecting success") is theater when the system already passes. Each commit message says `RED+GREEN` to make this explicit.
- **EXPLAIN regex is permissive across index-scan flavors.** `/Index (Scan|Only Scan)|Bitmap Index Scan/` accepts any of the three index-access node types Postgres might choose; the literal `rls_canary_tenant_idx` substring binds the assertion to the specific canary index.
- **WITH CHECK rejection assertion uses message regex, not SQLSTATE.** `/row-level security|policy/i` is stable across Postgres point releases; SQLSTATE 42501 is technically more precise but `pg`'s error-shape exposure of `code` varies across versions. The message regex is the user-facing artifact and is the right level of binding for a regression test.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] connectAsAnonymous returned the same 22P02 error in the new tests; pivoted from RESET to fresh pg.Client.**

- **Found during:** Initial smoke after writing Task 1, before any test code ran (probed via in-repo `pnpm tsx` script; deleted after diagnosis).
- **Issue:** Plan 06 SUMMARY §Phase 7 Findings recommended option 1 (RESET app.tenant_id) as the preferred fix. Direct probing in `psql` showed Postgres 16's placeholder-GUC semantics: once `set_config('app.tenant_id', ...)` has been called in a session, `RESET "app.tenant_id"` and `DISCARD ALL` both leave the GUC defined as `''` rather than reverting to NULL. The cast `''::uuid` in the policy expression then raises 22P02 instead of failing closed to NULL.
- **Fix:** Switched `connectAsAnonymous` from `pool.connect()` to `new Client(opts)` (a fresh, never-touched session). `current_setting('app.tenant_id', true)` returns NULL on a fresh session → policy fails closed → 0 rows. Verified empirically.
- **Files modified:** `tests/rls/fixtures/connection.ts`.
- **Committed in:** `68af9b7` (`fix(01-07): make connectAsAnonymous use a fresh pg.Client (Plan 06 forward fix)`).

**2. [Rule 1 — Bug] guc-reset.test.ts assertion shape pivoted from "current_setting returns NULL" to "the value did not survive ROLLBACK".**

- **Found during:** Drafting Task 3.
- **Issue:** RESEARCH §Pattern 4 and the plan's verbatim snippet asserted `expect(rows[0].tenant_id).toBeNull()` after a ROLLBACK on a pool-reused connection. Same Postgres 16 placeholder-GUC quirk: `current_setting` returns `''` not NULL on a touched-then-rolled-back session.
- **Fix:** Reframed the assertion to `matches_a === false` (the value set by set_config did NOT persist, regardless of what specific empty-equivalent the GUC ended up at) and added a secondary assertion `guc === null || guc === ''` to document both legitimate outcomes. The security property is unchanged: no leak of the previously-set value. Test header comment explains the model.
- **Files modified:** `tests/rls/guc-reset.test.ts` (in its initial write — never committed in the original shape).
- **Committed in:** `9b82859` (`test(01-07): RED+GREEN GUC-reset + index-scan pen tests`).

### Phase 2+ Findings (not blocking; documented for future planners)

**1. The `connectAsAnonymous` fresh-client semantics are the model Phase 6's `withTenantContext` request middleware should match.**

Each request boundary should not depend on prior connection state — either by acquiring a fresh client (heavier; preserves NULL-GUC fail-closed behavior) or by always calling `set_config('app.tenant_id', ..., true)` at the start of every request (lighter; relies on the request always doing the set, not on the GUC being NULL beforehand). Either is fine; the choice should be documented in Phase 6's RESEARCH for `withTenantContext`. The Phase 1 pen-test path uses the heavier-but-clearer fresh-client pattern; Phase 6's hot path will likely choose the always-set pattern.

**2. The `RESET "app.tenant_id"` quirk is a footgun for any future code that needs a NULL-GUC state on an existing connection.**

If Phase 6 or later phases need to "drop" the tenant context on a pool-reused connection (e.g., a system-level admin operation that should fail closed if it forgets to set a tenant), `RESET` is NOT enough. The connection must be discarded and reopened, or the admin operation must use a DIFFERENT connection-string identity (e.g., a service role with explicit BYPASSRLS for that operation). Documented here so Phase 6 doesn't rediscover it cold.

**Total deviations:** 2 auto-fixed (1 blocking pivot from Plan 06's recommended option; 1 assertion-shape pivot for Postgres 16 semantics). 2 forward-looking findings for Phase 6.
**Impact on plan:** None — every `<acceptance_criteria>` for the 3 tasks passed; full `pnpm test:rls` is green; SUMMARY documents the deviations transparently for downstream phases.

## Authentication Gates

None — local docker postgres only; no external service auth; pen tests are entirely offline.

## User Setup Required

None. All harness and schema state from Plans 01-06 carry forward unchanged. New contributors who copy `.env.local.example` and run `pnpm db:up && pnpm test:rls` get a green suite.

## Issues Encountered

- **Postgres 16 placeholder-GUC empty-string semantics surprised twice** — once in Plan 06 (connectAsAnonymous), once in Plan 07 (guc-reset.test.ts assertion shape). The semantics are: any placeholder GUC (two-part name with a dot, like `app.tenant_id`), once touched in a session via `set_config(..., true)` or `set_config(..., false)`, remains DEFINED for the life of the session — RESET and DISCARD ALL set it to `''` rather than truly removing it. `current_setting('app.tenant_id', true)` (missing-ok variant) returns `''` on such a session, never NULL. Both Plan 06's and Plan 07's anonymous-case strategies (RESET; assert NULL) are wrong against Postgres 16; the corrections are documented in this SUMMARY's §Deviations and inline in the test files. Total downtime: ~6 minutes across the diagnosis and pivot.
- **`tests/rls/cross-tenant-select.test.ts` initial typecheck errors** — `rows[0].id` flagged TS2532 (object possibly undefined) until non-null asserts added (`rows[0]!.id`). Fix is consistent with the existing tests/rls/setup.ts pattern (`roleRows[0]?` guard for the BYPASSRLS check). Total downtime: ~1 minute.
- **NodeNext .js extensions on relative imports** — same constraint Plans 02-04 hit; `import './fixtures/connection'` errored, fixed by appending `.js`. The plan's verbatim snippets predated this constraint.
- **GitNexus index is stale** (last indexed `2a1b9c9`, before this phase started). Per CLAUDE.md: re-run `npx gitnexus analyze` after the new code lands. Hooks fired stale warnings 4 times during this plan (after each task commit + the deviation fix) — non-blocking; deferred to phase close per the established Plan 04/05/06 pattern.

## Verification Results

Plan-level `<verification>` block — all 5 items PASS:

1. **All six test files exist and import from Plan 06 fixtures** ✓ — verified via `ls tests/rls/*.test.ts` (7 files including env-boot.test.ts) and `grep "from './fixtures"` (all 6 new files import from Plan 06's `./fixtures/{connection,tenants,jwt}.js`).
2. **`pnpm test:rls` runs all 7 test files green; ≥20 individual test cases** ✓ — `Test Files 7 passed (7)`, `Tests 27 passed (27)`.
3. **Runtime <30 seconds (target <10s)** ✓ — 665ms; well under both bounds.
4. **Each test file maps to a specific D-03 row + a specific T-01-XX threat** ✓ — see file-header comments in each `.test.ts`; mappings are: select↔#1/T-01-01, write↔#2-3/T-01-02, jwt-tampering↔#4/T-01-03, service-role↔#5/T-01-04, guc-reset↔#6/T-01-05, index-scan↔TNT-03 EXPLAIN row/T-01-08.
5. **The full suite passes against the Plan 05 schema state — any RLS regression in Phase 2+ fails a specific named test** ✓ — by construction; the setup.ts BYPASSRLS + relforcerowsecurity + policy-name sanity checks plus the per-file assertions cover the entire Plan 05 schema-state surface.

Per-task `<acceptance_criteria>` blocks — all 3 PASS (each 4-5 acceptance items met). See task commits' verification logs above and the file-content greps captured during the run.

## Known Stubs

None. Every test makes a substantive assertion against the live Plan 05 schema; there are no placeholder `expect(true).toBe(true)` shells, no TODO comments, no skipped tests.

## Next Phase Readiness

**Plan 01-08 (CI workflow) is unblocked** — the full `pnpm test:rls` suite is the merge gate. CI's GitHub Actions workflow:
1. docker-compose service `postgres:16-alpine` (Plan 01 / RESEARCH §Pattern 7)
2. `pnpm install --frozen-lockfile`
3. Provision `app_user` role
4. Apply migrations (drizzle-kit migrate as postgres superuser)
5. GRANT DML to app_user (post-migrate)
6. `pnpm test:rls` — exit 0 = merge OK; any failure = blocked merge

The CI workflow file in Plan 08 inherits the working harness boot path verbatim. The setup.ts BYPASSRLS + FORCE + policy sanity checks fire before any test runs, so any schema regression (a future PR forgetting to apply FORCE on a new tenant-scoped table, or a policy declaration drifting between schema-as-code and DB DDL) aborts the suite with a precise message.

**Phase 2+ (rule schema) inheritance** — every new tenant-scoped table:
1. Add the table to the relforcerowsecurity assertion list in `tests/rls/setup.ts`.
2. Add the table's policy name to the polname assertion list in `tests/rls/setup.ts`.
3. Create `tests/rls/{table}-cross-tenant-select.test.ts` and `tests/rls/{table}-cross-tenant-write.test.ts` following the same connectAsTenant + seedX pattern.
4. The rest (FORCE migration, GRANT, index) flows through Plan 04/05's drizzle-kit + --custom migration pattern.

**No blockers carried forward.**

## Self-Check

Verifying claims before finalizing.

**Files created — exist on disk:**

- [FOUND] /Users/chrissaechao/IdeaProjects/lender-search/tests/rls/cross-tenant-select.test.ts (2.3 KB)
- [FOUND] /Users/chrissaechao/IdeaProjects/lender-search/tests/rls/cross-tenant-write.test.ts (2.7 KB)
- [FOUND] /Users/chrissaechao/IdeaProjects/lender-search/tests/rls/jwt-tampering.test.ts (2.8 KB)
- [FOUND] /Users/chrissaechao/IdeaProjects/lender-search/tests/rls/service-role-boundary.test.ts (1.7 KB)
- [FOUND] /Users/chrissaechao/IdeaProjects/lender-search/tests/rls/guc-reset.test.ts (4.3 KB)
- [FOUND] /Users/chrissaechao/IdeaProjects/lender-search/tests/rls/index-scan.test.ts (2.2 KB)

**Commits exist in `git log`:**

- [FOUND] `68af9b7` — fix(01-07): make connectAsAnonymous use a fresh pg.Client (Plan 06 forward fix)
- [FOUND] `810ec05` — test(01-07): RED+GREEN cross-tenant SELECT/INSERT/UPDATE/DELETE pen tests
- [FOUND] `c06bc9b` — test(01-07): RED+GREEN JWT-tampering + service-role-boundary pen tests
- [FOUND] `9b82859` — test(01-07): RED+GREEN GUC-reset + index-scan pen tests

**Live test-suite state (`pnpm test:rls` final output):**

- [FOUND] `Test Files 7 passed (7)` — env-boot.test.ts + 6 cross-tenant test files
- [FOUND] `Tests 27 passed (27)` — 8 env-boot + 19 cross-tenant
- [FOUND] `Duration 665ms` — full suite well under the 30s ceiling

**Acceptance criteria across all 3 tasks:** All passed (Tasks 1–3 acceptance lists above).

**Plan-level verification block:** All 5 sections passed.

## Self-Check: PASSED

---
*Phase: 01-tenant-isolation-foundation*
*Plan: 07 — Pen tests (D-03 coverage matrix)*
*Completed: 2026-04-30*
