---
phase: 3
slug: audit-log-agency-rule-encoding
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-04
audited: 2026-05-05
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Sourced from `03-RESEARCH.md` §"Validation Architecture".
> Audited 2026-05-05 against post-execution state — all rows verified COVERED via targeted `pnpm test:schema -t '<filter>'` runs.

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

| Requirement | Behavior | Test Type | Automated Command | Test File | Status |
|-------------|----------|-----------|-------------------|-----------|--------|
| AUD-01 | `evaluation_event` partitioned by month, RLS-policed parent + 6 forward children (B7b) | structural | `pnpm test:schema -t 'evaluation_event partitioned'` | `tests/audit/evaluation-event-structural.test.ts` (8 tests) + `tests/audit/evaluation-event-child-rls.test.ts` | ✅ COVERED |
| AUD-02 | `evaluation_event` columns + decision CHECK constraint + REVOKE structurally enforced | structural | `pnpm test:schema -t 'evaluation_event'` | `tests/audit/evaluation-event-structural.test.ts` | ✅ COVERED |
| AUD-03 | REVOKE UPDATE/DELETE on parent + every child partition (Pitfall PG-1, PG-2) | security | `pnpm test:schema -t 'evaluation_event REVOKE'` | `tests/audit/evaluation-event-structural.test.ts` | ✅ COVERED |
| AUD-04 | `lib/audit/snapshotId.ts` determinism + `lib/audit/snapshot-persistence.ts` round-trip | unit | `pnpm test:schema -t 'snapshotId'` | `tests/audit/snapshot-id.test.ts` (5 tests) + `tests/audit/snapshot-persistence.test.ts` | ✅ COVERED |
| AGY-01 | `agency_rule_version` row exists per agency post-seed (FNMA, FHLMC, FHA, VA, USDA) | structural | `pnpm test:schema -t 'agency_rule_version'` | `tests/agency/agency-version-{fnma,fhlmc,fha,va}.test.ts` (per-agency split per B1a) | ✅ COVERED |
| AGY-02 | FNMA full derog matrix — **9 rows** (BK7 base/EC, BK13_DISCHARGED, BK13_DISMISSED, MULTIPLE_BK, FORECLOSURE×2 PURCHASE/LCOR per B2 split, DIL/SS/CO base/EC, mortgage-included-in-BK exception) | structural | `pnpm test:schema -t 'FNMA derog'` | `tests/agency/fnma-derog.test.ts` (13 tests) | ✅ COVERED |
| AGY-02 | FNMA derog golden snapshot (sha256=`71b24015b029b0f07ebbcc8f84c78a26c75c7835488d64fac5670f7230f7e201`) | regression | `pnpm test:schema -t 'FNMA derog bundle matches golden'` | `tests/agency/fnma-derog.test.ts` | ✅ COVERED |
| AGY-03 | FHLMC §5202.5 derog matrix — 8 rows; FORECLOSURE EC=24m delta vs FNMA's 36m (Assumption A1) | structural | `pnpm test:schema -t 'FHLMC derog'` | `tests/agency/fhlmc-derog.test.ts` (10 tests) — golden hash `e69f8f8cecbe18b699a194ca8286a87638bb6fa5f8b7ab020f9dc91134febb2e` | ✅ COVERED |
| AGY-04 | FHA HUD 4000.1 standard EC active + golden snapshot | structural | `pnpm test:schema -t 'FHA derog'` | `tests/agency/fha-derog.test.ts` (14 tests) — golden `67dbe97368740c3a73e0aaf3513250edde1c884af3b449d5ee86aa3bcbe26a60` | ✅ COVERED |
| AGY-04 | FHA Back-to-Work `state='DEPRECATED'` + `sunset_date='2016-09-30'` queryable but excluded from active-rule lookups (B3 + B8a) | structural | `pnpm test:schema -t 'DEPRECATED'` | `tests/agency/fha-derog.test.ts` | ✅ COVERED (6 tests pass) |
| AGY-05 | VA Pamphlet 26-7 Ch.4 — 8 rows (3 cited BK + 5 `not_applicable=true` sentinels per B4a/B9 cross-agency parity) | structural | `pnpm test:schema -t 'VA derog'` | `tests/agency/va-derog.test.ts` (7 tests) | ✅ COVERED |
| AGY-06 | `program_version → agency_rule_version` FK (already shipped Phase 2) | structural | covered by `tests/schema/derog-rule-roundtrip.test.ts` (Phase 2) | Phase 2 | ✅ COVERED |
| AGY-07 | `lib/cascade/poll.ts::pollAgencyPublications` typed handler signature returns `Promise<PollResult[]>` empty array stub | unit | `pnpm test:schema -t 'pollAgencyPublications'` | `tests/cascade/poll-stub.test.ts` (2 tests) | ✅ COVERED |
| AGY-08 | `enqueue_agency_cascade()` trigger fans out one `cascade_review_queue` row per affected `program_version` across multiple tenants (D-17 integration) | integration | `pnpm test:schema -t 'cascade trigger'` | `tests/cascade/cascade-trigger.test.ts` (4 tests) | ✅ COVERED |
| AGY-08 | `cascade_review_queue` cross-tenant pen tests (Phase 1 D-03 + Phase 2 D-19 matrix) | security | `pnpm test:rls -t 'cascade_review_queue'` | `tests/rls/cascade-review-queue-cross-tenant.test.ts` (6 tests) | ✅ COVERED |
| AGY-08 | Initial agency version INSERT (`superseded_by IS NULL`) inserts zero queue rows (Pitfall PG-4) | integration | `pnpm test:schema -t 'cascade trigger initial insert'` | `tests/cascade/cascade-trigger.test.ts` | ✅ COVERED (1 test pass) |
| AGY-09 | `conforming_loan_limit_version` EXCLUDE on `(year WITH =, effective_period WITH &&)` + `conforming_loan_limit_county` PK + `upper_inf` close-detection (B10) | structural | `pnpm test:schema -t 'conforming_loan_limit'` | `tests/schema/fhfa-loan-limits.test.ts` (17 tests) | ✅ COVERED |
| AGY-09 | `program_version.conforming_loan_limit_version_id uuid NULL FK` exists | structural | `pnpm test:schema -t 'program_version conforming FK'` | `tests/schema/fhfa-loan-limits.test.ts` | ✅ COVERED |
| AGY-09 | FHFA 2026 CSV loader idempotency (`pnpm db:seed && pnpm db:seed` produces identical state) + **3,235 county rows** seeded (160 high-cost) | regression | `pnpm test:schema -t 'fhfa loader idempotent'` | `tests/schema/fhfa-loan-limits.test.ts` | ✅ COVERED |

