---
last_mapped_commit: 78f1733137651248ed0cf7e02bf3cf8ad36f1c83
---

# Coding Conventions

**Analysis Date:** 2026-05-01

> Scope: rebuild-only (`db/`, `lib/`, `tests/`, `scripts/`). The legacy CRA prototype at `src/App.js` is ESLint-ignored and excluded from `tsconfig.json`; do not extend it. Conventions below apply to all new code.

## Naming Patterns

**Files:**
- Source files use `kebab-case.ts`: `agency-rule-version.ts`, `program-rule.ts`, `rule-citation.ts`, `derog-seasoning.ts`. The seed-fixture top-level file is the one camelCase exception (`tests/rls/seedTwoTenants.ts`) preserved by Plan 02-09 as a deliberate Rule 3 deviation; do not propagate the camelCase pattern.
- Custom Drizzle types live under `_types/`: `db/schema/_types/daterange.ts` — leading underscore signals "type-only helper, not a table."
- Migration filenames are zero-padded ordered SQL emitted by drizzle-kit: `0000_initial.sql`, `0001_force_rls.sql`, `0002_program_schema.sql`, `0006_detect_loosenings.sql`. Do NOT rename or reorder a migration that has shipped.
- Test files: `<subject>.test.ts` (e.g., `tests/rls/cross-tenant-select.test.ts`, `tests/schema/program-version-exclude.test.ts`).
- Test fixtures: `tests/<suite>/fixtures/<name>.ts` (e.g., `tests/rls/fixtures/connection.ts`, `tests/rules/fixtures/fnma-foreclosure.ts`). Top-level `tests/rls/seedTwoTenants.ts` is the documented Rule 3 deviation.

**Tables / SQL identifiers:**
- Postgres tables / columns: `snake_case` (`program_version`, `rule_citation`, `agency_rule_version`, `tenant_id`, `effective_period`).
- Internal "fixture / regression smoke" tables get a leading underscore — `_rls_canary` — visible in `\dt` so it cannot be confused with a domain table.
- Postgres enums: `snake_case` type name, `SCREAMING_SNAKE` values: `tenant_kind` to `BROKERAGE | RETAIL_LENDER | WHOLESALE_LENDER | SYSTEM`; `program_rule_layer` to `INVESTOR_OVERLAY | PRODUCT_FEATURE`. The `rule_kind` enum uses lowercase values (`ltv_max`, `derog_seasoning`) because those literals double as object keys in Zod dispatch tables (`lib/rules/schemas/index.ts`).
- Indexes: `<table>_<purpose>_idx` (`program_rule_tenant_idx`, `program_rule_version_layer_kind_idx`, `agency_rule_derog_event_idx`).
- Constraints: `<table>_<rule>` for CHECK / EXCLUDE (`program_version_no_overlap_active`, `rule_citation_has_source`, `agency_rule_version_agency_check`).
- RLS policies: `<table>_tenant_isolation` for tenant-scoped tables; `<table>_world_read` + `<table>_system_write` for the agency-tier dual policy (`db/schema/agency-rule-version.ts`, `db/schema/agency-rule.ts`).
- Postgres functions: `snake_case` (`detect_loosenings(uuid)`, `jsonb_min_numeric(jsonb)`).

