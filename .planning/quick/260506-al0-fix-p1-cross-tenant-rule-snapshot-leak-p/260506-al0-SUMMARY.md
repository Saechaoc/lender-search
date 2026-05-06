---
quick_id: 260506-al0
plan: 01
type: execute
status: complete
subsystem: audit-and-tenant-isolation
tags:
  - security
  - rls
  - tenant-isolation
  - migration
  - audit
  - cross-tenant-leak
requirements:
  - P1-CROSS-TENANT-RULE-SNAPSHOT-LEAK
dependency_graph:
  requires:
    - migration 0015 (rule_snapshot create)
    - migration 0019 (system_role-only read)
    - tenant table + RLS bootstrap pattern (Phase 1)
  provides:
    - rule_snapshot per-tenant scope (tenant_id NOT NULL FK + composite UNIQUE + tenant_isolation policy)
    - snapshotId(input) requiring tenantId in canonical hash input
    - persistSnapshot / loadSnapshot / captureCurrentBundle requiring tenantId
  affects:
    - lib/audit/snapshotId.ts (SnapshotInput shape)
    - lib/audit/snapshot-persistence.ts (3 helper signatures)
    - scripts/seed/index.ts (snapshot-write block deleted)
    - tests/audit/* (rewritten + threaded)
    - tests/schema/rule-snapshot-system-only-read.test.ts (replaced with tenant-isolation assertions)
  blocks_phase4:
    - Phase 4 evaluator first migration must re-add composite FK on (tenant_id, ruleset_snapshot_id) -> (tenant_id, sha256_hash)
    - Phase 4 evaluator MUST connect as app_user (NOT system_role); see deferred-items.md
tech-stack:
  patterns:
    - per-tenant RLS shape mirroring program_version / evaluation_event / lender_overlay_rule
    - bundle-canonical-hash input includes tenantId at the schema level
    - DEFERRABLE FK drop ordering (drop FK before DELETE to avoid pending-trigger-event lock)
    - DO-block constraint-then-index discovery for Drizzle's unique-constraint vs unique-index ambiguity
key-files:
  created:
    - db/migrations/0022_rule_snapshot_tenant_scope.sql
    - .planning/quick/260506-al0-fix-p1-cross-tenant-rule-snapshot-leak-p/deferred-items.md
  modified:
    - db/migrations/meta/_journal.json
    - db/schema/rule-snapshot.ts
    - lib/audit/snapshot-persistence.ts
    - lib/audit/snapshotId.ts
    - scripts/seed/index.ts
    - tests/audit/snapshot-persistence.test.ts
    - tests/audit/snapshot-id.test.ts
    - tests/schema/rule-snapshot-system-only-read.test.ts
decisions:
  - "Migration ordering revised: drop evaluation_event FK FIRST (before DELETE FROM rule_snapshot) — the DEFERRABLE INITIALLY DEFERRED FK from 0015 queues a pending-trigger event when DELETE fires, which then blocks subsequent ALTER TABLE evaluation_event with 'cannot ALTER TABLE because it has pending trigger events'. Plan's stated invariant (DELETE before ADD COLUMN tenant_id NOT NULL) still honored — only the FK-drop step was lifted ahead. Plan 1 ↔ 2 step swap is documented inline in the migration's step comments."
  - "DO-block discovery for the existing UNIQUE on sha256_hash now drops the CONSTRAINT form FIRST (cascades the backing index drop), then falls through to the bare uniqueIndex form. The original plan order (index-first then constraint) errors with 'cannot drop index … because constraint … requires it' on Postgres because UNIQUE constraints always have a backing index that cannot be dropped independently."
  - "Migration registered manually in __drizzle_migrations: ran via psql directly (drizzle-kit migrate suppresses the underlying Postgres error and exits non-zero silently in Drizzle 0.31.10), then inserted the file's sha256 into __drizzle_migrations so subsequent drizzle-kit migrate is a no-op. This matches the existing journal/hash convention used by migrations 0008-0021 (which have no per-migration snapshot.json either)."
  - "snapshotId(input) keysToEmit replacer-array re-sorted alphabetically including 'tenant_id' so the new key actually serializes through JSON.stringify's replacer-array contract: ['agency_versions', 'id', 'overlay_versions', 'program_versions', 'recorded_at', 'tenant_id']."
  - "persistSnapshot bundle.tenantId === tenantId invariant is a defense-in-depth assertion catching stale-bundle drift — a future caller passing a tenantA bundle to persistSnapshot(client, tenantB, bundle) would otherwise compute a hash that doesn't match the row's tenant_id (because tenantId is in the canonical hash input). Documented as load-bearing in the docblock."
metrics:
  duration: "14m 4s"
  tasks: 2
  files_changed: 10
  files_created: 2
  files_modified: 8
  completed: "2026-05-06T15:00:31Z"
---

# Quick Task 260506-al0: P1 cross-tenant rule_snapshot leak (Option B) Summary

**One-liner:** Promoted `rule_snapshot` to per-tenant scope (Option B) — tenant_id NOT NULL FK + composite UNIQUE + tenant_isolation RLS policy mirroring program_version's shape, with tenantId threaded through `snapshotId()` as a canonical-hash input and through `captureCurrentBundle / persistSnapshot / loadSnapshot` as a required parameter.

## Tasks

| Task | Name                                                                                  | Commit  | Files                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1    | Migration 0022 + Drizzle schema mirror — promote rule_snapshot to per-tenant scope    | 64c7e72 | `db/migrations/0022_rule_snapshot_tenant_scope.sql`, `db/migrations/meta/_journal.json`, `db/schema/rule-snapshot.ts` |
| 2    | Code + tests + seed — thread tenantId through the persistence + hash surface          | a6730a4 | `lib/audit/snapshotId.ts`, `lib/audit/snapshot-persistence.ts`, `scripts/seed/index.ts`, three test files              |

## What changed

### Migration 0022 (`db/migrations/0022_rule_snapshot_tenant_scope.sql`)

10-step transaction that promotes `rule_snapshot` from system-only to per-tenant scope without touching 0015 / 0019 (CLAUDE.md migration-immutability convention). Step ordering:

1. **DROP evaluation_event FK** — `evaluation_event_ruleset_snapshot_fkey` (single-column FK on sha256_hash). Lifted ahead of step 2 because the DEFERRABLE INITIALLY DEFERRED FK queues a pending-trigger event when DELETE fires next, and that blocks subsequent `ALTER TABLE evaluation_event`.
2. **DELETE FROM rule_snapshot** — clears 8 orphan baseline rows (left over from prior seed-time writes that have no real owner under the new schema).
3. **DROP role-gated policies** — `rule_snapshot_system_read` + `rule_snapshot_system_write`.
4. **DROP single-column UNIQUE on sha256_hash** — DO-block discovers and drops the CONSTRAINT form first (so its backing index cascades), with bare-uniqueIndex fallback.
5. **ADD tenant_id NOT NULL FK** — REFERENCES tenant(id) ON DELETE RESTRICT.
6. **ADD composite UNIQUE** — `rule_snapshot_tenant_hash_unique (tenant_id, sha256_hash)`.
7. **CREATE rule_snapshot_tenant_isolation policy** — verbatim mirror of `evaluation_event_tenant_isolation` shape (FOR ALL TO public; tenant_id = current_setting('app.tenant_id', true)::uuid for both USING and WITH CHECK).
8. **Re-grant SELECT, INSERT to app_user** — undoes 0019's REVOKE.
9. **Defensive re-grant to system_role**.
10. **Reassert FORCE RLS** — defensive (already on per 0015).

### Drizzle schema mirror (`db/schema/rule-snapshot.ts`)

- `tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'restrict' })`
- Composite `uniqueIndex('rule_snapshot_tenant_hash_unique').on(t.tenantId, t.sha256Hash)` replaces the single-column unique
- Single `pgPolicy('rule_snapshot_tenant_isolation', { ... })` declaration; `systemRole` import removed
- File-header docblock rewritten to "one-policy shape" narrative pointing Phase 4 evaluator at app_user

### Hash function (`lib/audit/snapshotId.ts`)

- `SnapshotInput.tenantId: string` (REQUIRED)
- `canonical` object now includes `tenant_id: input.tenantId`
- `keysToEmit` replacer-array sorted alphabetically and includes `'tenant_id'`: `['agency_versions', 'id', 'overlay_versions', 'program_versions', 'recorded_at', 'tenant_id']`
- A6 invariant: same versions + different tenantId → different hash (tested in `tests/audit/snapshot-id.test.ts`)

### Persistence helpers (`lib/audit/snapshot-persistence.ts`)

| Function | Old signature | New signature |
|---|---|---|
| `captureCurrentBundle` | `(client, tenantId?)` | `(client, tenantId)` — required |
| `persistSnapshot` | `(client, bundle)` | `(client, tenantId, bundle)` — required |
| `loadSnapshot` | `(client, hash)` | `(client, tenantId, hash)` — required |

- `WHERE FALSE` / `tenantArgs = []` branch deleted; every tenant-scoped query now uses `WHERE tenant_id = $1` (defense-in-depth alongside the RLS policies).
- `INSERT INTO rule_snapshot` now uses `(tenant_id, sha256_hash, content_jsonb)` and `ON CONFLICT (tenant_id, sha256_hash)`.
- `loadSnapshot` WHERE clause: `tenant_id = $1 AND sha256_hash = $2`.
- `persistSnapshot` invariant: `bundle.tenantId === tenantId` (catches stale-bundle drift).
- `captureCurrentBundle` returns `tenantId` on the bundle for round-trip equivalence.

### Seed (`scripts/seed/index.ts`)

- Snapshot-write block (lines 45-57 of old head) + dynamic `import('../../lib/audit/snapshot-persistence.js')` deleted.
- Replaced with comment explaining: "rule_snapshot is now per-tenant scoped; baseline-system snapshot with no tenant no longer has a coherent owner. Phase 4 evaluator persists per-evaluation snapshots inline at request time. See deferred-items.md."

### Tests

- **`tests/audit/snapshot-id.test.ts`**: `FIXTURE_TENANT_ID` constant threaded through every existing call (A1-A5 contract preserved). New A6 test asserts different tenantId → different hash.
- **`tests/audit/snapshot-persistence.test.ts`** (rewritten): `beforeAll` creates two fixture tenants under the admin pool with `ts`-suffixed names; `afterAll` cleans up rule_snapshot rows + tenant rows. Tests:
  1. composite UNIQUE introspection
  2. idempotency under (tenantId, hash)
  3. round-trip under tenantA
  4. cross-tenant isolation (admin pool, WHERE filter)
  5. cross-tenant isolation (app_user pool, RLS policy)
  6. hash divergence by construction (same agency refs, different tenants → different hashes)
  7. captureCurrentBundle filters tenant-scoped tables
  8. SC#1 deterministic replay
- **`tests/schema/rule-snapshot-system-only-read.test.ts`** (replaced): role-gated policy gone; `rule_snapshot_tenant_isolation` present with `roles=['public']` and the standard `current_setting('app.tenant_id', ...)` USING clause; app_user has SELECT and INSERT privileges; matching app.tenant_id reads its rows; mismatched yields zero; INSERT WITH CHECK rejects mismatched tenant_id.

## Verification Output

### Migration immutability gate
```
$ git diff --exit-code db/migrations/0015_rule_snapshot.sql db/migrations/0019_rule_snapshot_system_read_only.sql
EXIT=0   ✓
```

### Schema introspection
```
 tenant_iso_present | role_gated_gone | force_rls | composite_unique_present | legacy_fk_gone | tenant_id_not_null
--------------------+-----------------+-----------+--------------------------+----------------+--------------------
 t                  | t               | t         | t                        | t              | t
```

### Test pass counts (vs. baseline 3d26c26)

| Suite | Baseline | After 260506-al0 | Delta |
|---|---|---|---|
| `pnpm typecheck` | green | green | — |
| `pnpm test:schema` | 219/219 | **223/223** | +4 (new tenant-isolation assertions) |
| `pnpm test:rls` | 62/62 | **62/62** | unchanged |

Targeted run (subset of test:schema):
- `tests/audit/snapshot-id.test.ts`: 9/9 (A1-A5 + A6)
- `tests/audit/snapshot-persistence.test.ts`: 7/7 (composite-UNIQUE, idempotency, round-trip, cross-tenant ×2, hash divergence, captureCurrentBundle, SC#1)
- `tests/schema/rule-snapshot-system-only-read.test.ts`: 4/4 (policies, privileges, isolation, INSERT WITH CHECK)

### Pre-existing failures from baseline 3d26c26

None. The plan noted potential pre-existing failures from 260505-wp8 (`tests/agency/fhlmc-derog.test.ts` golden hash + `tests/schema/superseded-by-deferrable.test.ts` EXCLUDE conflict), but the actual baseline at 3d26c26 ran 219/219 schema + 62/62 rls clean.

## Deviations from Plan

### [Rule 1 - Bug] Migration step ordering: drop evaluation_event FK before DELETE FROM rule_snapshot

- **Found during:** Task 1 verify gate (`pnpm drizzle-kit migrate` exited 1 silently; manual `psql -v ON_ERROR_STOP=1` reproduced).
- **Issue:** The plan's step order was DELETE FROM rule_snapshot (step 1) then DROP evaluation_event FK (step 2). Postgres rejected the second ALTER with `ERROR: cannot ALTER TABLE "rule_snapshot" because it has pending trigger events`. The DEFERRABLE INITIALLY DEFERRED FK on `evaluation_event.ruleset_snapshot_id -> rule_snapshot.sha256_hash` (from migration 0015) queues a deferred-trigger check when DELETE fires; that queued check then blocks subsequent ALTERs on either side of the FK inside the same transaction.
- **Fix:** Swapped step 1 and step 2. The plan's stated invariant ("DELETE FROM rule_snapshot must run BEFORE the column ADD") is still honored — only the FK-drop step was lifted ahead. The migration now reads: DROP evaluation_event FK → DELETE rows → DROP policies → DROP UNIQUE → ADD tenant_id → ADD composite UNIQUE → CREATE policy → GRANTs → FORCE RLS. Inline comments at steps 1 and 2 of the migration document the why.
- **Files modified:** `db/migrations/0022_rule_snapshot_tenant_scope.sql`.
- **Commit:** 64c7e72.

### [Rule 1 - Bug] DO-block UNIQUE drop order: constraint-form first, then index-form

- **Found during:** Task 1 verify gate (after the FK-order fix above), `psql -v ON_ERROR_STOP=1` returned `ERROR: cannot drop index rule_snapshot_sha256_hash_key because constraint rule_snapshot_sha256_hash_key on table rule_snapshot requires it`.
- **Issue:** The plan's DO block tried to drop the unique INDEX form first, then fall through to drop the unique CONSTRAINT form. But Drizzle 0015's `uniqueIndex(...)` actually emitted a UNIQUE CONSTRAINT (`rule_snapshot_sha256_hash_key`), not a bare unique index. Postgres rejects DROP INDEX on a constraint-backed index — DROP CONSTRAINT must come first to cascade the index drop.
- **Fix:** Reordered the DO block: query `pg_constraint` for unique-constraint-on-(sha256_hash) first and `ALTER TABLE ... DROP CONSTRAINT` if present (which cascades the backing index), then fall through to the `pg_indexes` lookup for any leftover bare uniqueIndex. Inline comment in step 4 of the migration documents the why.
- **Files modified:** `db/migrations/0022_rule_snapshot_tenant_scope.sql`.
- **Commit:** 64c7e72.

### [Process] Migration registered in `__drizzle_migrations` after manual psql apply

- **Found during:** Task 1 verify gate.
- **Issue:** `pnpm drizzle-kit migrate` (drizzle-kit 0.31.10) suppressed the underlying Postgres error during the first attempt (the FK-ordering bug), exiting non-zero (1) but with no visible error to stdout. After fixing the migration body via `psql`, drizzle-kit's `__drizzle_migrations` table was empty for idx 22 even though the schema state was correct.
- **Fix:** Computed `sha256(0022_rule_snapshot_tenant_scope.sql)` (= `a564e6497bc40c1b49d60fe5b476a6a2d9d74bf3779436fcec88b8857d203b47`) and `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (sha, 1778050100000)`. This matches the existing journal/hash convention (verified by re-computing sha256 on `0021_force_rls_phase3_gaps.sql` and comparing to the existing row). Subsequent `pnpm drizzle-kit migrate` is a no-op as expected, and both `pnpm test:rls` and `pnpm test:schema` global-setups apply the migration cleanly on fresh CI DBs because they run with `__drizzle_migrations` populated by their own migrate call.
- **Files modified:** none (DB state only).
- **Commit:** none (no source change).

### [Note] GitNexus impact analysis fallback to grep

CLAUDE.md mandates `gitnexus_impact({target, direction: "upstream"})` before editing symbols. The GitNexus MCP tools (`gitnexus_impact`, `gitnexus_detect_changes`, etc.) are not available in this executor's tool surface (only Read/Write/Edit/Bash). The plan's `<constraints>` block anticipated this with the note "fall back to grep — the call-site list in the plan is already authoritative." Per-task verification:

- Pre-edit grep on `ruleSnapshot|rule_snapshot` returned exactly the 7 source files in the plan's call-site inventory: `tests/schema/global-setup.ts` (comment only — confirmed), `tests/schema/rule-snapshot-system-only-read.test.ts`, `tests/audit/snapshot-persistence.test.ts`, `scripts/seed/index.ts`, `lib/audit/snapshot-persistence.ts`, `db/schema/rule-snapshot.ts`, `db/schema/index.ts` (barrel — no edit). Plus the migration files. No additional touch points.
- Pre-edit grep on `captureCurrentBundle|persistSnapshot|loadSnapshot|snapshotId` returned the 4 source files in the call-site inventory: `lib/audit/snapshot-persistence.ts`, `lib/audit/snapshotId.ts`, `tests/audit/snapshot-id.test.ts`, `tests/audit/snapshot-persistence.test.ts`, `scripts/seed/index.ts`. Exhaustive.
- Post-edit, the test totals (223/223 schema + 62/62 rls + green typecheck) provide the regression-gate equivalent of `gitnexus_detect_changes()`: any unintended scope change would have surfaced as a typecheck error or a test failure.

GitNexus index staleness was reported by the harness post-commit; this is a knowledge-graph state, not a code regression.

### [Note] No node_modules in worktree at startup

The worktree's `node_modules` was missing at startup; ran `pnpm install --frozen-lockfile` to set it up before any test/typecheck. `.env.local` was also missing (gitignored); copied from the parent worktree's `.env.local` so migration runs and tests could authenticate against the local Postgres.

## Authentication Gates

None — all work ran against the local Postgres docker container with credentials from `.env.local`.

## Self-Check: PASSED

- Created files exist: `db/migrations/0022_rule_snapshot_tenant_scope.sql` ✓; `.planning/quick/260506-al0-fix-p1-cross-tenant-rule-snapshot-leak-p/deferred-items.md` ✓
- Modified files exist: 8/8 ✓
- Commits exist: `64c7e72` (Task 1) ✓; `a6730a4` (Task 2) ✓
- All must_haves from frontmatter satisfied (verified above via the schema introspection + grep checks + test counts).
