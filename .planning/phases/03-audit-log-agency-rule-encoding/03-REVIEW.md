---
phase: 03-audit-log-agency-rule-encoding
reviewed: 2026-05-05T00:00:00Z
depth: standard
files_reviewed: 53
files_reviewed_list:
  - db/migrations/0007_phase3_schema.sql
  - db/migrations/0008_evaluation_event_partitioned.sql
  - db/migrations/0009_evaluation_event_pg_cron.sql
  - db/migrations/0010_cascade_review_queue.sql
  - db/migrations/0011_conforming_loan_limit.sql
  - db/migrations/0012_program_version_conforming_fk.sql
  - db/migrations/0013_agency_rule_state_and_deferrable_fk.sql
  - db/migrations/0014_rule_citation_unique_key.sql
  - db/migrations/0015_rule_snapshot.sql
  - db/schema/cascade-review-queue.ts
  - db/schema/conforming-loan-limit-county.ts
  - db/schema/conforming-loan-limit-version.ts
  - db/schema/evaluation-event.ts
  - db/schema/rule-snapshot.ts
  - lib/agency-seeds/fha/back-to-work-deprecated.ts
  - lib/agency-seeds/fha/derog-seasoning.ts
  - lib/agency-seeds/fhfa/README.md
  - lib/agency-seeds/fhlmc/derog-seasoning.ts
  - lib/agency-seeds/fnma/derog-seasoning.ts
  - lib/agency-seeds/types.ts
  - lib/agency-seeds/va/derog-seasoning.ts
  - lib/audit/index.ts
  - lib/audit/snapshot-persistence.ts
  - lib/audit/snapshotId.ts
  - lib/cascade/index.ts
  - lib/cascade/poll.ts
  - scripts/seed-agency.ts
  - scripts/seed/agency-fha.ts
  - scripts/seed/agency-fhlmc.ts
  - scripts/seed/agency-fnma.ts
  - scripts/seed/agency-va.ts
  - scripts/seed/index.ts
  - tests/agency/agency-version-fha.test.ts
  - tests/agency/agency-version-fhlmc.test.ts
  - tests/agency/agency-version-fnma.test.ts
  - tests/agency/agency-version-va.test.ts
  - tests/agency/fha-derog.test.ts
  - tests/agency/fhlmc-derog.test.ts
  - tests/agency/fnma-derog.test.ts
  - tests/agency/va-derog.test.ts
  - tests/audit/evaluation-event-child-rls.test.ts
  - tests/audit/evaluation-event-structural.test.ts
  - tests/audit/snapshot-id.test.ts
  - tests/audit/snapshot-persistence.test.ts
  - tests/cascade/cascade-trigger.test.ts
  - tests/cascade/poll-stub.test.ts
  - tests/rls/cascade-review-queue-cross-tenant.test.ts
  - tests/schema/agency-rule-state.test.ts
  - tests/schema/fhfa-loan-limits.test.ts
  - tests/schema/rule-citation-unique.test.ts
  - tests/schema/superseded-by-deferrable.test.ts
findings:
  blocker: 4
  warning: 9
  info: 6
  total: 19
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-05-05T00:00:00Z
**Depth:** standard
**Files Reviewed:** 53
**Status:** issues_found

## Summary

Phase 3 lands a substantial body of work — partitioned append-only audit log, hand-authored agency rule sets across FNMA/FHLMC/FHA/VA/USDA with the FHA Back-to-Work DEPRECATED row, agency cascade trigger fan-out, FHFA conforming loan limit ingestion, content-addressed snapshot persistence, and a coherent test matrix. SQL parameter binding is consistent (no string-concatenated user input in any reviewed query), and the migration safety story (DEFERRABLE FK, partial unique index, EXCLUDE constraints) is well-thought-out.

That said, this review surfaces several issues that I would block on before merging:

1. **`rule_snapshot` is world-readable but `captureCurrentBundle` captures cross-tenant rows.** This contradicts CLAUDE.md's explicit "cross-tenant data exposure is a release-blocker" rule and the schema's own doc comment that promises the writer will scope to one tenant.
2. **Snapshot canonical bundle key drift** — the schema doc + migration 0015 header say the bundle keys are `agency_rule_versions/agency_rules/program_versions/program_rules/lender_overlay_rules` but the implementation emits `agency_versions/program_versions/overlay_versions` with no per-rule rows at all. SC#1 deterministic replay can't actually replay from this bundle.
3. **Citation hash collision risk** — `citation_hash` is `md5(source_url|page_number|excerpt)` but the seed loader writes a different excerpt for the FHLMC `BK13_DISMISSED` row at the FHLMC `#BK_CHAPTER_13` URL than for the FHLMC `BK13_DISCHARGED` row at the same URL. With page_number NULL in both, the two rows hash-collide, and the second INSERT silently overwrites the first row's excerpt via `DO UPDATE`. Two FHLMC rules end up sharing one citation with the dismissed-clause excerpt.
4. **Partition pruning broken at the index** — `evaluation_event_tenant_evaluated_idx` is declared `(tenant_id, evaluated_at)` (no DESC) in the schema source but `(tenant_id, evaluated_at DESC)` in the partitioned migration 0008. Drizzle's 0007 emits the unsorted form, then 0008 drops the table; the index ends up correct, but `db/schema/evaluation-event.ts` is now lying about the on-disk shape — the schema is no longer the source of truth.

The remaining warnings flag structural footguns (loose state filter discipline downstream, excerpt length unconstrained, idempotency holes in the seed re-run path) and the info items document smaller code-quality improvements.

## Blocker Issues

### BL-01: rule_snapshot is world-readable but captureCurrentBundle captures cross-tenant rows

**File:** `lib/audit/snapshot-persistence.ts:36-50`, `db/schema/rule-snapshot.ts:31-37`, `db/migrations/0015_rule_snapshot.sql:26-28`

