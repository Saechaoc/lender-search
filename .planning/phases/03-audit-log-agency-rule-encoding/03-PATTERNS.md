# Phase 3: Audit Log + Agency Rule Encoding - Pattern Map

**Mapped:** 2026-05-04
**Files analyzed:** 35 (new + modified) across schema, migrations, lib, fixtures, scripts, tests, config
**Analogs found:** 33 / 35 (94% coverage; 2 files have no exact analog and use research patterns)

---

## File Classification

### Schema files (`db/schema/*.ts`)

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|-----------|----------------|---------------|
| `db/schema/evaluation-event.ts` | schema (system+tenant; partitioned) | append-only insert | `db/schema/agency-rule-version.ts` (system-owned) + `db/schema/program-version.ts` (tenant_id RLS) | hybrid match |
| `db/schema/cascade-review-queue.ts` | schema (tenant-scoped + system_role write) | event-driven trigger fan-out | `db/schema/program-version.ts` (tenant RLS) + `db/schema/agency-rule-version.ts` (system_role write) | hybrid match |
| `db/schema/conforming-loan-limit-version.ts` | schema (system-owned versioned) | reference data CRUD | `db/schema/agency-rule-version.ts` | exact role |
| `db/schema/conforming-loan-limit-county.ts` | schema (system-owned child rows; composite PK) | reference data CRUD | `db/schema/agency-rule.ts` (FK to *_version + system policies) | role + flow match |
| `db/schema/program-version.ts` (DELTA: +`conforming_loan_limit_version_id`) | schema modification (one nullable FK column) | n/a | existing `program_version.agency_rule_version_id` column add (Phase 2) | exact pattern |
| `db/schema/index.ts` (DELTA: +5 re-exports) | barrel modification | n/a | existing barrel from Phase 2 | exact |

### Migrations (`db/migrations/*.sql`, all `--custom`)

| New File | Role | Pattern Source | Match Quality |
|----------|------|---------------|---------------|
| `db/migrations/0007_evaluation_event_partitioned.sql` | DDL: PARTITION BY RANGE + RLS + REVOKE + 6 inline partitions + `create_next_evaluation_event_partition()` SQL function | `db/migrations/0006_detect_loosenings.sql` (function shape) + `db/migrations/0001_force_rls.sql` (FORCE RLS) + `db/migrations/0003_force_rls_program.sql` (GRANT) | hybrid (no full analog: only partitioned table in repo) |
| `db/migrations/0008_evaluation_event_pg_cron.sql` | DDL: CREATE EXTENSION + cron.schedule with exception block fallback | `db/migrations/0004_program_constraints.sql` (CREATE EXTENSION btree_gist) | partial — needs DO $$ EXCEPTION wrapper for alpine fallback (Pitfall PG-5) |
| `db/migrations/0009_cascade_review_queue.sql` | DDL: FORCE RLS + system_role write + GRANT + `enqueue_agency_cascade()` plpgsql trigger function + CREATE TRIGGER | `db/migrations/0006_detect_loosenings.sql` (function definition shape) + `db/migrations/0005_force_rls_agency.sql` (FORCE + GRANT) | exact (`detect_loosenings` is the closest function shape; this one is plpgsql AFTER INSERT trigger) |
| `db/migrations/0010_conforming_loan_limit.sql` | DDL: EXCLUDE constraint + GRANT pattern for system-owned tables | `db/migrations/0004_program_constraints.sql` (EXCLUDE on `agency_rule_version`) + `db/migrations/0005_force_rls_agency.sql` (GRANT to app_user) | exact |
| `db/migrations/0011_program_version_conforming_fk.sql` | DDL: ALTER TABLE ADD COLUMN one-column delta | `db/migrations/0002_program_schema.sql` ALTER TABLE patterns (drizzle-generated) | role match (one-column FK delta) |

### Library code (`lib/`)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `lib/audit/snapshotId.ts` | utility (pure-TS hash) | transform | `lib/tenant/context.ts` (forward-compat seam pattern) | role match (both lock signature for future phase consumer) |
| `lib/audit/index.ts` | barrel | n/a | `lib/rules/schemas/index.ts` (barrel + dispatch) | partial (no dispatch table needed) |
| `lib/cascade/poll.ts` | service stub (async handler signature) | event-driven (Phase 6) | `lib/tenant/context.ts` (signature-locked forward-compat) | role match |
| `lib/cascade/index.ts` | barrel | n/a | `lib/rules/schemas/index.ts` re-export pattern | partial |
| `lib/agency-seeds/types.ts` | shared type definitions | n/a | `lib/rules/schemas/index.ts` (the `RuleKind` discriminated dispatch) | role match — Phase 3 needs `AgencyRuleSeed<T>` discriminated by rule_kind |
| `lib/agency-seeds/fnma/derog-seasoning.ts` | fixture (typed reference data) | reference data | `tests/rules/fixtures/fnma-foreclosure.ts` (single typed DerogSeasoning fixture) | exact pattern (Phase 3 generalizes to an array of 8 event types per agency) |
| `lib/agency-seeds/fhlmc/derog-seasoning.ts` | fixture | reference data | same as fnma | exact |
| `lib/agency-seeds/fha/derog-seasoning.ts` | fixture (active EC + back-to-work DEPRECATED export) | reference data | same as fnma + Pattern P5 (deprecated via versioned daterange) | exact + extension |
| `lib/agency-seeds/va/derog-seasoning.ts` | fixture | reference data | same as fnma | exact |
| `lib/agency-seeds/usda/version-stub.ts` | fixture (zero rule rows) | reference data | derived from agency-fixture but with empty `seeds[]` | partial (degenerate case of fnma pattern) |
| `lib/agency-seeds/fhfa/2026-conforming-limit-values-by-county.csv` | raw data file (committed CSV) | n/a | none in repo (first committed CSV) | NO ANALOG — research-pattern only |
| `lib/agency-seeds/fhfa/README.md` | documentation (annual update procedure) | n/a | none — only docs file in `lib/` (most lib doc is JSDoc) | NO ANALOG — research-pattern only |

### Scripts (`scripts/`)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `scripts/seed-agency.ts` | script (idempotent loader; postgres connection) | batch INSERT with ON CONFLICT | `scripts/init-db.sh` (DB connection pattern) + `tests/_shared/agency-fixture.ts::seedAgencyVersion` (transactional bootstrap + system_tenant pattern) | hybrid (init-db.sh is bash; seedAgencyVersion is the TS analog at runtime) |
| `scripts/seed-fhfa.ts` (or extension to seed-agency.ts) | script (CSV parse + batch insert) | file-I/O + batch INSERT | `scripts/seed-agency.ts` (sibling pattern) + `csv-parse@5.6` npm docs | partial (no in-repo CSV-loader analog) |

### Tests (`tests/`)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `tests/audit/evaluation-event-structural.test.ts` | structural test (table introspection + REVOKE) | n/a | `tests/schema/agency-rule-version-exclude.test.ts` (constraint introspection) + `tests/rls/setup.ts` (relforcerowsecurity / pg_class / pg_policies queries) | role match |
| `tests/audit/snapshot-id.test.ts` | unit test (pure-TS, no DB) | n/a | `tests/rules/derog-seasoning.test.ts` (Vitest unit test, no DB connection) | exact |
| `tests/agency/agency-version.test.ts` | structural test (queryable seed verification per agency) | n/a | `tests/schema/derog-rule-roundtrip.test.ts` (post-seed query of agency_rule) | exact |
| `tests/agency/fnma-derog.test.ts` | structural test (per-event-type assertions; golden snapshot) | n/a | `tests/schema/derog-rule-roundtrip.test.ts` + `tests/rules/derog-seasoning.test.ts` (combined: DB query + per-field assertion + sha256 snapshot) | exact pattern |
| `tests/agency/fhlmc-derog.test.ts` | structural test | n/a | same as fnma-derog | exact |
| `tests/agency/fha-derog.test.ts` | structural test (active + DEPRECATED queryable separately) | n/a | same as fnma-derog + Pattern P5 deprecated-program filter | exact + extension |
| `tests/agency/va-derog.test.ts` | structural test | n/a | same as fnma-derog | exact |
| `tests/cascade/poll-stub.test.ts` | unit test (typed handler signature; no DB) | n/a | `tests/rules/derog-seasoning.test.ts` (pure-TS no-DB pattern) | role match |
| `tests/cascade/cascade-trigger.test.ts` | integration test (D-17; trigger fires per affected program_version) | event-driven (trigger) | `tests/schema/detect-loosenings.test.ts` (admin connection + transactional INSERT + assertion) | exact pattern (different function: trigger vs SQL function) |
| `tests/rls/cascade-review-queue-cross-tenant.test.ts` | security test (cross-tenant matrix) | n/a | `tests/rls/program-cross-tenant.test.ts` (D-19 6-case matrix template) + `tests/rls/lender-overlay-cross-tenant.test.ts` (tenant-scoped table) | exact (template directly applicable) |
| `tests/schema/fhfa-loan-limits.test.ts` | structural test (EXCLUDE + FK introspection) | n/a | `tests/schema/agency-rule-version-exclude.test.ts` (EXCLUDE constraint test) + `tests/schema/derog-rule-roundtrip.test.ts` (post-seed query) | exact |

### Modified files

| File | Modification | Pattern Source |
|------|-------------|----------------|
| `tests/rls/global-setup.ts` | extend to call `pnpm db:seed` after migrate (Step 2.5 between drizzle-kit migrate and GRANT block) | extends existing Step 2 pattern |
| `tests/schema/setup.ts` | extend to call `pnpm db:seed` after the (already-applied) migrations are confirmed | extends existing pattern |
| `tests/rls/seedTwoTenants.ts` | OPTIONAL: extend `seedSharedAgency` if Phase 3 production seed needs in-test parity | optional refactor |
| `.github/workflows/ci.yml` | add `pnpm db:seed` step after `pnpm drizzle-kit migrate` (line 111) | extends existing migrations step block |
| `package.json` | add `"db:seed": "tsx scripts/seed-agency.ts && tsx scripts/seed-fhfa.ts"` | extends scripts block |
| `vitest.schema.config.ts` | extend `include` array: add `'tests/audit/**/*.test.ts'`, `'tests/agency/**/*.test.ts'`, `'tests/cascade/**/*.test.ts'` | extends existing array |
| `drizzle.config.ts` | NO CHANGE — two-connection-string pattern carries forward unchanged | existing |

