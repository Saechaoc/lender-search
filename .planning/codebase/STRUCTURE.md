---
last_mapped_commit: 78f1733137651248ed0cf7e02bf3cf8ad36f1c83
analysis_date: 2026-05-01
scope: db, lib, tests, scripts (src/ legacy prototype excluded)
---

# Codebase Structure

**Analysis Date:** 2026-05-01

## Directory Layout

```
lender-search/
├── db/
│   ├── migrations/                          # Drizzle-applied SQL migrations (auto + --custom)
│   │   ├── 0000_initial.sql                 # tenant + _rls_canary tables, ENABLE RLS, policies
│   │   ├── 0001_force_rls.sql               # --custom: ALTER TABLE ... FORCE ROW LEVEL SECURITY
│   │   ├── 0002_program_schema.sql          # rule_kind + program_rule_layer enums; program family + agency family + rule_citation + lender_overlay_rule + RLS policies
│   │   ├── 0003_force_rls_program.sql       # --custom: FORCE RLS on program/program_version/program_rule/rule_citation + GRANTs
│   │   ├── 0004_program_constraints.sql     # --custom: btree_gist, jsonb_min_numeric IMMUTABLE wrapper, min_confidence GENERATED, EXCLUDE constraints, CHECK constraints, partial expression index
│   │   ├── 0005_force_rls_agency.sql        # --custom: FORCE RLS on lender_overlay_rule + GRANTs on agency tables
│   │   ├── 0006_detect_loosenings.sql       # --custom: detect_loosenings(uuid) SQL function
│   │   └── meta/
│   │       ├── _journal.json                # Drizzle migration journal (idx + tag + when)
│   │       └── 0000_snapshot.json … 0006_snapshot.json
│   └── schema/                              # Drizzle table definitions (TypeScript)
│       ├── _types/
│       │   └── daterange.ts                 # customType wrapping Postgres daterange
│       ├── index.ts                         # Schema barrel re-exporting every table/enum
│       ├── tenant.ts                        # tenant table + tenant_kind enum + self-filtering RLS policy
│       ├── canary.ts                        # _rls_canary regression smoke table
│       ├── program.ts                       # program parent table (tenant-scoped)
│       ├── program-version.ts               # bitemporal program_version with effective_period daterange
│       ├── program-rule.ts                  # program_rule + program_rule_layer pgEnum + rule_kind pgEnum (canonical)
│       ├── rule-citation.ts                 # tenant-scoped rule_citation table
│       ├── agency-rule-version.ts           # system-owned agency_rule_version with world_read + system_write policies
│       ├── agency-rule.ts                   # system-owned agency_rule table (re-imports rule_kind)
│       ├── lender-overlay-rule.ts           # tenant-scoped lender_overlay_rule (re-imports rule_kind)
│       └── system-role.ts                   # pgRole('system_role').existing() reference
│
├── lib/
│   ├── env.ts                               # t3-env Zod boot validation; throws synchronously on missing/malformed env
│   ├── db/
│   │   └── client.ts                        # postgres-js client + Drizzle instance (prepare:false for Supabase pooler)
│   ├── rules/
│   │   └── schemas/                         # 17 Zod schemas + dispatch barrel
│   │       ├── index.ts                     # ruleKinds tuple + ruleBodySchemas dispatch + parseRuleBody(kind, body)
│   │       ├── ltv-max.ts                   # { value: 0..100 }
│   │       ├── cltv-max.ts                  # { value: 0..120 }
│   │       ├── hcltv-max.ts                 # { value: 0..120 }
│   │       ├── fico-min.ts                  # { value: int(300..850) }
│   │       ├── dti-max.ts                   # { value: 0..100 }
│   │       ├── reserves-min.ts              # { value, unit: 'months' | 'dollars' }
│   │       ├── derog-seasoning.ts           # full DerogRule (event_type enum, measurement_anchor, base/extenuating waits, post_event_LTV_caps, mortgage_included_in_bk_rule)
│   │       ├── income-doc-method.ts         # bank-statement / FULL_DOC / WVOE / asset depletion typed shape
│   │       ├── dscr-method.ts               # numerator_rule, denominator_method, min_dscr_by_ltv_tier, no-ratio
│   │       ├── geo-state.ts                 # { allowList: string[2][], denyList: string[2][] }
│   │       ├── geo-county.ts                # entries with state + 5-digit FIPS + allowed
│   │       ├── occupancy-allow.ts           # values: ('PRIMARY'|'SECOND_HOME'|'INVESTMENT')[]
│   │       ├── purpose-allow.ts             # values: PurposeValue[] (7 values)
│   │       ├── property-type-allow.ts       # values: PropertyTypeValue[] (7 values)
│   │       ├── doc-type-allow.ts            # values: DocTypeValue[] (8 values)
│   │       ├── mi-required.ts               # { required: bool, providers: string[] }
│   │       └── manual-uw-path.ts            # { allowed: bool, compensatingFactors: string[] }
│   └── tenant/
│       └── context.ts                       # setTenantContext(tx, tenantId) → SELECT set_config('app.tenant_id', $1, true)
│
├── tests/
│   ├── rls/                                 # Cross-tenant pen tests (vitest.config.ts)
│   │   ├── global-setup.ts                  # Truncates tables, runs drizzle-kit migrate, GRANTs to app_user
│   │   ├── setup.ts                         # beforeAll sanity checks: BYPASSRLS guard, FORCE RLS guard, policy-name guard
│   │   ├── seedTwoTenants.ts                # Seeds 2 tenants + canary + program family + shared agency_rule_version
│   │   ├── env-boot.test.ts                 # CFG-05 boot-fail-closed (no DB; vi.stubEnv + vi.resetModules)
│   │   ├── cross-tenant-select.test.ts      # SELECT returns 0 rows on canary
│   │   ├── cross-tenant-write.test.ts       # INSERT with mismatched tenant_id rejected
│   │   ├── jwt-tampering.test.ts            # Forged JWT with tampered tenant_id still gates
│   │   ├── guc-reset.test.ts                # is_local=true GUC dies on ROLLBACK; pooled-conn reuse safe
│   │   ├── service-role-boundary.test.ts    # SUPABASE_SERVICE_ROLE_KEY not in env; DATABASE_URL points at app_user
│   │   ├── index-scan.test.ts               # rls_canary_tenant_idx exists; EXPLAIN uses Index Scan
│   │   ├── program-cross-tenant.test.ts     # D-03 matrix on program (Phase 2)
│   │   ├── program-version-cross-tenant.test.ts   # D-03 matrix on program_version
│   │   ├── program-rule-cross-tenant.test.ts      # D-03 matrix on program_rule
│   │   ├── rule-citation-cross-tenant.test.ts     # D-03 matrix on rule_citation
│   │   ├── lender-overlay-cross-tenant.test.ts    # D-03 matrix + FK-to-foreign-program edge case
│   │   └── fixtures/
│   │       ├── connection.ts                # connectAsTenant + connectAsAnonymous helpers
│   │       └── jwt.ts                       # mintJWT / forgeJWT / extractTenantIdFromJWT (HS256, jose)
│   ├── schema/                              # Schema-constraint tests (vitest.schema.config.ts)
│   │   ├── setup.ts                         # Opens __pgPool (app_user) + __pgAdminPool (postgres)
│   │   ├── program-version-exclude.test.ts  # EXCLUDE on program_version blocks overlapping active rows; allows draft
│   │   ├── agency-rule-version-exclude.test.ts # EXCLUDE on agency_rule_version blocks overlapping per-agency rows
│   │   ├── program-rule-layer-check.test.ts # pgEnum rejects layer='AGENCY_BASE'
│   │   ├── min-confidence-generated.test.ts # GENERATED STORED via jsonb_min_numeric IMMUTABLE wrapper
│   │   ├── citation-source-check.test.ts    # rule_citation_has_source CHECK rejects both NULL
│   │   ├── citation-fk.test.ts              # program_rule.primary_citation_id NOT NULL + FK
│   │   ├── agency-cross-tenant-readable.test.ts # world_read SELECT under tenant + anonymous; INSERT from app_user denied
│   │   ├── derog-rule-roundtrip.test.ts     # SC#2: FNMA derog round-trip via Postgres + partial expression index
│   │   ├── detect-loosenings.test.ts        # ltv_max overlay > agency returns 1 row; restrictive returns 0
│   │   └── fixtures/
│   │       └── seed.ts                      # seedTenantWithProgramAndCitation + seedAgencyDerogRule + truncateAllTables
│   └── rules/                               # Zod-unit tests (no DB; vitest.schema.config.ts)
│       ├── dispatch-table.test.ts           # ruleKinds has 17 values; parseRuleBody routes correctly
│       ├── numeric-kinds.test.ts            # ltv/cltv/hcltv/fico/dti/reserves bounds
│       ├── allow-list-kinds.test.ts         # 4 allow-lists + geo_state + geo_county + mi + manual_uw_path
│       ├── derog-seasoning.test.ts          # FNMA fixture parse + reject malformed
│       ├── dscr-method.test.ts              # numerator/denominator/no-ratio/IO denominator
│       ├── income-doc-method.test.ts        # bank-statement/FULL_DOC/CPA letter
│       └── fixtures/
│           └── fnma-foreclosure.ts          # FNMA Selling Guide B3-5.3-07 DerogRule fixture (SC#2)
│
├── scripts/
│   └── init-db.sh                           # Postgres docker-entrypoint init: creates app_user + system_role, GRANTs
│
├── drizzle.config.ts                        # drizzle-kit config: schema → ./db/schema/index.ts; out → ./db/migrations
├── package.json                             # pnpm scripts: db:up/down/migrate, test:rls, test:schema, lint, typecheck
├── tsconfig.json                            # ES2022 / NodeNext; includes lib/, db/, tests/; excludes src/, build/, .next
├── vitest.config.ts                         # RLS pen-test config (forks, isolate, sequence.concurrent:false)
├── vitest.schema.config.ts                  # Schema + Zod-unit test config
├── vitest.env-boot.config.ts                # Standalone env-boot config (Plan 01-02 historical)
├── eslint.config.mjs                        # Flat config: blocks process.env reads + service-role* imports from app paths
├── docker-compose.yml                       # Postgres 16 service definition
├── README.md
├── AGENTS.md
└── CLAUDE.md
```

