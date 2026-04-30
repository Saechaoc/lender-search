# Phase 1: Tenant Isolation Foundation - Research

**Researched:** 2026-04-29
**Domain:** Postgres + Drizzle 0.45 + Vitest pen-test harness; database-enforced tenant isolation; CI gate
**Confidence:** HIGH on Postgres RLS semantics; HIGH on Drizzle 0.45 RLS support (verified against current docs); HIGH on Vitest+pg pen-test pattern; MEDIUM on the exact "append-to-generated-migration" workflow (drizzle-kit's native support is `--custom` for empty files, so the FORCE/policy SQL strategy needs care — see Pitfall section)

## Summary

Phase 1 stands up a Postgres 16 database, a minimum schema (`tenant` + `_rls_canary`), `FORCE ROW LEVEL SECURITY` on every tenant-scoped table, a `setTenantContext()` TS helper, a Vitest pen-test suite, and a t3-env config — all greenfield, all on a plain Postgres Docker container, no Next.js app yet.

The single highest-leverage technical question — "does Drizzle 0.45 support RLS as schema-as-code or do we hand-write raw SQL?" — has a clean answer: **Drizzle 0.45 supports `.enableRLS()` and `pgPolicy()` natively in the schema** (added in drizzle-kit 0.27.0, October 2024) [VERIFIED: orm.drizzle.team/docs/rls]. `drizzle-kit generate` emits `CREATE POLICY` and `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` from the schema. The only feature the schema API does NOT cover is `FORCE ROW LEVEL SECURITY` — that two-line ALTER must be appended via `drizzle-kit generate --custom` migration files [VERIFIED: orm.drizzle.team/docs/kit-custom-migrations]. `drizzle-kit push` has a known bug (#3504) that does NOT apply RLS policies; use `drizzle-kit migrate` only.

**Primary recommendation:** Schema declares `pgPolicy()` and `.enableRLS()` in TS, drizzle-kit generates the migration, then a separate `--custom` migration appends the `FORCE ROW LEVEL SECURITY` ALTER + a sanity-check `INSERT INTO tenant ... LIMIT 0` that proves policies exist (catches "schema regenerated and lost RLS" regressions). Pen tests are Vitest with `pool: 'forks'` for process isolation, node-postgres `pg.Pool` per test to a fresh transaction-rolled-back state. CI is a GitHub Actions Postgres 16 service container running `pnpm test:rls` against a fresh database every run.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Pen-test harness + service-role boundary:**
- **D-01:** Pen tests written in TypeScript with **Vitest + node-postgres + `jose`** for JWT mint/forge. Tests live at `tests/rls/`. Helpers compile against the same TS sources the app will reuse (e.g., `setTenantContext`).
- **D-02:** Service-role bypass guarded by **env-var segregation + ESLint rule**. `SUPABASE_SERVICE_ROLE_KEY` is set only in CI/migration runner env, never in app runtime. ESLint rule blocks importing the service-role key from app source paths. Pen test asserts `process.env.SUPABASE_SERVICE_ROLE_KEY` is `undefined` when imported through the request-scoped module graph.
- **D-03:** Pen-test coverage matrix (minimum at Phase 1 close):
  - Cross-tenant SELECT returns zero rows when `app.tenant_id` is set to Tenant A and query targets Tenant B's row
  - Cross-tenant INSERT with mismatched `tenant_id` payload is rejected
  - Cross-tenant UPDATE/DELETE on Tenant B's row from Tenant A's GUC affects zero rows
  - JWT-tampering: a forged JWT setting `tenant_id` to a tenant the user does not belong to is treated as a no-rows-returned result, not an exfiltration
  - Service-role boundary: connecting through the app request path with the anon key cannot escalate to service_role
  - GUC reset: each test resets `app.tenant_id` between cases (transactional rollback per test)

**Phase 1 schema scope:**
- **D-04:** **Bare canary schema** only:
  - `tenant(id uuid pk default gen_random_uuid(), kind tenant_kind not null, name text not null, created_at timestamptz default now(), updated_at timestamptz default now())`
  - `_rls_canary(id uuid pk default gen_random_uuid(), tenant_id uuid not null references tenant(id), payload text, created_at timestamptz default now())`
  - `tenant_kind` enum: `('BROKERAGE', 'RETAIL_LENDER', 'WHOLESALE_LENDER', 'SYSTEM')`
  - `_rls_canary` is permanent regression smoke
- **D-05:** **Self-filtering RLS on `tenant`** itself: policy `USING (id = current_setting('app.tenant_id', true)::uuid)`. `current_setting(..., true)` returns NULL when GUC is unset → no rows.
- **D-06:** `tenant_id` indexed on `_rls_canary`; pen test asserts `EXPLAIN` uses index scan.

**Local dev + CI Postgres source:**
- **D-07:** Plain Postgres 16 Docker container for local dev + CI. No Supabase CLI at Phase 1.
- **D-08:** Direct connection only at Phase 1. `prepare: false` documented but not exercised through real Supavisor pooler in tests.
- **D-09:** GitHub Actions, Postgres 16 service container, `pnpm test:rls` (Vitest `--run`). Migrations apply to a fresh database per CI run.

**Migration tooling + tenant context primitive:**
- **D-10:** drizzle-kit only. Schema in TS at `db/schema/*.ts`. `drizzle-kit generate` produces `db/migrations/NNNN_*.sql`. RLS policy SQL appended to the same generated migration file.
- **D-11:** `setTenantContext(tx, tenantId)` TS helper at `lib/tenant/context.ts` using `set_config('app.tenant_id', tenantId, true)` (is_local=true, transaction-scoped).

**Configuration / environment:**
- **D-12:** t3-env at `lib/env.ts` validates required env vars at boot using Zod 4. Server-only schema separated from client. Boot fails closed.
- **D-13:** `.env.local` (gitignored) for local; GitHub Actions secrets for CI; Vercel encrypted env for prod (Phase 6 wires).

### Claude's Discretion

- Exact Vitest config (timeouts, parallelism, retry behavior) — pick sensible defaults; tune if tests prove flaky
- Drizzle schema file layout (`db/schema/index.ts` re-exports vs. flat structure) — pick conventional pattern
- Migration file naming convention beyond drizzle-kit defaults
- Exact ESLint rule implementation for service_role import block (custom rule vs. `no-restricted-imports`)
- Test fixture seeding strategy (per-test factory functions vs. shared seed file)
- Local Postgres container orchestration (raw `docker run` vs. `docker-compose.yml`)

### Deferred Ideas (OUT OF SCOPE)

- Supabase CLI local stack — defer to Phase 6
- Pooler/Supavisor validation in test path — defer to Phase 6
- `user_tenant` membership table — defer to Phase 6
- `license` stub table — defer to Phase 8
- pgTAP tests — revisit if Vitest harness becomes unwieldy
- Defense-in-depth: dedicated Postgres app role with `NO BYPASSRLS` — env-var segregation + ESLint rule are Phase 1's guard
- Custom ESLint rule for service-role import block — use `no-restricted-imports` if sufficient
- Ephemeral Supabase branch per PR — rejected at Phase 1 for cost
</user_constraints>

## Project Constraints (from CLAUDE.md)

CLAUDE.md is the project's hard contract. Phase 1 plans must respect:

- **TypeScript everywhere.** No JS outside generated code. CLAUDE.md says "TypeScript 5.7" — current latest 5.7.x is `5.7.3` (use that pin) [VERIFIED: npm view typescript@~5.7]. The newer 5.9.x and 6.0.x lines exist but CLAUDE.md locks 5.7. Plan respects the lock.
- **Drizzle 0.45.x with `prepare: false`.** Latest is `0.45.2` published 2026-03-27 [VERIFIED: npm view drizzle-orm@0.45.2]. Phase 1 sets the `prepare: false` posture even though pooler is Phase 6.
- **No Prisma. No CRA. No client-side LLM calls. No `middleware.ts` / `revalidateTag(tag)` deprecated forms.** Phase 1 has no app code yet so most of these don't apply, but the ESLint config baseline ships with these guards forward-looking.
- **Tenant filtering at the database, never the application.** This is the entire phase mandate.
- **No client-side secrets.** Phase 1's t3-env contract has a server-only schema; Phase 6 will reuse it for the app.
- **Pure-TS evaluation engine at `lib/eval/`** is Phase 4 — not Phase 1, but the directory layout convention `lib/<concern>/` carries through. Phase 1 establishes `lib/tenant/` and `lib/env.ts`.
- **GSD Workflow Enforcement** — file edits must go through GSD commands.
- **GitNexus index is stale** (legacy React prototype). Phase 1's first commit will trigger a full re-index when convenient — not blocking the phase.
- **pnpm package manager.** The current `package.json` uses `react-scripts`; Phase 1 will replace it. Plan deletes `src/App.js` (or moves it under a `legacy/` directory the rest of the build ignores) when the new `package.json` lands. CONTEXT.md is silent on this; flag for the planner.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TNT-01 | `FORCE ROW LEVEL SECURITY` on every tenant-scoped table; even table owners subject to policy | Postgres RLS section + Pitfall 2 (FORCE not in Drizzle schema API; raw-SQL custom migration covers it) |
| TNT-02 | Read `tenant_id` from JWT app_metadata via `current_setting('app.tenant_id')` at every request boundary; service-role connections never bypass RLS for application traffic | `setTenantContext` pattern + Pattern 3 (GUC name + missing-ok variant); Pattern 5 (service-role boundary) |
| TNT-03 | Index `tenant_id` on every tenant-scoped table | Drizzle `index('idx_name').on(table.tenant_id)` in schema; pen test asserts `EXPLAIN` chooses index scan |
| TNT-04 | CI pen-test suite at `tests/rls/` blocks merge on any cross-tenant query that succeeds | Vitest harness section + GitHub Actions service-container CI section |
| TNT-05 | Zero cross-tenant data egress paths | Self-filtering RLS on `tenant` (D-05) + Pattern 4 (no admin "view as another tenant" surface to scope-check at Phase 1) |
| TNT-06 | No aggregate competitive-analytics surface (antitrust posture) | Out-of-scope architectural commitment from PROJECT.md / PITFALLS 3.1 — Phase 1 documents the constraint; nothing to build to satisfy it |
| CFG-02 | Postgres 16+ via Supabase with Drizzle 0.45; `prepare: false` for Supabase pooler | Pattern 1 (Drizzle 0.45 + postgres-js client config); Pitfall 5 (pen-test pg client vs Drizzle postgres-js client reconciliation) |
| CFG-05 | Vercel encrypted env + t3-env runtime validation; no plaintext secrets in source | Pattern 6 (t3-env at `lib/env.ts`, server-only schema, fail-closed boot) |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.7.3 | Single language across schema + tests + helpers | CLAUDE.md locks 5.7. Latest 5.7.x as of 2026-04-29 [VERIFIED: npm view typescript@~5.7]. |
| Drizzle ORM | 0.45.2 | Schema-as-code; migrations; eventual app DB layer | CLAUDE.md locks 0.45. `pgTable` + `pgPolicy` + `enableRLS()` ship in 0.45 [VERIFIED: orm.drizzle.team/docs/rls]. Latest 0.45.x is 0.45.2, published 2026-03-27 [VERIFIED: npm view drizzle-orm@0.45.2]. |
| drizzle-kit | 0.31.10 | Migration generator + `--custom` for raw SQL | Latest stable [VERIFIED: npm view drizzle-kit]. RLS policies emit correctly via `drizzle-kit generate` (NOT `push` — see Pitfall 1). |
| postgres-js (`postgres`) | 3.4.9 | Drizzle's recommended pg driver for the future app path | Latest [VERIFIED: npm view postgres]. Set `prepare: false` for Supabase pooler compatibility in Phase 6. Phase 1 still uses this pin to lock the version Phase 6 inherits. |
| node-postgres (`pg`) | 8.20.0 | Pen-test direct DB driver (per D-01) | Latest [VERIFIED: npm view pg]. Used in `tests/rls/` only — independent connection lifecycle from the Drizzle path so pen tests have full control over BEGIN/ROLLBACK + GUC. |
| Vitest | 4.1.5 | Test runner | Latest stable [VERIFIED: npm view vitest]. Use `pool: 'forks'` (default) for process isolation between test files. |
| jose | 6.2.3 | Mint + verify + forge JWTs in pen tests | Latest [VERIFIED: npm view jose]. Phase 1 mints HS256 fixture JWTs with a test secret; Phase 6 will switch to verifying RS256 from Supabase. |
| Zod | 4.4.1 | t3-env runtime schema | Latest [VERIFIED: npm view zod]. CLAUDE.md locks Zod 4. Confirmed stable as of 2026-04. |
| @t3-oss/env-core | 0.13.11 | Boot-time env-var validation | Latest [VERIFIED: npm view @t3-oss/env-core]. `env-core` (not `env-nextjs`) is correct for Phase 1 since there's no Next.js yet. Phase 6 swaps to `@t3-oss/env-nextjs` re-using the same Zod schemas. |
| dotenv | 17.4.2 | Load `.env.local` for local dev + Vitest | Latest [VERIFIED: npm view dotenv]. Vitest reads via `dotenv/config` import in the setup file. |
| tsx | 4.21.0 | Run TS scripts (drizzle config, migration runner) | Latest [VERIFIED: npm view tsx]. drizzle-kit reads `drizzle.config.ts` via tsx-style execution. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ESLint | 10.2.1 (flat config) | Block `SUPABASE_SERVICE_ROLE_KEY` imports from app paths | Latest stable [VERIFIED: npm view eslint]. Use `no-restricted-imports` rule with patterns blocking the env access from `app/` paths (forward-looking — no app code in Phase 1, but rule ships now). |
| pnpm | latest | Package manager | CLAUDE.md locks pnpm. Adopt before installing any new deps. Existing repo uses npm via `react-scripts` (legacy prototype) — Phase 1 replaces `package.json`. |

**Phase 1 has NO Next.js, NO React 19, NO @anthropic-ai/sdk, NO Inngest, NO shadcn/ui, NO Sentry/Axiom.** All of those are Phase 6+. Including them in Phase 1's dependency set is scope creep.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| node-postgres in pen tests | postgres-js (same as app driver) | postgres-js is template-tagged-SQL-first; node-postgres has a more explicit `client.query(text, values)` API that's easier to read in pen tests. CONTEXT.md D-01 already locks pg. Verdict: keep pg. |
| Vitest | Jest, Mocha | Vitest is faster, native ESM, native TS — and CLAUDE.md (the broader stack) is moving the project to Vitest as the standard. Verdict: Vitest. |
| jose | jsonwebtoken | jose is modern (ESM, Web Crypto), zero deps, supports both HS256 and RS256 cleanly. CONTEXT.md D-01 locks jose. Verdict: jose. |
| `@t3-oss/env-core` | Hand-rolled `process.env` validation with Zod | env-core handles the "server vs client" split that Phase 6 will need; using it from Phase 1 means Phase 6 doesn't migrate. Verdict: env-core. |
| docker-compose | Raw `docker run` | docker-compose gives a `docker-compose.yml` checked into git that documents the local-dev contract. Single command (`docker compose up -d`) for new contributors. Verdict: docker-compose, even though CONTEXT.md leaves to discretion. |

**Installation:**
```bash
# Replace the existing react-scripts package.json with a TS project
pnpm init

# Core
pnpm add drizzle-orm@0.45.2 postgres@3.4.9 pg@8.20.0
pnpm add zod@4.4.1 @t3-oss/env-core@0.13.11 dotenv@17.4.2

# Dev
pnpm add -D typescript@5.7.3 @types/node @types/pg
pnpm add -D drizzle-kit@0.31.10 tsx@4.21.0
pnpm add -D vitest@4.1.5 jose@6.2.3
pnpm add -D eslint@10.2.1 typescript-eslint@latest
```

**Version verification:** All versions checked against npm registry on 2026-04-29 [VERIFIED: npm view <pkg>]. Pin all to exact versions in `package.json` (no `^` or `~`) so CI is reproducible.

## Architecture Patterns

### Recommended Project Structure

```
lender-search/
├── db/
│   ├── schema/
│   │   ├── tenant.ts          # tenant table + tenant_kind enum
│   │   ├── canary.ts          # _rls_canary table
│   │   └── index.ts           # re-exports
│   └── migrations/
│       ├── 0000_initial.sql            # drizzle-kit generate output (tables + indexes + policies)
│       └── 0001_force_rls_canary.sql   # drizzle-kit generate --custom (FORCE ROW LEVEL SECURITY)
├── lib/
│   ├── env.ts                 # t3-env Zod schema, server-only
│   └── tenant/
│       └── context.ts         # setTenantContext(tx, tenantId)
├── tests/
│   └── rls/
│       ├── setup.ts                    # dotenv + DB connection helper
│       ├── fixtures/
│       │   ├── jwt.ts                  # mintJWT, forgeJWT helpers
│       │   └── tenants.ts              # seedTwoTenants helper
│       ├── cross-tenant-select.test.ts
│       ├── cross-tenant-write.test.ts
│       ├── jwt-tampering.test.ts
│       ├── service-role-boundary.test.ts
│       ├── guc-reset.test.ts
│       └── index-scan.test.ts          # EXPLAIN assertion
├── docker-compose.yml         # postgres:16 service for local dev
├── drizzle.config.ts
├── eslint.config.js
├── tsconfig.json
├── vitest.config.ts
└── .env.local.example         # commit example; .env.local is gitignored
```

**Layout rationale:**
- `db/schema/` is the schema source of truth in TS; `db/migrations/` is the SQL output. drizzle-kit owns the latter.
- `lib/tenant/context.ts` is the single canonical reference to the GUC name `app.tenant_id`. Any other reference is a smell.
- `lib/env.ts` is the boot guard.
- `tests/rls/` is the pen-test home; never put pen-test fixtures elsewhere.
- One file per pen-test category for clarity. The harness is ~6 files for the D-03 coverage matrix.

### Pattern 1: Drizzle 0.45 RLS Schema Declaration

Drizzle 0.45 supports policies as a parameter to `pgTable`, with `enableRLS()` chained on the table builder when no policies are present.

```typescript
// db/schema/tenant.ts
import { pgEnum, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const tenantKind = pgEnum('tenant_kind', ['BROKERAGE', 'RETAIL_LENDER', 'WHOLESALE_LENDER', 'SYSTEM']);

export const tenant = pgTable('tenant', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: tenantKind('kind').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  // Self-filtering policy per D-05: a row is visible only when its id matches the GUC.
  // current_setting(..., true) returns NULL when GUC unset → no rows visible.
  pgPolicy('tenant_self_filter', {
    as: 'permissive',
    for: 'all',
    to: 'public',
    using: sql`${t.id} = current_setting('app.tenant_id', true)::uuid`,
    withCheck: sql`${t.id} = current_setting('app.tenant_id', true)::uuid`,
  }),
]);
```

```typescript
// db/schema/canary.ts
import { index, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenant } from './tenant';

export const rlsCanary = pgTable('_rls_canary', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  payload: text('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  // TNT-03: tenant_id indexed
  index('rls_canary_tenant_idx').on(t.tenantId),
  pgPolicy('canary_tenant_isolation', {
    as: 'permissive',
    for: 'all',
    to: 'public',
    using: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
    withCheck: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
  }),
]);
```

[VERIFIED: orm.drizzle.team/docs/rls — pgPolicy syntax with `as`/`for`/`to`/`using`/`withCheck` and policy as `pgTable` parameter]

**Adding a policy automatically enables RLS** [VERIFIED: orm.drizzle.team/docs/rls] — no separate `.enableRLS()` call needed when policies are present. Drizzle emits `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` plus the `CREATE POLICY` DDL in the generated migration.

### Pattern 2: Appending FORCE ROW LEVEL SECURITY via Custom Migration

Drizzle 0.45's schema API does **not** model `FORCE ROW LEVEL SECURITY` (the schema API enables RLS but does not force it on table owners) [CITED: orm.drizzle.team/docs/rls — searched for FORCE syntax, not present in policy options]. TNT-01 requires FORCE.

The canonical pattern is `drizzle-kit generate --custom` to create an empty migration file, then hand-write the FORCE ALTER statements:

```bash
pnpm drizzle-kit generate --name=initial          # outputs 0000_initial.sql with tables + RLS + policies
pnpm drizzle-kit generate --custom --name=force_rls  # outputs 0001_force_rls.sql empty
```

```sql
-- db/migrations/0001_force_rls.sql
ALTER TABLE "tenant" FORCE ROW LEVEL SECURITY;
ALTER TABLE "_rls_canary" FORCE ROW LEVEL SECURITY;
```

[VERIFIED: orm.drizzle.team/docs/kit-custom-migrations — `--custom` flag generates empty migration file for raw SQL DDL not supported by drizzle-kit]

**Why two migrations and not one:** drizzle-kit re-generates `0000_initial.sql` if you re-run `generate`. If you hand-edit `0000_initial.sql` to add the FORCE clauses, the next `generate` run silently overwrites them. Keeping FORCE in a separate `--custom` migration means it's append-only and survives schema regeneration. **This is the load-bearing safety property of the file layout.**

CI runs `pnpm drizzle-kit migrate` which applies all migration files in order [VERIFIED: orm.drizzle.team/docs/drizzle-kit-migrate].

### Pattern 3: setTenantContext Helper + GUC Semantics

```typescript
// lib/tenant/context.ts
import { sql } from 'drizzle-orm';
import type { PgDatabase, PgTransaction } from 'drizzle-orm/pg-core';

/**
 * Set the per-transaction tenant context for RLS.
 *
 * The third arg (is_local=true) scopes the GUC to the current transaction,
 * so it is automatically reset on COMMIT or ROLLBACK. No manual cleanup.
 *
 * MUST be called inside a transaction. Calling it on a top-level connection
 * with is_local=true is a no-op (Postgres warning, no error).
 *
 * Single source of truth for the GUC name 'app.tenant_id'. Grep for any
 * other reference to that string in the codebase — it's a smell.
 */
export async function setTenantContext(
  tx: PgTransaction<any, any, any> | PgDatabase<any, any, any>,
  tenantId: string,
): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
}
```

**GUC semantics, verified:**
- Custom GUC names with a dot (e.g., `app.tenant_id`) are **placeholder GUCs** in Postgres 16. The server accepts `set_config()` calls on any two-part name without pre-declaration. Quote: "PostgreSQL will accept a setting for any two-part parameter name. Such variables are treated as placeholders and have no function until the module that defines them is loaded." [VERIFIED: postgresql.org/docs/16/runtime-config-custom.html]
- `is_local=true` scopes the change to the current transaction; `is_local=false` (or `SET` without `LOCAL`) persists for the session [VERIFIED: postgresql.org/docs/16/config-setting.html — equivalent to `SET LOCAL`].
- `current_setting('app.tenant_id', true)` (missing-ok variant) returns **NULL** when the GUC is unset [VERIFIED: postgresql.org/docs/current/functions-admin.html]. The RLS policy `WHERE tenant_id = NULL::uuid` is always false → no rows visible. **This is the safe default and the reason the policy uses the missing-ok variant.**
- Without `is_local`, a leaked GUC from a previous request on a pooled connection would be a cross-tenant leak. With `is_local`, the GUC dies with the transaction. **`is_local=true` is non-negotiable.**

### Pattern 4: Vitest Pen-Test Harness

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',                        // process isolation per test file
    isolate: true,                        // each file gets a fresh process
    setupFiles: ['./tests/rls/setup.ts'],
    sequence: { concurrent: false },      // single test at a time within a file
    testTimeout: 10_000,
    hookTimeout: 10_000,
    include: ['tests/rls/**/*.test.ts'],
  },
});
```

`pool: 'forks'` is the Vitest 4.x default and gives child-process isolation between test files [VERIFIED: vitest.dev/config/pool]. Forks are slightly slower than threads but the isolation matters for tests that touch a real database.

```typescript
// tests/rls/setup.ts
import 'dotenv/config';
import { Pool } from 'pg';
import { afterAll, beforeAll } from 'vitest';
import { env } from '../../lib/env';

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool;
}

