---
phase: 03-audit-log-agency-rule-encoding
fixed_at: 2026-05-05T23:59:00Z
review_path: .planning/phases/03-audit-log-agency-rule-encoding/03-REVIEW.md
iteration: 1
findings_in_scope: 13
fixed: 13
skipped: 0
status: all_fixed
---

# Phase 3: Code Review Fix Report

**Fixed at:** 2026-05-05T23:59:00Z
**Source review:** `.planning/phases/03-audit-log-agency-rule-encoding/03-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 13 (4 blockers + 9 warnings; the 6 info-class findings are out of scope for this iteration)
- Fixed: 13
- Skipped: 0

**Test posture (final clean DB):** 40 test files, 216 tests passing. Baseline before fixes was 197 tests; this iteration added 19 new regression tests across the WR-02, WR-04, WR-07, WR-08, WR-09, BL-01, BL-02, BL-03, and WR-01 commits.

**Migrations added (NEW; existing 0007–0015 untouched per immutability rule):**
- `0016_rule_citation_excerpt_length_check.sql` — WR-02
- `0017_rule_citation_hash_full_identity.sql` — BL-03
- `0018_rule_snapshot_system_read_only.sql` — BL-01
- `0019_cascade_trigger_security_definer.sql` — WR-07
- `0020_force_rls_phase3_gaps.sql` — WR-08

**GitNexus impact analysis note:** The GitNexus index was reported stale (last indexed 64840dc) at the start of this run. Per project convention, impact analysis was characterized in REVIEW.md by the reviewer; the fixer applied the reviewer's recommendations without re-running `gitnexus_impact` for each symbol. A `npx gitnexus analyze` run is recommended after this fix branch merges.

## Fixed Issues

### BL-01: rule_snapshot is world-readable but captureCurrentBundle captures cross-tenant rows

**Files modified:** `db/migrations/0018_rule_snapshot_system_read_only.sql` (new), `db/migrations/meta/_journal.json`, `db/schema/rule-snapshot.ts`, `tests/schema/rule-snapshot-system-only-read.test.ts` (new). Coordinated with BL-02 (which added `tenantId` parameter to `captureCurrentBundle`).
**Commit:** `ec05c87`
**Applied fix:** Two-part fix (option (b) per the prompt). (1) `captureCurrentBundle(client, tenantId?)` now scopes tenant tables (program_version, program_rule, lender_overlay_rule) to the requesting tenant; the system-baseline path used by `pnpm db:seed` captures system-owned rows only. (2) Migration 0018 drops `rule_snapshot_world_read` and creates `rule_snapshot_system_read` (FOR SELECT TO `system_role` USING true), and revokes SELECT on `rule_snapshot` from `app_user`. Phase 4 evaluator already runs as system_role for evaluation_event inserts; the snapshot read is in-role with no transition needed. Phase 5+ tenant-readable snapshot paths must add an explicit `tenant_id` column AND a per-tenant policy — never re-introduce world-read.

### BL-02: Snapshot canonical bundle key drift breaks SC#1 historical replay contract

**Files modified:** `lib/audit/snapshot-persistence.ts`, `tests/audit/snapshot-persistence.test.ts`
**Commit:** `5c2049e`
**Applied fix:** Comprehensive rewrite of `captureCurrentBundle` / `canonicalize` / `loadSnapshot`. Three drift fixes: (1) renamed canonical bundle keys to match the migration 0015 header — `agency_rule_versions / agency_rules / program_versions / program_rules / lender_overlay_rules`. (2) capture FULL row contents (not just `id` + `recorded_at`); SC#1 deterministic replay now actually possible from `content_jsonb` alone — Phase 4 evaluator does not need to JOIN back to live tables. (3) added `sortKeysDeep` helper applied to every nested object before `JSON.stringify` so V8 iteration-order assumptions can never silently invalidate stored sha256 hashes when fields are added later. Bumped `schema_version` to 2. Public `CanonicalBundle` interface exported so Phase 4 evaluator imports the shape contract directly. Test coverage adds an SC#1 round-trip assertion: persist a synthetic bundle with a `rule_body`, load it back, confirm the body bytes are the ones we put in (not anything resolved from a live table).

### BL-03: citation_hash collides on FHLMC BK13 — second seed silently overwrites first

**Files modified:** `lib/agency-seeds/fhlmc/derog-seasoning.ts`, `db/migrations/0017_rule_citation_hash_full_identity.sql` (new), `db/migrations/meta/_journal.json`, `tests/schema/rule-citation-hash-identity.test.ts` (new), `tests/agency/fhlmc-derog.test.ts` (golden hash bumped)
**Commit:** `978a9ba`
**Applied fix:** Both fixes the reviewer recommended. (a) Distinct URL anchors: FHLMC `BK13_DISCHARGED` now cites `#BK_CHAPTER_13_DISCHARGED` and `BK13_DISMISSED` cites `#BK_CHAPTER_13_DISMISSED` (mirroring the FNMA pattern). (b) Migration 0017 drops + recreates `rule_citation.citation_hash` with the GENERATED expression extended to include `bbox::text + source_pdf_sha256` alongside the existing `(source_url, page_number, excerpt)`. The partial unique index `rule_citation_unique_idx` is rebuilt unchanged at the index level; the underlying hash now reflects full citation identity so a future fixture citing different page regions of the same URL cannot silently collide. The FHLMC golden snapshot hash in `tests/agency/fhlmc-derog.test.ts` was deliberately bumped from `e69f8f8c…febb2e` to `64a87b54…82fd98` because `notes_citations` strings changed; the inline comment documents the bump rationale.

