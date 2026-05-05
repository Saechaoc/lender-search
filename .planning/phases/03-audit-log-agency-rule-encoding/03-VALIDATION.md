---
phase: 3
slug: audit-log-agency-rule-encoding
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-04
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Sourced from `03-RESEARCH.md` §"Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.5 (per Phase 1+2; package.json) |
| **Config files** | `vitest.config.ts` (RLS suite), `vitest.schema.config.ts` (schema/rules suite); Phase 3 extends `vitest.schema.config.ts` to include `tests/audit/`, `tests/agency/`, `tests/cascade/` paths |
| **Quick run command** | `pnpm test:schema -t '<filter>'` (targeted Vitest -t filter) |
| **Full suite command** | `pnpm test:rls && pnpm test:schema` |
| **Estimated runtime** | ~10s full suite at Phase 3 size; <5s per filtered run |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test:schema -t '<filter>'` for the file under change
- **After every plan wave:** Run `pnpm test:schema && pnpm test:rls`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10s (full suite); <5s (targeted filter)

---

## Per-Task Verification Map

> Task IDs are filled in by the planner. The Requirement → Test mapping below is locked.

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| AUD-01 | `evaluation_event` partitioned by month, RLS-policed | structural | `pnpm test:schema -t 'evaluation_event partitioned'` | ❌ W0 (`tests/audit/evaluation-event-structural.test.ts`) | ⬜ pending |
| AUD-02 | `evaluation_event` has all required columns + CHECK constraints | structural | `pnpm test:schema -t 'evaluation_event columns'` | ❌ W0 (same file) | ⬜ pending |
| AUD-03 | REVOKE UPDATE/DELETE structurally enforced on parent + every child partition | security | `pnpm test:schema -t 'evaluation_event REVOKE'` | ❌ W0 (same file) | ⬜ pending |
| AUD-04 | `lib/audit/snapshotId.ts` determinism (4 assertions: A1 same/same, A2 reorder/same, A3 extra/different, A4 mutate/different) | unit | `pnpm test:schema -t 'snapshotId determinism'` | ❌ W0 (`tests/audit/snapshot-id.test.ts`) | ⬜ pending |
| AGY-01 | `agency_rule_version` row exists per agency post-seed (FNMA, FHLMC, FHA, VA, USDA) | structural | `pnpm test:schema -t 'agency_rule_version per agency'` | ❌ W0 (`tests/agency/agency-version.test.ts`) | ⬜ pending |
| AGY-02 | FNMA full derog matrix per `event_type` (8 line items per SC#3: BK7 base/EC, BK13_DISCHARGED, BK13_DISMISSED, MULTIPLE_BK, FORECLOSURE base + 90% LTV cap window, DIL/SS/CO base/EC, mortgage-included-in-BK exception) | structural | `pnpm test:schema -t 'FNMA derog'` | ❌ W0 (`tests/agency/fnma-derog.test.ts`) | ⬜ pending |
| AGY-02 | FNMA derog golden snapshot (sha256 of seeded rule_body bundle) | regression | `pnpm test:schema -t 'FNMA derog bundle matches golden'` | ❌ W0 (same file) | ⬜ pending |
| AGY-03 | FHLMC §5202.5 derog matrix encoded with FHLMC-specific anchors | structural | `pnpm test:schema -t 'FHLMC derog'` | ❌ W0 (`tests/agency/fhlmc-derog.test.ts`) | ⬜ pending |
| AGY-04 | FHA HUD 4000.1 standard EC active | structural | `pnpm test:schema -t 'FHA standard EC active'` | ❌ W0 (`tests/agency/fha-derog.test.ts`) | ⬜ pending |
| AGY-04 | FHA Back-to-Work `state='deprecated'` + `sunset_date='2016-09-30'` queryable but excluded from active-rule lookups | structural | `pnpm test:schema -t 'FHA Back-to-Work DEPRECATED'` | ❌ W0 (same file) | ⬜ pending |
| AGY-05 | VA Pamphlet 26-7 Chapter 4 Topic 7 derog matrix | structural | `pnpm test:schema -t 'VA derog'` | ❌ W0 (`tests/agency/va-derog.test.ts`) | ⬜ pending |
| AGY-06 | `program_version → agency_rule_version` FK (already shipped Phase 2) | structural | covered by `tests/schema/derog-rule-roundtrip.test.ts` (Phase 2) | ✅ Phase 2 | ✅ green |
| AGY-07 | `lib/cascade/poll.ts::pollAgencyPublications` typed handler signature returns `Promise<PollResult[]>` empty array stub | unit | `pnpm test:schema -t 'pollAgencyPublications'` | ❌ W0 (`tests/cascade/poll-stub.test.ts`) | ⬜ pending |
| AGY-08 | `enqueue_agency_cascade()` trigger fans out one `cascade_review_queue` row per affected `program_version` across multiple tenants (D-17 integration test) | integration | `pnpm test:schema -t 'cascade trigger'` | ❌ W0 (`tests/cascade/cascade-trigger.test.ts`) | ⬜ pending |
| AGY-08 | `cascade_review_queue` cross-tenant pen tests (Phase 1 D-03 + Phase 2 D-19 matrix) | security | `pnpm test:rls -t 'cascade_review_queue'` | ❌ W0 (`tests/rls/cascade-review-queue-cross-tenant.test.ts`) | ⬜ pending |
| AGY-08 | Initial agency version INSERT (`superseded_by IS NULL`) inserts zero queue rows (Pitfall PG-4) | integration | `pnpm test:schema -t 'cascade trigger initial insert'` | ❌ W0 (same file) | ⬜ pending |
| AGY-09 | `conforming_loan_limit_version` EXCLUDE on `(year WITH =, effective_period WITH &&)` + `conforming_loan_limit_county` PK + structural | structural | `pnpm test:schema -t 'conforming_loan_limit'` | ❌ W0 (`tests/schema/fhfa-loan-limits.test.ts`) | ⬜ pending |
| AGY-09 | `program_version.conforming_loan_limit_version_id uuid NULL FK` exists | structural | `pnpm test:schema -t 'program_version conforming FK'` | ❌ W0 (same file) | ⬜ pending |
| AGY-09 | FHFA 2026 CSV loader idempotency (`pnpm db:seed && pnpm db:seed` produces identical state) + ~25,600 rows seeded | regression | `pnpm test:schema -t 'fhfa loader idempotent'` | ❌ W0 (same file) | ⬜ pending |

---

## Wave 0 Requirements

Test stubs and infra that MUST land before any feature task:

- [ ] `tests/audit/evaluation-event-structural.test.ts` — covers AUD-01 (partition introspection via `pg_partition_tree`), AUD-02 (column + CHECK introspection via `information_schema`), AUD-03 (REVOKE introspection via `pg_class.relacl` on parent + every child partition)
- [ ] `tests/audit/snapshot-id.test.ts` — covers AUD-04 four assertions (A1/A2/A3/A4)
- [ ] `tests/agency/agency-version.test.ts` — covers AGY-01 (one `agency_rule_version` row exists per agency post-`pnpm db:seed`)
- [ ] `tests/agency/fnma-derog.test.ts` — covers AGY-02 (8 structural assertions per SC#3 line items + golden snapshot)
- [ ] `tests/agency/fhlmc-derog.test.ts` — covers AGY-03
- [ ] `tests/agency/fha-derog.test.ts` — covers AGY-04 (standard EC active + Back-to-Work DEPRECATED + sunset filter)
- [ ] `tests/agency/va-derog.test.ts` — covers AGY-05
- [ ] `tests/cascade/poll-stub.test.ts` — covers AGY-07 (typed handler signature + empty array return)
- [ ] `tests/cascade/cascade-trigger.test.ts` — covers AGY-08 (D-17 integration test: 2 tenants × 1 program_version each → 2 queue rows post-cascade; initial-insert short-circuit)
- [ ] `tests/rls/cascade-review-queue-cross-tenant.test.ts` — covers AGY-08 cross-tenant matrix
- [ ] `tests/schema/fhfa-loan-limits.test.ts` — covers AGY-09 (EXCLUDE constraint + program_version FK + loader idempotency)
- [ ] `lib/agency-seeds/types.ts` — shared `AgencyRuleSeed<T>` type
- [ ] `scripts/seed-agency.ts` — idempotent loader connecting via `DATABASE_MIGRATION_URL` with `ON CONFLICT DO NOTHING` keyed on `(agency, version_label, rule_kind, event_type)`
- [ ] `scripts/seed-fhfa.ts` (or extension to `seed-agency.ts`) — FHFA CSV ingestion via `csv-parse@5.6+`
- [ ] `package.json` script: `"db:seed": "tsx scripts/seed-agency.ts && tsx scripts/seed-fhfa.ts"` (or unified `seed-agency.ts`)
- [ ] CI step in `.github/workflows/ci.yml` to run `pnpm db:seed` after `pnpm drizzle-kit migrate`
- [ ] Extend `tests/rls/global-setup.ts` and `tests/schema/setup.ts` to call `pnpm db:seed` after migrate
- [ ] Optional: extract `tests/_shared/agency-fixture.ts` per Phase 2 WR-05 follow-up (planner picks)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| pg_cron extension availability under Supabase managed tier | AUD-01 (partition auto-create) | Requires Supabase project; not testable in local docker-postgres-16-alpine | At Phase 6: `SELECT extname FROM pg_extension WHERE extname = 'pg_cron';` against the Supabase project. If absent, fall back to Supabase native scheduler. Phase 3 ships the function unconditionally — scheduler choice deferred. |
| FNMA Selling Guide URL anchor stability | AGY-02 (citation discipline) | FNMA republishes the Selling Guide; auto-generated anchor IDs may drift across publications | Periodic manual verification (Phase 6+ cascade poll surfaces this automatically via sha256 fingerprint). At Phase 3 close: each `rule_citation.source_url` resolves to the cited content. Verbatim `excerpt` enables manual re-resolution if anchor breaks. |
| FHLMC §5202.5 anchor specifics (assumption A1) | AGY-03 | FHLMC guide behind interactive interface; URL stability requires manual visit | Planner verifies FHLMC FORECLOSURE EC reduction (24m vs FNMA's 36m) against canonical guide before AGY-03 PR merges. Document outcome in plan SUMMARY. |
| Mortgagee Letter 2016-14 vs 2016-09 number for Back-to-Work termination (assumption A6) | AGY-04 | HUD's archive may use different letter numbering than research found | Planner verifies exact ML number against HUD's archive before AGY-04 PR merges. The DEPRECATED state + sunset_date is what matters; ML number is documentation. |

---

## Nyquist Dimensions Coverage

| Dimension | Coverage |
|-----------|----------|
| **D1 Structural** | Per-rule field assertions (`tests/agency/<agency>-derog.test.ts`); table+column introspection (`tests/audit/evaluation-event-structural.test.ts`, `tests/schema/fhfa-loan-limits.test.ts`); FK + EXCLUDE + CHECK introspection |
| **D2 Behavioral** | Cascade trigger integration test (`tests/cascade/cascade-trigger.test.ts`); two-step convention exercise; trigger fires per affected program_version; initial-insert short-circuit |
| **D3 Regression** | Per-agency golden snapshot (sha256 of seeded rule_body bundle); `lib/audit/snapshotId.ts` deterministic round-trip; FHFA loader idempotency |
| **D4 Security** | Cross-tenant pen tests on `cascade_review_queue` (matches Phase 1 D-03 + Phase 2 D-19); REVOKE structural enforcement on `evaluation_event` parent + child partitions (Pitfall PG-1, PG-2) |
| **D5 Determinism** | snapshotId four assertions (A1/A2/A3/A4); per-agency golden snapshot; partition routing only via parent name (Pitfall PG-1) |
| **D6 Idempotency** | Loader re-run safety: `ON CONFLICT DO NOTHING` keyed on `(agency, version_label, rule_kind, event_type)`; `pnpm db:seed && pnpm db:seed` produces identical state; FHFA two-step daterange close convention |
| **D7 Forward-compat** | `lib/audit/snapshotId.ts` signature locked at Phase 3 (Phase 4 evaluator imports unchanged); `lib/cascade/poll.ts::pollAgencyPublications` signature locked (Phase 6 implements); `cascade_review_queue` shape locked (Phase 6 worker SKIP LOCKED + Phase 8 AM UI) |
| **D8 Validation Surface** | Zod `parseRuleBody(kind, body)` at fixture compile time + at loader runtime; FHFA per-row Zod validation (county_fips length 5, numeric range sanity) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