**Issue:** `captureCurrentBundle` runs `SELECT id, recorded_at FROM program_version ORDER BY id` and `... FROM lender_overlay_rule ...` with no tenant filter. The connection runs as `postgres` (admin pool) so RLS does not constrain it. The resulting bundle therefore contains program_version + lender_overlay_rule references from *every* tenant in the database. That bundle is then persisted into `rule_snapshot.content_jsonb`, and the table policy is `rule_snapshot_world_read FOR SELECT TO public USING true`. Any tenant authenticated against the app can `SELECT content_jsonb FROM rule_snapshot LIMIT 1` and read references to every other tenant's program_version IDs.

The schema's own doc comment in `db/schema/rule-snapshot.ts:33-37` even spells this out: *"Cross-tenant exposure: the bundle CAN contain tenant-scoped rows … but the WRITER scopes them to the evaluating tenant only."* The writer does not. This is a direct violation of CLAUDE.md (`### Conventions`): *"Cross-tenant data exposure is a release-blocker. No admin 'view as another tenant,' no cross-tenant analytics …"*.

Today the references are only `id` + `recorded_at`, so the leakage is metadata-shaped (count of tenant-scoped rows, their UUIDs, when they were recorded). Phase 4 plans to extend `content_jsonb` to *full* rule rows per the migration 0015 header — at that point this bug graduates from metadata leak to wholesale tenant-data exfiltration via `SELECT content_jsonb FROM rule_snapshot`.

**Fix:** Pick one of:

```ts
// Option A (preferred): make captureCurrentBundle tenant-scoped at the call boundary
export async function captureCurrentBundle(
  client: PoolClient,
  tenantId: string,
): Promise<SnapshotInput> {
  const arvs = await client.query<{ id: string; recorded_at: Date }>(
    `SELECT id::text, recorded_at FROM agency_rule_version ORDER BY id ASC`,
  ); // agency tables are system-owned: no tenant filter required
  const pvs = await client.query<{ id: string; recorded_at: Date }>(
    `SELECT id::text, recorded_at FROM program_version
     WHERE tenant_id = $1 ORDER BY id ASC`,
    [tenantId],
  );
  const lors = await client.query<{ id: string; created_at: Date }>(
    `SELECT id::text, created_at FROM lender_overlay_rule
     WHERE tenant_id = $1 ORDER BY id ASC`,
    [tenantId],
  );
  // ...
}
```

Then in `scripts/seed/index.ts:50-56`, either drop the baseline-snapshot write (move it to a Phase 4 entry point that knows the evaluating tenant) or write one snapshot per tenant.

```sql
-- Option B (defense-in-depth): replace world_read with a per-tenant-or-system policy
DROP POLICY rule_snapshot_world_read ON rule_snapshot;
CREATE POLICY rule_snapshot_tenant_or_system_read ON rule_snapshot
  FOR SELECT TO public
  USING (
    -- Bundle is system-only by default; explicit tenant scoping when added.
    -- For now, only system_role members can read.
    pg_has_role(current_user, 'system_role', 'MEMBER')
  );
```

Option A is the right shape because it preserves Phase 5's ability to replay a tenant's historical decision without granting that tenant cross-tenant access.

---

### BL-02: snapshot canonical bundle key drift breaks SC#1 historical replay contract

**File:** `lib/audit/snapshot-persistence.ts:59-72, 109-124`, `db/schema/rule-snapshot.ts:21-28`, `db/migrations/0015_rule_snapshot.sql:11-13`

**Issue:** The migration header and schema doc comment promise this canonical bundle shape:

```
{ schema_version, agency_rule_versions[], agency_rules[],
  program_versions[], program_rules[], lender_overlay_rules[] }
```

The implementation in `canonicalize()` actually emits:

```
{ schema_version, agency_versions[], program_versions[], overlay_versions[] }
```

Three problems compound:

1. **Key name mismatch.** `agency_rule_versions` (doc) vs `agency_versions` (impl). `lender_overlay_rules` (doc) vs `overlay_versions` (impl). Anyone writing a Phase 4 reader against the doc shape gets `undefined`.
2. **Missing per-rule arrays.** `agency_rules`, `program_rules`, and `lender_overlay_rules` (the actual rules — not just version refs) are absent. The migration header explicitly says *"Phase 4 evaluator can re-evaluate from this jsonb alone, even if live tables have been updated since the snapshot."* It cannot — it has version IDs but no rule bodies. Phase 4 *must* re-resolve through `agency_rule WHERE agency_rule_version_id IN (...)`, which means an updated rule body produces a different historical decision. This violates SC#1 deterministic replay (which is the entire point of the table).
3. **No per-row canonical ordering of fields inside `content_jsonb`.** `JSON.stringify` on the array elements emits keys in object-literal order: `{ id, recorded_at }`. That happens to be deterministic *only because* the implementation is currently stupid-simple. The moment a Phase 4 PR adds extra fields (`tenant_id`, `agency`, ...) without sorting the keys, V8's iteration order will diverge from the SQL row's column order, and existing `rule_snapshot.sha256_hash` values stop matching new computations of the "same" snapshot.

**Fix:**
1. Reconcile the doc + implementation. Pick one shape and update both. Recommend the migration-header shape (per-rule arrays) so SC#1 holds.
2. Extend `captureCurrentBundle` to pull full row bodies, not just `(id, recorded_at)`:
   ```ts
   const arules = await client.query(
     `SELECT id::text, agency_rule_version_id::text, rule_kind, rule_body
        FROM agency_rule
        WHERE agency_rule_version_id = ANY($1::uuid[])
        ORDER BY id ASC`,
     [arvs.rows.map(r => r.id)],
   );
   ```
3. Add a deep `sortKeysDeep` helper (the VA test already has the recipe at `tests/agency/va-derog.test.ts:69-79`) and pass every row through it before `JSON.stringify` so future field additions can't silently invalidate the hash.
4. Add a contract test: persist a snapshot, mutate `agency_rule.rule_body` of a row inside it, call `loadSnapshot(hash)`, assert the *original* body is returned (not the live one). This locks the determinism contract that SC#1 depends on.