---

## Pattern Assignments

### `db/schema/evaluation-event.ts` (schema, partitioned + tenant-scoped)

**Hybrid analog:** `db/schema/agency-rule-version.ts` (for system-owned + version metadata) + `db/schema/program-version.ts` (for tenant_id + tenant_isolation policy)

**Header / JSDoc pattern from `agency-rule-version.ts:1-22`:**
```typescript
/**
 * agency_rule_version — system-owned versioned agency rule snapshot.
 * ...
 * Per CONTEXT D-05: this table is NOT tenant-scoped.
 * ...
 * Per CONTEXT D-16: columns are id, agency (text NOT NULL ...
```
**Adopt the JSDoc-block convention listing CONTEXT decision IDs and Pitfall references; for evaluation_event reference D-01..D-04 + Pitfall PG-1.**

**Tenant-isolation policy pattern from `program-version.ts:80-86`:**
```typescript
pgPolicy('program_version_tenant_isolation', {
  as: 'permissive',
  for: 'all',
  to: 'public',
  using: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
  withCheck: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
}),
```
**Apply to evaluation_event** as `evaluation_event_tenant_isolation`. Parent-only policy per Pitfall PG-1 — RLS policies on the parent suffice when all traffic routes through the parent.

**Index pattern from `program-version.ts:78-79`:**
```typescript
index('program_version_tenant_idx').on(t.tenantId),
index('program_version_agency_rule_version_idx').on(t.agencyRuleVersionId),
```
**Adopt** `evaluation_event_tenant_evaluated_idx` on `(tenantId, evaluatedAt DESC)` per RESEARCH §Audit Log Architecture.

**DELTA from analogs (Phase 3-specific):**
- Drizzle 0.45 does NOT model `PARTITION BY RANGE` — the parent table + every child partition + REVOKE statements ship via `--custom` migration `0007_evaluation_event_partitioned.sql`. The Drizzle `pgTable()` declaration here is for type generation only; the actual DDL lives in the migration. This is similar to how Phase 2 declared `effectivePeriod` as a `daterange` custom type but the EXCLUDE constraint lived in `--custom` migration.
- Composite PK `(id, evaluated_at)` because Postgres requires the partition key column in the PK on partitioned tables. Drizzle doesn't natively model this; the pgTable declaration must use a composite primary key (`primaryKey({ columns: [t.id, t.evaluatedAt] })`).
- `decision text` CHECK IN ('eligible','near_miss','ineligible') — drizzle-kit can model column CHECK natively (via `check()` from `drizzle-orm/pg-core`); pattern from `db/schema/cascade-review-queue.ts` status check.
- `evaluator_version text NOT NULL CHECK (length(evaluator_version) > 0)` — the non-empty CHECK lands in `--custom` migration; column-level CHECK is harder in drizzle-kit.

---

### `db/schema/cascade-review-queue.ts` (schema, tenant-scoped + system_role write)

**Primary analog:** `db/schema/program-version.ts` (tenant-scoped + tenant_isolation policy) + `db/schema/agency-rule-version.ts` (system_role policy)

**Tenant-isolation pattern (lines 80-86 of `program-version.ts`):** identical to evaluation-event above. Apply as `cascade_review_queue_tenant_isolation`.

**System-role write pattern from `agency-rule-version.ts:50-56`:**
```typescript
pgPolicy('agency_rule_version_system_write', {
  as: 'permissive',
  for: 'all',
  to: systemRole,
  using: sql`true`,
  withCheck: sql`true`,
}),
```
**Apply to cascade_review_queue** as `cascade_review_queue_system_write`. The trigger function inserts under system_role membership, bypassing the GUC requirement — this is **why both policies coexist** on this table.

**FK + tenant_id pattern from `program-version.ts:50-58`:**
```typescript
tenantId: uuid('tenant_id')
  .notNull()
  .references(() => tenant.id),
programId: uuid('program_id')
  .notNull()
  .references(() => program.id),
agencyRuleVersionId: uuid('agency_rule_version_id')
  .notNull()
  .references(() => agencyRuleVersion.id),
```
**Apply** for `cascade_review_queue` columns `tenant_id`, `program_version_id`, `prior_agency_rule_version_id`, `new_agency_rule_version_id`.

**Status CHECK pattern (Drizzle-native `check()` from drizzle-orm/pg-core):**
```typescript
import { check } from 'drizzle-orm/pg-core';
// ...
check('cascade_review_queue_status_check',
  sql`${t.status} IN ('pending','claimed','completed','dismissed')`),
```

**DELTA:**
- Two-policy shape (tenant_isolation + system_write coexisting on the same table) is unprecedented in the existing codebase — agency tables have system_write only, tenant tables have tenant_isolation only. Phase 3 introduces this hybrid. Document this in the JSDoc per the pattern from `lender-overlay-rule.ts:23-25` (Pitfall 3.5 release-blocker callout).
- FORCE RLS lands in the `--custom` migration `0009_cascade_review_queue.sql` per the same `0003_force_rls_program.sql` pattern.
- Two indexes per Claude's Discretion: `(tenant_id, status, created_at)` for AM read + `(status, created_at)` partial WHERE status='pending' for the worker claim path.

---

### `db/schema/conforming-loan-limit-version.ts` (schema, system-owned versioned)

**Exact analog:** `db/schema/agency-rule-version.ts`

**Imports + table declaration from `agency-rule-version.ts:23-58`:**
```typescript
import { type AnyPgColumn, index, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { systemRole } from './system-role.js';
import { daterange } from './_types/daterange.js';

export const agencyRuleVersion = pgTable(
  'agency_rule_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agency: text('agency').notNull(),
    versionLabel: text('version_label').notNull(),
    sourceUrl: text('source_url'),
    sourcePdfSha256: text('source_pdf_sha256'),
    effectivePeriod: daterange('effective_period').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
    supersededBy: uuid('superseded_by').references((): AnyPgColumn => agencyRuleVersion.id),
  },
  (t) => [
    index('agency_rule_version_agency_idx').on(t.agency),
    pgPolicy('agency_rule_version_world_read', { /* SELECT TO public */ }),
    pgPolicy('agency_rule_version_system_write', { /* ALL TO system_role */ }),
  ],
);
```

**Adopt verbatim for `conforming_loan_limit_version`**, replacing `agency` → `year integer`, dropping `superseded_by` (the version chain uses effective_period bracketing only). Add `index('conforming_loan_limit_version_year_idx').on(t.year)`.

**DELTA:**
- `year integer NOT NULL` instead of `agency text NOT NULL`
- `source_url text NOT NULL` (different from agency_rule_version.source_url which is nullable; FHFA always has the canonical URL)
- No `superseded_by` self-FK (version chain is via effective_period close convention only — D-23 two-step)
- EXCLUDE constraint `(year WITH =, effective_period WITH &&)` lands in `--custom` migration `0010_conforming_loan_limit.sql` (same pattern as `0004_program_constraints.sql:93-95`).

---

### `db/schema/conforming-loan-limit-county.ts` (schema, system-owned child rows)

**Exact analog:** `db/schema/agency-rule.ts` (FK to agency_rule_version + system policies; no tenant_id)

**Imports + table declaration shape from `agency-rule.ts:22-62`:**
```typescript
import { index, jsonb, pgPolicy, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { systemRole } from './system-role.js';
import { agencyRuleVersion } from './agency-rule-version.js';
// ...
export const agencyRule = pgTable('agency_rule', {
  id: uuid('id').primaryKey().defaultRandom(),
  agencyRuleVersionId: uuid('agency_rule_version_id')
    .notNull()
    .references(() => agencyRuleVersion.id),
  // ...
}, (t) => [
  pgPolicy('agency_rule_world_read', { for: 'select', to: 'public', using: sql`true` }),
  pgPolicy('agency_rule_system_write', { for: 'all', to: systemRole, using: sql`true`, withCheck: sql`true` }),
]);
```

**DELTA:**
- Composite primary key `(limit_version_id, county_fips)` instead of single `id` — uses `primaryKey({ columns: [t.limitVersionId, t.countyFips] })` from `drizzle-orm/pg-core`. No analog in the existing repo for composite PK; verify with Drizzle docs.
- `county_fips text NOT NULL` (5-char FIPS code, leading zeros preserved per Pitfall PG-7)
- 9 numeric columns for unit-tier × baseline/high-balance variants
- `is_high_cost boolean NOT NULL DEFAULT false` (per Open Question 7: stored at load time)

---

### `db/schema/program-version.ts` (DELTA: +`conforming_loan_limit_version_id` column)

**Pattern source:** the existing `agency_rule_version_id` column at `program-version.ts:56-58`:
```typescript
agencyRuleVersionId: uuid('agency_rule_version_id')
  .notNull()
  .references(() => agencyRuleVersion.id),
```

**Apply the same shape**, but as nullable:
```typescript
conformingLoanLimitVersionId: uuid('conforming_loan_limit_version_id')
  .references(() => conformingLoanLimitVersion.id),  // no .notNull() — D-22 nullable FK
```

**DELTA:**
- Migration `0011_program_version_conforming_fk.sql` (`--custom`) ALTERs the existing table; the schema TS file declaration lands in this PR for forward-typed Drizzle queries.
- Phase 4 evaluator dereferences when non-null per D-22.

---

### `db/migrations/0007_evaluation_event_partitioned.sql` (`--custom`)

**Multi-analog:** `0006_detect_loosenings.sql` (function definition shape) + `0001_force_rls.sql` + `0003_force_rls_program.sql` (FORCE + GRANT) + `0004_program_constraints.sql` (CREATE EXTENSION pattern; explanatory header comments).

