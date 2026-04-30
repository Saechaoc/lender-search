# Phase 1: Tenant Isolation Foundation — Discussion Log

**Date:** 2026-04-29
**Mode:** discuss (default)

---

## Areas Selected

User selected all 4 presented gray areas:
1. Pen-test harness + service-role boundary
2. Phase 1 schema scope
3. Local dev + CI Postgres source
4. Migration tooling + tenant context primitive

Areas were narrowed at presentation time from 6 candidates by combining:
- "Pen-test harness shape" + "Service-role boundary policy" → Area 1
- "Migration tooling split" + "Tenant context primitive" → Area 4

---

## Area 1: Pen-test harness + service-role boundary

### Q1: Pen-test harness language/runner — what writes tests/rls/?

Options presented:
- Vitest + pg + jose (Recommended)
- pgTAP via pg_prove
- Hybrid: pgTAP for policy correctness + Vitest for JWT/service-role

**User selection:** Vitest + pg + jose (Recommended)

Notes: TS test files reuse helpers in app code. JWT-tampering + service-role-boundary tests need an external runner anyway, which collapses the "split harness" argument.

### Q2: How is service_role bypass guarded in Phase 1?

Options presented:
- Env-var segregation + lint rule (Recommended)
- Postgres-side: REVOKE + custom role for migrations
- Both belt-and-suspenders

**User selection:** Env-var segregation + lint rule (Recommended)

Notes: Simpler Phase 1 surface. Postgres-side dedicated app role recorded as deferred defense-in-depth option.

---

## Area 2: Phase 1 schema scope

### Q1: What tables land in Phase 1?

Options presented:
- Bare canary (Recommended)
- Skeleton (tenant + user_tenant + license stub)
- Tenant only, no smoke table

**User selection:** Bare canary (Recommended)

Notes: `tenant` parent + `_rls_canary` smoke table. `user_tenant` deferred to Phase 6. License stub deferred to Phase 8.

### Q2: How does the tenant table itself participate in RLS?

Options presented:
- Self-filtering RLS (Recommended)
- No RLS on tenant; gated via user_tenant join
- RLS only on tenant-scoped children, tenant table service-role-only

**User selection:** Self-filtering RLS (Recommended)

Notes: Same primitive everywhere. Policy: `id = current_setting('app.tenant_id', true)::uuid`. Missing-ok variant returns NULL when GUC unset → policy fails → no rows.

---

## Area 3: Local dev + CI Postgres source

### Q1: What Postgres backs local dev + CI pen tests?

Options presented:
- Plain Postgres 16 container, fast loop (Recommended)
- Supabase CLI local stack everywhere
- Hybrid: plain container CI fast lane + Supabase branch on PR/main

**User selection:** Plain Postgres 16 container, fast loop (Recommended)

Notes: Fastest loop. Supabase CLI defer to Phase 6 when GoTrue + Storage are needed.

### Q2: Is the Supabase pooler in the test path at Phase 1?

Options presented:
- Test direct connection only at Phase 1 (Recommended)
- Run pgbouncer container in front of test Postgres
- Defer pooler validation to Phase 6

**User selection:** Test direct connection only at Phase 1 (Recommended)

Notes: `prepare: false` documented in Drizzle config. Phase 6 wires the production Drizzle client to Supabase pooler with a smoke test.

---

## Area 4: Migration tooling + tenant context primitive

### Q1: Migration tooling — how do DDL + RLS policies land?

Options presented:
- drizzle-kit only; RLS .sql appended to generated migrations (Recommended)
- drizzle-kit + Supabase CLI hybrid
- Raw .sql migrations only with custom runner

**User selection:** drizzle-kit only; RLS .sql appended to generated migrations (Recommended)

Notes: Single source of truth. Plain pg container path; no Supabase CLI in migration loop.

### Q2: How does code set the app.tenant_id GUC?

Options presented:
- TS helper setTenantContext(tx, tenantId) (Recommended)
- Postgres function app.set_tenant(uuid)
- Raw set_config calls inline at every callsite

**User selection:** TS helper setTenantContext(tx, tenantId) (Recommended)

Notes: Lives at `lib/tenant/context.ts`. Phase 6 `withTenantContext` reuses it. `is_local=true` scopes GUC to current transaction.

---

## Deferred Ideas (carried into CONTEXT.md)

- Supabase CLI local stack → Phase 6
- Pooler/Supavisor validation in test path → Phase 6
- `user_tenant` membership table → Phase 6
- `license` stub table → Phase 8
- pgTAP tests for SQL-internal policy correctness → revisit if Vitest harness becomes unwieldy
- Dedicated Postgres app role with `NO BYPASSRLS` → defense-in-depth, revisit if env-var posture proves insufficient
- Ephemeral Supabase branch per PR → cost-deferred; revisit when pooler-specific bugs warrant prod parity per PR

## Claude's Discretion (recorded in CONTEXT.md)

- Vitest config tuning
- Drizzle schema file layout
- Migration file naming beyond drizzle-kit defaults
- Exact ESLint rule implementation (custom vs. `no-restricted-imports`)
- Test fixture seeding strategy
- Local Postgres container orchestration (raw `docker run` vs. `docker-compose.yml`)

---

*Discussion completed: 2026-04-29*
*Next step: `/gsd-plan-phase 1`*