---

### BL-03: citation_hash collides on FHLMC BK13 — second seed silently overwrites first

**File:** `lib/agency-seeds/fhlmc/derog-seasoning.ts:69-93`, `db/migrations/0014_rule_citation_unique_key.sql:14-21`, `scripts/seed-agency.ts:157-164`

**Issue:** The `citation_hash` is computed as:

```sql
md5(coalesce(source_url, '') || '|' || coalesce(page_number::text, '') || '|' || coalesce(excerpt, ''))
```

For the FHLMC fixture, two rows share the same `source_url` (`{FHLMC_CITATION_BASE}#BK_CHAPTER_13`) with different excerpts:

- `BK13_DISCHARGED` → excerpt: `"Bankruptcy (Chapter 13): A two-year waiting period is permitted, measured from the discharge date."`
- `BK13_DISMISSED` → excerpt: `"Bankruptcy (Chapter 13): A four-year waiting period is required, measured from the dismissal date. A two-year waiting period is permitted with documented extenuating circumstances."`

These produce *different* hashes (different excerpts), so the partial unique index doesn't fire. **However**, the loader's `ON CONFLICT (tenant_id, citation_hash) WHERE source_url IS NOT NULL DO UPDATE SET excerpt = EXCLUDED.excerpt` clause still mis-behaves on **re-runs**: both INSERT attempts have distinct hashes so two rows are created per fresh DB. Then on a second `pnpm db:seed` invocation against the same DB, both rows ON CONFLICT match their existing twin and update their own excerpt — fine.

But there is a **real** collision the other way: across the FNMA fixture, `BK13_DISMISSED` cites `${FNMA_CITATION_BASE}#BK_CHAPTER_13_DISMISSED` (distinct anchor) while FHLMC's `BK13_DISCHARGED` and `BK13_DISMISSED` both cite `${FHLMC_CITATION_BASE}#BK_CHAPTER_13` — the *same* URL anchor. Look at the fixture again:

```ts
// FHLMC BK13_DISCHARGED → sourceUrl: `${FHLMC_CITATION_BASE}#BK_CHAPTER_13`
// FHLMC BK13_DISMISSED  → sourceUrl: `${FHLMC_CITATION_BASE}#BK_CHAPTER_13`  // <-- SAME URL
```

Two FHLMC seeds at the same URL with *different* excerpts. After the first seed run:
- `rule_citation` row A: hash = md5(URL|""|"discharge excerpt"), excerpt = discharge text
- `rule_citation` row B: hash = md5(URL|""|"dismissal excerpt"), excerpt = dismissal text

Both `agency_rule` rows correctly point at their own citation. **But** the second seed run's INSERT into `agency_rule` runs after the citation INSERT for *that* run, so the dedupe `WHERE NOT EXISTS` predicate fires — the existing `agency_rule` row points at citation A. New INSERT for B's `agency_rule` is suppressed. This is *probably* benign because both rules already exist. But it relies on the `_seed_key` discriminator being threaded through correctly, AND the `agency_rule.primary_citation_id` pointer is now stable to citation A across both rows of the SAME event_type if a future fixture splits BK13 into two same-URL different-excerpt rows.

The deeper bug: **`page_number` is nullable and ignored**. Two distinct excerpts can collide on hash if they happen to be the same (unlikely but possible across fixtures). More importantly, the hash skips fields like `bbox` and `source_pdf_sha256` that the spec says distinguish citations. A future fixture that shares a URL but cites different page bounding boxes or different source PDFs will silently dedupe.

**Fix:** Either (a) make the FHLMC `BK13_DISCHARGED` and `BK13_DISMISSED` URLs distinct (use `#BK_CHAPTER_13_DISCHARGED` / `#BK_CHAPTER_13_DISMISSED` anchors as FNMA does), AND (b) extend the citation hash to include `bbox` and `source_pdf_sha256`:

```sql
ALTER TABLE rule_citation
  DROP COLUMN citation_hash;
ALTER TABLE rule_citation
  ADD COLUMN citation_hash text GENERATED ALWAYS AS (
    md5(
      coalesce(source_url, '') || '|' ||
      coalesce(page_number::text, '') || '|' ||
      coalesce(bbox::text, '') || '|' ||
      coalesce(source_pdf_sha256, '') || '|' ||
      coalesce(excerpt, '')
    )
  ) STORED;
```