beforeAll(async () => {
  globalThis.__pgPool = new Pool({ connectionString: env.DATABASE_URL });
  // Sanity check: our tests should NEVER run as a BYPASSRLS role.
  const { rows } = await globalThis.__pgPool.query(
    `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`
  );
  if (rows[0]?.rolbypassrls) {
    throw new Error(`Pen tests connected as a BYPASSRLS role. Aborting.`);
  }
});

afterAll(async () => {
  await globalThis.__pgPool.end();
});
```

The BYPASSRLS sanity check is a defense-in-depth: even if `.env.local` is misconfigured to point at a superuser connection string, the pen tests refuse to run because policies would be silently bypassed.

```typescript
// tests/rls/fixtures/jwt.ts
import { SignJWT } from 'jose';

const secret = new TextEncoder().encode(process.env.RLS_TEST_JWT_SECRET ?? 'phase-1-fixture-secret');

export async function mintJWT(claims: { tenantId: string; userId?: string }): Promise<string> {
  return new SignJWT({
    sub: claims.userId ?? 'fixture-user',
    app_metadata: { tenant_id: claims.tenantId },
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(secret);
}

export async function forgeJWT(claims: { tenantId: string; tamperedTenantId: string }): Promise<string> {
  // Forge a JWT that claims a DIFFERENT tenant than the user belongs to.
  // At Phase 1 there is no user table — this is a structural fixture.
  return mintJWT({ tenantId: claims.tamperedTenantId });
}
```

```typescript
// tests/rls/fixtures/tenants.ts
import { Pool } from 'pg';

export interface SeedResult {
  tenantA: string;  // uuid
  tenantB: string;
  canaryA: string;  // uuid of A's canary row
  canaryB: string;
}

export async function seedTwoTenants(pool: Pool): Promise<SeedResult> {
  // Run as the migration role (BYPASSRLS in CI's case via service role).
  // In Phase 1's plain-Postgres setup, the test user IS the table owner,
  // so we use FORCE RLS in the migration but explicitly skip it for seeding
  // by setting the GUC to a placeholder UUID then deleting it.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Bypass: temporarily disable RLS for seeding by acquiring elevated session
    // Alternative: seed via a dedicated service role with BYPASSRLS at CI level
    const a = await client.query(`INSERT INTO tenant(kind, name) VALUES ('BROKERAGE', 'A') RETURNING id`);
    const b = await client.query(`INSERT INTO tenant(kind, name) VALUES ('BROKERAGE', 'B') RETURNING id`);
    const ca = await client.query(
      `INSERT INTO _rls_canary(tenant_id, payload) VALUES ($1, 'A-payload') RETURNING id`,
      [a.rows[0].id],
    );
    const cb = await client.query(
      `INSERT INTO _rls_canary(tenant_id, payload) VALUES ($1, 'B-payload') RETURNING id`,
      [b.rows[0].id],
    );
    await client.query('COMMIT');
    return { tenantA: a.rows[0].id, tenantB: b.rows[0].id, canaryA: ca.rows[0].id, canaryB: cb.rows[0].id };
  } finally {
    client.release();
  }
}
```

⚠️ **The seeding path needs a BYPASSRLS or owner-with-RLS-disabled role.** With `FORCE ROW LEVEL SECURITY` enabled, even the table owner cannot insert rows that wouldn't pass the policy unless the GUC is set. The pragmatic Phase 1 pattern: seed via a service role that has `BYPASSRLS`, OR set the GUC to the target tenant before each insert. The latter is more uniform; choose it. **Updated seed pattern:**

```typescript
export async function seedTwoTenants(pool: Pool): Promise<SeedResult> {
  const client = await pool.connect();
  try {
    // Tenant A
    await client.query('BEGIN');
    // GUC must be set BEFORE the INSERT so the WITH CHECK clause passes.
    // For the very first insert into tenant (which has no parent row yet),
    // the self-filtering policy is fine because the new row's id == the GUC.
    // We'll generate the UUID client-side and use it for both the GUC and the row.
    const idA = (await client.query(`SELECT gen_random_uuid()::text AS id`)).rows[0].id;
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [idA]);
    await client.query(`INSERT INTO tenant(id, kind, name) VALUES ($1, 'BROKERAGE', 'A')`, [idA]);
    const ca = await client.query(
      `INSERT INTO _rls_canary(tenant_id, payload) VALUES ($1, 'A-payload') RETURNING id`,
      [idA],
    );
    await client.query('COMMIT');

    // Tenant B (separate transaction so the GUC resets)
    await client.query('BEGIN');
    const idB = (await client.query(`SELECT gen_random_uuid()::text AS id`)).rows[0].id;
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [idB]);
    await client.query(`INSERT INTO tenant(id, kind, name) VALUES ($1, 'BROKERAGE', 'B')`, [idB]);
    const cb = await client.query(
      `INSERT INTO _rls_canary(tenant_id, payload) VALUES ($1, 'B-payload') RETURNING id`,
      [idB],
    );
    await client.query('COMMIT');

    return { tenantA: idA, tenantB: idB, canaryA: ca.rows[0].id, canaryB: cb.rows[0].id };
  } finally {
    client.release();
  }
}
```

This is itself a design proof-point — **even seed code must respect RLS**. The "create tenant A as tenant A" pattern is self-consistent because the self-filtering policy `using id = current_setting(...)` is satisfied when the new row's id matches the GUC. [ASSUMED: confirmed by reasoning, not by an external citation — flag for the planner to validate with a smoke test.]

```typescript
// tests/rls/cross-tenant-select.test.ts
import { describe, expect, it } from 'vitest';
import { seedTwoTenants } from './fixtures/tenants';