**Header comment pattern from `0006_detect_loosenings.sql:1-32`:**
```sql
-- Phase 2 / Plan 02-06 Task 2: detect_loosenings(uuid) SQL function (D-12).
--
-- Per CONTEXT D-12 / SCH-03 + Phase 2 SC#4: ...
-- ...
-- SECURITY INVOKER (default): function runs with caller's permissions, ...
-- ...
-- Plan 02-08 D-20.5 test asserts:
--   - INSERT a fixture overlay loosening ltv_max above agency -> function
--     returns 1 row
```
**Adopt** for `0007_evaluation_event_partitioned.sql` header — call out CONTEXT D-01/D-02/D-03, Pitfall PG-1 (parent-only routing), Pitfall PG-2 (REVOKE inheritance to children).

**Function definition pattern from `0006_detect_loosenings.sql:34-45`:**
```sql
CREATE OR REPLACE FUNCTION detect_loosenings(p_program_version_id uuid)
  RETURNS TABLE (
    program_rule_id uuid,
    agency_rule_id uuid,
    dimension text,
    agency_value jsonb,
    overlay_value jsonb
  )
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
AS $$
  WITH
    overlay_rules AS (...)
  SELECT ...
$$;
```
**Adopt the function-definition skeleton** for `create_next_evaluation_event_partition()`. The Phase 3 function is `LANGUAGE plpgsql SECURITY INVOKER` (research §Audit Log Architecture) instead of `sql STABLE` because it does DDL via EXECUTE. Use `to_regclass()` idempotency guard per RESEARCH §pg_cron.

**FORCE pattern from `0001_force_rls.sql:18-19`:**
```sql
ALTER TABLE "tenant" FORCE ROW LEVEL SECURITY;
ALTER TABLE "_rls_canary" FORCE ROW LEVEL SECURITY;
```
**Apply** `ALTER TABLE evaluation_event FORCE ROW LEVEL SECURITY;` after the parent CREATE TABLE.

**GRANT pattern from `0003_force_rls_program.sql:24-32`:**
```sql
ALTER TABLE "program" FORCE ROW LEVEL SECURITY;
ALTER TABLE "program_version" FORCE ROW LEVEL SECURITY;
ALTER TABLE "program_rule" FORCE ROW LEVEL SECURITY;
ALTER TABLE "rule_citation" FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "program" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "program_version" TO app_user;
```
**Adapt for evaluation_event** — only `GRANT SELECT, INSERT` (D-02 maximalist REVOKE on UPDATE/DELETE). Apply REVOKE to PUBLIC, app_user, system_role per D-02.

**EXTENSION pattern from `0004_program_constraints.sql:36-37`:**
```sql
-- Step 1 — btree_gist extension (Pitfall B prereq for EXCLUDE).
CREATE EXTENSION IF NOT EXISTS btree_gist;
```
**Note for `0008_evaluation_event_pg_cron.sql`** — wrap `CREATE EXTENSION pg_cron` in a `DO $$ BEGIN ... EXCEPTION WHEN OTHERS THEN ... END $$` block per Pitfall PG-5 (alpine fallback). The `0004_program_constraints.sql` pattern is the no-fallback baseline; Phase 3's pg_cron migration adds the exception wrapper because alpine doesn't bundle pg_cron.

**DELTA / new patterns introduced by Phase 3:**
- `PARTITION BY RANGE (evaluated_at)` on parent — no analog in repo; research §Pattern P1 is the canonical reference.
- 6 inline `CREATE TABLE evaluation_event_y2026mNN PARTITION OF ... FOR VALUES FROM ... TO ...` per Claude's Discretion (chose inline DDL per Open Question 3 recommendation).
- `REVOKE UPDATE, DELETE ON evaluation_event FROM PUBLIC, app_user, system_role` — D-02 maximalist; no existing REVOKE pattern in repo (Phase 1+2 GRANTs only).
- Composite PK `(id, evaluated_at)` syntax in CREATE TABLE — Postgres-required for partitioned tables.

---

### `db/migrations/0008_evaluation_event_pg_cron.sql` (`--custom`)

**Closest analog:** `0004_program_constraints.sql:36-37` (CREATE EXTENSION pattern).

**Pattern adaptation needed (Pitfall PG-5):**
```sql
-- Wrap in DO block so alpine local dev (which omits pg_cron binaries) doesn't fail.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule(
    'create_next_evaluation_event_partition',
    '0 2 1 * *',
    $cron$ SELECT create_next_evaluation_event_partition() $cron$
  );
EXCEPTION
  WHEN undefined_file OR feature_not_supported OR insufficient_privilege THEN
    RAISE NOTICE 'pg_cron unavailable in this environment; partition cron not scheduled. Phase 6 wires Supabase managed scheduler.';
END
$$;
```

The `DO $$ ... EXCEPTION ...$$` pattern is documented in `scripts/init-db.sh:24-30`:
```bash
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'system_role') THEN
    CREATE ROLE system_role NOLOGIN NOBYPASSRLS NOSUPERUSER;
  END IF;
END
\$\$;
```
**Adopt the IF/EXCEPTION pattern.** The `0004_program_constraints.sql` CREATE EXTENSION btree_gist line is bare because btree_gist IS in alpine; pg_cron is NOT.

---

### `db/migrations/0009_cascade_review_queue.sql` (`--custom`)

**Primary analog:** `0006_detect_loosenings.sql` (function shape) + `0005_force_rls_agency.sql` (FORCE + GRANT for tables with mixed policies).

**Trigger function pattern (NEW; closest analog is `detect_loosenings` for plpgsql shape):**
```sql
CREATE OR REPLACE FUNCTION enqueue_agency_cascade()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
AS $$
BEGIN
  INSERT INTO cascade_review_queue (
    tenant_id, program_version_id,
    prior_agency_rule_version_id, new_agency_rule_version_id,
    status, created_at
  )
  SELECT pv.tenant_id, pv.id, prior.id, NEW.id, 'pending', now()
  FROM agency_rule_version prior
  JOIN program_version pv ON pv.agency_rule_version_id = prior.id
  WHERE prior.agency = NEW.agency
    AND prior.superseded_by = NEW.id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER agency_rule_version_cascade
  AFTER INSERT ON agency_rule_version
  FOR EACH ROW
  EXECUTE FUNCTION enqueue_agency_cascade();
```

**DELTA from detect_loosenings:**
- `LANGUAGE plpgsql` (not `sql`) because it's a row trigger doing INSERT side-effects
- `RETURNS trigger` (not table)
- VOLATILE (default; trigger writes side-effects) — `STABLE` was correct for `detect_loosenings` (read-only); `VOLATILE` is correct here
- `SECURITY INVOKER` — same posture as `detect_loosenings`; the cascade_review_queue system_write policy lets system_role members INSERT cross-tenant per Pattern P6.

**FORCE + GRANT pattern from `0005_force_rls_agency.sql:23-28`:**
```sql
ALTER TABLE "lender_overlay_rule" FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "lender_overlay_rule" TO app_user;
```
**Adapt** to `cascade_review_queue` — `ALTER TABLE cascade_review_queue FORCE ROW LEVEL SECURITY;` plus `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE cascade_review_queue TO app_user;` (UPDATE for the worker claim path; DELETE for retention later).

---

### `db/migrations/0010_conforming_loan_limit.sql` (`--custom`)

**Exact analog:** `0004_program_constraints.sql` (EXCLUDE constraint + system-table GRANT).

**EXCLUDE pattern from `0004_program_constraints.sql:93-95`:**
```sql
-- agency_rule_version: only ONE version per agency at a time.
ALTER TABLE "agency_rule_version"
  ADD CONSTRAINT "agency_rule_version_no_overlap"
  EXCLUDE USING gist ("agency" WITH =, "effective_period" WITH &&);
```

**Apply to conforming_loan_limit_version:**
```sql
ALTER TABLE "conforming_loan_limit_version"
  ADD CONSTRAINT "conforming_loan_limit_version_no_overlap"
  EXCLUDE USING gist ("year" WITH =, "effective_period" WITH &&);
```
**btree_gist already enabled by `0004_program_constraints.sql:37`** — no need to re-enable.

**GRANT pattern from `0005_force_rls_agency.sql:27-28`:**
```sql
GRANT SELECT ON TABLE "agency_rule_version" TO app_user;
GRANT SELECT ON TABLE "agency_rule" TO app_user;
```
**Apply:**
```sql
GRANT SELECT ON TABLE "conforming_loan_limit_version" TO app_user;
GRANT SELECT ON TABLE "conforming_loan_limit_county" TO app_user;
```

---

### `db/migrations/0011_program_version_conforming_fk.sql` (`--custom`)

**Pattern source:** standard ALTER TABLE ADD COLUMN — no full analog in repo (Phase 2 generates initial schema; Phase 3 first introduces post-hoc column delta).

**Pattern (research only — no in-repo analog):**
```sql
-- Phase 3 / Plan 03-XX: program_version conforming loan limit FK (AGY-09 / D-22).
ALTER TABLE "program_version"
  ADD COLUMN "conforming_loan_limit_version_id" uuid NULL
  REFERENCES "conforming_loan_limit_version"("id");
```

**Header comment pattern from `0001_force_rls.sql:1-15`:**
```sql
-- Phase 1 / TNT-01: Force RLS on every tenant-scoped table.
--
-- Drizzle 0.45's schema API does not model FORCE ROW LEVEL SECURITY ...
-- This file is INTENTIONALLY a separate migration from 0000_initial.sql.
-- drizzle-kit may regenerate 0000_initial.sql on the next schema change ...
```
**Adopt** the explanatory header pattern — call out CONTEXT D-22, the schema-as-code lockstep with `db/schema/program-version.ts` declaration, and the AGY-09 / Phase 4 dereference contract.

---

### `lib/audit/snapshotId.ts` (utility, pure-TS hash)

**Closest analog:** `lib/tenant/context.ts` (forward-compat seam pattern: signature locked at one phase, consumed unchanged at next).

