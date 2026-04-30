# Phase 1: Tenant Isolation Foundation - Context

**Gathered:** 2026-04-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Stand up Postgres 16+ via Supabase with `FORCE ROW LEVEL SECURITY` on every tenant-scoped table; ship a CI pen-test suite at `tests/rls/` that blocks merge on any cross-tenant query that succeeds. This is the antitrust insurance policy — every later phase depends on tenant isolation being database-enforced before any tenant data exists. No customer-visible product. No auth flow (Phase 6). No real domain schema (Phase 2).

**In scope (TNT-01..06, CFG-02, CFG-05):**
- Supabase project provisioning + Drizzle 0.45 connection (`prepare: false`)
- `tenant` table + minimum smoke table to prove RLS end-to-end
- RLS policies using `current_setting('app.tenant_id')::uuid` from JWT app_metadata
- `tenant_id` indexed on every tenant-scoped table
- `tests/rls/` Vitest pen-test suite covering cross-tenant SELECT/INSERT/UPDATE/DELETE, JWT-tampering, service-role boundary
- t3-env runtime validation; no plaintext secrets in source
- CI gate that blocks merge on any pen-test failure

**Out of scope (explicit deferrals):**
- Supabase Auth wiring → Phase 6
- `withTenantContext` request wrapper → Phase 6 (Phase 1 ships the underlying primitive)
- Inngest worker pool → Phase 6
- Sentry / Axiom → Phase 6
- Real domain tables (program, agency_rule, license, evaluation_event) → Phase 2+
- Pooler/Supavisor validation in test path → Phase 6
- Supabase CLI local stack → Phase 6 (Phase 1 uses plain Postgres container)

</domain>

<decisions>
## Implementation Decisions

### Pen-test harness + service-role boundary
- **D-01:** Pen tests written in TypeScript with **Vitest + node-postgres + `jose`** for JWT mint/forge. Tests live at `tests/rls/`. Helpers compile against the same TS sources the app will reuse (e.g., `setTenantContext`).
- **D-02:** Service-role bypass guarded by **env-var segregation + ESLint rule**. `SUPABASE_SERVICE_ROLE_KEY` is set only in CI/migration runner env, never in app runtime. ESLint rule blocks importing the service-role key from app source paths. Pen test asserts `process.env.SUPABASE_SERVICE_ROLE_KEY` is `undefined` when imported through the request-scoped module graph.
- **D-03:** Pen-test coverage matrix (minimum at Phase 1 close):
  - Cross-tenant SELECT returns zero rows when `app.tenant_id` is set to Tenant A and query targets Tenant B's row
  - Cross-tenant INSERT with mismatched `tenant_id` payload is rejected
  - Cross-tenant UPDATE/DELETE on Tenant B's row from Tenant A's GUC affects zero rows
  - JWT-tampering: a forged JWT setting `tenant_id` to a tenant the user does not belong to is treated as a no-rows-returned result, not an exfiltration (Phase 1 has no user table — test asserts that even when GUC is forged to a foreign tenant, no other path leaks)
  - Service-role boundary: connecting through the app request path with the anon key cannot escalate to service_role
  - GUC reset: each test resets `app.tenant_id` between cases (transactional rollback per test)

### Phase 1 schema scope
- **D-04:** **Bare canary schema** only:
  - `tenant(id uuid pk default gen_random_uuid(), kind tenant_kind not null, name text not null, created_at timestamptz default now(), updated_at timestamptz default now())`
  - `_rls_canary(id uuid pk default gen_random_uuid(), tenant_id uuid not null references tenant(id), payload text, created_at timestamptz default now())`
  - `tenant_kind` enum: `('BROKERAGE', 'RETAIL_LENDER', 'WHOLESALE_LENDER', 'SYSTEM')` — locked from PROJECT.md.
  - `_rls_canary` is permanent regression smoke. It stays in the schema after Phase 2 and is referenced by the pen-test suite forever.
- **D-05:** **Self-filtering RLS on `tenant`** itself: policy `USING (id = current_setting('app.tenant_id', true)::uuid)`. Every read of the tenant table is GUC-gated, same primitive everywhere. `current_setting(..., true)` (missing-ok=true) returns NULL when GUC is unset, which fails the policy → no rows. No special-case "tenant lookup" path in the codebase.
- **D-06:** **`tenant_id` column indexed** on `_rls_canary` (and every tenant-scoped table going forward). `CREATE INDEX ON _rls_canary(tenant_id)`. Drizzle schema declares the index; pen test asserts `EXPLAIN` uses index scan, not seq scan, on a single-row tenant lookup.