describe('RLS: cross-tenant SELECT', () => {
  it('returns zero rows when GUC is set to Tenant A and query targets Tenant B', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool);
    const client = await globalThis.__pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [seed.tenantA]);

      // Query targets Tenant B's canary row by id directly.
      const { rows } = await client.query(
        `SELECT id FROM _rls_canary WHERE id = $1`,
        [seed.canaryB],
      );

      expect(rows).toHaveLength(0);  // RLS hides Tenant B's row from Tenant A's GUC
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('returns zero rows when GUC is unset (missing-ok policy returns NULL)', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool);
    const client = await globalThis.__pgPool.connect();
    try {
      await client.query('BEGIN');
      // Do NOT set the GUC. current_setting(..., true) returns NULL.
      const { rows } = await client.query(`SELECT id FROM _rls_canary`);
      expect(rows).toHaveLength(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
```

**The whole pen-test suite follows this pattern:**
1. Seed two tenants via `seedTwoTenants`.
2. Open a transaction.
3. Set the GUC (or don't).
4. Run the query under test.
5. Assert zero rows for cross-tenant cases; or assert the expected row count for in-tenant cases.
6. ROLLBACK.

The full coverage matrix per D-03:

| Test file | What it asserts |
|-----------|-----------------|
| `cross-tenant-select.test.ts` | A's GUC + B's row → 0 rows; unset GUC → 0 rows |
| `cross-tenant-write.test.ts` | INSERT with `tenant_id = B` while GUC = A → fails WITH CHECK; UPDATE/DELETE on B's row → 0 rows affected |
| `jwt-tampering.test.ts` | Forged JWT with foreign tenant → setTenantContext sets the foreign GUC → all queries return 0 rows (no other path leaks) |
| `service-role-boundary.test.ts` | Importing `process.env.SUPABASE_SERVICE_ROLE_KEY` from app paths is forbidden (ESLint test); pen test asserts the env is undefined when imported via the request-scoped module graph |
| `guc-reset.test.ts` | After ROLLBACK in test N, test N+1's GUC starts NULL (asserts `current_setting('app.tenant_id', true) IS NULL`) |
| `index-scan.test.ts` | `EXPLAIN SELECT ... WHERE tenant_id = $1` chooses index scan, not seq scan, on `_rls_canary` (TNT-03 verification) |

[VERIFIED: simplyblock.io/blog/underated-postgres-multi-tenancy-with-row-level-security/ — RLS + SET LOCAL transaction-scoped tenant context pattern; codepunkt.de/writing/blazing-fast-prisma-and-postgres-tests-in-vitest/ — transactional rollback per test pattern]

### Pattern 5: Service-Role Boundary

The Supabase `service_role` key bypasses RLS [CITED: supabase.com/docs/guides/database/postgres/row-level-security]. Phase 1's defense is **env-var segregation** + **ESLint rule** (D-02), with the actual database-level `BYPASSRLS` role pattern deferred (per Deferred Ideas).

```javascript
// eslint.config.js (flat config)
import tseslint from 'typescript-eslint';

export default tseslint.config({
  files: ['app/**/*.ts', 'app/**/*.tsx', 'lib/**/*.ts', 'src/**/*.ts'],
  ignores: ['lib/env.ts', 'db/migrations/**', 'tests/**', 'scripts/**'],
  rules: {
    'no-restricted-properties': ['error', {
      object: 'process',
      property: 'env',
      message: 'Read env vars from `lib/env.ts` (t3-env) only. Direct `process.env` access in app paths is forbidden — it bypasses runtime validation.',
    }],
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['**/service-role*', '**/admin-db*'],
        message: 'service_role / admin DB clients must not be imported from app paths. Only migration scripts and CI tools may use them.',
      }],
    }],
  },
});
```

[VERIFIED: eslint.org/docs/latest/rules/no-restricted-imports — `patterns.group` syntax for gitignore-style import blocking in flat config]

The ESLint rule is **forward-looking** in Phase 1: there's no app code to lint yet. The reason to ship the rule now is that it ships baked into `eslint.config.js` and is not someone's "remember to add it" todo when Phase 6 lands. The pen test `service-role-boundary.test.ts` asserts `process.env.SUPABASE_SERVICE_ROLE_KEY` is `undefined` when running through the test runner with the standard `.env.local` (which only sets `DATABASE_URL` and the test JWT secret).

A second, stronger defense — a dedicated Postgres role with `NO BYPASSRLS` — is in Deferred Ideas. Phase 1 does **not** ship it because:
1. There's no real service-role connection yet (Phase 6 wires Supabase Auth).
2. The plain-Postgres-Docker dev setup uses the default `postgres` user which is a superuser (BYPASSRLS implicit). The pen-test connection uses a non-superuser app role provisioned by an init script (see Pattern 7 below).

### Pattern 6: t3-env Configuration

```typescript
// lib/env.ts
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url().refine(
      (s) => s.startsWith('postgresql://') || s.startsWith('postgres://'),
      'DATABASE_URL must be a Postgres connection string',
    ),
    // Phase 1: only required in CI/migration runner contexts.
    // Use z.string().optional() at Phase 1; tighten to required at Phase 6.
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    // Pen-test JWT secret. Required only when running tests/rls.
    RLS_TEST_JWT_SECRET: z.string().min(16).optional(),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  },
  // No client-side env at Phase 1.
  client: {},
  runtimeEnv: process.env,
  // Boot fails closed if a required server var is missing or malformed.
  emptyStringAsUndefined: true,
});
```

[VERIFIED: env.t3.gg/docs/core — createEnv API for env-core; runtimeEnv pattern for Node-only environments]

**Why `optional()` for `SUPABASE_SERVICE_ROLE_KEY` at Phase 1:**
- Phase 1 has no real Supabase connection.
- Forcing the env var at Phase 1 means every dev needs a Supabase project, which contradicts D-07 (plain Docker Postgres).
- Phase 6 changes the schema to `z.string().min(20)` for the production env path.

The boot-fail-closed pattern is automatic: `createEnv` throws synchronously on import if any `server` schema check fails. Importing `env` from `lib/env.ts` is the application's first I/O — if it fails, the process exits before any DB connection.

### Pattern 7: Postgres 16 Local Dev + CI

**Local dev (`docker-compose.yml`):**

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    container_name: lender-search-pg
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: lender_search_dev
    ports:
      - "5432:5432"
    volumes:
      - lender-search-pg-data:/var/lib/postgresql/data
      - ./scripts/init-db.sh:/docker-entrypoint-initdb.d/init-db.sh:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  lender-search-pg-data:
```