**Header / JSDoc pattern from `lib/tenant/context.ts:1-35`:**
```typescript
/**
 * setTenantContext — the canonical RLS GUC primitive (TNT-02).
 *
 * Calls Postgres `set_config(...)` so RLS policies filter on ...
 * ...
 * Phase 1 / Phase 6 contract:
 *   - Phase 1 (this file): primitive only. Pen tests call set_config directly...
 *   - Phase 6: a `withTenantContext({ tenantId, fn })` middleware wraps every
 *     server action / route handler ...
 *
 * Reference:
 *   - postgresql.org/docs/16/runtime-config-custom.html
 */
```
**Adopt this JSDoc form** — call out the Phase 3 / Phase 4 contract (Phase 3 ships helper + 4-assertion test; Phase 4 evaluator imports unchanged as the canonical writer).

**Function shape — no in-repo analog for sha256/createHash. Use research §`lib/audit/snapshotId.ts` shape verbatim:**
```typescript
import { createHash } from 'node:crypto';

export interface VersionRef {
  id: string;
  recorded_at: string;  // ISO 8601 string per Pitfall PG-3
}

export interface SnapshotInput {
  agencyVersions: VersionRef[];
  programVersions: VersionRef[];
  overlayVersions: VersionRef[];
}

export function snapshotId(input: SnapshotInput): string {
  const canonical = {
    agency_versions: [...input.agencyVersions]
      .map((v) => ({ id: v.id, recorded_at: v.recorded_at }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    // ... same for program_versions, overlay_versions
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
```

**DELTA from `lib/tenant/context.ts`:**
- Pure function (no DB call)
- Synchronous (no async/await)
- No Drizzle types — `node:crypto` only
- Single-file export (no consumer middleware planned in this phase)

---

### `lib/audit/index.ts` (barrel)

**Pattern source:** `lib/rules/schemas/index.ts:88-105` (re-export pattern):
```typescript
export * from './ltv-max.js';
export * from './cltv-max.js';
// ...
```

**Apply minimal:**
```typescript
export * from './snapshotId.js';
```
No dispatch table needed; only one file.

---

### `lib/cascade/poll.ts` (service stub, async handler signature)

**Closest analog:** `lib/tenant/context.ts` (signature-locked forward-compat).

**Pattern from research §`lib/cascade/poll.ts` (no in-repo analog for async stub):**
```typescript
export interface PollResult {
  agency: 'FNMA' | 'FHLMC' | 'FHA' | 'VA' | 'USDA';
  versionLabel: string;
  sourceUrl: string;
  sourcePdfSha256: string | null;
  changeDetected: boolean;
}

export async function pollAgencyPublications(): Promise<PollResult[]> {
  return [];
}
```

**Adopt the JSDoc convention from `lib/tenant/context.ts:18-21`:**
```typescript
/**
 * Phase 3 / Phase 6 contract:
 *   - Phase 3 (this file): typed handler stub returning empty array; integration
 *     test exercises the consumer side (the trigger path that fires when an
 *     agency_rule_version is INSERTed)
 *   - Phase 6: lands real HTTP fetch + sha256-diff + Vercel Cron wiring (CFG-01)
 *     and the Inngest worker pool consumer (CFG-04)
 */
```

**DELTA:**
- `async`/`Promise<>` (lib/tenant/context.ts also async; pattern carries forward)
- No imports beyond the type definitions — Phase 3 stub does NOT pull in `pg`, `node:fetch`, or `crypto`. Phase 6 adds them when real fetch lands.

---

### `lib/cascade/index.ts` (barrel)

**Pattern source:** same as `lib/audit/index.ts`.

**Apply:**
```typescript
export * from './poll.js';
```

---

### `lib/agency-seeds/types.ts` (shared `AgencyRuleSeed<T>` type)

**Closest analog:** `lib/rules/schemas/index.ts` (the `RuleKind` discriminated dispatch).

**Discriminated-type pattern from `lib/rules/schemas/index.ts:43-76`:**
```typescript
export const ruleKinds = [
  'ltv_max', 'cltv_max', 'hcltv_max', /* ... */
] as const;

export type RuleKind = typeof ruleKinds[number];

export const ruleBodySchemas = {
  ltv_max: ltvMaxSchema,
  cltv_max: cltvMaxSchema,
  // ...
} as const satisfies Record<RuleKind, z.ZodType>;
```

**Adapt for AgencyRuleSeed:**
```typescript
import type { RuleKind } from '../rules/schemas/index.js';

export interface AgencyRuleSeedCitation {
  sourceUrl: string;
  excerpt: string;
}

export interface AgencyRuleSeed<TBody = unknown> {
  versionLabel: string;
  ruleKind: RuleKind;
  ruleBody: TBody;
  citation: AgencyRuleSeedCitation;
}
```
**The `<TBody = unknown>` generic** lets per-agency files type the body precisely (e.g., `AgencyRuleSeed<DerogSeasoning>` for derog-seasoning.ts) while the loader accepts the type-erased `AgencyRuleSeed` array.

---

### `lib/agency-seeds/<agency>/derog-seasoning.ts` (typed reference data; one per agency)

**Exact analog:** `tests/rules/fixtures/fnma-foreclosure.ts`

**Single-fixture pattern from `tests/rules/fixtures/fnma-foreclosure.ts:19-38`:**
```typescript
import type { DerogSeasoning } from '../../../lib/rules/schemas/derog-seasoning.js';

export const fnmaForeclosure: DerogSeasoning = {
  event_type: 'FORECLOSURE',
  measurement_anchor: 'COMPLETION',
  base_waiting_months: 84,
  extenuating_circumstances_waiting_months: 36,
  post_event_LTV_caps: [
    {
      months_since_min: 36,
      months_since_max: 84,
      max_LTV: 90,
      purposeAllowList: ['PURCHASE', 'RATE_TERM_REFI'],
      occupancyAllowList: ['PRIMARY'],
    },
  ],
  reestablished_credit_required: true,
  mortgage_included_in_bk_rule: 'BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED',
  notes_citations: ['FNMA Selling Guide B3-5.3-07'],
};
```

**Phase 3 generalization** (research §`lib/agency-seeds/fnma/derog-seasoning.ts`): export an **array** of typed seeds, one per event_type:
```typescript
import type { DerogSeasoning } from '../../rules/schemas/derog-seasoning.js';
import type { AgencyRuleSeed } from '../types.js';

const FNMA_VERSION_LABEL = 'FNMA-SEL-2026-04';
const FNMA_CITATION_BASE = 'https://selling-guide.fanniemae.com/sel/b3-5.3-07/';

export const fnmaDerogSeasoningSeeds: AgencyRuleSeed<DerogSeasoning>[] = [
  {
    versionLabel: FNMA_VERSION_LABEL,
    ruleKind: 'derog_seasoning',
    ruleBody: { /* BK7 body */ },
    citation: { sourceUrl: `${FNMA_CITATION_BASE}#BK_CHAPTER_7`, excerpt: '...' },
  },
  // ... 7 more rows: BK13_DISCHARGED, BK13_DISMISSED, MULTIPLE_BK,
  // FORECLOSURE (with post_event_LTV_caps), DEED_IN_LIEU, SHORT_SALE,
  // MORTGAGE_CHARGE_OFF (with mortgage_included_in_bk_rule)
];
```

**Per-agency content** comes from RESEARCH §"Per-agency content matrix":
- `fnma/derog-seasoning.ts`: 8 event types per FNMA matrix
- `fhlmc/derog-seasoning.ts`: 8 event types with FHLMC anchors (24m EC for FORECLOSURE per A1; planner verifies)
- `fha/derog-seasoning.ts`: 8 event types with FHA shorter waits (24/12); plus `fhaBackToWorkDeprecatedSeed` for the DEPRECATED row
- `va/derog-seasoning.ts`: 8 event types with VA shorter waits

**DELTA from the test fixture:**
- Test fixture exports a single `DerogSeasoning`; Phase 3 fixture exports an array of typed `AgencyRuleSeed<DerogSeasoning>` wrapping body + citation per row.
- Test fixture has no `versionLabel` or `citation` — those are scalar in tests; Phase 3 production fixture pulls them through.

---

### `lib/agency-seeds/fha/derog-seasoning.ts` (additional: `fhaBackToWorkDeprecatedSeed` export)

**Pattern P5 source (RESEARCH §Per-agency content matrix §FHA + Pattern P5):**
- Ship as a SECOND `agency_rule_version` row with `version_label = 'HUD-4000.1-BTW-DEPRECATED'`, `effective_period = '[2013-08-15, 2016-09-30)'`
- Loader treats it as a separate agency seeding call (per RESEARCH `scripts/seed-agency.ts:709-712`):
```typescript
await seedAgencyVersionAndRules('FHA', 'HUD-4000.1-BTW-DEPRECATED',
  '[2013-08-15,2016-09-30)',
  'https://www.hud.gov/sites/documents/16-14ml.pdf',
  [fhaBackToWorkDeprecatedSeed]);
```

**No in-repo analog for the deprecated-via-effective-period pattern;** this is Phase 3's first deprecated agency rule. The mechanism is identical to active agency seeds — just different `effective_period` upper bound and `version_label`. Phase 4 evaluator's `effective_period @> CURRENT_DATE` check naturally filters it out.

---

### `lib/agency-seeds/usda/version-stub.ts` (degenerate case)

**Pattern source:** RESEARCH `scripts/seed-agency.ts:716-717`:
```typescript
// USDA stub: agency_rule_version row only, zero child rules per D-12.
await seedAgencyVersionAndRules('USDA', 'USDA-SFH-7-CFR-3555', '[2026-01-01,infinity)',
  'https://www.rd.usda.gov/programs-services/single-family-housing-programs', []);