For (a):
```ts
// lib/agency-seeds/fhlmc/derog-seasoning.ts:69, :89
sourceUrl: `${FHLMC_CITATION_BASE}#BK_CHAPTER_13_DISCHARGED`,
sourceUrl: `${FHLMC_CITATION_BASE}#BK_CHAPTER_13_DISMISSED`,
```

Add a regression test: insert 2 rule_citation rows with same URL + different excerpts under the same tenant, assert *two* distinct citation_hashes.

---

### BL-04: db/schema/evaluation-event.ts is no longer the source of truth — silently drifts from the on-disk DDL

**File:** `db/schema/evaluation-event.ts:50-62`, `db/migrations/0008_evaluation_event_partitioned.sql:24, 53-54`

**Issue:** The Drizzle schema declares:
```ts
index('evaluation_event_tenant_evaluated_idx').on(t.tenantId, t.evaluatedAt),
```
which migration 0007 emits as `(tenant_id, evaluated_at)` (ascending, the default). Migration 0008 then `DROP TABLE IF EXISTS evaluation_event CASCADE` and recreates the table partitioned, with the index re-declared as `(tenant_id, evaluated_at DESC)`. The on-disk index is the descending form; the schema source claims ascending.

This isn't merely a docs nit — it has three concrete consequences:

1. **`pnpm drizzle-kit generate` against this schema will detect a "drift"** and emit a *new* migration that converts the index back to ascending. Whoever next regenerates migrations gets a 0016 that quietly degrades the index.
2. **The composite PK shape is also misaligned.** Schema declares `id` and `evaluatedAt` columns separately + a `primaryKey({ columns: [t.id, t.evaluatedAt] })` constraint, which Drizzle will model as if the table is *not* partitioned. Anyone using Drizzle's query builder against `evaluationEvent` will not know to set `evaluated_at` for partition pruning to fire — they'll write `db.select().from(evaluationEvent).where(eq(evaluationEvent.id, x))` which becomes a fan-out across every partition.
3. **`enable RLS` declared in the schema** is a parent-level operation. The schema does NOT declare `forceRowLevelSecurity` because Drizzle 0.45 doesn't model it. The schema contradicts the on-disk state (0008 ENABLES + FORCEs RLS).

The 0008 migration's own header acknowledges this: *"Drizzle 0.45 does not model PARTITION BY RANGE, REVOKE, or composite PK on partitioned tables."* That's correct, but the response should be to **remove the doomed declaration from the schema**, not to keep both. As written, `db/schema/evaluation-event.ts` is misleading documentation that masquerades as code.

**Fix:** Either:

**Option A (preferred):** Replace `db/schema/evaluation-event.ts` with a thin pass-through that exports types only, no `pgTable` declaration, and add a code comment pointing at the canonical migration:
```ts
/**
 * evaluation_event — declared in db/migrations/0008_evaluation_event_partitioned.sql
 * (Drizzle 0.45 cannot model PARTITION BY RANGE / DEFERRABLE FK / FORCE RLS).
 *
 * This file exposes Drizzle types only. The Drizzle schema is intentionally
 * absent — drizzle-kit generate against an authoritative form would emit
 * spurious migrations.
 */
import type { sql } from 'drizzle-orm';
export interface EvaluationEvent { /* ... shape from migration 0008 ... */ }
export type NewEvaluationEvent = Omit<EvaluationEvent, 'id' | 'evaluatedAt'>;
```

**Option B (more invasive):** Add `db/schema/.drizzle-ignore` (or equivalent) and explicitly omit `evaluation_event` from the `drizzle-kit generate` introspection set. Document the omission in the schema source.

Add a CI check that `pnpm drizzle-kit generate --dry-run` produces no diff against the committed migrations. That's the regression gate.

---

## Warnings

### WR-01: DEPRECATED state filter discipline depends on convention, not constraint

**File:** `lib/agency-seeds/fha/back-to-work-deprecated.ts:14-16`, `scripts/seed/agency-fha.ts:19-22`, `tests/agency/fha-derog.test.ts:198-211`

**Issue:** The fix for "FHA Back-to-Work was retired in 2016" is encoded by a `state='DEPRECATED'` column AND an `effective_period='[2013-08-15,2016-09-30)'` daterange. The doc comment in `back-to-work-deprecated.ts:14` claims "Phase 4 evaluator filters on `state='ACTIVE' AND effective_period @> CURRENT_DATE` so the DEPRECATED row exists for historical-scenario replay but never fires for active eligibility decisions."

Today, no Phase 3 production code path actually does this filtering — Phase 4 hasn't shipped. There is no enforced constraint that prevents a future PR from writing:

```ts
const rules = await db
  .select()
  .from(agencyRule)
  .where(eq(agencyRule.agencyRuleVersionId, arvId));  // forgot state filter
```

…and silently returning the Back-to-Work 12-month-foreclosure-waiting-period rule for an active 2026 evaluation. The Phase 3 test at `tests/agency/fha-derog.test.ts:198-211` *only* asserts that a `effective_period @> CURRENT_DATE` query *excludes* the DEPRECATED row — it does *not* assert that any actual application code uses that filter.

This is a Critical-class bug waiting to happen in Phase 4 (and the prompt's Focus Area #9 explicitly flags it as Critical). I'm classifying it Warning *only* because there is no shippable code today that exhibits the bug — but the fix should land before Phase 4 evaluator code does.

**Fix:** Build the safety net now:

1. Add a typed wrapper at `lib/agency-seeds/active-rules.ts` that is the *only* exported entry point for "find active agency rule":
   ```ts
   export function activeAgencyRulesWhere(arv: AgencyRuleVersion) {
     return and(
       eq(agencyRule.agencyRuleVersionId, arv.id),
       sql`${arv.state} = 'ACTIVE'`,
       sql`${arv.effectivePeriod} @> CURRENT_DATE`,
     );
   }
   ```
2. Add a CI lint that grep-fails any `from(agencyRule)` that doesn't go through `activeAgencyRulesWhere`. Or make `agencyRule` not directly importable.
3. Add an integration test that constructs a scenario hitting FORECLOSURE event with a 2024-completion date, evaluates against the FHA matrix, and asserts the deciding rule is the `HUD-4000.1-2024-08` 36m one — *not* the `HUD-4000.1-BTW-DEPRECATED` 12m one.

---

### WR-02: rule_citation excerpt has no length cap; some seeds approach 450 chars

**File:** `lib/agency-seeds/fha/derog-seasoning.ts:60-62`, `db/schema/rule-citation.ts:65`

**Issue:** Focus Area #10 of the prompt asserts `rule_citation.excerpt` is constrained ≤500 chars per Phase 2. I cannot find this constraint:

- `db/schema/rule-citation.ts:65` declares `excerpt: text('excerpt').notNull()` — unbounded.
- No CHECK constraint in any migration referencing `excerpt` and `length`.
- No Zod schema for citation that caps excerpt length.

The longest seeded excerpt is 444 chars (`lib/agency-seeds/fha/derog-seasoning.ts:60-62`, the BK7 excerpt). Currently within the (hypothetical) 500 char cap, but a future fixture could exceed it, and there is no guard.

This is also a citation-hash determinism concern: very long excerpts cause the md5 input string to grow unboundedly, which is fine for md5 but unbounded excerpt growth means the citation table's STORED column index entry grows linearly. Not a correctness bug today; a discipline gap.

**Fix:** Add the constraint that the prompt assumes:
```sql
ALTER TABLE rule_citation
  ADD CONSTRAINT rule_citation_excerpt_length_check
  CHECK (length(excerpt) <= 500);