```bash
# scripts/init-db.sh — runs once on first container boot
#!/usr/bin/env bash
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  -- Phase 1 uses gen_random_uuid() which is built into Postgres 13+.
  -- pgcrypto extension is NOT required.
  CREATE ROLE app_user LOGIN PASSWORD 'app_user_password' NOBYPASSRLS;
  GRANT CONNECT ON DATABASE lender_search_dev TO app_user;
  GRANT USAGE ON SCHEMA public TO app_user;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
EOSQL
```

[VERIFIED: postgresql.org/docs/13+/functions-uuid.html — gen_random_uuid() in core since v13; pgcrypto wrapper deprecated]

**Why a separate `app_user` role with `NOBYPASSRLS`:**
- The default `postgres` superuser bypasses RLS silently.
- Pen tests connect as `app_user` so `FORCE ROW LEVEL SECURITY` is meaningful.
- `setup.ts` BYPASSRLS sanity check confirms the connection role.

`.env.local`:
```
DATABASE_URL=postgresql://app_user:app_user_password@localhost:5432/lender_search_dev
RLS_TEST_JWT_SECRET=local-dev-fixture-secret-change-me
```

`.env.local` is gitignored; `.env.local.example` is committed.

**CI (`.github/workflows/test.yml`):**

```yaml
name: Tests
on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  rls-pen-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: lender_search_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
    env:
      DATABASE_URL: postgresql://app_user:app_user_password@localhost:5432/lender_search_test
      RLS_TEST_JWT_SECRET: ci-fixture-jwt-secret-do-not-reuse
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Provision app_user role
        run: |
          PGPASSWORD=postgres psql -h localhost -U postgres -d lender_search_test -c \
            "CREATE ROLE app_user LOGIN PASSWORD 'app_user_password' NOBYPASSRLS;
             GRANT CONNECT ON DATABASE lender_search_test TO app_user;
             GRANT USAGE ON SCHEMA public TO app_user;"
      - name: Apply migrations
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/lender_search_test
        run: pnpm drizzle-kit migrate
      - name: Grant DML privileges to app_user (post-migration)
        run: |
          PGPASSWORD=postgres psql -h localhost -U postgres -d lender_search_test -c \
            "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
             GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;"
      - name: Run RLS pen tests
        run: pnpm test:rls
```