**TypeScript identifiers:**
- Drizzle table exports: `camelCase` matching the table name (`tenant`, `program`, `programVersion`, `agencyRuleVersion`, `lenderOverlayRule`).
- Drizzle row types via `$inferSelect` / `$inferInsert`: `PascalCase` + `New` prefix for inserts (`Tenant` / `NewTenant`, `ProgramVersion` / `NewProgramVersion`, `AgencyRule` / `NewAgencyRule`). Always exported alongside the table.
- Zod schemas: `<kind>Schema` (`ltvMaxSchema`, `derogSeasoningSchema`, `dscrMethodSchema`). Each schema file ALSO exports a TypeScript type alias `<Kind>` derived via `z.infer<typeof xSchema>` (`type LtvMax`, `type DerogSeasoning`).
- Functions: `camelCase` verbs — `setTenantContext`, `connectAsTenant`, `connectAsAnonymous`, `seedTwoTenants`, `seedTenantWithProgramAndCitation`, `parseRuleBody`, `mintJWT`, `forgeJWT`.
- Constants: `SCREAMING_SNAKE` for module-level immutables (`TENANT_GUC_NAME` in `lib/tenant/context.ts`, `FORCED_TABLES` in `tests/rls/setup.ts`, `MIGRATION_DB_URL` / `ADMIN_URL` in test setup).
- The `as const` literal-tuple pattern for enum-like exports (`lib/rules/schemas/index.ts` `ruleKinds`); a discriminated `RuleKind` type is then derived via `typeof ruleKinds[number]`.

## Code Style

**Language posture:**
- TypeScript only. `tsconfig.json` `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`. `tsconfig.json` `include` is the closed set `lib/**`, `db/**`, `tests/**`, `drizzle.config.ts`, `vitest.config.ts`; `src/` is excluded.
- No JavaScript outside generated drizzle-kit `meta/_snapshot.json` files.

**Module system:**
- `package.json` `type: "module"`. Imports of project-local files MUST end in `.js` (NodeNext requires the on-disk extension; TypeScript rewrites `.ts` to `.js` at compile): `import { tenant } from './tenant.js';`, `import { fnmaForeclosure } from '../rules/fixtures/fnma-foreclosure.js';`. Bare-package imports (`zod`, `drizzle-orm`, `pg`) do not get an extension.

**Formatting:**
- No `.prettierrc` is checked in. Observable house style: 2-space indent, single quotes, trailing commas in multiline literals, semicolons. Match the surrounding file when in doubt; do not introduce new formatting patterns.

**Linting:**
- `eslint.config.mjs` flat config layered on `typescript-eslint/recommended`. Two project-specific load-bearing rules:
  1. `no-restricted-properties` blocks `process.env.*` reads in `app/**`, `pages/**`, `src/**`. The single sanctioned env reader is `lib/env.ts` (t3-env validated). `lib/env.ts`, `db/migrations/**`, `tests/**`, `scripts/**`, and `*.config.*` are exempt by directory scope (the rule never targets them in the first place).
  2. `no-restricted-imports` blocks `**/service-role*` and `**/admin-db*` patterns from app paths. Migration scripts and CI tools may use them; app code may not.
- Run via `pnpm lint`. There is also a smoke-fixture command `pnpm lint:fixture` (referenced from `package.json`) that intentionally runs against `app/.eslint-fixture.ts` to PROVE the rule fires; that file is excluded from the default `pnpm lint` run via `--ignore-pattern`.

## Import Organization

**Order observed across `lib/` and `db/schema/`:**
1. Bare-package imports first (`zod`, `drizzle-orm`, `drizzle-orm/pg-core`, `pg`, `jose`, `dotenv`).
2. Drizzle helpers (`sql`, `customType`) before table imports.
3. Local relative imports next, with `.js` extensions.
4. Type-only imports use `import type` (`import type { AnyPgColumn } from 'drizzle-orm/pg-core'`, `import type { Pool, PoolClient } from 'pg'`).
5. Drizzle table cross-references go through the per-table file directly (`import { tenant } from './tenant.js'`), NOT through the barrel `db/schema/index.ts`. The barrel exists for `drizzle.config.ts` (single import path for migration generation), not for intra-schema use.

**Path aliases:**
- None. All relative imports use `./` / `../` with `.js` extensions. Do not introduce path aliases without updating `tsconfig.json`, `eslint.config.mjs`, and the three vitest configs simultaneously.

## Comments and Documentation