## Directory Purposes

**`db/migrations/`:**
- Purpose: Drizzle-applied SQL migrations. Both auto-generated and `--custom` migrations live side-by-side in numeric order.
- Contains: 7 numbered migrations (0000–0006), `meta/_journal.json` (Drizzle migration tracking), per-migration JSON snapshots used by drizzle-kit for diffing.
- Key files: `0001_force_rls.sql`, `0003_force_rls_program.sql`, `0005_force_rls_agency.sql` (FORCE RLS — Drizzle 0.45 cannot model FORCE), `0004_program_constraints.sql` (EXCLUDE + CHECK + GENERATED + partial expression index), `0006_detect_loosenings.sql` (Postgres function).

**`db/schema/`:**
- Purpose: TypeScript Drizzle table definitions. Each file co-locates columns, indexes, RLS policies, TypeScript types.
- Contains: 9 table files, 1 role file, 1 custom type, 1 barrel index.
- Key files: `index.ts` (barrel — `drizzle.config.ts` reads this single import path), `tenant.ts` (tenant_kind enum), `program-rule.ts` (canonical `rule_kind` + `program_rule_layer` enums; the 17-value `rule_kind` pgEnum is re-imported by `agency-rule.ts` and `lender-overlay-rule.ts`).

**`lib/`:**
- Purpose: Application-side TypeScript code. Currently three subsystems: env validation, Postgres client, tenant GUC primitive, plus the rule schema dispatch.
- Contains: `env.ts`, `db/client.ts`, `tenant/context.ts`, `rules/schemas/` (17 schemas + dispatch).
- Key files: `lib/env.ts` (boot-time t3-env Zod validation), `lib/db/client.ts` (postgres-js with `prepare: false`), `lib/tenant/context.ts` (`setTenantContext` GUC primitive), `lib/rules/schemas/index.ts` (`parseRuleBody` dispatch).