[VERIFIED: docs.github.com/en/actions/using-containerized-services/creating-postgresql-service-containers — services.postgres.image and health-check pattern]

**Why migrations apply as `postgres` (superuser) but tests run as `app_user`:**
- Migrations need to `CREATE TABLE`, `ALTER TABLE ... FORCE ROW LEVEL SECURITY`, etc. Those are owner operations.
- Tests need to be subject to RLS. `app_user` with `NOBYPASSRLS` is subject.
- `FORCE ROW LEVEL SECURITY` ensures even the table owner (`postgres` here) is subject to policies. So even if a test accidentally used the `postgres` connection, RLS would still apply.

`package.json` scripts:
```json
{
  "scripts": {
    "db:up": "docker compose up -d postgres",
    "db:down": "docker compose down",
    "db:migrate": "drizzle-kit migrate",
    "db:generate": "drizzle-kit generate",
    "test:rls": "vitest run --config vitest.config.ts"
  }
}
```

### Anti-Patterns to Avoid

- **Hand-editing the drizzle-kit-generated `0000_initial.sql` to add FORCE ROW LEVEL SECURITY.** drizzle-kit may regenerate it. Use a separate `--custom` migration (Pattern 2).
- **Using `drizzle-kit push` instead of `migrate`.** Issue #3504 confirms `push` does NOT apply RLS policies, while `migrate` does [VERIFIED: github.com/drizzle-team/drizzle-orm/issues/3504].
- **Setting the GUC with `is_local=false` (or with `SET` instead of `SET LOCAL` / `set_config(..., true)`).** A leaked GUC on a pooled connection is a cross-tenant leak. Always use `is_local=true`.
- **Connecting pen tests as the `postgres` superuser.** Superusers bypass RLS silently. Use a `NOBYPASSRLS` role; assert this in `setup.ts`.
- **Hand-rolling JWT in pen tests.** Use `jose` — the spec's HS256 is a 4-line call.
- **Putting RLS policies in a separate "policies.sql" file outside drizzle-kit's migration flow.** Drift between schema-as-code and live DB becomes invisible. Schema-as-code via Drizzle 0.45's `pgPolicy` is the load-bearing decision.
- **Letting the seed step run as a BYPASSRLS role.** Seed code that bypasses policy is seed code that doesn't prove the policy works. Force seed code through the same `set_config` path the runtime uses.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| RLS schema declaration | Hand-write `CREATE POLICY` SQL alongside Drizzle TS schema | Drizzle 0.45's `pgPolicy()` schema parameter | Drift between TS schema and DB DDL is silent. Pin to one source of truth. |
| RLS policy migrations | drizzle-kit push | drizzle-kit generate + migrate | Issue #3504: push does not apply RLS DDL. |
| FORCE ROW LEVEL SECURITY | Add to the same generated migration drizzle-kit owns | Separate `--custom` migration file | Drizzle regenerates the auto-migration; hand-edits get lost. |
| JWT mint in tests | Crafting `header.payload.signature` strings manually | `jose.SignJWT` | jose is 4 lines for HS256, has Web Crypto support, used by the wider Node ecosystem. |
| Per-test transactional rollback | Reset script that TRUNCATE's between tests | BEGIN/work/ROLLBACK pattern | TRUNCATE is slow and breaks foreign keys. Transaction rollback is instantaneous. |
| GUC reset between tests | Manual `SELECT set_config('app.tenant_id', NULL, false)` | `is_local=true` + transaction rollback | GUC dies with the transaction. No manual cleanup. |
| Postgres 16 in CI | Spin up a Docker container manually in a step | GitHub Actions `services:` block | Service containers are managed by Actions runner; health-checks built in. |
| Env-var validation | Throw on first `process.env.X` access | t3-env with Zod schema at boot | Boot-fail-closed catches missing config before the first DB connection. |
| ESLint flat config | Custom rule to detect SUPABASE_SERVICE_ROLE_KEY usage | `no-restricted-imports` + `no-restricted-properties` | Built-in rules cover the pattern. Custom rules are defer-able. |

**Key insight:** Phase 1's value is the discipline of "the database enforces this, not the application." Every "hand-rolled" alternative above is application-layer enforcement. Reject all of them.

## Common Pitfalls

### Pitfall 1: drizzle-kit push silently skips RLS policies

**What goes wrong:** Developer runs `drizzle-kit push` to sync schema during dev; sees "Changes applied"; assumes RLS is on. It is not. The pen-test suite catches it eventually, but locally the dev was running without isolation for hours.

**Why it happens:** Issue #3504 in drizzle-orm — push and migrate take divergent code paths through the snapshot generator. Push handles tables/columns/indexes but skips policy DDL [VERIFIED: github.com/drizzle-team/drizzle-orm/issues/3504].

**How to avoid:** **Never use `drizzle-kit push` in this codebase.** Lock it down via:
1. `package.json` has only `db:migrate`, no `db:push` script.
2. `drizzle.config.ts` does not contain push-specific config.
3. `CONTRIBUTING.md` (or `AGENTS.md`) calls out push as forbidden.
4. Pen-test suite's `setup.ts` queries `pg_policies` to assert the expected policies exist; fails the entire suite if they don't.

**Warning signs:**
- `pg_policies` view returns fewer rows than the schema declares.
- Pen tests pass for the wrong reason (e.g., GUC behavior happens to filter even without policies).
- Cross-tenant SELECT returns rows but the dev "swears RLS is on."

### Pitfall 2: FORCE ROW LEVEL SECURITY missing on table owner

**What goes wrong:** RLS is enabled. Policies are defined. But `FORCE` is not set, so the table owner (the migration role, often `postgres` superuser) is not subject to policies. Pen tests passing as a non-owner doesn't catch this. Then an admin script or scheduled job runs as the owner and exfiltrates cross-tenant data.

**Why it happens:** Drizzle 0.45's schema API does not model FORCE. The dev assumes "ENABLE means it's on." It's not — the table owner is exempt by default.

**How to avoid:**
1. Pattern 2 above: separate `--custom` migration with `ALTER TABLE ... FORCE ROW LEVEL SECURITY`.
2. Pen test `force-rls.test.ts` queries `pg_class.relforcerowsecurity` and asserts `true` for every tenant-scoped table.
3. CI lints the schema migrations on every PR for the FORCE clause.

**Warning signs:**
- `SELECT relname, relforcerowsecurity FROM pg_class WHERE relname IN ('tenant', '_rls_canary')` returns `f` for any row.
- A test running as the table owner sees rows from foreign tenants.

### Pitfall 3: GUC leaks across pooled connections (is_local=false footgun)

**What goes wrong:** A request handler calls `set_config('app.tenant_id', '<A>', false)`. The connection is returned to the pool. The next request gets the same connection, doesn't call `set_config`, and queries with Tenant A's GUC still active. Cross-tenant leak.

**Why it happens:** `is_local=false` (the default for `SET` without `LOCAL`) persists for the session, not the transaction. Pooled connections live across many transactions.

**How to avoid:**
1. `setTenantContext()` always passes `is_local=true` (Pattern 3). Hard-coded.
2. Pen test `guc-reset.test.ts` asserts that after a transaction rolls back, `current_setting('app.tenant_id', true)` returns NULL on the same connection.
3. Code review: any direct `set_config` call outside `lib/tenant/context.ts` is a smell.

**Warning signs:**
- Test N's tenant context bleeding into test N+1.
- Production logs showing multiple tenants' rows in a single response.

### Pitfall 4: Pen tests connect as a BYPASSRLS role

**What goes wrong:** `.env.local` points at `postgresql://postgres:...` (the superuser). Postgres superusers bypass RLS silently. Pen tests pass because no policy is consulted; they think they're testing isolation but they're not.

**Why it happens:** Default Postgres Docker setup grants `postgres` superuser. Devs reuse the connection string for everything.

**How to avoid:**
1. Provision a `NOBYPASSRLS` `app_user` role in the dev container init script and CI step.
2. `setup.ts` queries `pg_roles.rolbypassrls` and aborts the test run if the connection is bypassing.
3. CI uses `app_user` connection string; never `postgres`.

**Warning signs:**
- Pen tests pass on day 1 with a BYPASSRLS connection. (They will — vacuously.)
- `setup.ts` BYPASSRLS check throws.

### Pitfall 5: Two database drivers (postgres-js vs pg) with different connection lifecycles

**What goes wrong:** App code uses `postgres` (postgres-js) via Drizzle. Pen tests use `pg` (node-postgres). The two have different connection-pool semantics — postgres-js opens connections lazily; pg's `Pool` is eager. A test that wraps `setTenantContext` in a transaction with the wrong driver may not actually scope the GUC.

**Why it happens:** Drizzle's recommended driver for Supabase is postgres-js with `prepare: false`. Pen tests use pg directly per CONTEXT.md D-01 because pg has more explicit transaction control.

