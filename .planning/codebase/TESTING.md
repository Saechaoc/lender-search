---
last_mapped_commit: 78f1733137651248ed0cf7e02bf3cf8ad36f1c83
mapped_at: 2026-05-01
focus: testing
---

# Testing Patterns

**Analysis Date:** 2026-05-01

## Test Framework

**Runner:**
- Vitest 4.1.5 (devDependency in `package.json`)
- Three configs at the repo root, each with its own scope and setup chain:
  - `vitest.config.ts` — RLS pen-test suite (`tests/rls/**/*.test.ts`)
  - `vitest.schema.config.ts` — Postgres-constraint suite + Zod-unit suite (`tests/schema/**/*.test.ts`, `tests/rules/**/*.test.ts`)
  - `vitest.env-boot.config.ts` — env-validation boot smoke runner for `tests/rls/env-boot.test.ts` (carve-out for Plan 01-02 / Wave-1 ordering)
- Pool strategy: `pool: 'forks'` + `isolate: true` + `sequence.concurrent: false` in all three configs. Each test file runs in its own fork-isolated process **and** files run sequentially — required because Postgres state (TRUNCATE, GUC, `agency_rule_version` EXCLUDE constraint) cannot tolerate parallel writers to the single docker container.

**Assertion Library:**
- Built-in `expect` from Vitest. Common matchers in use: `toEqual`, `toBe`, `toHaveLength`, `toMatch`, `toContain`, `rejects.toThrow(/pattern/i)`, `toBeUndefined`, `toBeTruthy`, `toBeGreaterThanOrEqual`.
- `ZodError` imported from `zod` for schema-rejection assertions: `expect(() => schema.parse(bad)).toThrow(ZodError)`.

**Run Commands:**

```bash
pnpm test:rls               # Run all RLS pen tests (12 files / 56 tests)
pnpm test:rls:watch         # Watch mode for RLS pen tests
pnpm test:schema            # Run schema-constraint + Zod-unit suites (15 schema + 7 rules files / 86 + 63 tests)
```

**No unified `test` script.** Each test kind is invoked explicitly so config-mismatched suites cannot accidentally cross-pollinate (e.g., schema tests cannot run under the RLS config, which would skip the postgres-superuser admin pool they need).

**Database prerequisite:**

```bash
pnpm db:up                  # Start the postgres:16-alpine docker container (required before any test command)
pnpm db:reset               # Wipe + restart the container — useful when a migration regression leaves stale state
```

## Test File Organization

**Location:**
- All test files live under `tests/` at the repo root. **Do not** co-locate tests under `lib/` — the three Vitest configs only `include: ['tests/**']`.
- Test files use the suffix `.test.ts`. No `.spec.ts` files exist; if you add one, it will not be picked up by the configs above.

**Subtree:**