**File header docblock — REQUIRED on every `.ts` source file in `lib/` and `db/schema/`.**
The pattern (10–60 lines): purpose statement, the locked decisions or pitfalls the file encodes, cross-references to `CONTEXT` / `RESEARCH` / `Plan` numbers, and a "Consumers:" section listing downstream files. Examples:
- `lib/tenant/context.ts` — explains GUC primitive, the canonical `app.tenant_id` literal location, the bootstrap pattern, and the Phase 1 vs Phase 6 contract.
- `db/schema/program-rule.ts` — locks the `layer` enum to `INVESTOR_OVERLAY | PRODUCT_FEATURE` and references CONTEXT D-05 / D-09.
- `db/schema/_types/daterange.ts` — documents the half-open `[start,end)` convention (Pitfall A) and points at consumers.

**Inline comments:**
- Use sparingly to explain WHY, not WHAT. Density rises around RLS policies, GENERATED expressions, and EXCLUDE constraints because the failure modes are non-obvious.
- Reference numbered pitfalls / decisions when they apply: `// Pitfall 7`, `// CONTEXT §D-05`, `// SC#2`, `// Plan 02-09`. Numbering is project-internal; do not invent new IDs ad-hoc — they trace back to `.planning/phases/`.

**Migration SQL comments:**
- Every `--custom` migration carries a header explaining why it exists, why Drizzle can't model it, and what it asserts. See `db/migrations/0001_force_rls.sql`, `db/migrations/0004_program_constraints.sql`, `db/migrations/0006_detect_loosenings.sql`.

**TSDoc:**
- Used selectively on exported functions (`setTenantContext`, `connectAsTenant`, `parseRuleBody`, `mintJWT`). `@param` for non-obvious arguments; otherwise prose suffices.

**ESLint disables:**
- Inline disables MUST be paired with a justification comment that points at a plan or pitfall. Example: `lib/tenant/context.ts` `eslint-disable @typescript-eslint/no-explicit-any` block carries a 9-line comment explaining why the Drizzle generic seam is intentional. `tests/rls/setup.ts` `eslint-disable no-var` documents that `declare global { var ... }` is the prescribed pattern.

## Function Design

**Signatures:**
- Async functions return `Promise<T>` explicitly: `async function setTenantContext(...): Promise<void>`. `async function seedTwoTenants(pool, adminPool?): Promise<SeedResult>`.
- Test helpers use a callback-with-resource-acquisition shape: `connectAsTenant<T>(pool, tenantId, fn: (client: PoolClient) => Promise<T>): Promise<T>` — the helper owns BEGIN / set_config / ROLLBACK / release. Callers never touch `client.release()` directly.
- Non-trivial result shapes are named interfaces (`SeedResult`, `TenantSeed`, `MintClaims`, `ForgeClaims`) rather than inline types.

**Parameters:**
- Pass identifiers (UUIDs, GUC values) as bind parameters; never interpolate. `client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])`. SQL injection must be structurally impossible.
- Discriminated unions instead of boolean flags where there are >2 mutually exclusive states.

**Return values:**
- Throw on shape errors (Zod `parse`, not `safeParse`) so the call site translates to a domain error: `parseRuleBody(kind, body)` throws `z.ZodError`.
- Return `null` only when null is the documented domain meaning. Don't use null as a sentinel for "not yet implemented" — leave a stub that throws instead.

## Module Design

**Barrel files:**
- `db/schema/index.ts` re-exports every table + enum so `drizzle.config.ts` has a single import path. New tables MUST be appended to this barrel.
- `lib/rules/schemas/index.ts` re-exports every per-kind schema AND defines `ruleBodySchemas` + `parseRuleBody` dispatch. The `satisfies Record<RuleKind, z.ZodType>` clause ensures adding a new `rule_kind` to the enum is a compile-error until a matching schema entry lands.
- Test directories do NOT use barrel files; tests import fixtures by direct path.