**How to avoid:**
1. Phase 1 has NO Drizzle runtime app code yet — only schema and pen tests. The split between drivers is forward-looking.
2. `lib/tenant/context.ts::setTenantContext` is typed against Drizzle's `PgDatabase | PgTransaction` interface. Pen tests bypass this and call `set_config` directly via `pg`'s `client.query()` — they don't import `setTenantContext` from the lib. **This is intentional**: the pen test exercises the SQL contract, not the helper's TS abstraction.
3. Phase 6 will add a smoke test that exercises `setTenantContext` through the postgres-js Drizzle path against the real Supabase pooler.

**Warning signs:**
- Mixing `postgres` and `pg` clients in the same test file.
- A test expecting `setTenantContext` to work over pg's `client.query` (it won't — `setTenantContext` takes a Drizzle handle, not a pg client).

### Pitfall 6: Forgetting WITH CHECK on INSERT/UPDATE policies

**What goes wrong:** Policy has only `USING` clause. SELECT and DELETE filter correctly. But INSERT and UPDATE accept any `tenant_id` payload because WITH CHECK is unset. Cross-tenant INSERT succeeds.

**Why it happens:** WITH CHECK is a separate clause. Devs see USING and assume it covers writes too.

**How to avoid:**
1. Pattern 1: every policy declares both `using` and `withCheck` for `for: 'all'`.
2. Pen test `cross-tenant-write.test.ts` asserts that an INSERT with `tenant_id != GUC` fails.

**Warning signs:**
- INSERT succeeds with mismatched tenant_id.
- `pg_policies.with_check` is NULL for a policy.

### Pitfall 7: Self-filtering policy on `tenant` blocks the bootstrap

**What goes wrong:** `tenant` table has policy `using (id = current_setting('app.tenant_id', true)::uuid)`. New tenant creation requires the tenant's id to already match the GUC — which it can't, because the tenant doesn't exist yet.

**Why it happens:** Self-filtering is the simplest, most uniform RLS pattern, but it requires the GUC-then-INSERT pattern (Pattern 4 seed code) where the new tenant's UUID is generated before the INSERT and used for both the GUC and the row id.

**How to avoid:**
1. Tenant creation happens in a dedicated provisioning path (Phase 6: probably an admin API that runs as a BYPASSRLS service role).
2. At Phase 1, the seed function generates the UUID first, sets the GUC, then inserts. WITH CHECK passes because `id == GUC`.
3. Document the bootstrap pattern in `lib/tenant/context.ts` comments.

**Warning signs:**
- "How do I create a new tenant?" — answer must be in the docs.
- `INSERT INTO tenant ... RETURNING id` failing for non-bypass roles without a pre-set GUC.

### Pitfall 8: Antitrust posture — implicitly building cross-tenant features

**What goes wrong:** A future "industry overlay library" or "shared rules" feature shows tenant A's overlay to tenant B. Pitfall 3.5 in `.planning/research/PITFALLS.md` calls this out as antitrust-actionable post Smith v. Optimal Blue (Oct 2025).

**Why it happens:** Phase 1 ships only the canary table. Future phases add real domain tables. If RLS is treated as a "table-by-table judgment call," some table will eventually ship without policies.

**How to avoid:**
1. Phase 1 establishes the **architectural contract**: every tenant-scoped table has RLS + FORCE + index + pen test. Period.
2. Future phases extend `tests/rls/` with the same coverage matrix per new table.
3. CI lint: any new `pgTable` declaration without a `pgPolicy()` parameter or `enableRLS()` chain triggers a CI warning. (Stretch goal — write the lint in Phase 2 when there are real tables.)

## Runtime State Inventory

> Phase 1 is greenfield. There is no prior runtime state. This section is included for completeness so future rename/refactor phases can follow the pattern.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None — first commit of new architecture; legacy `src/App.js` is throwaway and uses localStorage only (browser-side, not server) | None |
| Live service config | None — no Supabase project, no Vercel project, no n8n, no Datadog yet | None |
| OS-registered state | None — no scheduled tasks, no daemons | None |
| Secrets/env vars | New `.env.local` with `DATABASE_URL` + `RLS_TEST_JWT_SECRET`; new GitHub Actions secrets contract for CI; no prior env contract | Document in `.env.local.example` |
| Build artifacts | Existing `node_modules/`, `build/`, `package-lock.json` from `react-scripts` legacy prototype — will be deleted when `package.json` is replaced | Clean delete during the planning step that swaps `package.json` |

**Nothing found in any category that blocks Phase 1.**

## Code Examples

### Drizzle config

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema/index.ts',
  out: './db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Drizzle 0.45+: explicitly opt into role management if we ever declare pgRole().
  // Phase 1 doesn't declare any custom roles, so leave default off.
  verbose: true,
  strict: true,
});
```

[VERIFIED: orm.drizzle.team/docs/drizzle-config-file]

### Schema index re-export

```typescript
// db/schema/index.ts
export * from './tenant';
export * from './canary';
```

### Generating the initial migration

```bash
pnpm db:up                                           # docker compose up -d postgres
pnpm drizzle-kit generate --name=initial             # → db/migrations/0000_initial.sql
pnpm drizzle-kit generate --custom --name=force_rls  # → db/migrations/0001_force_rls.sql (empty)
# hand-edit 0001_force_rls.sql to add ALTER TABLE ... FORCE ROW LEVEL SECURITY
pnpm drizzle-kit migrate                             # apply both migrations
```

After `0000_initial.sql` is generated, inspect it. It should contain:
- `CREATE TYPE tenant_kind AS ENUM (...)`
- `CREATE TABLE tenant (...)`
- `CREATE TABLE _rls_canary (...)`
- `CREATE INDEX rls_canary_tenant_idx ON _rls_canary(tenant_id)`
- `ALTER TABLE tenant ENABLE ROW LEVEL SECURITY`
- `CREATE POLICY tenant_self_filter ON tenant ...`
- `ALTER TABLE _rls_canary ENABLE ROW LEVEL SECURITY`
- `CREATE POLICY canary_tenant_isolation ON _rls_canary ...`

If any of these is missing, drizzle-kit may have regressed — investigate before merging.

`0001_force_rls.sql` (hand-written):
```sql
ALTER TABLE "tenant" FORCE ROW LEVEL SECURITY;
ALTER TABLE "_rls_canary" FORCE ROW LEVEL SECURITY;
```

### Vitest setup file

```typescript
// tests/rls/setup.ts (excerpt — full version above)
import 'dotenv/config';
import { Pool } from 'pg';
import { beforeAll, afterAll } from 'vitest';

beforeAll(async () => {
  globalThis.__pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
  });

  // Sanity: NOT a BYPASSRLS role
  const { rows } = await globalThis.__pgPool.query(
    `SELECT rolbypassrls, current_user AS role FROM pg_roles WHERE rolname = current_user`,
  );
  if (!rows[0]) throw new Error('Could not introspect connection role');
  if (rows[0].rolbypassrls) {
    throw new Error(`Connected as BYPASSRLS role '${rows[0].role}'. Pen tests would be vacuous. Aborting.`);
  }

  // Sanity: every tenant-scoped table has FORCE
  const { rows: forced } = await globalThis.__pgPool.query(
    `SELECT relname, relforcerowsecurity FROM pg_class WHERE relname IN ('tenant', '_rls_canary')`,
  );
  for (const t of forced) {
    if (!t.relforcerowsecurity) {
      throw new Error(`Table '${t.relname}' is not FORCE ROW LEVEL SECURITY. Migration may be incomplete.`);
    }
  }
});