```
tests/
├── _shared/
│   └── agency-fixture.ts                           # seedAgencyVersion: shared SYSTEM-tenant + ARV + citation bootstrap
├── rls/                                            # Phase 1 + Phase 2 D-19 cross-tenant pen tests (12 files / 56 tests)
│   ├── global-setup.ts                             # Vitest globalSetup: TRUNCATE + drizzle-kit migrate + GRANT
│   ├── setup.ts                                    # Vitest setupFiles: __pgPool + __pgAdminPool + FORCE-RLS sanity
│   ├── seedTwoTenants.ts                           # Two-tenant seed + program family per tenant
│   ├── fixtures/
│   │   ├── connection.ts                           # connectAsTenant + connectAsAnonymous helpers
│   │   └── jwt.ts                                  # mintJWT + forgeJWT (HS256 test-only secret)
│   ├── env-boot.test.ts                            # Standalone (run via vitest.env-boot.config.ts)
│   ├── cross-tenant-select.test.ts                 # Phase 1 baseline pen tests
│   ├── cross-tenant-write.test.ts                  # Phase 1 baseline pen tests
│   ├── guc-reset.test.ts                           # GUC liveness across pool checkout/checkin
│   ├── index-scan.test.ts                          # rls_canary_tenant_idx EXPLAIN sanity
│   ├── jwt-tampering.test.ts                       # Forged-JWT D-03 row #4
│   ├── service-role-boundary.test.ts               # SUPABASE_SERVICE_ROLE_KEY env segregation
│   ├── lender-overlay-cross-tenant.test.ts         # Phase 2 D-19 — D-03 matrix on lender_overlay_rule
│   ├── program-cross-tenant.test.ts                # Phase 2 D-19 — D-03 matrix on program
│   ├── program-rule-cross-tenant.test.ts           # Phase 2 D-19 — D-03 matrix on program_rule
│   ├── program-version-cross-tenant.test.ts        # Phase 2 D-19 — D-03 matrix on program_version
│   └── rule-citation-cross-tenant.test.ts          # Phase 2 D-19 — D-03 matrix on rule_citation
├── schema/                                         # Phase 2 Postgres-constraint tests (15 files / 86 tests)
│   ├── setup.ts                                    # __pgPool (app_user) + __pgAdminPool (postgres) — no migrate
│   ├── fixtures/
│   │   └── seed.ts                                 # seedTenantWithProgramAndCitation + seedAgencyDerogRule
│   ├── agency-cross-tenant-readable.test.ts        # System-owned ARVs are SELECT-able from any tenant
│   ├── agency-rule-version-exclude.test.ts         # EXCLUDE gist on (agency, effective_period)
│   ├── citation-fk.test.ts                         # program_rule.primary_citation_id FK + NOT NULL
│   ├── citation-source-check.test.ts               # CHECK on rule_citation.source_url XOR source_document_id
│   ├── derog-rule-roundtrip.test.ts                # SC#2 acceptance: structured DerogRule round-trip
│   ├── detect-loosenings.test.ts                   # detect_loosenings(uuid) function — overlay-vs-agency diff
│   ├── min-confidence-generated.test.ts            # GENERATED column rebuilds on rule_body change
│   ├── program-rule-layer-check.test.ts            # CHECK on layer ∈ enum
│   └── program-version-exclude.test.ts             # EXCLUDE gist on (program_id, effective_period) WHERE state='active'
└── rules/                                          # Zod schema unit tests (7 files / 63 tests)
    ├── fixtures/
    │   └── fnma-foreclosure.ts                     # SC#2 DerogSeasoning fixture — FNMA Selling Guide B3-5.3-07
    ├── allow-list-kinds.test.ts
    ├── derog-seasoning.test.ts
    ├── dispatch-table.test.ts                      # Exhaustive ruleKinds + parseRuleBody routing
    ├── dscr-method.test.ts
    ├── income-doc-method.test.ts
    └── numeric-kinds.test.ts                       # ltv_max / cltv_max / hcltv_max / fico_min / dti_max / reserves_min
```

**Naming:**
- Test files: `<subject>-<concern>.test.ts` (e.g., `program-cross-tenant.test.ts`, `agency-rule-version-exclude.test.ts`).
- Fixture files: descriptive nouns under `fixtures/` (e.g., `fnma-foreclosure.ts`, `connection.ts`, `jwt.ts`).
- Seed entry points live at the suite root (e.g., `tests/rls/seedTwoTenants.ts`, `tests/_shared/agency-fixture.ts`), not inside `fixtures/` — they orchestrate multiple fixtures.

## Test Structure

**Suite Organization:**

Cross-tenant pen tests follow a strict D-03 matrix per tenant-scoped table — six cases:

```typescript
// tests/rls/program-cross-tenant.test.ts
import { describe, expect, it } from 'vitest';
import { connectAsAnonymous, connectAsTenant } from './fixtures/connection.js';
import { seedTwoTenants } from './seedTwoTenants.js';

describe('RLS: cross-tenant access on program table (D-19 / T-2-01)', () => {
  it('cross-tenant SELECT returns 0 rows when GUC is A and target is B', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
      const { rows } = await client.query(
        `SELECT id::text FROM program WHERE id = $1::uuid`,
        [seed.programB],
      );
      expect(rows).toHaveLength(0);
    });
  });

  it('connectAsAnonymous returns 0 rows (no GUC; policy fails closed)', async () => {
    await seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool);
    await connectAsAnonymous(globalThis.__pgPool, async (client) => {
      const { rows } = await client.query(`SELECT id::text FROM program`);
      expect(rows).toHaveLength(0);
    });
  });

  // …in-tenant SELECT, cross-tenant INSERT (rejected by WITH CHECK), cross-tenant UPDATE (0 rows), cross-tenant DELETE (0 rows)
});
```