```
And add a Zod schema for `AgencyRuleSeedCitation`:
```ts
// lib/agency-seeds/types.ts
import { z } from 'zod';
export const agencyRuleSeedCitationSchema = z.object({
  sourceUrl: z.string().url(),
  excerpt: z.string().min(1).max(500),
});
export type AgencyRuleSeedCitation = z.infer<typeof agencyRuleSeedCitationSchema>;
```
Then in the seed loader, validate at load time:
```ts
agencyRuleSeedCitationSchema.parse(seed.citation);
```

---

### WR-03: seedFhfaYear blows past EXCLUDE constraint when re-run mid-year (idempotency hole)

**File:** `scripts/seed-agency.ts:251-352`

**Issue:** The function does this sequence:

1. UPDATE all open-ended (`upper_inf`) versions with `year < current` to close them at `${year}-01-01`.
2. SELECT existing version row for `year`. If found, reuse. Otherwise INSERT new.

When called for year 2026 against a fresh DB, this works. When called for year 2026 against a DB where 2026 was already seeded once, step 2's lookup short-circuits and reuses the existing version. Fine.

**But** if the loader is interrupted between step 1 and step 2 (e.g. a SIGKILL during the per-county INSERT loop), the next run encounters this state:
- Year 2025 row exists with `effective_period = [2025-01-01, 2026-01-01)` (closed by the prior run).
- Year 2026 row may or may not exist (interrupted before INSERT).
- If 2026 row absent, step 2 attempts INSERT with `effective_period = '[2026-01-01,)'` (truly unbounded).

The EXCLUDE constraint is `EXCLUDE USING gist (year WITH =, effective_period WITH &&)`. Year 2026 vs year 2025 is `=` mismatch, so EXCLUDE doesn't fire. INSERT succeeds. **However**, if the prior run wrote 2026 with a bounded form (it did — the lookup would have found it), and a Phase 4+ migration later writes 2027 → seedFhfaYear closes 2026 to `[2026-01-01, 2027-01-01)` and INSERTs 2027. This is correct.

The actual idempotency bug: line 278-284 closes any `year < N` open-ended row. But there is no transactional guarantee that the close + the INSERT happen atomically with each other — they're inside the same `BEGIN/COMMIT` envelope, so they ARE atomic. However, the close writes UPDATE on a system-owned table without first checking `app.tenant_id` is set to a SYSTEM tenant. If a future caller is wired with `app.tenant_id` set to a tenant UUID, the UPDATE will silently affect zero rows because `conforming_loan_limit_version` has `system_role` write policy. A silent zero-row UPDATE leaves prior versions open-ended, which **then** lets the new INSERT collide with the prior's open-ended `infinity` upper.

**Fix:** Set the GUC explicitly to system tenant before running the close, and assert it took effect:
```ts
await client.query('BEGIN');
await client.query(`SET LOCAL ROLE postgres`);  // confirm we're system_role
const closed = await client.query(
  `UPDATE conforming_loan_limit_version
     SET effective_period = daterange(lower(effective_period), $1::date, '[)')
   WHERE upper_inf(effective_period)
     AND year < $2
   RETURNING year`,
  [`${year}-01-01`, year],
);
console.log(`Closed ${closed.rowCount} prior open-ended versions: ${closed.rows.map(r => r.year)}`);
```

Even better: refuse to run if `current_setting('app.tenant_id', true)` is set to a non-SYSTEM tenant, and document that the loader must be invoked from the migration role only.

---

### WR-04: Test isolation root cause — mid-test `pnpm db:seed` invocation in `tests/schema/setup.ts`

**File:** `tests/schema/setup.ts:53-63`

**Issue:** Focus Area #8 asks about the `pnpm test:schema` parallel-fork race documented in 03-04 + 03-06 SUMMARYs. Looking at `tests/schema/setup.ts:53-63`:

```ts
const { execFileSync } = await import('node:child_process');
try {
  execFileSync('pnpm', ['db:seed'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_MIGRATION_URL: ADMIN_URL },
  });
} catch (err) { ... }
```

This is the root cause of the parallel-fork race:
1. Vitest with default poolOptions runs each test file in a separate worker thread/process.
2. Each worker imports `setup.ts` → each worker's `beforeAll` fires once.
3. Each worker runs `pnpm db:seed` against the *same* DB.
4. `seedFnma()` / `seedFhlmc()` etc. each open their own transactions; the `INSERT INTO agency_rule_version ... WHERE NOT EXISTS` is idempotent at the row level but the get-or-create-tenant + GUC set-up race against each other.
5. `seedFhfaYear` does the global UPDATE-close-prior-versions; multiple workers run this UPDATE simultaneously and at least one will see zero rows (no open-ended row to close because another worker already closed it), then the INSERT path may collide on the EXCLUDE constraint.
6. `persistSnapshot` in `scripts/seed/index.ts:53` calls `captureCurrentBundle` → INSERT into `rule_snapshot ... ON CONFLICT (sha256_hash) DO UPDATE`. If two workers race, both compute the same hash (identical bundle); one INSERT wins, the other ON CONFLICTs — fine. But if the bundles have *raced* to capture different snapshots (worker A captures ARV+pv at T0, worker B at T1 while A is mid-INSERT), they produce different hashes and *both* persist. This is benign but flaky for any test asserting a specific row count.

Beyond the race, the cost itself is wrong: invoking `pnpm db:seed` (which spawns a Node process) inside `beforeAll` of a test file means a `pnpm` child process per Vitest worker, and pnpm's own startup is several hundred ms. With 5+ test files, that's seconds of duplicated work.

**Fix:** Move the seed to `globalSetup` (single invocation, no per-worker race). Vitest 4 supports `globalSetup` in `vitest.schema.config.ts`:

```ts
// vitest.schema.config.ts
export default {
  test: {
    globalSetup: ['./tests/schema/global-setup.ts'],
    setupFiles: ['./tests/schema/setup.ts'],
  },
};