afterAll(async () => {
  await globalThis.__pgPool.end();
});
```

The `relforcerowsecurity` sanity check is the gate that catches Pitfall 2 even if the FORCE migration was somehow skipped.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-write `CREATE POLICY` SQL alongside Drizzle TS schema | Drizzle 0.45 `pgPolicy()` as schema-as-code | drizzle-kit 0.27.0 (October 2024) [VERIFIED: github.com/drizzle-team/drizzle-orm/releases/tag/drizzle-kit@0.27.0] | Single source of truth; drift between TS schema and DB policies eliminated. |
| Test against superuser DB connections | Test against NOBYPASSRLS dedicated role | Always-recommended; structurally enforced via `setup.ts` BYPASSRLS check | Vacuous "RLS works" results impossible — tests fail loudly if connection is privileged. |
| `SET app.tenant_id = '<id>'` (session-scoped) | `set_config('app.tenant_id', '<id>', true)` (transaction-scoped) | Pool-aware multi-tenant SaaS pattern | GUC dies with transaction; no leak across pooled connection reuse. |
| pgcrypto extension for `gen_random_uuid()` | Built-in core function | Postgres 13 (Sept 2020) [VERIFIED: postgresql.org/docs/13/functions-uuid.html] | No extension required; cleaner migrations. |
| Vitest 1.x with `pool: 'threads'` | Vitest 4.x with `pool: 'forks'` (default) | Vitest 1.6+ default change | Better isolation for DB-touching tests at small per-file overhead cost. |
| ESLint legacy `.eslintrc.js` config | Flat config `eslint.config.js` (default in v9+) | ESLint 9 (April 2024); now v10.2.1 [VERIFIED: npm view eslint] | Cleaner, JS-native config; better tree-shake of plugins. |
| Custom env-var validation | `@t3-oss/env-core` with Zod | t3-env 0.7+ (2024) | Boot-fail-closed pattern; type-safe env access. |
| `@supabase/auth-helpers-nextjs` (deprecated) | `@supabase/ssr` | Supabase rebrand 2024 | N/A for Phase 1 (no Next.js); flag for Phase 6. |

**Deprecated/outdated to avoid in Phase 1:**
- `drizzle-kit push` — does not apply RLS policies (Issue #3504).
- `enableRLS()` in v1.0.0-beta+ (use `withRLS` then) — but Phase 1 is on 0.45 stable, so `enableRLS()` is current.
- `@supabase/auth-helpers-nextjs` — replaced by `@supabase/ssr`. Phase 6 concern.
- `middleware.ts` — Next.js 16 deprecated this in favor of `proxy.ts`. Phase 6 concern.
- `pgcrypto` extension just for `gen_random_uuid()` — no longer needed.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Drizzle 0.45's `pgPolicy()` emits the exact `CREATE POLICY` SQL we expect (with `USING` and `WITH CHECK` rendering the `sql\`...\`` template correctly) | Pattern 1 | Generated migration may have broken policy SQL; planner should add a "verify generated SQL by visual inspection of migration" task before applying. |
| A2 | `seedTwoTenants` pattern (set GUC = new UUID, then INSERT row with same UUID) passes the self-filtering policy on `tenant` | Pattern 4 | If the WITH CHECK clause evaluates differently than expected, seeding fails. Planner should add a "smoke-test the seed function in the first PR" step. |
| A3 | `drizzle-kit migrate` applies the `--custom` migration's raw FORCE ROW LEVEL SECURITY ALTER without complaint | Pattern 2 | Possible — `migrate` runs SQL files literally — but flag for a smoke test. |
| A4 | The pen-test ESLint rule (`no-restricted-properties` on `process.env`) plus `no-restricted-imports` is sufficient to catch the service-role exfiltration pattern at Phase 1 | Pattern 5 | At Phase 1 there's no app code to lint, so this is forward-looking. Real validation happens in Phase 6. |
| A5 | Postgres 16 GitHub Actions service container image (`postgres:16-alpine`) is stable and has the `gen_random_uuid()` core function | Pattern 7 | Verified via search but not exercised in this research session — first CI run will confirm. |
| A6 | A `NOBYPASSRLS` `app_user` role granted DML on tables in the public schema can read/write through RLS policies as expected | Pattern 7 | Standard pattern; risk is low. Integration smoke test catches regressions. |

**These assumptions need user/planner attention.** A1, A2, A3 are the load-bearing ones — they're "Drizzle 0.45 actually works the way the docs claim." First implementation PR should include a smoke test that proves all three.

## Open Questions

1. **Should Phase 1 also delete the legacy `src/App.js` and `react-scripts` setup?**
   - What we know: CLAUDE.md says the prototype is throwaway; new work targets the new stack. CONTEXT.md is silent on cleanup.
   - What's unclear: Does Phase 1 do the cleanup or defer it (to keep the diff focused)?
   - Recommendation: Defer the deletion to Phase 6 (or whenever Next.js lands) to keep Phase 1's diff scoped strictly to db/tests/env. **Move `src/App.js` to `legacy/` and add a `.gitignore` ignore for `legacy/` from build tooling, so it doesn't pollute new tooling but isn't lost.** Confirm with planner.