**Single source of truth conventions:**
- The `app.tenant_id` GUC literal appears in EXACTLY three places: `lib/tenant/context.ts` (the helper + `TENANT_GUC_NAME` constant), `db/schema/*.ts` `pgPolicy()` declarations, and `tests/rls/*` (which intentionally call `set_config` via raw `pg` per RESEARCH §Pitfall 5). Any other reference is a smell.
- The 17 `rule_kind` values appear in EXACTLY two places: `db/schema/program-rule.ts` `pgEnum('rule_kind', [...])` and `lib/rules/schemas/index.ts` `ruleKinds` const tuple. The dispatch test `tests/rules/dispatch-table.test.ts` asserts they match verbatim.
- Migration SQL for ORM-modeled tables (0000, 0002, 0003, 0005) is generated by `pnpm db:generate`. Custom SQL for features Drizzle cannot model (0001 FORCE RLS, 0004 EXCLUDE / CHECK / GENERATED, 0006 `detect_loosenings`) is hand-authored AND each ships with a paired `meta/<n>_snapshot.json`. NEVER hand-edit a generated file or run `db:generate` after a custom migration without inspecting the diff.

## Architectural Conventions

**Tenant isolation lives in the database, not the application.**
- `tenant_id` columns are `uuid NOT NULL REFERENCES tenant(id)` on every tenant-scoped table.
- Each tenant-scoped table carries a `pgPolicy('<table>_tenant_isolation', ...)` whose USING + WITH CHECK clauses both use ``${t.tenantId} = current_setting('app.tenant_id', true)::uuid``. The `, true` (missing-ok) variant is non-negotiable — without it, an unset GUC raises 22023 instead of returning NULL, breaking fail-closed.
- Migrations 0001 / 0003 / 0005 apply `ALTER TABLE … FORCE ROW LEVEL SECURITY` because Drizzle 0.45 cannot model FORCE. FORCE is the property that makes the migration role (postgres) subject to RLS — without it, owner-bypass silently neutralizes every policy. `tests/rls/setup.ts` asserts `relforcerowsecurity = true` at every test boot.
- Application writes go through `app_user` (NOBYPASSRLS NOSUPERUSER), provisioned in `scripts/init-db.sh`. `system_role` (also NOBYPASSRLS NOSUPERUSER) is the system-owned write role for agency tables; only the migration runner (postgres) is GRANTed `system_role`.

**Bootstrap pattern for tenant-self-filtering tables (Pitfall 7).**
Inserting into a table whose RLS policy is `using id = GUC` requires:
1. Generate the new UUID server-side (`gen_random_uuid()`).
2. `set_config('app.tenant_id', <new uuid>, true)` (is_local true so it dies with the txn).
3. `INSERT INTO tenant (id, ...) VALUES (<new uuid>, ...)` — WITH CHECK passes because id == GUC.
Reference implementations: `tests/rls/seedTwoTenants.ts::seedOneTenantWithProgramFamily`, `tests/schema/fixtures/seed.ts::seedTenantWithProgramAndCitation`.

**Citation discipline as a SCHEMA constraint, not an application convention.**
- `program_rule.primary_citation_id`, `agency_rule.primary_citation_id`, `lender_overlay_rule.primary_citation_id` are all `uuid NOT NULL REFERENCES rule_citation(id)`. There is no application path that can persist a rule without a citation.
- `rule_citation` carries `CHECK (source_pdf_sha256 IS NOT NULL OR source_url IS NOT NULL)` (`db/migrations/0004_program_constraints.sql`) — every citation has at least one source pointer.
- Test enforcement: `tests/schema/citation-fk.test.ts`, `tests/schema/citation-source-check.test.ts`.

**Bitemporal versioning + EXCLUDE.**
- `program_version.effective_period` is `daterange NOT NULL` half-open (`[start,end)` per `db/schema/_types/daterange.ts`). Adjacent ranges `[A,B)` `[B,C)` are non-overlapping by construction so back-to-back versions ship cleanly.
- Only ONE `state='active'` per `program_id` at any time, enforced by `EXCLUDE USING gist (program_id WITH =, effective_period WITH &&) WHERE (state='active')` (`db/migrations/0004_program_constraints.sql`). Same shape on `agency_rule_version` (no WHERE partial because no state column).
- The `state` column uses a CHECK constraint (`'draft', 'in_review', 'active', 'deprecated', 'sunset'`) rather than a Postgres enum — so Phase 8 lifecycle UI can extend without an enum migration.