**The full D-03 matrix (mandatory for every tenant-scoped table):**

1. Cross-tenant SELECT returns 0 rows
2. Anonymous (no GUC set) returns 0 rows
3. In-tenant SELECT returns the in-tenant row
4. Cross-tenant INSERT with mismatched `tenant_id` is rejected by RLS WITH CHECK (`/row-level security|policy/i`)
5. Cross-tenant UPDATE on a foreign tenant row affects 0 rows
6. Cross-tenant DELETE on a foreign tenant row affects 0 rows

When you add a new tenant-scoped table, copy this matrix verbatim (see `tests/rls/program-cross-tenant.test.ts`) and update `tests/rls/setup.ts`'s `FORCED_TABLES` array + the policy-name `required` list.

**Schema constraint tests** open their own admin transaction with explicit BEGIN/SAVEPOINT/ROLLBACK so the test rolls back leftover writes (`agency_rule_version` EXCLUDE seeds persist across runs):

```typescript
// tests/schema/agency-rule-version-exclude.test.ts
const adminClient = await globalThis.__pgAdminPool.connect();
const yr = 3000000 + Math.floor(Math.random() * 100000);
try {
  await adminClient.query('BEGIN');
  await adminClient.query(/* first row */);
  await adminClient.query('SAVEPOINT before_overlap');
  await expect(adminClient.query(/* overlapping row */))
    .rejects.toThrow(/conflicting key value violates exclusion constraint/i);
  await adminClient.query('ROLLBACK TO SAVEPOINT before_overlap');
  await adminClient.query('ROLLBACK');
} finally {
  adminClient.release();
}
```

**Zod schema tests** follow a parse-good / reject-bad pattern per `rule_kind`:

```typescript
// tests/rules/derog-seasoning.test.ts
import { ZodError } from 'zod';
import { derogSeasoningSchema } from '../../lib/rules/schemas/derog-seasoning.js';
import { fnmaForeclosure } from './fixtures/fnma-foreclosure.js';

it('parses the FNMA post-foreclosure fixture (SC#2)', () => {
  const parsed = derogSeasoningSchema.parse(fnmaForeclosure);
  expect(parsed.event_type).toBe('FORECLOSURE');
  expect(parsed.base_waiting_months).toBe(84);
});

it('rejects negative base_waiting_months', () => {
  const bad = { ...fnmaForeclosure, base_waiting_months: -12 };
  expect(() => derogSeasoningSchema.parse(bad)).toThrow(ZodError);
});
```

The dispatch-table test (`tests/rules/dispatch-table.test.ts`) enforces exhaustive coverage: every `rule_kind` in the 17-element `ruleKinds` array must have a matching `ruleBodySchemas` entry, and `parseRuleBody` must route correctly per kind. Adding a new `rule_kind` without a Zod schema breaks this test.

**Patterns:**
- **Setup:** Each suite uses Vitest's `beforeAll`/`afterAll` (in `tests/rls/setup.ts` and `tests/schema/setup.ts`) to construct `globalThis.__pgPool` (app_user; RLS-enforced) and `globalThis.__pgAdminPool` (postgres superuser; for system-table writes).
- **Teardown:** Connections are released back to the pool inside `finally` blocks. Pools are drained in `afterAll`. Tests rely on `connectAsTenant`'s automatic ROLLBACK so per-test writes never persist.
- **Assertion style:** RLS pen tests assert row counts (`toHaveLength(0)`, `result.rowCount === 0`) and the regex `/row-level security|policy/i` on rejected INSERTs. Constraint tests assert specific Postgres error fragments (e.g., `/null value in column "primary_citation_id"/i`, `/violates foreign key constraint/i`, `/conflicting key value violates exclusion constraint/i`).