2. **Should `_rls_canary` be in the `public` schema or a dedicated `_meta` schema?**
   - What we know: Devs reading `\dt` will see `_rls_canary` next to real domain tables. Leading underscore signals "test fixture."
   - What's unclear: Whether a dedicated `_meta` schema is cleaner long-term.
   - Recommendation: Stick with `public` for Phase 1 (fewer moving parts; Drizzle's default schema) and revisit if the schema gets crowded. The leading underscore is a sufficient signal.

3. **What concrete value should the pen test for the JWT-tampering case assert?**
   - What we know: D-03 says "a forged JWT setting `tenant_id` to a tenant the user does not belong to is treated as a no-rows-returned result, not an exfiltration."
   - What's unclear: At Phase 1 there is no user table, no auth flow. The "user belongs to" concept doesn't exist. The pen test can only assert that `setTenantContext` with a foreign tenant ID returns zero rows from canary tables.
   - Recommendation: The Phase 1 JWT-tampering test asserts: (a) mintJWT returns a valid JWT with the tampered claim; (b) extracting the claim and calling `set_config` with the tampered value sets the GUC; (c) all queries in the resulting transaction return zero rows from canary tables (because the foreign tenant doesn't exist or has no rows). This is the structural property — Phase 6 hardens it once auth + user_tenant_role tables exist.

4. **Index for `EXPLAIN` assertion — exact query shape?**
   - What we know: TNT-03 requires `tenant_id` indexed; CONTEXT.md D-06 says "pen test asserts EXPLAIN uses index scan."
   - What's unclear: Postgres may choose seq scan on a tiny test table even when an index exists — too few rows to justify. Need to seed enough rows to trigger the planner's index-scan choice, OR use `set enable_seqscan = off` to force the assertion.
   - Recommendation: Use `SET LOCAL enable_seqscan = off` in the test transaction, then assert `EXPLAIN` chose `Index Scan`. This validates the index exists and is usable, not that the planner chose it under realistic data volumes (which is a Phase 2+ concern).

5. **Is `npm` or `pnpm` the bootstrap package manager?**
   - What we know: CLAUDE.md and stack research lock pnpm. Existing `package.json` was generated by `react-scripts` and uses npm. There's a `package-lock.json` and `node_modules/`.
   - What's unclear: Phase 1 task ordering — does it `rm -rf node_modules package-lock.json` first, then `pnpm init`?
   - Recommendation: Yes — explicit task in the plan to swap to pnpm. Delete `node_modules/`, `package-lock.json`, and the existing `package.json`'s `react-scripts` deps. New `package.json` is the Phase 1 source of truth.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Docker (for postgres:16-alpine) | Local dev container | Assumed (standard developer env) | 24.x+ | Connect to a remote Postgres if Docker missing — but document the cost. |
| GitHub Actions runner | CI | Available (project hosted on GitHub per `gh` config) | latest ubuntu-latest | None — Phase 1 ships GitHub Actions; if the project moves CI providers, the workflow file ports cleanly. |
| pnpm | Package manager | Need to install if not present | 9.x | npm could be used but breaks CLAUDE.md lock. |
| Postgres 16 | Database | Via Docker — confirmed image exists [VERIFIED: hub.docker.com/_/postgres tags] | 16-alpine | None — Phase 1 mandates Postgres 16+ per CFG-02. |
| node 20.9+ | Runtime | Required by Vitest 4.x and drizzle-kit 0.31 | 20 LTS | Node 22 should work but flag if anything misbehaves. |
| `@types/pg` | TS types for node-postgres | npm install | latest | None — required for typed pen tests. |

**Missing dependencies with no fallback:** None — the entire phase runs on tools that are either standard in any Node TS dev environment or installable via pnpm.

**Missing dependencies with fallback:** None applicable.

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json`. This section drives `VALIDATION.md`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test:rls -- --reporter=basic` (single file or filter) |
| Full suite command | `pnpm test:rls` (alias for `vitest run --config vitest.config.ts`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TNT-01 | FORCE ROW LEVEL SECURITY active on `tenant` and `_rls_canary` | unit (DB introspection) | `pnpm test:rls -- tests/rls/setup.ts` (sanity check fires in beforeAll) | ❌ Wave 0 |
| TNT-02 (read) | Cross-tenant SELECT with GUC=A targeting B's row → 0 rows | integration | `pnpm test:rls -- tests/rls/cross-tenant-select.test.ts` | ❌ Wave 0 |
| TNT-02 (write) | Cross-tenant INSERT with mismatched tenant_id payload → WITH CHECK violation | integration | `pnpm test:rls -- tests/rls/cross-tenant-write.test.ts` | ❌ Wave 0 |
| TNT-02 (update/delete) | UPDATE/DELETE on B's row from A's GUC → 0 rows affected | integration | `pnpm test:rls -- tests/rls/cross-tenant-write.test.ts` | ❌ Wave 0 |
| TNT-02 (JWT tamper) | Forged JWT with foreign tenant_id → `setTenantContext` sets foreign GUC → 0 rows | integration | `pnpm test:rls -- tests/rls/jwt-tampering.test.ts` | ❌ Wave 0 |
| TNT-02 (service-role) | `process.env.SUPABASE_SERVICE_ROLE_KEY` is undefined in app-path module graph; ESLint rule blocks import patterns | integration + lint | `pnpm test:rls -- tests/rls/service-role-boundary.test.ts && pnpm lint` | ❌ Wave 0 |
| TNT-03 | `tenant_id` index used by EXPLAIN on `_rls_canary` lookup | integration | `pnpm test:rls -- tests/rls/index-scan.test.ts` | ❌ Wave 0 |
| TNT-04 | All RLS pen tests gate the merge in CI | CI integration | `.github/workflows/test.yml` runs `pnpm test:rls` and fails the workflow on any failure | ❌ Wave 0 |
| TNT-05 | No cross-tenant data egress paths (architectural — nothing to test at Phase 1; canary table proves the primitive works) | architectural | n/a — verified by absence of cross-tenant query paths in code review | n/a |
| TNT-06 | No competitive-analytics surface (architectural commitment) | architectural | n/a — Phase 1 documents the constraint; no code to test | n/a |
| CFG-02 | Drizzle 0.45 + postgres-js client config compiles with `prepare: false` (forward-looking) | static | `pnpm tsc --noEmit` includes the import path even though the client isn't yet exercised | ❌ Wave 0 |
| CFG-05 | Boot fails closed when `DATABASE_URL` is missing or malformed | unit | `pnpm test:rls -- tests/rls/env-boot.test.ts` (or simpler: `node -e "process.env.DATABASE_URL=''; require('./lib/env.ts')"` script in CI) | ❌ Wave 0 |
| (smoke) | GUC reset between transactions: after ROLLBACK, `current_setting('app.tenant_id', true)` returns NULL | integration | `pnpm test:rls -- tests/rls/guc-reset.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test:rls -- <single-file-pattern>` (≤2s for one file)
- **Per wave merge:** `pnpm test:rls` full suite (≤10s expected for all 6 files at Phase 1's data volume)
- **Phase gate:** Full suite green in CI before `/gsd-verify-work` accepts the phase. Pen-test failures block merge — non-negotiable.

### Wave 0 Gaps

All test files are gaps — Phase 1 is greenfield. The plan must explicitly create:

- [ ] `vitest.config.ts` — pool: forks; pool isolation; setupFiles
- [ ] `tests/rls/setup.ts` — pg.Pool global; BYPASSRLS sanity check; relforcerowsecurity sanity check
- [ ] `tests/rls/fixtures/jwt.ts` — mintJWT, forgeJWT helpers
- [ ] `tests/rls/fixtures/tenants.ts` — seedTwoTenants helper
- [ ] `tests/rls/cross-tenant-select.test.ts` — covers TNT-02 read
- [ ] `tests/rls/cross-tenant-write.test.ts` — covers TNT-02 write/update/delete
- [ ] `tests/rls/jwt-tampering.test.ts` — covers TNT-02 JWT
- [ ] `tests/rls/service-role-boundary.test.ts` — covers TNT-02 service-role
- [ ] `tests/rls/guc-reset.test.ts` — covers GUC reset between transactions
- [ ] `tests/rls/index-scan.test.ts` — covers TNT-03 (EXPLAIN with `enable_seqscan=off`)
- [ ] `tests/rls/env-boot.test.ts` — covers CFG-05 (or implement as a small shell script in CI)
- [ ] Framework install: `pnpm add -D vitest@4.1.5 jose@6.2.3 @types/pg`

**Phase 1 architectural commitment to downstream phases:** Every later phase that adds a tenant-scoped table MUST add corresponding pen tests under `tests/rls/<phase>/` covering: cross-tenant SELECT, cross-tenant INSERT (WITH CHECK), cross-tenant UPDATE/DELETE, EXPLAIN-uses-index-scan. Phase 1's `tests/rls/setup.ts` BYPASSRLS + relforcerowsecurity sanity checks are the universal gate — every later phase's tests inherit the setup file.

## Security Domain

> `security_enforcement` is not explicitly set to `false` in `.planning/config.json`, so this section is included.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | partial — Phase 6 owns auth flow | jose-minted fixture JWTs in pen tests; real Supabase Auth deferred to Phase 6 |
| V3 Session Management | no | No sessions in Phase 1 (no app yet) |
| V4 Access Control | **YES — central** | Postgres RLS with FORCE; `tenant_id` GUC pattern; pen-test gate enforces |
| V5 Input Validation | partial | Zod schema in t3-env; Drizzle's typed query builder forward-looking |
| V6 Cryptography | partial | jose for JWT (HS256 in tests); production switches to RS256 in Phase 6. Never hand-roll JWT or HMAC. |
| V8 Data Protection | yes | RLS is the data-protection primitive at the storage layer |
| V14 Configuration | yes | t3-env boot-fail-closed; secrets only in env vars; `.env.local` gitignored |

### Known Threat Patterns for Postgres + Drizzle stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection in policy expressions or app queries | Tampering | Drizzle's typed queries + `sql\`...\`` template (auto-parameterized); `set_config` always called with parameterized arguments |
| Cross-tenant data exfiltration via missing WHERE clause | Information Disclosure | RLS + FORCE makes "forgot WHERE" a no-rows-returned bug. Pen tests prove it. |
| GUC leak across pooled connections | Information Disclosure | `is_local=true` on every `set_config`. Pen test asserts GUC reset between transactions. |
| BYPASSRLS escalation via service-role key in app path | Elevation of Privilege | Env-var segregation + ESLint `no-restricted-imports` + pen test asserting `process.env.SUPABASE_SERVICE_ROLE_KEY` undefined in app paths |
| Forged JWT with foreign tenant_id | Spoofing | Phase 1: structural — even a forged JWT only sets the GUC; RLS still filters at the DB. Phase 6: Supabase Auth verifies JWT signature before extraction. |
| Plaintext secrets in source | Information Disclosure | t3-env runtime validation; `.env.local` gitignored; secrets in Vercel encrypted env / GH Actions secrets |
| RLS policy misapplied (USING without WITH CHECK) | Information Disclosure | Pattern 1: every policy declares both. Pen test cross-tenant-write asserts WITH CHECK rejects mismatched payloads. |

**Antitrust posture (PITFALLS.md §3.1, §3.5):** Phase 1's structural defense against the Smith v. Optimal Blue (Oct 2025) class-action exposure is exactly the RLS + FORCE pattern. A future "industry overlay" or "shared rules" feature that violates tenant isolation would require disabling FORCE on the relevant tables — a code change reviewable in a single PR. The architectural commitment is "no cross-tenant data path is buildable without explicitly tearing down RLS." Phase 1 ships that commitment.

## Sources

### Primary (HIGH confidence)
- [Drizzle ORM Row-Level Security docs](https://orm.drizzle.team/docs/rls) — `pgPolicy` API, `enableRLS()`, schema-as-code RLS
- [Drizzle Custom Migrations docs](https://orm.drizzle.team/docs/kit-custom-migrations) — `--custom` flag for raw SQL
- [Drizzle migrate vs push](https://orm.drizzle.team/docs/drizzle-kit-migrate) — `migrate` command behavior
- [Drizzle Issue #3504 — push does not apply RLS](https://github.com/drizzle-team/drizzle-orm/issues/3504) — confirmed bug, status: fixed-in-beta
- [drizzle-kit 0.27.0 release notes](https://github.com/drizzle-team/drizzle-orm/releases/tag/drizzle-kit@0.27.0) — RLS introduction
- [PostgreSQL 16 Custom Configuration Parameters](https://www.postgresql.org/docs/16/runtime-config-custom.html) — placeholder GUC behavior, no pre-declaration needed
- [PostgreSQL 16 Setting Parameters](https://www.postgresql.org/docs/16/config-setting.html) — `set_config` and `is_local` semantics
- [PostgreSQL Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) — `FORCE ROW LEVEL SECURITY`, BYPASSRLS, policy semantics
- [GitHub Actions PostgreSQL service containers](https://docs.github.com/en/actions/using-containerized-services/creating-postgresql-service-containers) — service-container CI pattern
- [Vitest pool config](https://vitest.dev/config/pool) — `pool: 'forks'` default and isolation
- [Postgres `gen_random_uuid()` core function (since v13)](https://github.com/prisma/web/issues/2209) — pgcrypto no longer required
- [ESLint `no-restricted-imports`](https://eslint.org/docs/latest/rules/no-restricted-imports) — flat config patterns
- [Supabase Row Level Security docs](https://supabase.com/docs/guides/database/postgres/row-level-security) — service_role bypass behavior
- [npm registry version verifications, all 2026-04-29](https://www.npmjs.com): drizzle-orm@0.45.2, drizzle-kit@0.31.10, postgres@3.4.9, pg@8.20.0, vitest@4.1.5, jose@6.2.3, zod@4.4.1, @t3-oss/env-core@0.13.11, dotenv@17.4.2, tsx@4.21.0, eslint@10.2.1, typescript@5.7.3

### Secondary (MEDIUM confidence)
- [drizzle-supabase-rls reference repo (rphlmr)](https://github.com/rphlmr/drizzle-supabase-rls) — JWT-to-GUC wiring pattern, `prepare: false` postgres-js client; Phase 6-relevant
- [Neon RLS + Drizzle guide](https://neon.com/docs/guides/rls-drizzle) — alternative provider's RLS integration; pattern is portable
- [Codepunkt — Blazing fast Prisma + Postgres tests in Vitest](https://codepunkt.de/writing/blazing-fast-prisma-and-postgres-tests-in-vitest/) — transactional rollback per test pattern
- [simplyblock — Postgres multi-tenancy with RLS](https://www.simplyblock.io/blog/underated-postgres-multi-tenancy-with-row-level-security/) — `SET LOCAL` tenant context in tests
- [permit.io — Postgres RLS Implementation Guide](https://www.permit.io/blog/postgres-rls-implementation-guide) — RLS pitfalls including superuser bypass

### Tertiary (LOW confidence)
- None — all critical claims cross-verified against official docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package version verified against npm registry on the research date.
- Drizzle 0.45 RLS support: HIGH — verified against current Drizzle docs and a working reference repo.
- Postgres RLS / GUC semantics: HIGH — verified against Postgres 16 official docs.
- Vitest pen-test pattern: HIGH — verified against Vitest 4.x docs and a popular community guide.
- GitHub Actions CI: HIGH — verified against GitHub's official docs.
- ESLint rule for service-role boundary: MEDIUM — pattern is well-known but the actual exfiltration path is forward-looking (no app code in Phase 1).
- t3-env: HIGH — pattern documented; v0.13.11 stable.
- Antitrust posture: HIGH — already locked decision; Phase 1 enforces structurally.

**Research date:** 2026-04-29
**Valid until:** 2026-05-29 for stable items (RLS semantics, Postgres docs); 2026-05-15 for fast-moving items (Drizzle minor versions, Vitest minor versions). Re-check if any plan ships >30 days from this date.

## RESEARCH COMPLETE