### BL-04: db/schema/evaluation-event.ts is no longer the source of truth — silently drifts from on-disk DDL

**Files modified:** `db/schema/evaluation-event.ts`
**Commit:** `685c125`
**Applied fix:** Aligned the Drizzle index declaration with the on-disk DDL by adding explicit `.desc()` on `t.evaluatedAt`. Migration 0008 emitted `(tenant_id, evaluated_at DESC)`; the Drizzle schema declared the unsorted form. The next `drizzle-kit generate` would have detected the drift and emitted a spurious 0021 converting the index back to ascending — silently degrading partition pruning + ORDER BY DESC LIMIT N recency scans. The remaining drift surface (PARTITION BY, FORCE RLS, REVOKE, DEFERRABLE FK) cannot be modelled in Drizzle 0.45; the doc comment was expanded to flag this as the agreed convention so any future 0021+ migration touching evaluation_event gets reviewed against migration 0008 + this comment for the partition/RLS/REVOKE properties.

**Note:** The reviewer's preferred Option A (replace pgTable with type-only exports) was attempted and reverted because `drizzle-kit generate` immediately produced a "user removed evaluation_event" prompt that would have escalated to MORE drift. The minimal-diff Option B-equivalent (keep the declaration, add `.desc()`, document the override authoritatively) achieves the BL-04 goal (next `drizzle-kit generate` produces no spurious migration) without breaking the introspection cycle.

### WR-01: DEPRECATED state filter discipline depends on convention, not constraint

**Files modified:** `lib/rules/active-agency-rule.ts` (new), `tests/rules/active-agency-rule.test.ts` (new)
**Commit:** `e67d6fe`
**Applied fix:** New typed helpers `activeAgencyRulesUnderVersion(arv)` and `activeAgencyRulesForAgency(agency)` that emit the `state = 'ACTIVE' AND effective_period @> CURRENT_DATE` predicate as a single source of truth. Phase 4 evaluator (when it lands) will funnel every "find active agency rule" query through these helpers. Integration test confirms via raw SQL that the active filter excludes the `HUD-4000.1-BTW-DEPRECATED` ARV and that no FORECLOSURE query result yields the BTW-signature 12-month value.

**Future work (out of scope for this iteration):** a CI lint to reject `from(agencyRule)` outside `lib/rules/active-agency-rule.ts` so direct imports cannot leak past the predicate. Phase 4 evaluator landing should add this lint at the same time.

### WR-02: rule_citation excerpt has no length cap; some seeds approach 450 chars

**Files modified:** `db/migrations/0016_rule_citation_excerpt_length_check.sql` (new), `db/migrations/meta/_journal.json`, `lib/agency-seeds/types.ts`, `scripts/seed-agency.ts`, `tests/schema/rule-citation-excerpt-length.test.ts` (new)
**Commit:** `86c2b87`
**Applied fix:** Both layers wired. (1) Migration 0016 adds `CHECK (length(excerpt) <= 500) NOT VALID` followed by `VALIDATE CONSTRAINT` (two-step so a long-running scan does not block writes on production-shaped tables). (2) `lib/agency-seeds/types.ts` now exports `agencyRuleSeedCitationSchema` (a real Zod schema with `max(500)`) replacing the prior compile-time-only TypeScript interface. (3) `scripts/seed-agency.ts` parses every seed.citation through the Zod schema before INSERT so a fixture with an over-cap excerpt fails fast with a structured error rather than as Postgres SQLSTATE 23514. The current longest seeded excerpt is 444 chars; the cap applies cleanly to existing data.

### WR-03: seedFhfaYear blows past EXCLUDE constraint when re-run mid-year

**Files modified:** `scripts/seed-agency.ts`
**Commit:** `69b5486`
**Applied fix:** Added a `pg_has_role(current_user, 'system_role', 'MEMBER')` assertion BEFORE the close-prior-versions UPDATE. If the connection lacks system_role membership, the loader throws a clear error naming the role the user must use (postgres via `DATABASE_MIGRATION_URL` — not app_user via `DATABASE_URL`). The close UPDATE itself now captures `RETURNING year + rowCount` and logs how many prior versions were closed, so a silent zero-row close (caused by RLS rejecting under unexpected role) is visible in the seed log instead of invisible until the next INSERT collides on the EXCLUDE.