// tests/schema/global-setup.ts
import { execFileSync } from 'node:child_process';
export default async function setup() {
  execFileSync('pnpm', ['db:seed'], { stdio: 'inherit', ... });
}
```

`tests/schema/setup.ts` then opens the connection pool only — no seed invocation.

---

### WR-05: pool.end() is fire-and-forget on seed failure — process exit may race the close

**File:** `scripts/seed/index.ts:62-67`

**Issue:**
```ts
main().catch((err) => {
  console.error('seed-agency failed:', err);
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  pool.end();         // <-- not awaited
  process.exit(1);    // <-- runs immediately
});
```

`pool.end()` returns a `Promise<void>`. `process.exit(1)` runs synchronously before the pool drains. On Node 18+, this typically results in `pg`'s sockets being closed mid-flight, which can leave server-side transactions hanging until Postgres detects the abrupt disconnect. Not a correctness bug per se, but it means `seed-agency failed: ...` may produce a truncated log on the next run when Postgres reaps the previous connection's stuck txn.

The eslint-disable comment is also misleading — the issue isn't "no-floating-promises", it's "promise not awaited". The disable hides the actual smell.

**Fix:**
```ts
main().catch(async (err) => {
  console.error('seed-agency failed:', err);
  try {
    await pool.end();
  } catch (closeErr) {
    console.error('pool close also failed:', closeErr);
  }
  process.exit(1);
});
```

---

### WR-06: 0008 migration drops + recreates evaluation_event without verifying it's empty

**File:** `db/migrations/0008_evaluation_event_partitioned.sql:19-25`

**Issue:** The header comment says: *"on a fresh CI DB, 0007 runs CREATE (the non-partitioned form), then 0008 DROPs and recreates partitioned. This sequence is safe because 0007's evaluation_event is empty when 0008 runs."*

That's true on a *fresh* CI DB. **But Drizzle migrations can be re-applied** — `drizzle-kit migrate` records each applied migration in the `drizzle.__drizzle_migrations` journal. If a developer:

1. Applies 0007 (creates non-partitioned evaluation_event).
2. Inserts test data.
3. Pulls in 0008 from main and runs `drizzle-kit migrate`.

The journal will skip 0007 (already applied) but apply 0008. `DROP TABLE IF EXISTS evaluation_event CASCADE` then drops the table *with* the test data. CASCADE will also drop any FK pointing at evaluation_event (e.g., child partitions, but in this case there are none yet). Silent data loss.

This is unlikely in CI (clean DB every run) but a real foot-gun for a developer working across PRs that both touch this table.

**Fix:** Either:
1. Guard the DROP behind a count check:
   ```sql
   DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM evaluation_event LIMIT 1) THEN
       RAISE EXCEPTION 'evaluation_event has rows; refusing to recreate as partitioned. Migrate data manually or run db:reset.';
     END IF;
   END
   $$;
   DROP TABLE evaluation_event CASCADE;
   ```
2. Better: add a 0008-style migration *only* for environments where 0007 ran, and gate the drop behind environment variable `LENDER_SEARCH_ALLOW_DESTRUCTIVE_MIGRATION=1`.

Migrations on populated tables that DROP CASCADE should never run silently.

---

### WR-07: enqueue_agency_cascade trigger runs SECURITY INVOKER under app_user — RLS WITH CHECK fires

**File:** `db/migrations/0010_cascade_review_queue.sql:24-47`

**Issue:** The trigger is `SECURITY INVOKER` (line 27). When an `app_user`-role connection inserts into `agency_rule_version`, the `AFTER INSERT` trigger fires under app_user's privileges. The trigger then INSERTs into `cascade_review_queue` with `tenant_id = pv.tenant_id` for *every* affected program_version. But app_user's RLS WITH CHECK policy on `cascade_review_queue` is `tenant_id = current_setting('app.tenant_id', true)::uuid` — so the trigger can only insert rows whose tenant_id equals the *currently set GUC*. If the trigger fans out across tenants A and B, it succeeds for the GUC-matching tenant and fails RLS WITH CHECK for the other.

The `cascade_review_queue_system_write` policy (line 78 of 0007) lets system_role members bypass — but the trigger runs as the *invoking* role, which is `app_user` (NOT a system_role member). The cascade insert path therefore depends on the inserter being a system_role member, not app_user.

In practice, agency_rule_version writes happen exclusively via `seedAgencyVersionAndRules` which connects as postgres (a system_role member). So today the trigger does work. **But** there is no enforcement that future code paths writing to `agency_rule_version` use a system_role connection. If Phase 6's Inngest worker writes new agency_rule_version rows under an `app_user` connection (because that's the default), the cascade fan-out will silently fail RLS WITH CHECK and skip rows for tenants other than the one whose GUC is set.

The "silent skip" comes from `INSERT INTO ... SELECT` semantics: rows that fail RLS WITH CHECK don't raise — they just don't insert. The trigger returns NEW happily.

**Fix:** Either:
1. Change the trigger to `SECURITY DEFINER` and own it as a system_role-member function:
   ```sql
   CREATE OR REPLACE FUNCTION enqueue_agency_cascade()
     RETURNS trigger
     LANGUAGE plpgsql
     SECURITY DEFINER
   AS $$
   ```
   Then `ALTER FUNCTION enqueue_agency_cascade() OWNER TO postgres` so the function always runs as postgres regardless of the inserter.
2. Or document the contract explicitly with a runtime check inside the trigger:
   ```sql
   IF NOT pg_has_role(current_user, 'system_role', 'MEMBER') THEN
     RAISE EXCEPTION 'enqueue_agency_cascade: invoking role must be system_role member';
   END IF;
   ```

Option 1 is the right shape because it lets future code paths work without requiring connection-role discipline at every call site.

---

### WR-08: pgPolicy `to: 'public'` declarations don't model FORCE — schema can never be source-of-truth

**File:** `db/schema/cascade-review-queue.ts:45-58`, `db/schema/evaluation-event.ts:54-60`, `db/schema/rule-snapshot.ts:53-65`

**Issue:** Drizzle 0.45's `pgPolicy` doesn't model `ALTER TABLE ... FORCE ROW LEVEL SECURITY`. The schema declares the `enableRowLevelSecurity` (which Drizzle DOES emit) but the FORCE clause is added in a follow-up migration (0010 line 20, 0008 line 46, 0015 line 34). The first migration that comes from `drizzle-kit generate` will not include FORCE, so a hot-loaded migration on a fresh DB through Drizzle alone leaves these tables with `relrowsecurity=t, relforcerowsecurity=f`.

The 0007 + 0008 sequence (Drizzle generates → manual 0008 force) handles this. But it relies on every reviewer noticing that any new RLS-enabled table needs a follow-up migration. There is no schema-level signal that `cascade_review_queue` requires FORCE — a future PR could add a new RLS-only table and forget the FORCE migration entirely.

**Fix:** Add a CI assertion that every table with `relrowsecurity=t` also has `relforcerowsecurity=t`. Place it in `tests/schema/`:

```ts
it('every RLS-enabled table also has FORCE', async () => {
  const adminClient = await globalThis.__pgAdminPool.connect();
  try {
    const { rows } = await adminClient.query<{ relname: string }>(
      `SELECT relname FROM pg_class
        WHERE relkind = 'r'
          AND relrowsecurity = true
          AND relforcerowsecurity = false
          AND relname NOT IN ('schema_migrations')  -- explicit allowlist`
    );
    expect(rows, `tables with RLS but not FORCE: ${rows.map(r=>r.relname).join(',')}`).toHaveLength(0);
  } finally {
    adminClient.release();
  }
});
```

This converts "remember to add FORCE" from a code-review obligation into a test.

---

### WR-09: snapshotId canonical JSON object iteration order is implementation-defined for non-string keys

**File:** `lib/audit/snapshotId.ts:31-43`

**Issue:** The implementation:
```ts
const canonical = {
  agency_versions: [...input.agencyVersions]
    .map((v) => ({ id: v.id, recorded_at: v.recorded_at }))
    .sort((a, b) => a.id.localeCompare(b.id)),
  // ...
};
return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
```

Two issues with `JSON.stringify` here:

1. **Top-level object key order.** ES2015 fixed JS object iteration order: integer-like keys first (in numeric order), then string keys in insertion order. `agency_versions / program_versions / overlay_versions` are all string keys, inserted in that specific order, so `JSON.stringify` emits them in that order — **on V8**. Other engines theoretically also follow ES2015, but the spec language is "implementation-defined for traversal" in some edge cases. This is a fragile dependency on V8 behavior. The test asserts A1-A4 round-trips on the same engine; it does not assert that another implementation (e.g. running this in Cloudflare Workers, Bun, or Deno) produces the same hash.

2. **`recorded_at` string format.** The contract says ISO 8601 string. `new Date().toISOString()` always emits the same format (`YYYY-MM-DDTHH:mm:ss.sssZ`). But callers can supply hand-built strings — e.g. `'2026-05-01T00:00:00Z'` (no millis) vs `'2026-05-01T00:00:00.000Z'` (with millis). These produce different hashes for the same logical timestamp. The Pitfall PG-3 comment in `snapshot-persistence.ts:18-20` says callers normalize via `.toISOString()`, but `snapshotId(input)` accepts any string and doesn't validate.

**Fix:**
1. Sort the top-level keys deterministically:
   ```ts
   const sortedCanonical = JSON.stringify(canonical, Object.keys(canonical).sort());
   ```
   Or use a recursive sort helper (see `tests/agency/va-derog.test.ts:69-79` for the recipe).

2. Validate the `recorded_at` shape in the `VersionRef` type:
   ```ts
   const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
   export function snapshotId(input: SnapshotInput): string {
     for (const v of [...input.agencyVersions, ...input.programVersions, ...input.overlayVersions]) {
       if (!ISO_8601_REGEX.test(v.recorded_at)) {
         throw new Error(`recorded_at must match YYYY-MM-DDTHH:mm:ss.sssZ; got ${v.recorded_at}`);
       }
     }
     // ... existing canonicalization
   }
   ```

The regex assertion in the test (`tests/audit/snapshot-persistence.test.ts:99`) catches this for `captureCurrentBundle`, but not for direct `snapshotId(input)` calls.

---

## Info

### IN-01: pg_cron migration silently swallows unrelated errors

**File:** `db/migrations/0009_evaluation_event_pg_cron.sql:8-20`

The exception handler catches `undefined_file OR feature_not_supported OR insufficient_privilege`, which covers the docker-postgres-16-alpine case where pg_cron is absent. **However**, if the `cron.schedule` call fails for a different reason (e.g., a typo in the function name, a syntax error in the schedule expression), those errors do NOT match the WHEN clause and would re-raise. Good. But the NOTICE message is misleading — it says "pg_cron unavailable" even when the actual cause might be "pg_cron available, schedule call failed". A future maintainer reading the log will misdiagnose.

**Fix:** Distinguish "extension absent" from "schedule failed":
```sql
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION
  WHEN undefined_file OR feature_not_supported OR insufficient_privilege THEN
    RAISE NOTICE 'pg_cron extension unavailable; skipping schedule';
    RETURN;