```

**Apply:** export an empty `AgencyRuleSeed[]` (`export const usdaSeeds: AgencyRuleSeed[] = [];`). The loader's `seedAgencyVersionAndRules` creates the version row even when seeds[] is empty (the for-loop body is skipped). The version_label `USDA-SFH-7-CFR-3555` per D-13.

---

### `lib/agency-seeds/fhfa/2026-conforming-limit-values-by-county.csv`

**NO ANALOG.** First committed CSV in the repo. Use research §FHFA 2026 CSV format directly:
- Source: `https://www.fhfa.gov/document/data/fullcountyloanlimitlist2026_hera-based_final_flat.xlsx` (or CSV variant)
- Format: 9-column header `"FIPS State Code", "FIPS County Code", "County Name", "State", "CBSA Number", "One-Unit Limit", "Two-Unit Limit", "Three-Unit Limit", "Four-Unit Limit"`
- ~3,200 rows
- Per Pitfall PG-7: BOM + quoted fields; commit the file as-downloaded; loader uses `csv-parse@5.6+`

---

### `lib/agency-seeds/fhfa/README.md`

**NO ANALOG.** First md doc file inside `lib/`. Pattern is research-prescribed (annual update procedure):
1. Download new FHFA CSV from FHFA conforming loan limit publication page
2. Commit to `lib/agency-seeds/fhfa/<year>-conforming-limit-values-by-county.csv`
3. Re-run `pnpm db:seed`
4. Loader detects existing year → applies two-step daterange close per D-23
5. Verify the EXCLUDE constraint allows the new year (`year_2027 != year_2026`)

Phase 3 ships only the 2026 version; doc states 2027+ uses the same procedure.

---

### `scripts/seed-agency.ts` (idempotent loader)

**Hybrid analog:** `scripts/init-db.sh` (DB connection + role pattern) + `tests/_shared/agency-fixture.ts::seedAgencyVersion` (transactional bootstrap + system_tenant pattern).

**Connection string pattern from `tests/rls/global-setup.ts:42-51`:**
```typescript
const MIGRATION_DB_URL =
  process.env.DATABASE_MIGRATION_URL ??
  process.env.DATABASE_URL?.replace('app_user:app_user_password', 'postgres:postgres') ??
  '';

if (!MIGRATION_DB_URL) {
  throw new Error('DATABASE_MIGRATION_URL or DATABASE_URL must be set ...');
}
```
**Adopt** for `scripts/seed-agency.ts` — connect via DATABASE_MIGRATION_URL (postgres role; system_role granted per `scripts/init-db.sh:31`).

**SYSTEM tenant bootstrap pattern from `tests/_shared/agency-fixture.ts:56-69`:**
```typescript
async function ensureSystemTenant(client: PoolClient): Promise<string> {
  const lookup = await client.query<{ id: string }>(
    `SELECT id::text FROM tenant WHERE kind = 'SYSTEM' LIMIT 1`,
  );
  if (lookup.rows[0]) return lookup.rows[0].id;
  const created = await client.query<{ id: string }>(
    `INSERT INTO tenant (id, kind, name)
     VALUES (gen_random_uuid(), 'SYSTEM', 'Agency Hand-Authoring System Tenant')
     RETURNING id::text`,
  );
  return created.rows[0]!.id;
}
```
**Adopt verbatim.** This is the same get-or-create idempotent pattern.

**Transactional seed pattern from `tests/_shared/agency-fixture.ts:90-135`:**
```typescript
export async function seedAgencyVersion(adminPool: Pool, options): Promise<...> {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const systemTenantId = await ensureSystemTenant(client);
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [systemTenantId]);
    const cit = await client.query<{ id: string }>(
      `INSERT INTO rule_citation (tenant_id, source_url, excerpt) VALUES ($1, $2, $3) RETURNING id::text`,
      [systemTenantId, citationSourceUrl, citationExcerpt],
    );
    // ... INSERT agency_rule_version
    await client.query('COMMIT');
    return { ... };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* swallow */ }
    throw err;
  } finally {
    client.release();
  }
}
```
**Adopt as the loader's `seedAgencyVersionAndRules` skeleton.** Add the per-rule INSERT loop with `ON CONFLICT DO NOTHING` keyed on `(agency_rule_version_id, rule_kind, rule_body->>'event_type')` per RESEARCH §scripts/seed-agency.ts:677-689 — using `INSERT ... SELECT ... WHERE NOT EXISTS` because the unique-keyed jsonb-discriminator path doesn't have a true unique index in Phase 2.

**dotenv pattern from `tests/rls/global-setup.ts:36-37`:**
```typescript
loadDotenv({ path: '.env.local' });
loadDotenv({ path: '.env' });
```
**Adopt.**

**Main entry pattern from research §scripts/seed-agency.ts:701-725:**
```typescript
async function main(): Promise<void> {
  await seedAgencyVersionAndRules('FNMA', 'FNMA-SEL-2026-04', '[2026-01-01,infinity)',
    'https://selling-guide.fanniemae.com/sel/b3-5.3-07/', fnmaDerogSeasoningSeeds);
  await seedAgencyVersionAndRules('FHLMC', 'FHLMC-SSG-2026-Q1', '[2026-01-01,infinity)', ...);
  await seedAgencyVersionAndRules('FHA', 'HUD-4000.1-2024-08', '[2026-01-01,infinity)', ...);
  await seedAgencyVersionAndRules('FHA', 'HUD-4000.1-BTW-DEPRECATED', '[2013-08-15,2016-09-30)', ...);
  await seedAgencyVersionAndRules('VA', 'VA-PAM-26-7-Ch4', '[2026-01-01,infinity)', ...);
  await seedAgencyVersionAndRules('USDA', 'USDA-SFH-7-CFR-3555', '[2026-01-01,infinity)', ...);
  await pool.end();
}

main().catch((err) => {
  console.error('seed-agency failed:', err);
  process.exit(1);
});
```

**DELTA from `tests/_shared/agency-fixture.ts`:**
- Production loader takes seeds[] from filesystem (imported from `lib/agency-seeds/`); test fixture takes options scalar
- Production loader idempotent via `INSERT ... WHERE NOT EXISTS` on `(agency_rule_version_id, rule_kind, rule_body->>'event_type')`; test fixture relies on per-test daterange randomization
- Production loader runs Zod validation via `parseRuleBody(seed.ruleKind, seed.ruleBody)` per Pattern P3 (research §scripts/seed-agency.ts:660); test fixture skips
- Production version_label is fixed (e.g., `FNMA-SEL-2026-04`); test fixture randomizes via `gen_random_uuid()::text` to avoid EXCLUDE collisions across runs

---

### `scripts/seed-fhfa.ts` (CSV parse + batch insert; can be inlined into seed-agency.ts)

**Closest analog:** `scripts/seed-agency.ts` (sibling pattern) + `csv-parse@5.6` npm docs (NO in-repo CSV-loader analog).

**Pattern (research only):**
```typescript
import { parse } from 'csv-parse';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const fhfaRowSchema = z.object({
  fips_state: z.string().regex(/^\d{2}$/),
  fips_county: z.string().regex(/^\d{3}$/),
  county_name: z.string().min(1).max(120),
  state_code: z.string().length(2),
  one_unit_baseline: z.number().int().positive(),
  // ... per RESEARCH §FHFA CSV format
});

async function seedFhfaYear(year: number, csvPath: string, baseline: number): Promise<void> {
  const csvBytes = await readFile(csvPath);
  const records = await new Promise<unknown[]>((resolve, reject) => {
    parse(csvBytes, { columns: true, bom: true, trim: true }, (err, recs) => {
      if (err) reject(err); else resolve(recs as unknown[]);
    });
  });
  // Two-step daterange close (D-23):
  // 1. Close any existing infinity-ending row for prior years
  await client.query(
    `UPDATE conforming_loan_limit_version
       SET effective_period = daterange(lower(effective_period), $1::date, '[)')
     WHERE upper(effective_period) = 'infinity' AND year < $2`,
    [`${year}-01-01`, year],
  );
  // 2. INSERT new year row
  // 3. Validate each row via Zod, INSERT into conforming_loan_limit_county
}
```

**DELTA from seed-agency.ts:**
- New dep: `csv-parse@5.6+` (must add to package.json)
- File-I/O via `node:fs/promises`
- Batch insert (~25,600 rows): use single `INSERT ... SELECT FROM unnest($1::text[], $2::text[], ...)` per RESEARCH §FHFA loader for efficiency
- `is_high_cost` derived at load time per Open Question 7

---

### Tests — `tests/audit/evaluation-event-structural.test.ts`

**Multi-analog:** `tests/schema/agency-rule-version-exclude.test.ts` (constraint introspection) + `tests/rls/setup.ts:113-159` (relforcerowsecurity / pg_class / pg_policies queries).

**Introspection pattern from `tests/rls/setup.ts:113-132`:**
```typescript
const { rows: forced } = await globalThis.__pgPool.query<{
  relname: string;
  relforcerowsecurity: boolean;
}>(
  `SELECT relname, relforcerowsecurity FROM pg_class WHERE relname = ANY($1::text[]) ORDER BY relname`,
  [FORCED_TABLES],
);
if (forced.length !== FORCED_TABLES.length) {
  // ...
}
for (const row of forced) {
  if (!row.relforcerowsecurity) {
    throw new Error(...);
  }
}
```
**Adopt** for `evaluation_event` and all 6 inline child partitions. Use `pg_partition_tree('evaluation_event'::regclass)` to enumerate partitions:
```sql
SELECT relid::regclass::text AS partition_name
FROM pg_partition_tree('evaluation_event'::regclass)
WHERE level > 0;
```

**REVOKE introspection (NEW — no in-repo analog):**
```typescript
// Verify REVOKE UPDATE/DELETE on parent and all children.
const { rows: acl } = await client.query<{ relname: string; relacl: string[] }>(
  `SELECT relname, relacl FROM pg_class
   WHERE relname IN ('evaluation_event', 'evaluation_event_y2026m05', /* ... */)
   ORDER BY relname`,
);
// Assert no entry in relacl grants UPDATE or DELETE to app_user, system_role, or PUBLIC.
```