---

## Wave 0 Requirements (all complete)

- [x] `tests/audit/evaluation-event-structural.test.ts` — covers AUD-01/02/03 (partition introspection via `pg_partition_tree`, column + CHECK introspection via `information_schema`, REVOKE introspection via `pg_class.relacl`)
- [x] `tests/audit/evaluation-event-child-rls.test.ts` — covers AUD-01 child-partition RLS+FORCE (B7b)
- [x] `tests/audit/snapshot-id.test.ts` — covers AUD-04 four assertions
- [x] `tests/audit/snapshot-persistence.test.ts` — covers AUD-04 round-trip via `rule_snapshot` table (A3a)
- [x] `tests/agency/agency-version-{fnma,fhlmc,fha,va}.test.ts` — covers AGY-01 (per-agency split per B1a)
- [x] `tests/agency/fnma-derog.test.ts` — covers AGY-02 (13 structural assertions + golden snapshot)
- [x] `tests/agency/fhlmc-derog.test.ts` — covers AGY-03
- [x] `tests/agency/fha-derog.test.ts` — covers AGY-04 (standard EC active + Back-to-Work DEPRECATED + sunset filter)
- [x] `tests/agency/va-derog.test.ts` — covers AGY-05 (cited BK + sentinel pattern per B4a/B9)
- [x] `tests/cascade/poll-stub.test.ts` — covers AGY-07
- [x] `tests/cascade/cascade-trigger.test.ts` — covers AGY-08 (4 tests including initial-insert short-circuit)
- [x] `tests/rls/cascade-review-queue-cross-tenant.test.ts` — covers AGY-08 cross-tenant matrix
- [x] `tests/schema/fhfa-loan-limits.test.ts` — covers AGY-09 (17 tests: EXCLUDE constraint + program_version FK + loader idempotency + B10 upper_inf)
- [x] `tests/schema/agency-rule-state.test.ts` — covers B8a `agency_rule_state` enum + sunset_date
- [x] `tests/schema/rule-citation-unique.test.ts` — covers B12 partial unique index
- [x] `tests/schema/superseded-by-deferrable.test.ts` — covers B5 deferrable FK two-step convention
- [x] `lib/agency-seeds/types.ts` — shared `AgencyRuleSeed<T>` type
- [x] `scripts/seed-agency.ts` — idempotent loader (FHFA loader integrated here, not separate `seed-fhfa.ts`)
- [x] `scripts/seed/index.ts` + per-agency contributors at `scripts/seed/agency-{fnma,fhlmc,fha,va}.ts` (B1a per-agency split)
- [x] `package.json` script: `"db:seed": "tsx scripts/seed/index.ts"`
- [x] CI step in `.github/workflows/ci.yml` to run `pnpm db:seed` after `pnpm drizzle-kit migrate`
- [x] Extend `tests/rls/global-setup.ts` and `tests/schema/setup.ts` to call `pnpm db:seed` after migrate
- [x] `tests/_shared/agency-fixture.ts` extracted with daterange anchored pre-2026 (Rule 1 fix from 03-02 to avoid Wave 1 infinity collision)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions | Status |
|----------|-------------|------------|-------------------|--------|
| pg_cron extension availability under Supabase managed tier | AUD-01 (partition auto-create) | Requires Supabase project; not testable in local docker-postgres-16-alpine | At Phase 6: `SELECT extname FROM pg_extension WHERE extname = 'pg_cron';` against the Supabase project. If absent, fall back to Supabase native scheduler. Phase 3 ships the function unconditionally — scheduler choice deferred. | ⏸ Phase 6 |
| FNMA Selling Guide URL anchor stability | AGY-02 (citation discipline) | FNMA republishes the Selling Guide; auto-generated anchor IDs may drift across publications | Periodic manual verification (Phase 6+ cascade poll surfaces this automatically via sha256 fingerprint). At Phase 3 close: each `rule_citation.source_url` resolves to the cited content. Verbatim `excerpt` enables manual re-resolution if anchor breaks. | ✅ verified at 03-08 (A2 URL gate, 0 violations) |
| FHLMC §5202.5 anchor specifics (assumption A1) | AGY-03 | FHLMC guide behind interactive interface; URL stability requires manual visit | Planner verifies FHLMC FORECLOSURE EC reduction (24m vs FNMA's 36m) against canonical guide before AGY-03 PR merges. Document outcome in plan SUMMARY. | ✅ documented in 03-03-SUMMARY |
| Mortgagee Letter 2013-26 number for Back-to-Work effective-period (assumption A6) | AGY-04 | HUD's archive may use different letter numbering than research found | Planner verifies exact ML number against HUD's archive before AGY-04 PR merges. The DEPRECATED state + sunset_date is what matters; ML number is documentation. | ✅ verified — HUD ML 2013-26 confirmed in 03-04-SUMMARY (B3 fix) |

---

## Nyquist Dimensions Coverage

| Dimension | Coverage |
|-----------|----------|
| **D1 Structural** | Per-rule field assertions (`tests/agency/<agency>-derog.test.ts`); table+column introspection (`tests/audit/evaluation-event-structural.test.ts`, `tests/schema/fhfa-loan-limits.test.ts`); FK + EXCLUDE + CHECK introspection |
| **D2 Behavioral** | Cascade trigger integration test (`tests/cascade/cascade-trigger.test.ts`); two-step convention exercise; trigger fires per affected program_version; initial-insert short-circuit |
| **D3 Regression** | Per-agency golden snapshot (sha256 of seeded rule_body bundle): FNMA `71b24015..`, FHLMC `e69f8f8c..`, FHA `67dbe973..`, VA precomputed; `lib/audit/snapshotId.ts` deterministic round-trip; FHFA loader idempotency |
| **D4 Security** | Cross-tenant pen tests on `cascade_review_queue` (matches Phase 1 D-03 + Phase 2 D-19); REVOKE structural enforcement on `evaluation_event` parent + child partitions (Pitfall PG-1, PG-2); B7b child-partition RLS+FORCE on 6 forward partitions |
| **D5 Determinism** | snapshotId four assertions (A1/A2/A3/A4); per-agency golden snapshot; partition routing only via parent name (Pitfall PG-1) |
| **D6 Idempotency** | Loader re-run safety: `ON CONFLICT DO NOTHING` keyed on `(agency, version_label, rule_kind, _seed_key OR event_type)` per B2; `pnpm db:seed && pnpm db:seed` produces identical state (A1 verified at 03-08); FHFA two-step daterange close convention (B10 `upper_inf`) |
| **D7 Forward-compat** | `lib/audit/snapshotId.ts` signature locked at Phase 3 (Phase 4 evaluator imports unchanged); `lib/cascade/poll.ts::pollAgencyPublications` signature locked (Phase 6 implements); `cascade_review_queue` shape locked (Phase 6 worker SKIP LOCKED + Phase 8 AM UI) |
| **D8 Validation Surface** | Zod `parseRuleBody(kind, body)` at fixture compile time + at loader runtime; FHFA per-row Zod validation (county_fips length 5, numeric range sanity, B10 daterange close); B12 partial unique index on `rule_citation` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s (verified — full schema suite ~3s; targeted filter <2s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** PASSED 2026-05-05

---

## Validation Audit 2026-05-05

| Metric | Count |
|--------|-------|
| Requirement rows audited | 18 |
| COVERED | 18 |
| PARTIAL | 0 |
| MISSING | 0 |
| Test files cross-referenced | 14 (all exist on disk) |
| Wave 0 infra items | 22 (all complete) |
| Manual-only items resolved | 3 of 4 (pg_cron deferred to Phase 6 by design) |

**Drift from draft → executed (documentation updates only, no coverage gaps):**
- AGY-02 row count: draft said "8 line items"; actual implementation shipped **9** (FORECLOSURE 2-row split per REVIEWS B2)
- AGY-09 row count: draft estimated "~25,600 rows"; actual FHFA 2026 FINAL FLAT CSV produced **3,235 county rows** (160 high-cost)
- `tests/agency/agency-version.test.ts` (single file in draft) → **`tests/agency/agency-version-{fnma,fhlmc,fha,va}.test.ts`** (4 per-agency files per B1a parallel-safe pattern)
- `scripts/seed-fhfa.ts` (draft) → **`scripts/seed-agency.ts::seedFhfaYear`** (integrated into single loader)

All sampled tests pass via `pnpm test:schema -t '<filter>'`. Full suite documented green at 03-08 (test:rls 62/62, test:schema 197/197).

**Ready for `/gsd-audit-milestone` after Phase 4-5 close.**