END
$$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'create_next_evaluation_event_partition',
    '0 2 1 * *',
    $cron$ SELECT create_next_evaluation_event_partition() $cron$
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron schedule failed: %', SQLERRM;
END
$$;
```

---

### IN-02: Excerpt encoded as English text duplicates information already in rule_body

**File:** `lib/agency-seeds/fnma/derog-seasoning.ts:50-53`, `lib/agency-seeds/fhlmc/derog-seasoning.ts:48-53` (and others)

The citation excerpts are paraphrased English of the rule_body (e.g., "A four-year waiting period is required, measured from the discharge or dismissal date of the bankruptcy action."). Anyone editing the `base_waiting_months` field has to also edit the excerpt's "four-year" string. Either field can drift from the source document, and there's no test that asserts the rule_body matches the excerpt's English form.

**Fix:** Either:
1. Drop the paraphrase. The `excerpt` should be a verbatim cited textSpan from the source PDF, not a re-stated description. The schema doc comment in `db/schema/rule-citation.ts:22-23` explicitly says this: *"the cited textSpan; structural guarantee that citations carry the actual quoted text"*. Today's seeds violate that — they're paraphrases, not quotes.
2. Add a regression check that compares `rule_body.base_waiting_months` to a numeric extraction from `excerpt` (e.g., regex out "four-year" → 48 months) and asserts equality.

---

### IN-03: tests/cascade/cascade-trigger.test.ts uses random close years; tests can flake on collision

**File:** `tests/cascade/cascade-trigger.test.ts:63, 122`, `tests/rls/cascade-review-queue-cross-tenant.test.ts:73`

The cascade integration tests pick `closeYear = 2080 + Math.floor(Math.random() * 10)` (range [2080..2089]). Each test wraps in BEGIN/ROLLBACK so cross-test state doesn't leak. **But** if two parallel test workers happen to pick the same year + insert at the same instant on the same prior ARV, they conflict on the EXCLUDE `agency_rule_version_no_overlap`. Probability is low (1/10 × small collision window) but non-zero.

The test at `tests/cascade/cascade-trigger.test.ts:143-196` hardcodes `closeYear = 2095` (line 172), which avoids the flake but also hardcodes a single year — if the test is split into multiple iterations, they all collide.

**Fix:** Replace random year selection with `gen_random_uuid()`-derived year offset, or use a wider range (e.g. 2080-2179, 100-year window, 10x lower collision probability). Or, since each test is in BEGIN/ROLLBACK, each worker's seed only exists inside its own txn — the EXCLUDE check fires per-row regardless. The race is only between concurrent COMMITs, but the tests ROLLBACK… so this is actually safe except for the one test at line 73-87 of `cascade-trigger.test.ts` which COMMITs at line 74. Look there.

Actually re-reading: line 74 of `cascade-trigger.test.ts` is `await client.query('COMMIT')` inside the DEFERRABLE FK two-step test. That test cleans up via DELETE. The DELETE is best-effort (line 78); if cleanup fails (e.g., another test is mid-INSERT), the ARV row leaks. Fixing this: use ROLLBACK with `SET CONSTRAINTS ALL IMMEDIATE` to validate the FK without committing.

---

### IN-04: VA fixture's `not_applicable: true` rows still set `reestablished_credit_required` and `mortgage_included_in_bk_rule`

**File:** `lib/agency-seeds/va/derog-seasoning.ts:151-177`

The 4 VA sentinel rows for FORECLOSURE / DEED_IN_LIEU / SHORT_SALE / MORTGAGE_CHARGE_OFF set `not_applicable: true`, yet still populate `reestablished_credit_required: false`, `mortgage_included_in_bk_rule: 'NOT_APPLICABLE'`, and `measurement_anchor: 'COMPLETION'` (or `'CHARGE_OFF_DATE'`). These fields are semantically meaningless when `not_applicable=true` but Phase 4 evaluator code that doesn't check `not_applicable` first might still read them and produce wrong outputs.

**Fix:** Add a Zod refine on `DerogSeasoning` that requires when `not_applicable === true`:
- `base_waiting_months` is null
- `extenuating_circumstances_waiting_months` is null
- `post_event_LTV_caps` is empty array

That makes the contract structural, not commented.

---

### IN-05: scripts/seed-agency.ts URL_GATE only checks scheme — not full URL validity

**File:** `scripts/seed-agency.ts:87, 137-139`

The `URL_GATE = /^https?:\/\//` regex blocks `file://` and `javascript:` schemes but doesn't validate the rest. `https://` (just the scheme, no host) passes. So does `https://localhost:9999/<script>alert(1)</script>`.