### Local dev + CI Postgres source
- **D-07:** **Plain Postgres 16 Docker container** for local dev + CI. `docker run postgres:16` with a volume for persistent dev data. Fastest loop. No Supabase CLI at Phase 1.
- **D-08:** **Direct connection only at Phase 1.** `prepare: false` is set on the Drizzle client config and documented as the production posture, but not exercised through a real Supavisor pooler in tests. Phase 6 wires the production Drizzle client to the Supabase pooler and adds a smoke test for prepared-statement-disabled behavior.
- **D-09:** **CI pipeline:** GitHub Actions, Postgres 16 service container, runs `pnpm test:rls` (Vitest with `--run`). Any pen-test failure = blocked merge. Migrations apply to a fresh database per CI run; no shared state.

### Migration tooling + tenant context primitive
- **D-10:** **drizzle-kit only.** Schema declared in TS at `db/schema/*.ts`. `drizzle-kit generate` produces `db/migrations/NNNN_description.sql` files. RLS policy SQL (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, `... FORCE ROW LEVEL SECURITY`, `CREATE POLICY ...`, indexes) is appended to the same generated migration file that creates the table. One source of truth: drizzle-kit. No Supabase CLI in the migration loop.
- **D-11:** **`setTenantContext(tx, tenantId)`** TS helper at `lib/tenant/context.ts`:
  ```ts
  export async function setTenantContext(tx: PgTransaction | PgDatabase, tenantId: string) {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
  }
  ```
  - `is_local=true` (third arg) scopes the GUC to the current transaction, so no manual reset needed.
  - Phase 1 pen tests call it directly. Phase 6 `withTenantContext` request wrapper reuses it inside server actions / route handlers.
  - Single source of truth for the GUC name `app.tenant_id`. Search for any other reference to that string is a code smell.

### Configuration / environment (CFG-02, CFG-05)
- **D-12:** **t3-env at `lib/env.ts`** validates required env vars at boot using Zod 4 schemas. Server-only schema (with `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`) is separate from client schema (none at Phase 1). Boot fails closed if any required var is missing or malformed.
- **D-13:** **Local dev secrets** live in `.env.local` (gitignored). CI uses GitHub Actions secrets. Production uses Vercel encrypted env (Phase 6 wires this; Phase 1 commits the t3-env contract so Phase 6 picks it up unchanged).

### Claude's Discretion
- Exact Vitest config (timeouts, parallelism, retry behavior) — pick sensible defaults; tune if tests prove flaky
- Drizzle schema file layout (`db/schema/index.ts` re-exports vs. flat structure) — pick conventional pattern
- Migration file naming convention beyond drizzle-kit defaults
- Exact ESLint rule implementation for service_role import block (custom rule vs. `no-restricted-imports`)
- Test fixture seeding strategy (per-test factory functions vs. shared seed file)
- Local Postgres container orchestration (raw `docker run` vs. `docker-compose.yml`)

</decisions>

<specifics>
## Specific Ideas