## Mocking

**Framework:** None for the database layer — tests connect to a real Postgres 16 docker container (`docker-compose.yml`).

**Mocking philosophy:** **No mocks for the DB or schema.** The whole point of the pen-test suite is to validate that Postgres-enforced RLS, FK, EXCLUDE, CHECK, and GENERATED constraints behave as the code expects. A mocked DB would pass vacuously and is explicitly disallowed.

The only Vitest mocking primitive in use is `vi.stubEnv` for env-validation tests:

```typescript
// tests/rls/env-boot.test.ts
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

it('throws when DATABASE_URL is empty', async () => {
  vi.stubEnv('DATABASE_URL', '');
  await expect(import('../../lib/env.js')).rejects.toThrow();
});
```

`vi.resetModules()` is required before each `import('../../lib/env.js')` so the schema is re-evaluated against the new env state. `vi.stubEnv` on string vars + `vi.unstubAllEnvs()` in `afterEach` is the canonical pattern; do not mutate `process.env` directly.

**Connection harness:**

Two helpers in `tests/rls/fixtures/connection.ts` enforce the GUC-and-rollback contract:

```typescript
// connectAsTenant — pooled connection inside a BEGIN/ROLLBACK transaction
// Sets app.tenant_id GUC with is_local=true so it dies on ROLLBACK.
await connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
  const { rows } = await client.query(`SELECT id FROM _rls_canary`);
  expect(rows).toHaveLength(1);
});

// connectAsAnonymous — FRESH pg.Client (NOT pooled) with no prior GUC touch
// Works around Postgres 16 placeholder-GUC quirk: once a session has touched
// `app.tenant_id`, RESET / DISCARD ALL leave it as '' (empty string) which
// raises 22P02 on `''::uuid`. A fresh client has never touched it → NULL → policy fails closed.
await connectAsAnonymous(globalThis.__pgPool, async (client) => {
  const { rows } = await client.query(`SELECT id::text FROM program`);
  expect(rows).toHaveLength(0);
});
```

**What to use directly:**
- Real Postgres docker container at `localhost:5432`
- Real `drizzle-kit migrate` against the migration role at globalSetup time
- Real `pg` driver (`new Pool`, `new Client`) — not Drizzle. The pen tests exercise the SQL contract, not the Drizzle TS abstraction (CONTEXT §D-01 + RESEARCH §Pitfall 5).

**What NOT to mock:**
- The database connection
- RLS policy evaluation
- Postgres FK / EXCLUDE / CHECK / GENERATED constraint behavior
- The `current_setting('app.tenant_id', true)` GUC propagation

## Fixtures and Factories

**Test Data:**

The shared agency bootstrap lives at `tests/_shared/agency-fixture.ts` so RLS and schema suites stay in lockstep:

```typescript
// tests/_shared/agency-fixture.ts
export async function seedAgencyVersion(
  adminPool: Pool,
  options: SeedAgencyVersionOptions = {},
): Promise<AgencyFixtureSeed> {
  // 1. Get-or-create the kind='SYSTEM' tenant under postgres adminPool (Pitfall G)
  // 2. set_config('app.tenant_id', system_tenant_id, true) so RLS WITH CHECK passes
  // 3. INSERT rule_citation under that tenant
  // 4. INSERT agency_rule_version with a randomized non-overlapping daterange
  //    (start year = 2100 + random()*100000) so the agency_rule_version_no_overlap
  //    EXCLUDE doesn't trip across multiple seeds in a single run.
}
```

**Per-tenant program-family seed (Phase 2 D-19 extension):**

