---
phase: 1
slug: tenant-isolation-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-29
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Phase 1's verification surface IS the pen-test suite. Every cross-tenant test failure is a release-blocker.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.x (with `pool: 'forks'` for Postgres connection isolation) |
| **Config file** | `vitest.config.ts` (Wave 0 creates) |
| **Quick run command** | `pnpm test:rls --run --bail=1` |
| **Full suite command** | `pnpm test:rls --run` |
| **Estimated runtime** | ~5 seconds (10 tests, transactional rollback per case) |

Driver split (deliberate):
- App / migrations: postgres-js (`postgres@3.4.x`) with `prepare: false`
- Pen tests: node-postgres (`pg@8.20.x`) for transaction-scoped GUC control

---

## Sampling Rate

- **After every task commit:** Run `pnpm test:rls --run --bail=1` (locally and in pre-commit if installed)
- **After every plan wave:** Run `pnpm test:rls --run` (full pen-test suite)
- **Before `/gsd-verify-work`:** Full suite green AND `pnpm drizzle-kit migrate` runs cleanly from a fresh DB
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

> Filled out by the planner during Phase 1 PLAN.md generation. Each task that materially adds RLS surface MUST have an automated command. Tasks that only edit config (eslint rule, env schema) carry their own grep-verifiable acceptance criteria.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 stands up the test infrastructure before any RLS DDL or pen tests can run. Every later wave depends on Wave 0 landing first.

- [ ] `package.json` — pnpm workspace; deps: drizzle-orm@0.45.x, drizzle-kit@0.31.x, postgres@3.4.x, pg@8.20.x, jose@6.x, @t3-oss/env-core@0.13.x, zod@4.x, vitest@4.1.x, typescript@5.7.x
- [ ] `pnpm-workspace.yaml` — repo root pnpm config (or `packageManager` field if single-package)
- [ ] `tsconfig.json` — TypeScript 5.7 strict
- [ ] `vitest.config.ts` — `pool: 'forks'`, `globalSetup: ['tests/rls/global-setup.ts']`, `setupFiles: ['tests/rls/setup.ts']`
- [ ] `tests/rls/global-setup.ts` — applies migrations from a fresh DB before suite starts
- [ ] `tests/rls/setup.ts` — connection sanity (BYPASSRLS check, FORCE RLS check), aborts suite if privileged role connects
- [ ] `tests/rls/fixtures/jwt.ts` — jose-based `mintJWT({tenantId, userId})` and `forgeJWT(claims)` helpers
- [ ] `tests/rls/fixtures/tenants.ts` — `seedTwoTenants()` helper that uses an admin connection (pre-FORCE) to create test tenants for the test run, then app-role connections for the assertions
- [ ] `lib/env.ts` — t3-env with Zod 4 server schema (DATABASE_URL required; SUPABASE_SERVICE_ROLE_KEY optional at Phase 1)
- [ ] `lib/db/client.ts` — Drizzle postgres-js client with `prepare: false`
- [ ] `lib/tenant/context.ts` — `setTenantContext(tx, tenantId)` using `set_config('app.tenant_id', $1, true)`
- [ ] `db/schema/index.ts` + `db/schema/tenant.ts` + `db/schema/canary.ts` — schema declarations with `pgPolicy()` and `.enableRLS()`
- [ ] `db/migrations/0000_*.sql` — drizzle-kit generated initial migration
- [ ] `db/migrations/0001_force_rls.sql` — drizzle-kit `--custom` migration appending `ALTER TABLE ... FORCE ROW LEVEL SECURITY`
- [ ] `docker-compose.yml` — `postgres:16-alpine` service with init script provisioning `app_user` (NOBYPASSRLS, NOSUPERUSER)
- [ ] `.github/workflows/ci.yml` — Postgres 16 service container, pnpm cache, `drizzle-kit migrate`, `pnpm test:rls`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Vercel encrypted env wired in production | CFG-05 | Vercel project doesn't exist yet (Phase 6 wires hosting) | Phase 1 ships only the t3-env contract; Phase 6 reviewer confirms Vercel env vars match the schema before deploying |
| Supabase project created with `tenant_id` JWT claim | TNT-02 | No real Supabase project at Phase 1 (deferred to Phase 6) | Phase 1 pen tests use a jose-minted fixture JWT; Phase 6 swaps to real Supabase JWKS verification |
| ESLint rule blocks service-role key from app paths | TNT-02 (D-02) | No `app/` or `pages/` directory exists yet (Phase 6 creates Next.js) | Phase 1 ships the ESLint rule config and a placeholder `app/` decoy file with a failing import; the lint command catches it. Phase 6 review confirms the rule fires once real app code lands |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (use `--run`)
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