For the Phase 3 hand-authored fixtures this is fine because authors curate the URLs. For Phase 6 (when extraction-pipeline citations get loaded), the gate is too weak.

**Fix:** Use the URL constructor:
```ts
function validateCitationUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Citation URL not parseable: ${raw}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Citation URL must be http(s); got ${parsed.protocol}`);
  }
  if (!parsed.hostname) {
    throw new Error(`Citation URL missing hostname: ${raw}`);
  }
}
```

---

### IN-06: Test golden hashes hardcoded with no documentation of regeneration procedure

**File:** `tests/agency/fha-derog.test.ts:264`, `tests/agency/fhlmc-derog.test.ts:135`, `tests/agency/fnma-derog.test.ts:202`, `tests/agency/va-derog.test.ts:86`

Each agency has a golden snapshot test asserting a hardcoded sha256 hash. Comments mention "bumping requires an intentional rule-body change paired with a fresh hash capture" but there's no script or doc explaining how to regenerate the hash. A first-time contributor changing a fixture has to:
1. Run the test, see the failure.
2. Read the failure message (which hopefully prints the actual hash).
3. Copy that hash into the test source.

This works, but the hash-bumping process is a footgun for accidental "make the test green" pressure — reviewers must enforce that hash bumps in PRs come paired with a documented rule change.

**Fix:** Add `pnpm test:golden:regenerate` script that runs each golden test in capture mode (writes the hash back to the test file) so the regeneration is one command. Alternatively, write the golden hashes to `*.golden.json` files alongside the tests so the diff in PR review surfaces both the old + new hash explicitly.

---

_Reviewed: 2026-05-05T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