```typescript
// tests/rls/seedTwoTenants.ts — bootstrap pattern (RESEARCH §Pitfall 7)
async function seedOneTenantWithProgramFamily(pool, agencyRuleVersionId, label) {
  // 1. SELECT gen_random_uuid() — generate UUID server-side
  // 2. set_config('app.tenant_id', new_uuid, true) — GUC matches new tenant_id
  // 3. INSERT INTO tenant (id, kind, name) VALUES ($1, 'BROKERAGE', ...) — WITH CHECK passes
  // 4. INSERT INTO _rls_canary, rule_citation, program, program_version, program_rule
  //    in FK order (Pitfall F)
  // 5. COMMIT — each tenant in its OWN transaction so the GUC resets between A and B
}
```

The bootstrap pattern is non-negotiable: the `tenant` table's self-filter policy `using id = current_setting('app.tenant_id')::uuid` means a new tenant can ONLY be inserted when the GUC matches the new tenant's id. Generate the UUID first, set the GUC, then INSERT.

**SC#2 fixture (FNMA post-foreclosure):**

```typescript
// tests/rules/fixtures/fnma-foreclosure.ts
export const fnmaForeclosure: DerogSeasoning = {
  event_type: 'FORECLOSURE',
  measurement_anchor: 'COMPLETION',
  base_waiting_months: 84,                              // 7-year baseline
  extenuating_circumstances_waiting_months: 36,         // 3-year w/ extenuating
  post_event_LTV_caps: [
    {
      months_since_min: 36,
      months_since_max: 84,
      max_LTV: 90,                                      // 3-7yr band
      purposeAllowList: ['PURCHASE', 'RATE_TERM_REFI'],
      occupancyAllowList: ['PRIMARY'],
    },
  ],
  reestablished_credit_required: true,
  mortgage_included_in_bk_rule: 'BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED',
  notes_citations: ['FNMA Selling Guide B3-5.3-07'],
};
```

This fixture is reused by both `tests/rules/derog-seasoning.test.ts` (Zod parse-good) and `tests/schema/derog-rule-roundtrip.test.ts` (Drizzle round-trip through Postgres). When you change the `DerogSeasoning` shape, update this fixture once and both suites pick up the change.

**Location:**
- Connection helpers: `tests/rls/fixtures/connection.ts`
- JWT helpers: `tests/rls/fixtures/jwt.ts`
- Two-tenant seed: `tests/rls/seedTwoTenants.ts`
- Schema-suite seed: `tests/schema/fixtures/seed.ts`
- Shared agency bootstrap: `tests/_shared/agency-fixture.ts`
- Rule-body fixtures: `tests/rules/fixtures/`

## Coverage

**Requirements:** No global coverage threshold enforced. Coverage is measured by D-03 matrix completeness (every tenant-scoped table) + Zod-schema dispatch-table exhaustiveness (every `rule_kind` ∈ `ruleKinds`).

**Total tests at HEAD (`78f1733`):** 142 tests across 27 files
- RLS pen-test suite: 12 files / 56 tests
- Schema-constraint suite: 15 files / 86 tests (also runs the 7 Zod-unit files / 63 tests via the shared `vitest.schema.config.ts` include glob)

**View Coverage:**

```bash
# No coverage script wired up. To collect ad-hoc:
pnpm test:rls -- --coverage
pnpm test:schema -- --coverage
```

## Test Types

**Pen tests (cross-tenant isolation):**
- Located: `tests/rls/`
- Scope: every tenant-scoped table gets the 6-case D-03 matrix
- Approach: real Postgres + RLS + GUC + `connectAsTenant` / `connectAsAnonymous` helpers; assert row counts and policy-rejection error messages

**Schema constraint tests:**
- Located: `tests/schema/`
- Scope: Postgres-enforced rules — FK, NOT NULL, EXCLUDE gist, CHECK, GENERATED columns, `detect_loosenings` SQL function, agency cross-tenant readability, structured DerogRule round-trip through `jsonb`
- Approach: real Postgres + admin pool transactions + SAVEPOINT/ROLLBACK to scope leftover writes

**Zod schema unit tests:**
- Located: `tests/rules/`
- Scope: parse-good + reject-bad per `rule_kind`; exhaustive dispatch-table coverage
- Approach: pure-TS, no DB; import the schema and call `.parse()` against fixtures