**Rule body shape — DB shallow, TypeScript deep.**
- Database constraints on `rule_body` are minimal: NOT NULL + `jsonb_typeof(rule_body) = 'object'` + `rule_kind` enum membership. The substantive shape lives in Zod schemas at `lib/rules/schemas/<kind>.ts` so migrations don't churn on shape changes.
- Each schema file exports `<kind>Schema` and a `<Kind>` type alias. Phase 4 evaluator, Phase 7 extraction validator, and Phase 8 AM commit all dispatch through `parseRuleBody(kind, body)` from `lib/rules/schemas/index.ts`.
- `parseRuleBody` throws `z.ZodError` — callers translate to user-facing errors (extraction reject, AM commit block, evaluator skip).

**Drizzle 0.45 + postgres-js client posture.**
- `lib/db/client.ts` constructs `postgres(env.DATABASE_URL, { prepare: false, max: 10, idle_timeout: 30, ssl: false })`. `prepare: false` is non-negotiable — Supabase's Supavisor pooler does not support prepared statements; setting the posture now means Phase 6 Supabase wiring is a `DATABASE_URL` change, not a client refactor.
- The driver split (RESEARCH §Pitfall 5): app + migrations use `postgres-js` via Drizzle. Pen tests use raw `pg` (node-postgres) so they exercise the SQL contract — not the TS abstraction.

**Env-var posture.**
- `lib/env.ts` is the SINGLE sanctioned `process.env` reader. `@t3-oss/env-core` validates at module load — boot fails closed before the first DB connection. `emptyStringAsUndefined: true` means a typo'd `DATABASE_URL=` becomes a missing-var error rather than silent passthrough.
- `RLS_TEST_JWT_SECRET` (min 16 chars) is the test-only JWT signing secret; production boots without it. `SUPABASE_SERVICE_ROLE_KEY` is `.optional()` at Phase 1 and tightens to `.min(20)` at Phase 6.
- ESLint `no-restricted-properties` blocks `process.env` reads from app paths so the fail-closed contract cannot be silently bypassed.

## Error Handling

**Server-side throws, callers translate.**
- Zod `parse` (not `safeParse`) is the default at the rule-schema boundary — `ZodError` propagates and the caller decides domain semantics.
- Helper functions wrap their work in `try { … BEGIN; … fn(); … ROLLBACK; } catch { try { ROLLBACK } catch {} ; throw } finally { release/end }` — the empty-catch-on-rollback is the documented "swallow; transaction may already be aborted" idiom (`tests/rls/fixtures/connection.ts`, `tests/schema/fixtures/seed.ts`).
- Test setup boot guards (`tests/rls/setup.ts`) throw with explicit messages so a misconfigured CI environment fails LOUD rather than silently passing vacuously: BYPASSRLS-role detection, missing `relforcerowsecurity` rows, missing RLS policies are all hard aborts.

**No client-side LLM calls; no client-side secrets.**
- All future LLM / SDK calls run server-side. Phase 6 Server Actions / route handlers wrap them. The legacy prototype's `localStorage` API-key pattern is excluded by design and the ESLint env-block rule is the structural enforcement.

## Logging

- Phase 1–2 do not write logs (no app yet). `console.error` / `process.stderr.write` are acceptable for migration-time diagnostics. Phase 6 wires Sentry + Axiom; do not introduce a logger abstraction before then.

## Commit Conventions

- Conventional Commits with phase prefix: `feat(02-09):`, `test(02-08):`, `fix(02-07):`, `docs(02):`. The phase number tracks `.planning/phases/<phase>/<sub-phase>` so commits link directly to the plan / context they implement.
- Bodies frequently include `Co-Authored-By: Claude <noreply@anthropic.com>` (or model-specific) trailer when work was AI-paired.
- The phase prefix is required for migration / schema commits because it disambiguates which plan a custom SQL change traces back to.

---

*Convention analysis: 2026-05-01*