**Test structure pattern from `tests/schema/agency-rule-version-exclude.test.ts:11-36`:**
```typescript
describe('agency_rule_version EXCLUDE constraint (D-20.4)', () => {
  it('blocks two overlapping versions for same agency', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      await adminClient.query('BEGIN');
      await adminClient.query(`INSERT INTO agency_rule_version ...`);
      await adminClient.query('SAVEPOINT before_overlap');
      await expect(
        adminClient.query(`INSERT INTO agency_rule_version ...`),
      ).rejects.toThrow(/conflicting key value violates exclusion constraint/i);
      await adminClient.query('ROLLBACK TO SAVEPOINT before_overlap');
      await adminClient.query('ROLLBACK');
    } finally {
      adminClient.release();
    }
  });
});
```
**Adopt** the SAVEPOINT-then-ROLLBACK structure. For evaluation_event, additionally test parent-routed INSERT + child partition routing automatic pruning.

---

### Tests — `tests/audit/snapshot-id.test.ts`

**Exact analog:** `tests/rules/derog-seasoning.test.ts` (pure-TS Vitest, no DB).

**Pattern from `tests/rules/derog-seasoning.test.ts:1-30`:**
```typescript
import { describe, expect, it } from 'vitest';
import { derogSeasoningSchema } from '../../lib/rules/schemas/derog-seasoning.js';
import { fnmaForeclosure } from './fixtures/fnma-foreclosure.js';

describe('derogSeasoningSchema', () => {
  it('parses the FNMA post-foreclosure fixture (SC#2)', () => {
    const parsed = derogSeasoningSchema.parse(fnmaForeclosure);
    expect(parsed.event_type).toBe('FORECLOSURE');
    // ...
  });
});
```
**Adopt** for snapshotId. Four assertions per CONTEXT specifics §6 (research §lib/audit/snapshotId.ts:312-345 has the verbatim test):
- A1: Same input → same hash
- A2: Reordered arrays → same hash
- A3: Extra version → different hash
- A4: Mutated recorded_at → different hash

**This file lives in `tests/audit/`** — Phase 3 adds this directory to `vitest.schema.config.ts include`.

---

### Tests — `tests/agency/agency-version.test.ts`

**Exact analog:** `tests/schema/derog-rule-roundtrip.test.ts` (post-seed agency_rule_version query).

**Pattern from `tests/schema/derog-rule-roundtrip.test.ts:8-35`:**
```typescript
describe('FNMA post-FC DerogRule round-trip (SC#2 / D-20.6)', () => {
  it('inserts fixture, queries by event_type=FORECLOSURE, asserts structured body', async () => {
    const seed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-04-01,2027-04-01)', fnmaForeclosure);

    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ rule_body: typeof fnmaForeclosure }>(
        `SELECT rule_body FROM agency_rule
          WHERE rule_kind = 'derog_seasoning'
            AND rule_body->>'event_type' = 'FORECLOSURE'
            AND id = $1::uuid`,
        [seed.agencyRuleId],
      );
      expect(rows).toHaveLength(1);
      // ... body assertions
    } finally {
      adminClient.release();
    }
  });
});
```
**Adopt** for agency-version.test — instead of seeding per-test, **assert the production seed (via `pnpm db:seed`) created one row per agency**:
```typescript
describe('agency_rule_version per agency seeded (AGY-01)', () => {
  for (const agency of ['FNMA', 'FHLMC', 'FHA', 'VA', 'USDA'] as const) {
    it(`seeds agency_rule_version row for ${agency}`, async () => {
      const adminClient = await globalThis.__pgAdminPool.connect();
      try {
        const { rows } = await adminClient.query(
          `SELECT version_label FROM agency_rule_version WHERE agency = $1 ORDER BY recorded_at DESC LIMIT 1`,
          [agency],
        );
        expect(rows).toHaveLength(1);
        // ... assert version_label format per D-13
      } finally {
        adminClient.release();
      }
    });
  }
});
```

**DELTA:**
- Test runs AFTER `pnpm db:seed` has populated; the test fixture pattern uses `seedAgencyDerogRule` which runs at test time. Phase 3 production tests rely on the global setup having seeded already (per D-06).

---

### Tests — `tests/agency/<agency>-derog.test.ts` (4 files: fnma, fhlmc, fha, va)

**Combined analog:** `tests/schema/derog-rule-roundtrip.test.ts` (DB query + per-field assertion) + `tests/rules/derog-seasoning.test.ts` (parse-good against typed body).

**Per-event-type assertion pattern (synthesized from research §`tests/agency/fnma-derog.test.ts`):**
```typescript
describe('FNMA derog matrix (Phase 3 SC#3)', () => {
  it('BK7: 48m base, 24m EC, anchor=DISCHARGE', async () => {
    const row = await fetchAgencyRule('FNMA', 'FNMA-SEL-2026-04', 'BK7');
    expect(row.rule_body.base_waiting_months).toBe(48);
    expect(row.rule_body.extenuating_circumstances_waiting_months).toBe(24);
    expect(row.rule_body.measurement_anchor).toBe('DISCHARGE');
  });
  // ... 7 more `it()` per event_type
  it('FORECLOSURE: 84m base, 36m EC, 3-to-7yr 90% LTV cap window', async () => {
    const row = await fetchAgencyRule('FNMA', 'FNMA-SEL-2026-04', 'FORECLOSURE');
    expect(row.rule_body.base_waiting_months).toBe(84);
    expect(row.rule_body.post_event_LTV_caps[0]).toMatchObject({
      months_since_min: 36,
      months_since_max: 84,
      max_LTV: 90,
      purposeAllowList: ['PURCHASE', 'RATE_TERM_REFI'],
      occupancyAllowList: ['PRIMARY'],
    });
  });
});
```

**Helper pattern from `tests/schema/derog-rule-roundtrip.test.ts:11-21`:**
```typescript
const adminClient = await globalThis.__pgAdminPool.connect();
try {
  const { rows } = await adminClient.query<{ rule_body: ... }>(
    `SELECT rule_body FROM agency_rule WHERE ... AND id = $1::uuid`,
    [seed.agencyRuleId],
  );
  expect(rows).toHaveLength(1);
} finally {
  adminClient.release();
}
```
**Adopt** the pool-acquire/release pattern. Wrap into a `fetchAgencyRule(agency, versionLabel, eventType)` helper per agency test file.

**Golden snapshot pattern (from research §Test Strategy §Per-agency golden snapshot):**
```typescript
import { createHash } from 'node:crypto';

it('FNMA derog bundle matches golden snapshot', async () => {
  const rows = await fetchAllAgencyRules('FNMA', 'FNMA-SEL-2026-04', 'derog_seasoning');
  const sorted = rows.sort((a, b) => a.rule_body.event_type.localeCompare(b.rule_body.event_type));
  const hash = createHash('sha256').update(JSON.stringify(sorted.map(r => r.rule_body))).digest('hex');
  expect(hash).toBe('<commit-time-locked-hash>');
});
```

**DELTA for `fha-derog.test.ts`:**
- Add a deprecated-program filter test (research §Test Strategy §Deprecated-program filter test):
```typescript
it('FHA Back-to-Work row exists but is filtered from active lookups', async () => {
  const row = await fetchAgencyRuleVersion('FHA', 'HUD-4000.1-BTW-DEPRECATED');
  expect(row).not.toBeNull();
  expect(row.effective_period).toBe('[2013-08-15,2016-09-30)');
  const active = await fetchActiveAgencyRulesForToday('FHA');
  expect(active.find(r => r.version_label === 'HUD-4000.1-BTW-DEPRECATED')).toBeUndefined();
});
```

---

### Tests — `tests/cascade/poll-stub.test.ts`

**Closest analog:** `tests/rules/derog-seasoning.test.ts` (pure-TS, no DB).

**Pattern (synthesized):**
```typescript
import { describe, expect, it } from 'vitest';
import { pollAgencyPublications } from '../../lib/cascade/poll.js';

describe('pollAgencyPublications stub (AGY-07)', () => {
  it('returns empty array at Phase 3', async () => {
    const result = await pollAgencyPublications();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it('returns Promise<PollResult[]> shape', async () => {
    const result = await pollAgencyPublications();
    // TypeScript signature is locked; runtime check is structural sanity.
    expect(result).toBeDefined();
  });
});
```

---

### Tests — `tests/cascade/cascade-trigger.test.ts` (D-17 integration test, Phase 3 SC#5)

**Exact analog:** `tests/schema/detect-loosenings.test.ts` (admin connection + transactional INSERT + assertion).

**Pattern from `tests/schema/detect-loosenings.test.ts:9-36`:**
```typescript
describe('detect_loosenings(uuid) (D-20.5)', () => {
  it('returns 1 row when overlay loosens ltv_max above agency', async () => {
    const agencySeed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-01-01,2027-01-01)', fnmaForeclosure);
    const seed = await seedTenantWithProgramAndCitation(globalThis.__pgPool, globalThis.__pgAdminPool, agencySeed.agencyRuleVersionId);

    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      await adminClient.query(
        `INSERT INTO agency_rule (agency_rule_version_id, rule_kind, rule_body, primary_citation_id)
         VALUES ($1, 'ltv_max', '{"value": 95}'::jsonb, $2)`,
        [agencySeed.agencyRuleVersionId, agencySeed.citationId],
      );
    } finally {
      adminClient.release();
    }

    await connectAsTenant(globalThis.__pgPool, seed.tenantId, async (client) => {
      // ... overlay INSERT + detect_loosenings call + assertion
    });
  });
});
```