**env-validation boot tests:**
- Located: `tests/rls/env-boot.test.ts`
- Scope: `lib/env.ts` fail-closed contract (CFG-05) — required-var violations throw at module-load time
- Approach: `vi.stubEnv` + `vi.resetModules` + dynamic `import('../../lib/env.js')`

**Not present:**
- E2E tests — no Playwright / Cypress yet (no UI exists; legacy prototype at `src/App.js` retired)
- Integration tests against external services (Reducto, Anthropic, Inngest, Supabase Auth) — Phase 0 has no extraction pipeline yet

## Common Patterns

**Async testing:**

```typescript
// rejects.toThrow with regex for Postgres error messages
await expect(
  connectAsTenant(globalThis.__pgPool, seed.tenantA, async (client) => {
    await client.query(/* cross-tenant INSERT */);
  }),
).rejects.toThrow(/row-level security|policy/i);
```

**Error testing (Zod):**

```typescript
import { ZodError } from 'zod';

it('rejects invalid event_type value', () => {
  const bad = { ...fnmaForeclosure, event_type: 'JURY_DUTY' };
  expect(() => derogSeasoningSchema.parse(bad)).toThrow(ZodError);
});
```

**Error testing (Postgres):**

```typescript
// Match a stable fragment of the Postgres error text. Use case-insensitive flag /i
// because Postgres versions occasionally tweak capitalization.
await expect(client.query(/* … */)).rejects.toThrow(/null value in column "primary_citation_id"/i);
await expect(client.query(/* … */)).rejects.toThrow(/violates foreign key constraint/i);
await expect(client.query(/* … */)).rejects.toThrow(/conflicting key value violates exclusion constraint/i);
```

**Forced index-scan EXPLAIN:**

```typescript
// Defeat the small-table planner heuristic (Postgres prefers seq scan on <100 rows)
await client.query('SET LOCAL enable_seqscan = off');
const { rows } = await client.query<Record<string, unknown>>(
  `EXPLAIN (FORMAT JSON) SELECT id FROM _rls_canary WHERE tenant_id = $1`,
  [seed.tenantA],
);
const planJson = JSON.stringify(rows[0]!['QUERY PLAN']);
expect(planJson).toMatch(/Index (Scan|Only Scan)|Bitmap Index Scan/);
expect(planJson).toContain('rls_canary_tenant_idx');
```

## Setup Pipeline (RLS suite)

The RLS config is the most complex setup chain — read this before adding pen tests:

**Stage 1 — `tests/rls/global-setup.ts` (runs once before the entire suite):**

1. Load `.env.local` → `.env` via `dotenv` (CI env vars take precedence — `dotenv` does not override pre-set vars)
2. Resolve `DATABASE_MIGRATION_URL` (or substitute `app_user:app_user_password` → `postgres:postgres` in `DATABASE_URL`)
3. TRUNCATE Phase 1 + Phase 2 tables CASCADE — guarded by `to_regclass` so it's a no-op on a fresh DB
4. `execFileSync('pnpm', ['drizzle-kit', 'migrate'], …)` — non-interactive + idempotent + uses `execFile` (no shell interpretation; args are pinned literals)
5. GRANT DML on tenant-scoped tables to `app_user` + GRANT SELECT on agency tables — defensive idempotent issue (migrations 0003 + 0006 already do this; survives migration regressions)
6. Construct `globalThis.__pgAdminPool` — best-effort, see Stage 2 caveat