### WR-04: Test isolation root cause — mid-test pnpm db:seed invocation in tests/schema/setup.ts

**Files modified:** `tests/schema/global-setup.ts` (new), `tests/schema/setup.ts`, `vitest.schema.config.ts`
**Commit:** `3b6b525`
**Applied fix:** Moved `pnpm db:seed` from per-fork `beforeAll` (which Vitest 4 fired 5+ times under `pool: 'forks'`) to `globalSetup` (single invocation per `pnpm test:schema`). Verified by test output: pre-fix shows `Baseline rule_snapshot persisted` 6 times; post-fix exactly 1.

### WR-05: pool.end() is fire-and-forget on seed failure

**Files modified:** `scripts/seed/index.ts`
**Commit:** `d11065c`
**Applied fix:** `pool.end()` is now awaited inside try/catch before `process.exit(1)`. The `eslint-disable @typescript-eslint/no-floating-promises` comment is removed because the underlying issue (unawaited promise → premature process exit) is now actually fixed rather than suppressed.

### WR-06: 0008 migration drops + recreates evaluation_event without verifying it's empty

**Files modified:** `tests/schema/destructive-migration-guard.test.ts` (new)
**Commit:** `be24d3e`
**Applied fix:** Migration 0008 is already shipped (immutability rule) so the historical risk cannot be backfilled in-place. Instead added a CI lint test that scans every migration file for unguarded `DROP TABLE` and fails if a NEW migration (post-grandfather list) lacks either a row-count guard or a `RAISE EXCEPTION` empty-table assertion. Currently grandfathered: `0008_evaluation_event_partitioned.sql` and `0017_rule_citation_hash_full_identity.sql` (the latter is `DROP COLUMN`, kept in allowlist for clarity). Adding new migrations to the allowlist requires a review comment.

### WR-07: enqueue_agency_cascade trigger runs SECURITY INVOKER

**Files modified:** `db/migrations/0019_cascade_trigger_security_definer.sql` (new), `db/migrations/meta/_journal.json`, `tests/schema/cascade-trigger-security-definer.test.ts` (new)
**Commit:** `69b82f4`
**Applied fix:** Migration 0019 uses `CREATE OR REPLACE FUNCTION` (allowed under the project's migration-immutability convention for follow-up fixes) to convert `SECURITY INVOKER → SECURITY DEFINER`, pin `search_path = public, pg_catalog` (defense-in-depth against caller-set-search_path hijack), and `ALTER FUNCTION OWNER TO postgres` so the elevated identity is actually a `system_role` member + table owner. The cascade fan-out now works under any caller role — including a future Phase 6 Inngest worker connection that might run as `app_user`.

### WR-08: pgPolicy `to: 'public'` declarations don't model FORCE — schema can never be source-of-truth

**Files modified:** `tests/schema/rls-force-everywhere.test.ts` (new), `db/migrations/0020_force_rls_phase3_gaps.sql` (new), `db/migrations/meta/_journal.json`
**Commit:** `4160057`
**Applied fix:** Two-part fix. (1) `tests/schema/rls-force-everywhere.test.ts` queries `pg_class` for `relrowsecurity = true AND relforcerowsecurity = false` and fails when any application table is in that state (allowlist excludes `__drizzle_migrations` only). The CI gate converts "remember to add FORCE" from a code-review obligation into a test failure. (2) The CI gate immediately caught 4 pre-existing tables that had RLS without FORCE: `agency_rule`, `agency_rule_version`, `conforming_loan_limit_version`, `conforming_loan_limit_county`. Migration 0020 backfills FORCE on all four.

### WR-09: snapshotId canonical JSON object iteration order is implementation-defined

**Files modified:** `lib/audit/snapshotId.ts`, `tests/audit/snapshot-id.test.ts`
**Commit:** `eedd7e2`
**Applied fix:** Two cross-engine determinism guards. (1) `JSON.stringify` replacer-array form sorts top-level object keys alphabetically + locks the inner key shape (`id`, `recorded_at`) — output is now identical regardless of engine (V8, Bun, Deno, Cloudflare Workers, etc). (2) ISO 8601 with-millis regex validation: `recorded_at` strings that don't match `YYYY-MM-DDTHH:mm:ss.sssZ` throw at the snapshotId boundary. `Date.toISOString()` always emits this form so well-behaved callers continue working; hand-built strings missing millis (e.g. `2026-05-01T00:00:00Z`) are rejected so they cannot produce a different hash for the same logical timestamp. Three new A5-family tests cover rejection in each of the three VersionRef arrays.

## Skipped Issues

None — all 13 in-scope findings were fixed.

---

_Fixed: 2026-05-05T23:59:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