**`tests/rls/`:**
- Purpose: Cross-tenant pen tests using raw `pg` (not Drizzle). Exercises the SQL contract directly.
- Contains: 13 test files + 2 setup files + 1 seed helper + fixtures subdirectory.
- Key files: `setup.ts` (FORCE-RLS sanity check; aborts suite on regression), `global-setup.ts` (runs `drizzle-kit migrate`), `seedTwoTenants.ts` (canonical bootstrap + program family seeder), `fixtures/connection.ts` (`connectAsTenant` + `connectAsAnonymous`), `fixtures/jwt.ts` (HS256 JWT minting).

**`tests/schema/`:**
- Purpose: Schema-constraint tests — EXCLUDE, CHECK, FK, GENERATED, RLS policy enforcement. Uses both `app_user` and `postgres` pools (agency-side seeds require postgres).
- Contains: 9 test files + setup + fixtures/seed.ts.
- Key files: `setup.ts` (constructs `__pgPool` + `__pgAdminPool` globals), `fixtures/seed.ts` (`seedTenantWithProgramAndCitation`, `seedAgencyDerogRule`, `truncateAllTables`).

**`tests/rules/`:**
- Purpose: Zod-unit tests for the 17 `rule_body` schemas. No DB. Validates parse-good and reject-bad cases per CONTEXT D-09.
- Contains: 6 test files (dispatch + 5 grouped schema test files) + `fixtures/fnma-foreclosure.ts`.
- Key files: `dispatch-table.test.ts` (ruleKinds tuple length + parseRuleBody routing), `derog-seasoning.test.ts` (FNMA SC#2 fixture).

**`scripts/`:**
- Purpose: Bash provisioning script(s) run outside the TS toolchain.
- Contains: `init-db.sh` only.
- Key files: `init-db.sh` (Postgres docker-entrypoint hook — creates `app_user NOBYPASSRLS NOSUPERUSER` and `system_role NOLOGIN NOBYPASSRLS NOSUPERUSER`, GRANTs).

## Key File Locations

**Schema entry point:**
- `db/schema/index.ts` — barrel re-export consumed by `drizzle.config.ts`.

**Migration entry point:**
- `db/migrations/0000_initial.sql` … `db/migrations/0006_detect_loosenings.sql` — applied in numeric order via `drizzle-kit migrate`.

**Tenant GUC primitive:**
- `lib/tenant/context.ts` — `setTenantContext(tx, tenantId)`. The literal string `app.tenant_id` appears in exactly three places: this file, `db/schema/*.ts` policies, and `tests/rls/*` tests.

**Rule kind dispatch:**
- `lib/rules/schemas/index.ts` — `ruleKinds` tuple (17 values), `ruleBodySchemas` dispatch, `parseRuleBody(kind, body)`.

**Configuration:**
- `drizzle.config.ts` — drizzle-kit config (uses `DATABASE_MIGRATION_URL` falling back to `DATABASE_URL`).
- `tsconfig.json` — ES2022 / NodeNext; includes `lib/`, `db/`, `tests/`; excludes `src/`, `build/`, `.next`.
- `package.json` — pnpm scripts (`db:up`, `db:migrate`, `test:rls`, `test:schema`, `lint`, `typecheck`).
- `vitest.config.ts` — RLS pen-test config.
- `vitest.schema.config.ts` — schema + Zod-unit test config.
- `eslint.config.mjs` — flat config blocking `process.env` reads from app paths.
- `docker-compose.yml` — Postgres 16 + scripts/init-db.sh mount.

**Postgres client:**
- `lib/db/client.ts` — postgres-js + Drizzle. Phase 1 ships the wiring; Phase 6 wires it into Server Actions / route handlers.

**Boot-time env:**
- `lib/env.ts` — t3-env. `import { env } from './env.js'` throws if `DATABASE_URL` is missing/malformed.

**Postgres roles:**
- `app_user` — runtime + pen tests. `NOBYPASSRLS NOSUPERUSER`. Created by `scripts/init-db.sh`.
- `system_role` — agency-rule cross-tenant reads + agency authoring. `NOLOGIN NOBYPASSRLS NOSUPERUSER`. Granted to `postgres` (the migration role) so Phase 3 hand-authoring writes via `system_role` policy.
- `postgres` — migration role + agency-side test seeds. Default Postgres superuser; only role that can `ALTER TABLE ... FORCE ROW LEVEL SECURITY` and write to `agency_rule` / `agency_rule_version`.

**Postgres function:**
- `detect_loosenings(uuid)` at `db/migrations/0006_detect_loosenings.sql`. `LANGUAGE sql STABLE SECURITY INVOKER`. Returns rows for each `INVESTOR_OVERLAY` rule that is more permissive than the linked `AGENCY_BASE` rule. Known issue: REVIEW.md CR-01 flagged a JOIN bug for `derog_seasoning`.

**Postgres extension:**
- `btree_gist` (created in `db/migrations/0004_program_constraints.sql`) — required for `EXCLUDE USING gist (... WITH =, ... WITH &&)` constraints on `program_version` and `agency_rule_version`.

## Naming Conventions

**Files:**
- TypeScript files in `db/schema/`, `lib/`, `tests/`: kebab-case (`program-version.ts`, `lender-overlay-rule.ts`, `derog-seasoning.ts`).
- SQL migrations: zero-padded numeric prefix + snake_case description (`0004_program_constraints.sql`).
- Test files: `<subject>.test.ts` (e.g., `cross-tenant-select.test.ts`, `program-version-exclude.test.ts`).
- Setup files: `setup.ts`, `global-setup.ts`.
- Fixture files: under `fixtures/` subdirectory in each test suite.
- Type-only modules under `_types/` (leading underscore signals "scaffolding, not domain").

**Tables:**
- snake_case singular (`program`, `program_version`, `program_rule`, `rule_citation`, `agency_rule`, `agency_rule_version`, `lender_overlay_rule`).
- Underscore prefix for fixtures-only tables (`_rls_canary`).

**Columns:**
- snake_case (`tenant_id`, `program_version_id`, `effective_period`, `source_pdf_sha256`, `field_confidence`, `min_confidence`).

**Indexes:**
- `<table>_<columns>_idx` (e.g., `program_tenant_idx`, `program_rule_version_layer_kind_idx`, `agency_rule_derog_event_idx`).

**RLS policies:**
- Tenant-scoped: `<table>_tenant_isolation` (e.g., `program_tenant_isolation`, `rule_citation_tenant_isolation`).
- Self-filtering on `tenant`: `tenant_self_filter`.
- World-read on agency: `<table>_world_read`.
- System-write on agency: `<table>_system_write`.

**Pgenums:**
- snake_case singular (`tenant_kind`, `rule_kind`, `program_rule_layer`).
- Values: SCREAMING_SNAKE_CASE for category-style enums (`BROKERAGE`, `INVESTOR_OVERLAY`, `BK7`, `FORECLOSURE`).
- Values: lowercase snake_case for technical-key enums (`ltv_max`, `derog_seasoning`, `geo_state`).

**Drizzle TS types:**
- Table type: `typeof <camelCase> .$inferSelect` exported as PascalCase (`Tenant`, `ProgramVersion`, `RuleCitation`).
- Insert type: `typeof <camelCase> .$inferInsert` exported as `New<PascalCase>` (`NewTenant`, `NewProgramVersion`).

**Zod schemas:**
- `<kindCamelCase>Schema` (e.g., `ltvMaxSchema`, `derogSeasoningSchema`, `dscrMethodSchema`).
- TypeScript types via `z.infer`: PascalCase (`LtvMax`, `DerogSeasoning`).

**Postgres GUC:**
- `app.tenant_id` — exactly three references in the codebase: `lib/tenant/context.ts` (the helper), `db/schema/*.ts` policies, `tests/rls/*` tests. Any other reference is a smell.

## Where to Add New Code

**New tenant-scoped table:**
1. Add `db/schema/<table-name>.ts` following the pattern in `db/schema/program.ts` or `db/schema/program-rule.ts`:
   - `tenant_id uuid NOT NULL REFERENCES tenant(id)`.
   - `index('<table>_tenant_idx').on(t.tenantId)`.
   - `pgPolicy('<table>_tenant_isolation', { for: 'all', to: 'public', using: tenant_id = GUC, withCheck: tenant_id = GUC })`.
2. Append `export * from './<table-name>.js'` to `db/schema/index.ts`.
3. Run `pnpm db:generate` to emit `db/migrations/NNNN_<auto-tag>.sql`.
4. Author `db/migrations/NNNN+1_force_rls_<table>.sql` (`--custom`):
   - `ALTER TABLE "<table>" FORCE ROW LEVEL SECURITY;`
   - `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "<table>" TO app_user;`
5. Extend `tests/rls/setup.ts`'s `FORCED_TABLES` array and policy-name `required` array to include the new table.
6. Add a `tests/rls/<table>-cross-tenant.test.ts` covering the 6-case D-03 matrix (cross-tenant SELECT, anonymous, in-tenant SELECT, cross-tenant INSERT, cross-tenant UPDATE, cross-tenant DELETE).

**New `rule_kind`:**
1. Append the kind to the pgEnum literal in `db/schema/program-rule.ts`'s `ruleKind` declaration (must be appended; reordering breaks migrations).
2. Append the kind to the `ruleKinds` tuple in `lib/rules/schemas/index.ts`.
3. Author `lib/rules/schemas/<kind-name>.ts` exporting `<kindCamelCase>Schema = z.object({...})` and `type <PascalCase> = z.infer<...>`.
4. Add the schema to the `ruleBodySchemas` dispatch in `lib/rules/schemas/index.ts`. The `satisfies Record<RuleKind, z.ZodType>` clause makes a missing entry a compile error.
5. Add re-export to the bottom of `lib/rules/schemas/index.ts`.
6. Generate migration (`pnpm db:generate`) — drizzle-kit will emit the `ALTER TYPE rule_kind ADD VALUE` statement.
7. If the new kind needs `detect_loosenings` coverage, extend the function in a new `--custom` migration (don't edit `0006`).
8. Add tests in `tests/rules/` (parse-good + reject-bad) and, if the kind has structural shape (not just `{ value }`), add a round-trip test in `tests/schema/`.

**New `--custom` migration (FORCE RLS, EXCLUDE, CHECK, GENERATED, CREATE FUNCTION):**
1. Create `db/migrations/NNNN_<descriptive-name>.sql` numbered AFTER the latest auto-generated migration. Do not edit existing migrations.
2. Document at the top why this is `--custom` (cite Drizzle 0.45 limitation or specific pitfall reference).
3. Add the entry to `db/migrations/meta/_journal.json` with the next `idx`, current `when` epoch ms, and the file's `tag`.
4. Run `pnpm db:migrate` locally to verify it applies cleanly.
5. Verify CI's `pnpm test:rls` job picks it up.

**New Postgres function:**
- Author in a `--custom` migration (see above). Match the pattern in `db/migrations/0006_detect_loosenings.sql`:
  - `CREATE OR REPLACE FUNCTION ... LANGUAGE sql STABLE|IMMUTABLE SECURITY INVOKER` (default INVOKER so caller's tenant context applies via RLS).
  - Document why STABLE vs IMMUTABLE.
  - Add a unit test in `tests/schema/<function-name>.test.ts`.

**New pen-test fixture:**
- Top-level helpers (returning structural seed IDs) live at `tests/rls/seedTwoTenants.ts` (cross-suite shared) or `tests/schema/fixtures/seed.ts` (schema-suite-specific).
- Connection helpers stay at `tests/rls/fixtures/connection.ts`.
- JWT helpers stay at `tests/rls/fixtures/jwt.ts`.

**New env var:**
- Add to `server: { ... }` in `lib/env.ts` with a Zod validator.
- Update `.env.local.example` to document the var (existence only; never commit values).
- If the var is auth-related and must NEVER appear in app paths, add an ESLint `no-restricted-properties` entry in `eslint.config.mjs` mirroring the `SUPABASE_SERVICE_ROLE_KEY` pattern.

## Special Directories

**`db/migrations/meta/`:**
- Purpose: drizzle-kit's migration journal and per-migration JSON snapshots.
- Generated: Yes — `drizzle-kit generate` writes here.
- Committed: Yes — required for `drizzle-kit migrate` to know which migrations have applied; also the snapshot diffing source of truth.
- Manual edits: Only `_journal.json` when authoring a `--custom` migration outside the generator's awareness.

**`db/schema/_types/`:**
- Purpose: Drizzle custom types not tied to a specific table. Leading underscore signals scaffolding rather than domain.
- Currently contains: `daterange.ts`.
- Committed: Yes.

**`tests/*/fixtures/`:**
- Purpose: Per-suite test fixtures (connection helpers, seed factories, sample rule bodies).
- Generated: No.
- Committed: Yes.

**`build/`:**
- Purpose: Legacy CRA build output from the prototype at `src/App.js`.
- Generated: Yes (by old `react-scripts build`).
- Committed: Yes (already in tree from prototype era).
- Treatment: Out of rebuild scope. Do not extend; do not depend on.

**`src/`:**
- Purpose: Legacy React prototype (`src/App.js`, ~1,775 lines per README).
- Excluded from `tsconfig.json` (`exclude: ["src", ...]`) and from this analysis.
- Treatment: Reference-only for LO scenario form shape per the task brief; do not extend.

**`.planning/`:**
- Purpose: GSD workflow planning artifacts (PROJECT.md, ROADMAP.md, REQUIREMENTS.md, per-plan workspaces, codebase analysis docs).
- Out of rebuild scope; product-management substrate only.

**`node_modules/`:**
- Generated: Yes (`pnpm install`).
- Committed: No.

---

*Structure analysis: 2026-05-01*