**Stage 2 — `tests/rls/setup.ts` (runs at the start of each test file's process):**

1. Re-load dotenv (separate Node process from globalSetup)
2. Construct `globalThis.__pgPool` (app_user, max=5) — RLS-enforced
3. **Defensively re-construct `globalThis.__pgAdminPool` (postgres, max=3)** — Vitest 4's globalSetup and setupFiles run in DIFFERENT module contexts (Plan 01-06 §Rule 3 deviation), so the global set in Stage 1 may not survive. Setup constructs its own.
4. **Sanity check 1 (Pitfall 4):** `pg_roles` shows `current_user.rolbypassrls === false`. If the connection accidentally lands as a superuser, RLS is silently bypassed → tests pass vacuously → ABORT.
5. **Sanity check 2 (Pitfall 6):** `pg_class.relforcerowsecurity === true` for all 7 tenant-scoped tables (`_rls_canary`, `lender_overlay_rule`, `program`, `program_rule`, `program_version`, `rule_citation`, `tenant`). FORCE makes the table owner subject to RLS — without it, the migration didn't apply correctly and tests would pass for the wrong reason.
6. **Sanity check 3:** all 7 expected RLS policies are present in `pg_policy`. Missing policies → ABORT with the missing-policy list.

**Stage 3 — per-test:**

Tests call `seedTwoTenants(globalThis.__pgPool, globalThis.__pgAdminPool)` to mint two tenants + program family per tenant + shared agency rule version, then exercise the D-03 matrix via `connectAsTenant` / `connectAsAnonymous`.

## Pitfalls Codified by Tests

**Pitfall 4 (silent bypass):** Pen tests connecting as a BYPASSRLS role would pass vacuously. `tests/rls/setup.ts` aborts the suite if `current_user.rolbypassrls` is true. Mirror this check if you add a new test config that connects to Postgres.

**Pitfall 6 (FORCE absent):** Without `FORCE ROW LEVEL SECURITY`, the table owner bypasses RLS. `tests/rls/setup.ts` introspects `pg_class.relforcerowsecurity` for every tenant-scoped table and aborts on missing FORCE.

**Pitfall 7 (bootstrap):** The `tenant` table self-filter means new tenant inserts need the GUC matching the new tenant_id BEFORE the INSERT. `seedOneTenantWithProgramFamily` in `tests/rls/seedTwoTenants.ts` codifies the pattern: `SELECT gen_random_uuid()` → `set_config('app.tenant_id', new_uuid, true)` → `INSERT INTO tenant (id, …) VALUES (new_uuid, …)`.

**Pitfall G (system-owned writes):** Agency tables have `policy ... TO system_role`; only the `postgres` role has `system_role` GRANTed. Agency-side inserts go through `globalThis.__pgAdminPool` (postgres connection), never `__pgPool` (app_user). `tests/_shared/agency-fixture.ts::seedAgencyVersion` always opens an admin transaction.

**Postgres 16 placeholder-GUC quirk:** Once `app.tenant_id` has been touched in a session, `RESET` / `DISCARD ALL` leave it as `''` (empty string) rather than NULL, and `''::uuid` raises 22P02. `connectAsAnonymous` opens a FRESH `pg.Client` (not pooled) so the GUC has never been touched → `current_setting('app.tenant_id', true)` returns NULL → policy fails closed cleanly.

**Vitest 4 module-context boundary (Plan 01-06 §Rule 3):** globalSetup and setupFiles run in different module contexts, so `globalThis.__pgAdminPool` set in `global-setup.ts` may not survive into `setup.ts`. The defense: `setup.ts` constructs its own `__pgAdminPool`. Don't rely on globals propagating across the boundary.

**Insert order (Pitfall F):** When seeding a tenant, FK chain is `tenant → rule_citation → program → program_version → program_rule`. The `program_rule.primary_citation_id` FK requires the citation exists FIRST. See `seedOneTenantWithProgramFamily` for the canonical order.

## Coverage Gaps (per `.planning/REVIEW/02-REVIEW.md` IN findings)

**Tests not yet written but planned:**

- `detect_loosenings` allow-list branch silently passes on missing `values` key — no regression test
- `detect_loosenings` SECURITY INVOKER + RLS fail-closed posture — no test that the function honors caller's RLS context
- `jsonb_min_numeric` raise-on-non-numeric path — no test for the error branch
- `tenant.kind` enum existence — no upfront sanity check (currently only validated implicitly via `INSERT INTO tenant (id, kind, ...) VALUES (..., 'BROKERAGE', ...)` in `seedOneTenantWithProgramFamily`)

When you land tests for any of these, add them to the matching `tests/schema/` file (or create a new one following the `<subject>-<concern>.test.ts` naming) and remove the entry from this list.

---

*Testing analysis: 2026-05-01*
