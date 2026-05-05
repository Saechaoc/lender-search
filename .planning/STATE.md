---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: "Phase 02 shipped — PR #2"
stopped_at: Phase 3 context gathered
last_updated: "2026-05-05T03:53:23.908Z"
last_activity: 2026-05-04
progress:
  total_phases: 15
  completed_phases: 2
  total_plans: 17
  completed_plans: 17
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-29)

**Core value:** Correctness on the long tail of derogatory and non-QM scenarios — eligibility decisions an LO can defend without calling a wholesale lender to confirm.
**Current focus:** Phase 2 — Rule Schema

## Current Position

Phase: 3
Plan: Not started
Status: Phase 02 shipped — PR #2
Last activity: 2026-05-04

Progress: [█░░░░░░░░░] 7% (1/15 phases complete)

## Performance Metrics

**Velocity:**

- Total plans completed: 12
- Average duration: ~10 min
- Total execution time: ~29 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1     | 3     | ~29 min | ~10 min |
| 02 | 9 | - | - |

**Recent Trend:**

- Last 5 plans: 01-01 (15 min), 01-02 (4 min), 01-03 (~10 min)
- Trend: -

*Updated after each plan completion*
| Phase 01 P02 | 4 min | 2 tasks | 3 files |
| Phase 01 P03 | ~10 min | 2 tasks | 2 files |
| Phase 01 P04 | 3 min | 3 tasks | 6 files |
| Phase 01 P05 | 4 min | 2 tasks | 6 files |
| Phase 01 P06 | ~6 min | 5 tasks tasks | 6 files files |
| Phase 01 P07 | ~7 min | 3 tasks tasks | 6 files files |
| Phase 01 P08 | 6 min | 4 tasks tasks | 8 files files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap: 4-phase PRD shape (Phase 0 / 1 / 2 / 3) honored; sliced fine into 15 sub-phases (11 v1 at full fidelity, 4 v2/v3 sketched)
- Roadmap: Tenant isolation (RLS + pen tests) is Phase 1 — schema cannot land safely without it (antitrust posture from Oct 2025 OB class action)
- Roadmap: Differentiator #2 (structured derog) lands in Phase 2 schema; Differentiator #3 (AM extraction with confidence) lands in Phase 7-8 — both unowned by 2026 incumbents
- Roadmap: Phase 0 exit gates (Reducto acceptance, library spike, golden set ≥98%/95%, RLS pen tests) consolidated in Phase 5
- Roadmap: GTM-01 (rename) and GTM-02 (buyer persona) treated as Phase 11 exit-gate success criteria, not separate phases
- Plan 01-01: Adopted pnpm 9.15.0 as packageManager; deleted legacy npm lockfile + node_modules in a single transition step (Task 2) so package.json shape and node_modules shape never disagree
- Plan 01-01: Excluded legacy `src/` from tsconfig.json `include` set; deletion of the prototype itself deferred to Phase 6 per RESEARCH §Open Questions Q1 to keep Phase 1 diffs scoped
- Plan 01-01: Provisioned `app_user` with both NOBYPASSRLS *and* NOSUPERUSER (plan-mandated) — superuser implicitly bypasses RLS even without `BYPASSRLS`, so dropping both flags closes the gap RESEARCH Pitfall 4 calls out
- Plan 01-01: Locked `.npmrc save-exact=true` so future `pnpm add` cannot reintroduce caret/tilde ranges and break CI reproducibility
- [Phase 01]: Plan 01-02: Added clientPrefix: '' to lib/env.ts (not in plan's verbatim snippet) so @t3-oss/env-core@0.13.11's ClientOptions type accepts client: {}; Phase 6 swaps to 'NEXT_PUBLIC_'
- [Phase 01]: Plan 01-02: Created vitest.env-boot.config.ts (minimal standalone runner) because the plan's prescribed --config='' workaround is broken in Vitest 4.1.5 (interprets empty string as path 'true'); Plan 07/08 evaluates whether to keep
- [Phase 01]: Plan 01-02: Used .js extensions on dynamic imports in env-boot.test.ts (NodeNext requirement from Plan 01-01's tsconfig); the plan's verbatim extensionless form predated this constraint
- [Phase 01]: Plan 01-03: Driver split documented in lib/db/client.ts JSDoc — app/migrations use postgres-js (Drizzle); pen tests use node-postgres directly to exercise raw transaction GUC contract without TS abstraction (Pitfall 5)
- [Phase 01]: Plan 01-03: setTenantContext signature accepts PgTransaction OR PgDatabase so Phase 6's withTenantContext request wrapper consumes it unchanged; tenantId passed via Drizzle sql tagged template (parameterized — injection-safe)
- [Phase 01]: Plan 01-03: Subagent stream timed out (#2410 SSE) after both code commits landed but before metadata commit; orchestrator spot-checked work (typecheck exit 0, working tree clean) and completed metadata step manually — no work lost
- [Phase 01]: Plan 01-04: NodeNext .js extensions on relative imports in db/schema/canary.ts and db/schema/index.ts (TS2835 — same constraint Plan 01-02/03 hit; the plan's verbatim RESEARCH §Pattern 1 snippet predated NodeNext)
- [Phase 01]: Plan 01-04: drizzle.config.ts loads .env (not .env.local) — workaround was inline DATABASE_URL=... pnpm drizzle-kit generate; flagged for Plan 05 to fix (load .env.local first)
- [Phase 01]: Plan 01-04: Generated 0000_initial.sql byte-matches RESEARCH §Pattern 1 expectations (Assumption A1 validated empirically); zero FORCE ROW LEVEL SECURITY clauses by design (Plan 05 owns FORCE via --custom)
- [Phase 01]: Plan 01-05: drizzle.config.ts now loads .env.local first, then .env; DATABASE_MIGRATION_URL (postgres superuser) preferred with DATABASE_URL (app_user) fallback. Two-connection-string pattern means migrations use the table-owner role (only postgres can ALTER FORCE) while runtime + pen tests use app_user (NOBYPASSRLS NOSUPERUSER) so FORCE RLS is meaningful
- [Phase 01]: Plan 01-05: Post-migrate GRANT step required after drizzle-kit migrate creates tables owned by postgres — init-db.sh's ALTER DEFAULT PRIVILEGES covers FUTURE tables but not the ones created during the migrate. Plan 08 CI workflow must run GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE tenant,_rls_canary TO app_user after pnpm drizzle-kit migrate
- [Phase 01]: Plan 01-05: pg_class.relforcerowsecurity = t verified for tenant + _rls_canary via psql introspection — TNT-01 structurally complete. Plan 06 pen-test setup.ts beforeAll asserts the same; Plan 07 pen tests rely on FORCE so even superuser table owner is subject to policy
- [Phase 01]: Plan 01-06: Pen-test harness landed (5 files at tests/rls/) — globalSetup runs drizzle-kit migrate via execFileSync + GRANTs DML to app_user; setup.ts beforeAll asserts BYPASSRLS=false + relforcerowsecurity=true + tenant_self_filter+canary_tenant_isolation policies present; jose mintJWT/forgeJWT/extractTenantIdFromJWT (HS256, Supabase shape); seedTwoTenants implements Pitfall-7 bootstrap (gen_random_uuid → set_config → INSERT) via app_user; connectAsTenant/connectAsAnonymous transactional wrappers with is_local=true. Smoke run: pnpm test:rls 8/8 in 596ms.
- [Phase 01]: Plan 01-06: [Rule 3 deviation] global-setup.ts AND setup.ts both needed explicit loadDotenv({path: '.env.local'}) — Vitest 4 globalSetup and setupFiles run in DISTINCT module contexts; the side-effect  (loads .env only) doesn't cross between them. Mirrors drizzle.config.ts's pattern (Plan 05 deviation fix). CI's GitHub Actions secrets still take precedence (dotenv won't override pre-set env vars).
- [Phase 01]: Plan 01-06: connectAsAnonymous + pool-reused connection raises 22P02 invalid uuid syntax (empty-string GUC) instead of returning 0 rows — Postgres placeholder GUCs persist as '' on the session after set_config+ROLLBACK on a pooled connection. Plan 07 must add RESET app.tenant_id at start of connectAsAnonymous OR use a fresh pg.Client OR update test expectation to 'cast raises 22P02' (also fail-closed). Documented in 01-06-SUMMARY §Phase 7 Findings.
- [Phase 01]: Plan 01-07: connectAsAnonymous switched to fresh pg.Client (NOT pool.connect()) — Postgres 16 placeholder GUCs once touched stay as '' rather than NULL after RESET/DISCARD ALL, so the only path that yields current_setting=NULL for the 'unset GUC → 0 rows' assertion is a session that never touched the GUC. Plan 06's recommended option 1 (RESET app.tenant_id) was empirically refuted; option 2 (fresh client) chosen. Phase 6 withTenantContext should match this semantic — either fresh client per request or always set_config at request start
- [Phase 01]: Plan 01-07: GUC-reset test asserts matches_a===false (the value set by set_config did NOT survive ROLLBACK), accepting both NULL and '' as fail-closed outcomes. Original RESEARCH §Pattern 4 / Plan 07 verbatim snippet asserted toBeNull() — strictly impossible in Postgres 16 on a touched-then-rolled-back session. Corrected assertion preserves the same security property (no value leak) while honest about Postgres semantics
- [Phase 01]: Plan 01-07: TDD RED+GREEN folded into single commits per task — system under test (RLS+FORCE+policies+index) was already built in Plans 04-05, so writing the same test twice (once expecting fail, once expecting pass) is theater. Each commit message says 'RED+GREEN' to make the folding explicit. Structural value of the tests is the regression gate, not simulated red-then-green progression
- [Phase 01]: Plan 01-08: Resolved typescript-eslint peer-dep mismatch by bumping 8.46.0 → 8.59.1 (peer accepts eslint@^10.0.0). Bumping the analyzer is preferred over downgrading ESLint 10 → 9; minor-version step within typescript-eslint 8.x with no breaking changes in rules used; pnpm install --frozen-lockfile resolves with zero peer warnings.
- [Phase 01]: Plan 01-08: Forward-looking ESLint rule pattern — ship the rule before the surface it guards exists, with a smoke fixture (app/.eslint-fixture.ts) that proves the rule fires today via inverted-exit-code lint:fixture script. Phase 6's first app/ PR is auto-gated on no-restricted-properties (process.env) + no-restricted-imports (service-role*/admin-db*) without anyone having to remember to add the rule.
- [Phase 01]: Plan 01-08: lib/tenant/context.ts uses block-disable @typescript-eslint/no-explicit-any with rationale comment instead of refactoring the PgDatabase<any,any,any> | PgTransaction<any,any,any> union types. The any triplets are a deliberate forward-compat seam (Plan 03 decision: Phase 6's withTenantContext consumes the helper unchanged); refactoring would either narrow the helper to one caller or add three new generic params for no value.
- [Phase 01]: Plan 01-08: Auto-approval under --auto orchestration — config.workflow.auto_advance=true triggered the auto-approve path for the human-verify checkpoint. Re-ran all 5 Phase 1 must-haves locally (typecheck exit 0; test:rls 27/27 in 657ms; lint exit 0; lint:fixture exit 0 with 2 errors firing; psql introspection t|t for both tables) and captured green output in SUMMARY before continuing. Manual push + watch-CI + intentional-regression demonstration deferred to user discretion post-execution.

### Pending Todos

None yet.

### Blockers/Concerns

- REQUIREMENTS.md summary states "95 total" but category-by-category sum is 110; mapping covers all 110 — discrepancy flagged for milestone review
- Reducto vendor lock pending Phase 5 acceptance test (≥95% cell accuracy on 10 non-QM matrices) or consensus-pass mitigation
- External expert reviewer for golden set (paid senior underwriter) needs sourcing before Phase 5 enters
- Plan 01-01 (forward-looking): typescript-eslint@8.46.0 declares peer eslint@^8.57.0||^9.0.0 but pinned eslint@10.2.1 — non-blocking for Plan 01-01 (no lint config exists yet); Plan 08 (CI + ESLint wiring) must choose between bumping typescript-eslint or pinning eslint to 9.x

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none — first milestone)* | | | |

## Session Continuity

Last session: 2026-05-05T03:53:23.903Z
Stopped at: Phase 3 context gathered
Resume file: .planning/phases/03-audit-log-agency-rule-encoding/03-CONTEXT.md