- The `_rls_canary` table is intentionally named with a leading underscore so it's visually distinct from real domain tables in `\dt` output — it's a permanent test fixture, not a domain object.
- "Forgot a `WHERE` clause" must surface as a no-rows-returned bug, not an exfiltration. This phrase from PROJECT.md is the architectural commitment Phase 1 makes literal.
- The pen test suite is the antitrust safety net. The October 2025 *Smith et al. v. Optimal Blue, LLC et al.* class action makes a single cross-tenant leak existentially expensive. Treat any RLS pen test failure with the same severity as a security incident.
- `current_setting('app.tenant_id', true)::uuid` (missing-ok variant) is the canonical reference. Any code path that reaches Postgres without setting that GUC must return zero rows, not error.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/PROJECT.md` §Constraints — tenant isolation as architectural commitment, RLS not application-layer
- `.planning/PROJECT.md` §Key Decisions — "Tenant isolation lifted to architectural commitment" (locked)
- `.planning/REQUIREMENTS.md` §TNT — TNT-01 through TNT-06 (RLS, JWT context, indexed tenant_id, pen test, no cross-tenant egress, no competitive analytics)
- `.planning/REQUIREMENTS.md` §CFG — CFG-02 (Postgres 16+, Drizzle 0.45, prepare:false), CFG-05 (t3-env, no plaintext secrets)
- `.planning/ROADMAP.md` §Phase 1 — goal + 5 success criteria

### Architecture and patterns
- `.planning/research/ARCHITECTURE.md` §"Pattern 2: Database-Enforced Tenancy via RLS + JWT Claim" — canonical RLS pattern, `current_setting` mechanism, isolation guarantees
- `.planning/research/ARCHITECTURE.md` §"Repository structure" — `tests/rls/` and `db/migrations/` directory mandates
- `.planning/research/ARCHITECTURE.md` §"`tests/rls/` is non-negotiable" — pen-test discipline source

### Antitrust posture
- `.planning/research/PITFALLS.md` §Pitfall 3.5 (Tenant isolation breached by shared overlay) — the failure mode RLS prevents
- `.planning/research/PITFALLS.md` §Pitfall 3.1 (Antitrust posture) — Optimal Blue October 2025 class action context
- `.planning/PROJECT.md` §Out of Scope — "Cross-tenant overlay visibility" line that Phase 1 enforces structurally

### Stack rationale (do not relitigate)
- `.planning/research/STACK.md` — Postgres + Supabase + Drizzle + RLS justification, version pins
- `CLAUDE.md` §Technology Stack — locked stack for the rebuild
- `CLAUDE.md` §Conventions — "Tenant filtering at the database, never the application" commitment

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **None.** Phase 1 is greenfield. The legacy React prototype at `src/App.js` is explicitly excluded from carry-forward (PROJECT.md §Existing codebase, CLAUDE.md). Phase 1 creates the first commit of the new architecture.

### Established Patterns
- This phase establishes the patterns: `db/schema/*.ts`, `db/migrations/*.sql`, `lib/tenant/context.ts`, `tests/rls/*.test.ts`, `lib/env.ts`. Every later phase builds on this layout.

### Integration Points
- `lib/tenant/context.ts::setTenantContext` is the integration seam Phase 6 consumes when wiring `withTenantContext` request middleware. The signature must not change without coordinating with Phase 6 plans.
- `db/migrations/*.sql` ordering matters; Phase 2 (Rule Schema) appends new migrations on top of Phase 1's. Drizzle's monotonic migration numbering handles this.
- `tests/rls/` harness is the foundation every later phase extends — Phase 2 schema adds program/agency tables and matching pen tests; Phase 7 staging schema adds `staging.*` pen tests; Phase 13 pricing tables extend pen tests for cross-tenant rate visibility.

</code_context>

<deferred>
## Deferred Ideas

These came up during discussion but belong in later phases. Captured to avoid loss; explicitly out of scope for Phase 1.

- **Supabase CLI local stack** — defer to Phase 6 when GoTrue + Storage are needed for auth flow
- **Pooler/Supavisor validation in test path** — defer to Phase 6; Phase 1 documents `prepare: false` but does not exercise it through a real pooler
- **`user_tenant` membership table** — defer to Phase 6 when Supabase Auth wires user identity. Phase 1 has no users
- **`license` stub table** — defer to Phase 8 (AM Review Surface + Lifecycle + Licensing) where licenses become real. Phase 2 schema may scaffold the FK shape if convenient
- **pgTAP tests for SQL-internal policy correctness** — Vitest harness covers Phase 1 needs. Revisit if Vitest harness becomes unwieldy or if SQL-only policy regressions slip through
- **Defense-in-depth: dedicated Postgres app role with `NO BYPASSRLS`** — env-var segregation + ESLint rule are Phase 1's guard. Add a dedicated app role at the database level if the env-var posture proves insufficient (e.g., a dependency leaks the service-role key into the app graph). Could be Phase 6 or later
- **Custom ESLint rule for service-role import block** — if `no-restricted-imports` from eslint-plugin-* base is sufficient, use it. Custom rule only if needed
- **Ephemeral Supabase branch per PR** — was option C in CI question; rejected at Phase 1 for cost. Worth revisiting once Supabase budget exists and pooler-specific bugs warrant prod parity per PR

</deferred>

---

*Phase: 01-tenant-isolation-foundation*
*Context gathered: 2026-04-29*