**Adopt** the admin-pool pattern + transactional structure. The Phase 3 cascade test seeds two tenants (each with one program_version FK'd to a prior agency_rule_version), then fires the trigger via the two-step convention (research §tests/cascade/cascade-trigger.test.ts:1167-1224):

```typescript
describe('cascade trigger (Phase 3 SC#5)', () => {
  it('inserts one cascade_review_queue row per affected program_version across tenants', async () => {
    const adminPool = globalThis.__pgAdminPool!;
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const setup = await seedTwoTenantsWithProgramVersions(client, 'FNMA', 'FNMA-SEL-2026-04');

      // Step 1 of two-step convention: UPDATE prior, set superseded_by
      const newArvId = (await client.query(`SELECT gen_random_uuid()::text AS id`)).rows[0]!.id;
      await client.query(
        `UPDATE agency_rule_version
           SET superseded_by = $1, effective_period = daterange(lower(effective_period), $2::date, '[)')
         WHERE id = $3`,
        [newArvId, '2026-04-01', setup.priorArvId],
      );

      // Step 2: INSERT new version. Trigger fires AFTER INSERT.
      await client.query(
        `INSERT INTO agency_rule_version (id, agency, version_label, source_url, effective_period)
         VALUES ($1, 'FNMA', 'FNMA-SEL-2026-05', $2, '[2026-04-01,infinity)')`,
        [newArvId, 'https://selling-guide.fanniemae.com/sel/b3-5.3-07/'],
      );

      // Assert: 2 rows, one per tenant.
      const queue = await client.query(
        `SELECT tenant_id::text, program_version_id::text, status
         FROM cascade_review_queue
         WHERE new_agency_rule_version_id = $1
         ORDER BY tenant_id`,
        [newArvId],
      );
      expect(queue.rowCount).toBe(2);
      expect(queue.rows[0].status).toBe('pending');

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('initial agency version (no prior) inserts zero queue rows', async () => {
    // Pitfall PG-4: WHERE prior.superseded_by = NEW.id yields zero rows on initial insert.
    // ...
  });
});
```

**Helper `seedTwoTenantsWithProgramVersions` is NEW** — closely mirrors `tests/rls/seedTwoTenants.ts::seedTwoTenants` but creates ONE program_version per tenant pointing at the SAME prior `agency_rule_version`. Pattern shape from existing `seedOneTenantWithProgramFamily` (`tests/rls/seedTwoTenants.ts:64-152`):
```typescript
async function seedOneTenantWithProgramFamily(pool, agencyRuleVersionId, label) {
  const client = await pool.connect();
  await client.query('BEGIN');
  // 1. tenant (bootstrap pattern)
  // 2. canary
  // 3. rule_citation
  // 4. program
  // 5. program_version (FK'd to agencyRuleVersionId)
  // 6. program_rule
  await client.query('COMMIT');
  return { ... };
}
```
**Phase 3 cascade test reuses the steps 1-5** (drops step 6 — cascade trigger only needs program_version, not program_rule).

---

### Tests — `tests/rls/cascade-review-queue-cross-tenant.test.ts`

**Exact analog:** `tests/rls/program-cross-tenant.test.ts` (the D-19 6-case matrix template).

**Adopt the entire 6-case structure verbatim from `tests/rls/program-cross-tenant.test.ts:20-87`:**
1. cross-tenant SELECT returns 0 rows
2. connectAsAnonymous returns 0 rows
3. in-tenant SELECT returns the in-tenant row
4. cross-tenant INSERT with mismatched tenant_id is rejected (RLS)
5. cross-tenant UPDATE on foreign tenant row affects 0 rows
6. cross-tenant DELETE on foreign tenant row affects 0 rows

**Adapt:**
- Replace `program` table references with `cascade_review_queue`
- Seed cascade_review_queue rows under each tenant: requires either firing the trigger (preferred per D-15 — system_write policy lets system_role members INSERT cross-tenant) OR direct admin INSERT
- The trigger fires under postgres role — postgres is a system_role member per `scripts/init-db.sh:31`. Phase 3 seed uses the trigger path naturally.

**5 tests vs 6:** the lender_overlay_rule test (`tests/rls/lender-overlay-cross-tenant.test.ts`) covers the FK-to-foreign-program edge case; cascade_review_queue may or may not need this coverage depending on whether `program_version_id` FK needs a similar guard. Phase 3 plan can decide.

---

### Tests — `tests/schema/fhfa-loan-limits.test.ts`

**Combined analog:** `tests/schema/agency-rule-version-exclude.test.ts` (EXCLUDE) + `tests/schema/derog-rule-roundtrip.test.ts` (post-seed query).

**EXCLUDE pattern from `tests/schema/agency-rule-version-exclude.test.ts:11-36`:** adopt for `conforming_loan_limit_version`. Replace `agency` with `year`:
```typescript
describe('conforming_loan_limit_version EXCLUDE constraint', () => {
  it('blocks two overlapping versions for same year', async () => {
    // ... INSERT 2026 with [2026-01-01,2027-01-01)
    // ... attempt 2026 INSERT with [2026-06-01,2027-06-01) → rejected
  });
  it('allows overlapping ranges for different years', async () => {
    // ... 2026 + 2027 with overlapping date ranges → allowed
  });
});
```

**FK introspection (NEW — build on `tests/rls/setup.ts:113-132` pattern):**
```typescript
it('program_version.conforming_loan_limit_version_id FK exists and is nullable', async () => {
  const { rows } = await client.query(
    `SELECT is_nullable FROM information_schema.columns
     WHERE table_name = 'program_version'
       AND column_name = 'conforming_loan_limit_version_id'`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].is_nullable).toBe('YES');
});

it('FK points at conforming_loan_limit_version(id)', async () => {
  const { rows } = await client.query(
    `SELECT conname, pg_get_constraintdef(oid) AS def
     FROM pg_constraint
     WHERE conrelid = 'program_version'::regclass
       AND contype = 'f'
       AND conname LIKE '%conforming%'`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].def).toMatch(/conforming_loan_limit_version/);
});
```

---

### Modified — `tests/rls/global-setup.ts` (extend with `pnpm db:seed`)

**Pattern:** insert a new step 2.5 between Step 2 (`drizzle-kit migrate` at lines 96-107) and Step 3 (GRANT block at lines 109-127):

```typescript
// Step 2.5: Run the agency seed loader (Phase 3 / D-06).
// Idempotent — safe to re-run on every test setup.
try {
  execFileSync('pnpm', ['db:seed'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_MIGRATION_URL: MIGRATION_DB_URL },
  });
} catch (err) {
  throw new Error(
    `globalSetup: pnpm db:seed failed. Phase 3 agency rules + FHFA loan limits failed to load. Original: ${(err as Error).message}`,
  );
}
```

**Adopt the existing execFileSync pattern from `tests/rls/global-setup.ts:99-103`:**
```typescript
execFileSync('pnpm', ['drizzle-kit', 'migrate'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: MIGRATION_DB_URL },
});
```

---

### Modified — `tests/schema/setup.ts` (extend with `pnpm db:seed`)

**Pattern:** since `tests/schema/setup.ts:11` says "this file does NOT run drizzle-kit migrate" (Plan 02-07's [BLOCKING] migrate already applied), but Phase 3 still needs to SEED. Add to `beforeAll`:
```typescript
beforeAll(async () => {
  // ... existing pool creation
  // Phase 3 / D-06: ensure agency seeds are loaded.
  // The seed loader is idempotent (ON CONFLICT DO NOTHING) so re-running is safe.
  // ...
});
```

Or, simpler: rely on `tests/rls/global-setup.ts` having run `pnpm db:seed` already (the schema test suite runs after the rls suite in CI per `package.json` scripts). Plan should verify whether `vitest.schema.config.ts` invokes its own globalSetup.

**Looking at `vitest.schema.config.ts:20`** — it has `setupFiles: ['./tests/schema/setup.ts']` but no `globalSetup`. The schema suite relies on the migrations already being applied (per the file header at lines 9-11). Phase 3 needs to either (a) add a globalSetup to vitest.schema.config.ts OR (b) call `pnpm db:seed` from `tests/schema/setup.ts:beforeAll`.

---

### Modified — `tests/rls/seedTwoTenants.ts` (OPTIONAL extension to `seedSharedAgency`)

**Pattern source:** existing `tests/_shared/agency-fixture.ts::seedAgencyVersion`. Phase 3 production seeding mirrors the same shape — but the EXISTING shared agency-fixture randomizes daterange (`makeRandomEffectivePeriod` at `tests/_shared/agency-fixture.ts:77-80`), while Phase 3 production uses fixed `[2026-01-01,infinity)`. The existing pattern carries forward unchanged.

**Optional refactor (per Open Question 6 in research):** consolidate the test-side ARV+citation bootstrap so Phase 3's 8 new agency test files use the same helper. NOT required for Phase 3 success criteria.

---

### Modified — `.github/workflows/ci.yml` (add `pnpm db:seed` step)

**Pattern:** insert after the migrations block at line 105-114. Adopt the same `env:` block shape:

```yaml
- name: Apply migrations + grant DML to app_user (replicates Plan 06 globalSetup)
  env:
    DATABASE_URL: postgresql://postgres:postgres@localhost:5432/lender_search_test
    PGPASSWORD: postgres
  run: |
    pnpm drizzle-kit migrate
    psql ... GRANT statements ...

# NEW Phase 3 step:
- name: Run agency seed loader (Phase 3 D-06)
  env:
    DATABASE_MIGRATION_URL: postgresql://postgres:postgres@localhost:5432/lender_search_test
  run: pnpm db:seed
```

**Adopt the env-var pattern from `.github/workflows/ci.yml:105-110`** — specify DATABASE_MIGRATION_URL as the postgres-superuser connection string per D-06.

---

### Modified — `package.json` (add `db:seed` script)

**Pattern:** insert into the `scripts` block:
```json
"db:seed": "tsx scripts/seed-agency.ts && tsx scripts/seed-fhfa.ts"
```

**Adopt the `tsx` runner pattern** — already used in package.json devDependencies:
```json
"tsx": "4.21.0"
```

---

### Modified — `vitest.schema.config.ts` (extend `include`)

**Pattern from line 24:**
```typescript
include: ['tests/schema/**/*.test.ts', 'tests/rules/**/*.test.ts'],
```
**Extend:**
```typescript
include: [
  'tests/schema/**/*.test.ts',
  'tests/rules/**/*.test.ts',
  'tests/audit/**/*.test.ts',
  'tests/agency/**/*.test.ts',
  'tests/cascade/**/*.test.ts',
],
```

---

## Shared Patterns

### Pattern A: Two-policy shape on a tenant-scoped table that needs cross-tenant trigger writes

**Source:** New for Phase 3 (cascade_review_queue). Combines patterns from `db/schema/program-version.ts` (tenant_isolation) + `db/schema/agency-rule-version.ts` (system_role_write).

**Apply to:** `cascade_review_queue` ONLY. Other Phase 3 tables are either pure-system (evaluation_event tenant-scoped) or pure-tenant.

```typescript
pgPolicy('<table>_tenant_isolation', {
  as: 'permissive',
  for: 'all',
  to: 'public',
  using: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
  withCheck: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
}),
pgPolicy('<table>_system_write', {
  as: 'permissive',
  for: 'all',
  to: systemRole,
  using: sql`true`,
  withCheck: sql`true`,
}),
```

**Why both:** Postgres OR-combines permissive policies. The trigger runs as postgres (a system_role member), so its INSERT passes the `system_write` policy regardless of GUC state. App-tenant reads pass the `tenant_isolation` policy.

---

### Pattern B: `--custom` migration with explanatory header pointing at CONTEXT decision IDs

**Source:** `db/migrations/0001_force_rls.sql:1-15`, `0006_detect_loosenings.sql:1-32`, `0004_program_constraints.sql:1-36`.

**Apply to:** all 5 new Phase 3 `--custom` migrations.

**Template:**
```sql
-- Phase 3 / Plan 03-XX Task N: <one-line description> (D-NN / AGY-NN).
--
-- Per CONTEXT D-NN: ...
-- Per Pitfall PG-N: ...
-- Per RESEARCH §<section>: ...
--
-- Why --custom: Drizzle 0.45 does not model <feature>. Hand-edits to
-- 0000_initial.sql or drizzle-generated files are silently overwritten
-- on regenerate. This file is append-only.
--
-- Wave 0 introspection test asserts <fact>.

<DDL>
```

---

### Pattern C: Idempotent loader keyed on natural identifiers

**Source:** `tests/_shared/agency-fixture.ts::ensureSystemTenant` (get-or-create) + research §`scripts/seed-agency.ts:677-689` (INSERT WHERE NOT EXISTS).

**Apply to:** `scripts/seed-agency.ts`, `scripts/seed-fhfa.ts`.

```typescript
// 1. Get-or-create the parent (agency_rule_version, conforming_loan_limit_version)
//    keyed on (agency, version_label) or (year).
// 2. For each child seed, INSERT WHERE NOT EXISTS keyed on
//    (parent_id, rule_kind, rule_body->>'event_type') for agency rules
//    or (limit_version_id, county_fips) for loan limits.
// 3. Wrap each parent+children operation in a transaction.
// 4. Re-running the loader is a structural no-op when state is current.
```

---

### Pattern D: Forward-compat seam (signature locked at one phase, body at next)

**Source:** `lib/tenant/context.ts` (Phase 1 ships primitive; Phase 6 wraps in `withTenantContext` middleware).

**Apply to:** `lib/audit/snapshotId.ts` (Phase 3 ships, Phase 4 evaluator imports), `lib/cascade/poll.ts` (Phase 3 ships stub, Phase 6 implements body).

**JSDoc convention (header should call out the lock):**
```typescript
/**
 * Phase 3 / Phase 4 contract:
 *   - Phase 3 (this file): primitive only. Test asserts deterministic behavior.
 *   - Phase 4: evaluator imports unchanged as the canonical writer.
 */
```

---

### Pattern E: Test-side admin pool acquire/release with `BEGIN`/`ROLLBACK`

**Source:** `tests/schema/derog-rule-roundtrip.test.ts:11-36`, `tests/schema/agency-rule-version-exclude.test.ts:13-36`.

**Apply to:** every Phase 3 test that does direct DB INSERT/SELECT under `__pgAdminPool`.

```typescript
const adminClient = await globalThis.__pgAdminPool.connect();
try {
  await adminClient.query('BEGIN');
  // ... test work
  await adminClient.query('ROLLBACK');
} finally {
  adminClient.release();
}
```

For cross-statement-failure-tolerant assertions, use SAVEPOINT (per `tests/schema/agency-rule-version-exclude.test.ts:23-31`):
```typescript
await adminClient.query('SAVEPOINT before_failure');
await expect(/* failing query */).rejects.toThrow(/.../);
await adminClient.query('ROLLBACK TO SAVEPOINT before_failure');
```

---

## No Analog Found

| File | Role | Reason |
|------|------|--------|
| `lib/agency-seeds/fhfa/2026-conforming-limit-values-by-county.csv` | raw CSV data | First committed CSV in repo. Source from FHFA publication URL; planner downloads + commits. |
| `lib/agency-seeds/fhfa/README.md` | documentation | First markdown doc inside `lib/`. Most lib docs are JSDoc-in-source. Pattern from research §FHFA Annual update path (D-23). |

Both files use research-prescribed content directly; no in-codebase analog needed.

---

## Phase 3-Specific Deviations

These items deviate from the closest analog enough to call out so the planner doesn't blindly mimic:

1. **`evaluation_event` is BOTH tenant-scoped AND partitioned** — no in-repo analog. Combines the tenant_isolation pattern from `program-version.ts` with new partitioning DDL (research §Pattern P1). Critical: RLS policies live on the parent only — Pitfall PG-1 (partition-aware RLS routing).

2. **`cascade_review_queue` two-policy hybrid** — Phase 3 introduces the first table with both `tenant_isolation` AND `system_write` policies coexisting. The trigger fan-out pattern requires cross-tenant writes from a row-trigger context, so the system_write policy bypasses the GUC requirement.

3. **`enqueue_agency_cascade()` is plpgsql, not sql** — `detect_loosenings()` is `sql STABLE` because read-only. The trigger writes side-effects, so plpgsql (and VOLATILE default) is correct. Same SECURITY INVOKER posture.

4. **`REVOKE UPDATE, DELETE` on `evaluation_event`** — first REVOKE in the codebase. D-02 maximalist (PUBLIC + app_user + system_role). No GRANT pattern in repo grants UPDATE/DELETE then revokes; Phase 3 ships REVOKE inside the same migration as the parent CREATE TABLE.

5. **Composite PK on `evaluation_event`** — `(id, evaluated_at)` because Postgres requires the partition key in the PK on partitioned tables. No precedent in repo (all existing tables use single-column UUID PK).

6. **Composite PK on `conforming_loan_limit_county`** — `(limit_version_id, county_fips)`. No in-repo precedent for composite PKs. Drizzle `primaryKey({ columns: [...] })` syntax (verify with Drizzle docs).

7. **First committed CSV file** — `lib/agency-seeds/fhfa/2026-conforming-limit-values-by-county.csv`. First committed `.csv` and first `lib/` markdown README. New `csv-parse@5.6+` dep introduced (Open Question 1 recommendation).

8. **Phase 3 first introduces the `tests/audit/`, `tests/agency/`, `tests/cascade/` test directories** — `vitest.schema.config.ts` extends `include` to cover them.

9. **First `--custom` migration that may fail in alpine** — pg_cron extension. Wrap in `DO $$ ... EXCEPTION WHEN ... END $$` block per Pitfall PG-5.

10. **Version chain via daterange close (no `superseded_by` self-FK)** — `conforming_loan_limit_version` does NOT carry `superseded_by` (unlike `agency_rule_version`). The two-step convention writes only `effective_period` upper bound (D-23). The cascade trigger semantics that depend on `superseded_by` are agency-version-specific.

---

## Data Flow Integration Points

| Seam | Phase 3 Lock | Future Consumer |
|------|--------------|-----------------|
| `evaluation_event` table shape | AUD-02 columns + RLS + REVOKE | Phase 4 evaluator writer; Phase 5 golden-set replay |
| `lib/audit/snapshotId.ts` signature | `(input: SnapshotInput) => string` (64-char hex) | Phase 4 evaluator imports unchanged |
| `cascade_review_queue` table shape | D-18 columns + status enum + 2-policy | Phase 6 Inngest worker (SKIP LOCKED); Phase 8 AM UI filter on status |
| `lib/cascade/poll.ts` signature | `pollAgencyPublications(): Promise<PollResult[]>` | Phase 6 implements body; Phase 7 extends with extraction |
| `program_version.conforming_loan_limit_version_id` FK | nullable uuid FK | Phase 4 evaluator dereferences when non-null |
| `enqueue_agency_cascade()` trigger | AFTER INSERT, plpgsql, SECURITY INVOKER | Phase 6+ poller two-step convention; trigger fires automatically |
| FHFA loader pattern | csv-parse + per-row Zod + ON CONFLICT | Phase 6+ extends to USDA Eligibility Map, HMDA |
| `pnpm db:seed` script | CI + tests/rls + tests/schema + production deploy | Every Phase ≥3 PR re-runs against fresh DBs |
| Cascade trigger two-step convention | UPDATE prior + INSERT new in same transaction | Phase 6+ poller + Phase 7+ extraction-driven updates use same shape |

---

## Metadata

**Analog search scope:**
- `db/schema/` (12 files)
- `db/migrations/` (7 files including initial.sql)
- `lib/` (env.ts, db/client.ts, rules/schemas/, tenant/context.ts)
- `scripts/` (init-db.sh)
- `tests/rls/` (16 files including fixtures)
- `tests/schema/` (8 files including fixtures)
- `tests/rules/` (6 files)
- `tests/_shared/agency-fixture.ts`
- Config: `package.json`, `vitest.schema.config.ts`, `vitest.config.ts`, `drizzle.config.ts`, `.github/workflows/ci.yml`

**Files scanned:** 53

**Pattern extraction date:** 2026-05-04

**Research file consulted:** `.planning/phases/03-audit-log-agency-rule-encoding/03-RESEARCH.md` §Patterns P1-P6, §Audit Log Architecture, §Agency Rule Hand-Authoring, §Cascade Infrastructure, §FHFA Conforming Loan Limits, §Test Strategy, §Pitfalls PG-1..PG-9.
