# Phase 3: Audit Log + Agency Rule Encoding - Context

**Gathered:** 2026-05-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 3 delivers three coupled but independently-shippable artifacts on top of the Phase 2 schema keystone:

1. **Append-only `evaluation_event` audit table** — partitioned monthly, structurally tamper-resistant, snapshot-bound for deterministic replay (AUD-01..04). The table ships at Phase 3 close; Phase 4 evaluator is the first writer.
2. **Hand-authored agency rule sets** — FNMA B3-5.3-07 derog matrix (full), FHLMC §5202.5 (full derog parity), FHA HUD 4000.1 (Back-to-Work DEPRECATED with sunset 2016-09-30; standard EC active), VA Pamphlet 26-7 (full derog parity), USDA scaffolded as a single `agency_rule_version` row only (AGY-01..06).
3. **Agency cascade infrastructure** — Postgres trigger on `agency_rule_version` INSERT writes per-affected-program rows into a new `cascade_review_queue` table; cron-poller handler stubbed; integration test exercises the trigger path. Vercel Cron + Inngest worker land at Phase 6 and consume the queue without schema churn (AGY-07, AGY-08).
4. **2026 FHFA conforming loan limits + high-balance overlays** as a separate two-table versioned set referenced by an optional FK on `program_version` (AGY-09).

**In scope (AUD-01..04, AGY-01..09):**

- `evaluation_event` table with monthly native declarative partitioning + pg_cron auto-create function + 6 forward partitions seeded inline at Phase 3 close. Columns per research §Audit Trail Design + §Pattern 5: `id`, `tenant_id`, `user_id`, `scenario_hash text`, `scenario_payload jsonb`, `ruleset_snapshot_id text`, `program_version_id`, `decision text CHECK IN ('eligible','near_miss','ineligible')`, `deciding_rule_id uuid`, `deciding_rule_layer text`, `rule_stack jsonb`, `near_miss_delta jsonb`, `evaluator_version text`, `evaluated_at timestamptz`. RLS + FORCE per Phase 2 pattern. `REVOKE UPDATE, DELETE ON evaluation_event FROM app_user, PUBLIC, system_role` (only postgres superuser can mutate, for administrative recovery).
- `lib/audit/snapshotId.ts` — pure-TS helper computing sha256 of canonicalized `{agency_versions, program_versions, overlay_versions}` (each entry = `{id, recorded_at}`, sorted by id). Phase 3 ships the helper + deterministic round-trip unit test; Phase 4 evaluator imports it as the canonical writer.
- TS-authored agency seed fixtures at `lib/agency-seeds/<agency>/<rule_kind>.ts` (e.g., `lib/agency-seeds/fnma/derog-seasoning.ts`) typed against the existing `lib/rules/schemas/index.ts` Zod dispatch table. Compile-time shape validation against `parseRuleBody`. One file per agency × rule_kind for review chunking.
- Idempotent loader script `pnpm db:seed` (`scripts/seed-agency.ts`) connecting via `DATABASE_MIGRATION_URL` (postgres role with `system_role` GRANT per Phase 2 D-17). Uses `ON CONFLICT DO NOTHING` keyed on `(agency, version_label, rule_kind, event_type)`. Re-runnable. Wires into CI workflow (after `drizzle-kit migrate`) and `tests/rls/global-setup.ts` + `tests/schema/setup.ts`.
- Per-agency hand-authored content: full derog event-type parity for FNMA + FHLMC + FHA + VA (`event_type` ∈ {BK7, BK13_DISCHARGED, BK13_DISMISSED, MULTIPLE_BK, FORECLOSURE, DEED_IN_LIEU, SHORT_SALE, MORTGAGE_CHARGE_OFF}), plus the FNMA-specific mortgage-included-in-BK exception, plus a FHA Back-to-Work agency_rule row marked `DEPRECATED` with `sunset_date: 2016-09-30` (queryable but inactive). USDA = one `agency_rule_version` row (`agency='USDA'`, `version_label='USDA-SFH-7-CFR-3555'`, source_url to USDA SFH program docs) + zero `agency_rule` rows.
- `agency_rule_version` initial seed effective_period = `[2026-01-01,infinity)` per agency. Future updates follow the two-step convention: `UPDATE prior SET effective_period upper bound = new_effective_date, superseded_by = NEW.id` THEN `INSERT new agency_rule_version` with `[new_date,infinity)`. Phase 7+ cascade poller and any hand-authored update follow this convention.
- `version_label` format: agency-document-id (`FNMA-SEL-2026-04`, `FHLMC-SSG-2026-Q1`, `HUD-4000.1-2024-08`, `VA-PAM-26-7-Ch4`, `USDA-SFH-7-CFR-3555`). Self-documenting, greppable, matches each agency's own publication identifier.
- Hand-authored `rule_citation` rows for each agency rule: `source_url` (canonical guide URL + section anchor), `excerpt` (verbatim cited text), `source_pdf_sha256`/`page_number`/`bbox` left NULL (Phase 2 D-03 CHECK constraint accepts URL-only). All agency citations live under the SYSTEM tenant (Phase 1 D-04 + Phase 2 fixture pattern).
- Per-rule structural assertion tests at `tests/agency/<agency>-derog.test.ts` (one test per Phase 3 SC#3 line item: BK7 base/EC, BK13 discharged/dismissed, multi-filing 5y/7y, FC base + 3-to-7-yr 90% LTV cap window with PURCHASE/RT_REFI + PRIMARY only, DIL/SS/CO 4y/2y EC, mortgage-in-BK exception, FHA Back-to-Work DEPRECATED + sunset, FHA standard EC active). Plus a per-agency golden snapshot test hashing the seeded rule_body bundle for regression detection. Plus a deprecated-program query test confirming Back-to-Work row exists but is filtered from active-rule lookups.
- `cascade_review_queue` table: tenant-scoped + RLS + FORCE (matching Phase 2 D-19 pattern). Columns: `id uuid pk`, `tenant_id uuid NOT NULL` (FK to tenant), `program_version_id uuid NOT NULL`, `prior_agency_rule_version_id uuid NOT NULL`, `new_agency_rule_version_id uuid NOT NULL`, `status text NOT NULL CHECK IN ('pending','claimed','completed','dismissed') DEFAULT 'pending'`, `claimed_at timestamptz NULL`, `claimed_by text NULL` (worker identifier), `completed_at timestamptz NULL`, `created_at timestamptz NOT NULL DEFAULT now()`. Two-policy shape per agency-table convention: `cascade_review_queue_tenant_isolation` (FOR ALL TO public USING tenant_id = GUC) + `cascade_review_queue_system_write` (FOR ALL TO system_role) so the trigger can INSERT across tenants while AM reads stay tenant-scoped. Indexes on `(tenant_id, status, created_at)` for the AM queue read path.
- Postgres trigger function `enqueue_agency_cascade()` AFTER INSERT ON `agency_rule_version` FOR EACH ROW: reads `NEW.agency`, finds prior version `WHERE agency=NEW.agency AND superseded_by=NEW.id`, JOINs `program_version` on `agency_rule_version_id = prior.id`, INSERTs one `cascade_review_queue` row per affected program_version (denormalizing `program_version.tenant_id` into the queue row).
- `lib/cascade/poll.ts` stub: typed handler signature `pollAgencyPublications(): Promise<PollResult[]>` returning empty result array. Phase 6 lands the actual HTTP fetch + sha256-diff logic + Vercel Cron wiring. Integration test at `tests/cascade/cascade-trigger.test.ts` simulates a new-version insert (using the two-step convention) and asserts the trigger creates queue rows for every affected program_version.
- `conforming_loan_limit_version (id uuid pk, year int NOT NULL, effective_period daterange NOT NULL, source_url text NOT NULL, source_pdf_sha256 text NULL, recorded_at timestamptz NOT NULL DEFAULT now())` + `conforming_loan_limit_county (limit_version_id uuid FK, county_fips text NOT NULL, state_code char(2) NOT NULL, one_unit_baseline numeric NOT NULL, two_unit_baseline numeric, three_unit_baseline numeric, four_unit_baseline numeric, one_unit_high_balance numeric, two_unit_high_balance numeric, three_unit_high_balance numeric, four_unit_high_balance numeric, is_high_cost bool NOT NULL DEFAULT false, PRIMARY KEY (limit_version_id, county_fips))`. System-owned (no tenant_id; world-readable + system_role write per agency-table pattern). EXCLUDE on `conforming_loan_limit_version (year WITH =, effective_period WITH &&)` to prevent overlapping versions per year.
- 2026 FHFA CSV/XLSX committed to `lib/agency-seeds/fhfa/2026-conforming-limit-values-by-county.csv` + TS loader at `scripts/seed-fhfa.ts` (or extension of `scripts/seed-agency.ts`). Annual update path: download new CSV, commit, re-run `pnpm db:seed` — loader detects existing 2026 row and follows two-step daterange close (UPDATE 2026 upper bound, INSERT 2027). README at `lib/agency-seeds/fhfa/README.md` documents the procedure.
- `program_version.conforming_loan_limit_version_id uuid NULL REFERENCES conforming_loan_limit_version(id)` — schema delta to existing `program_version` table (Phase 2 D-15). Conforming/conventional programs set it; non-QM/DSCR/bank-statement/jumbo programs leave NULL. Phase 4 evaluator dereferences when non-null and the scenario hits a county-level loan-amount check.
- Tests/rls extension: `cascade_review_queue` cross-tenant pen tests matching Phase 1 D-03 / Phase 2 D-19 matrix.

**Out of scope (explicit deferrals):**

- Vercel Cron wiring + real HTTP fetch implementation in `lib/cascade/poll.ts` → Phase 6 (CFG-01)
- Inngest 4.2 worker pool + cascade_review_queue consumer with SKIP LOCKED → Phase 6 (CFG-04)
- Agency-publication scraping (FNMA Selling Guide announcements, HUD Mortgagee Letters, VA Circulars, FHFA Notices) → Phase 7 extends Phase 6's polling hook
- Pure-TS evaluator at `lib/eval/` that writes `evaluation_event` rows → Phase 4 (EVL-01..09)
- Library-vs-custom evaluator spike → Phase 4 (EVL-09)
- Staging schema (`staging.draft_rule` etc.) and extraction pipeline → Phase 7 (EXT-01..10)
- AM three-pane review UI consuming cascade_review_queue → Phase 8 (AM-01..09)
- Program lifecycle state-transition enforcement at AM commit → Phase 8 (PRG-01..04)
- License gate on program_version commit → Phase 8 (LCS-01..04)
- USDA full agency rule encoding → Phase 12 v2 (COV-v2-01)
- HFA / second-lien CES/HELOC / construction-to-perm program rules → Phase 12 v2 (COV-v2-02..04)
- Brokerage `LENDER_OVERLAY` author UI → Phase 12 v2 (LOV-01..03)
- Live pricing tables `pricing_feed`, `pricing_quote` → Phase 13 (PRC-01..05)
- Saved-scenario re-run alerting (re-evaluation cron driven by snapshot delta) → Phase 14 v3 (WKF-03)
- cascade_review_queue retention/archival policy → Phase 13+ revisit (queue stays small at Phase 1 scale; ~<100 rows/year)
- Cold-archive automation for evaluation_event partitions older than 24 months → Phase 13+ revisit (research §Pattern 5 forecasts ~400k rows/day at maturity; Phase 1-3 scale stays trivial)

</domain>

<decisions>
## Implementation Decisions

### Audit log mechanics (AUD-01..04)

- **D-01:** `evaluation_event` uses native Postgres declarative partitioning (`PARTITION BY RANGE (evaluated_at)`) with one partition per calendar month. Phase 3 ships a SQL function `create_next_evaluation_event_partition()` invoked monthly via pg_cron. Six forward partitions seeded inline at Phase 3 close (covers May–Oct 2026 plus the Phase 3 month). pg_cron may require Supabase managed-tier enablement at Phase 6 — flagged for the planner. No pg_partman dependency.
- **D-02:** `REVOKE UPDATE, DELETE ON evaluation_event FROM app_user, PUBLIC, system_role` — maximalist tampering posture. Only the postgres superuser can mutate (administrative recovery only). When Phase 6 introduces the Supabase `authenticated` role, it inherits PUBLIC's revoked posture automatically. Stronger than research's `REVOKE ... FROM authenticated` because we don't trust system_role with the audit log either.
- **D-03:** `scenario_payload jsonb NOT NULL` + `scenario_hash text NOT NULL` both ship. Full payload enables single-row replay (AUD-04) without the Phase 9 `saved_scenario` table existing yet. PII trade-off accepted because (a) RLS scopes per-tenant, (b) audit-log immutability is the legal-defensibility win, (c) Phase 6 lands tenant_id egress redaction at the log/dashboard boundary. Hash is sha256 over canonicalized payload for dedup + integrity.
- **D-04:** `lib/audit/snapshotId.ts` is a pure-TS helper that computes `sha256(JSON.stringify(canonical))` where `canonical = {agency_versions: [{id, recorded_at}, ...].sort(by id), program_versions: [...].sort(by id), overlay_versions: [...].sort(by id)}`. Phase 3 ships the helper + a deterministic-output unit test (same input → same hash; reordering input → same hash). Phase 4 evaluator imports it as the canonical `ruleset_snapshot_id` writer. Mirrors Phase 1 D-11 pattern (setTenantContext shipped before Phase 6 wraps it).

### Agency rule hand-authoring workflow (AGY-01..05)

- **D-05:** Source-of-truth lives in TypeScript fixtures at `lib/agency-seeds/<agency>/<rule_kind>.ts`. Each file exports an array of objects typed against the existing Zod dispatch table at `lib/rules/schemas/index.ts` so `parseRuleBody(kind, body)` validates shape at compile time. Idempotent loader at `scripts/seed-agency.ts` invoked by `pnpm db:seed`. Loader connects via `DATABASE_MIGRATION_URL` (postgres role with `system_role` GRANT per Phase 2 fixture pattern). Idempotency keyed on `(agency, version_label, rule_kind, event_type)` via `ON CONFLICT DO NOTHING`.
- **D-06:** `pnpm db:seed` runs after `drizzle-kit migrate` in three places: (a) `.github/workflows/ci.yml` step, (b) `tests/rls/global-setup.ts`, (c) `tests/schema/setup.ts`. Single source of truth — every PR + every test run gets the seeded data. Local dev: `pnpm db:reset && pnpm db:seed`. Production deploy uses the same loader (Phase 6 wires it into the Vercel deploy step or runs as a post-migration job).
- **D-07:** Agency citations are URL-only — `rule_citation.source_url` + section anchor (e.g., `https://selling-guide.fanniemae.com/sel/b3-5.3-07/...#FORECLOSURE_3_TO_7_YEARS`) + `excerpt` (verbatim cited text); `source_pdf_sha256`, `page_number`, `bbox` stay NULL on agency rows. Phase 2 D-03 CHECK constraint (`source_pdf_sha256 IS NOT NULL OR source_url IS NOT NULL`) is satisfied via the URL path. Clean separation: hand-authored = URL; Phase 7 lender-matrix extraction = PDF + page + bbox.
- **D-08:** Test posture combines per-rule structural assertions (one test per SC#3 line item) at `tests/agency/<agency>-derog.test.ts` with a per-agency golden snapshot test hashing the seeded rule_body bundle (catches accidental edits). Plus a deprecated-program test asserting FHA Back-to-Work row exists with `state='deprecated'` + `sunset_date='2016-09-30'` and is filtered from active-rule lookups. The structural assertions cover: BK7 base 48m / EC 24m, BK13_DISCHARGED 24m, BK13_DISMISSED 48m, MULTIPLE_BK 60m / 84m, FORECLOSURE 84m base + post_event_LTV_caps[0] for the 36-84m window with `max_LTV=90, purposeAllowList=['PURCHASE','RATE_TERM_REFI'], occupancyAllowList=['PRIMARY']`, DIL/SS/CO 48m / 24m EC, mortgage-included-in-BK exception (`mortgage_included_in_bk_rule = 'BK_CLOCK_APPLIES'`), FHA Back-to-Work DEPRECATED + sunset, FHA standard EC active.
- **D-09:** PR chunking strategy: (1) audit log table + REVOKE + partitioning + lib/audit/snapshotId.ts → 1 PR; (2) FNMA derog matrix + tests → 1 PR; (3) FHLMC §5202.5 + tests → 1 PR; (4) FHA HUD 4000.1 + Back-to-Work DEPRECATED + tests → 1 PR; (5) VA Pamphlet 26-7 + tests → 1 PR; (6) USDA stub agency_rule_version → folded into one of the agency PRs or its own micro-PR; (7) FHFA loan limits + CSV + loader extension → 1 PR; (8) cascade_review_queue + trigger + lib/cascade/poll.ts stub + integration test → 1 PR. Plan should reflect this in waves.
- **D-10:** Each agency's first version effective_period = `[2026-01-01,infinity)`. Postgres daterange supports `infinity` literal so the upper bound is open. Future agency updates follow the two-step convention: `UPDATE prior agency_rule_version SET effective_period = '[2026-01-01,2026-04-01)', superseded_by = NEW.id` then `INSERT new agency_rule_version` with `[2026-04-01,infinity)`. Phase 7+ poller and any hand-authored update use this same shape.
- **D-11:** Full derog event-type parity across FNMA + FHLMC + FHA + VA. Each agency gets one `agency_rule` row per `event_type` (BK7, BK13_DISCHARGED, BK13_DISMISSED, MULTIPLE_BK, FORECLOSURE, DEED_IN_LIEU, SHORT_SALE, MORTGAGE_CHARGE_OFF) with the agency-specific `measurement_anchor`, `base_waiting_months`, `extenuating_circumstances_waiting_months`, and (for FNMA FORECLOSURE) the `post_event_LTV_caps[]` 90% LTV window. FNMA also gets the `mortgage_included_in_bk_rule` field set to its FNMA-specific value. ~30–40 agency_rule rows total; ~30–40 rule_citation rows.
- **D-12:** USDA stub = single `agency_rule_version` row only (`agency='USDA'`, `version_label='USDA-SFH-7-CFR-3555'`, `effective_period='[2026-01-01,infinity)'`, `source_url` to USDA SFH program docs at https://www.rd.usda.gov/programs-services/single-family-housing-programs). Zero `agency_rule` child rows. Satisfies AGY-01 ("USDA scaffolded"). Phase 12 (COV-v2-01) hand-authors the actual USDA rules.
- **D-13:** `version_label` naming convention: agency-document-id format. Phase 3 seed values: `FNMA-SEL-2026-04`, `FHLMC-SSG-2026-Q1`, `HUD-4000.1-2024-08`, `VA-PAM-26-7-Ch4`, `USDA-SFH-7-CFR-3555`. Self-documenting, greppable, matches each agency's own publication identifier; Phase 7 cascade poller uses the same shape when it detects a new version.

### Agency cascade infrastructure (AGY-07, AGY-08)

- **D-14:** Phase 3 ships `cascade_review_queue` table + Postgres trigger AFTER INSERT ON `agency_rule_version` that writes one row per affected program_version directly into the queue. No external queue dependency (no pg-boss, no Inngest, no LISTEN/NOTIFY). Phase 6 Inngest worker reads from the table using `SELECT ... FOR UPDATE SKIP LOCKED`. Survives the Inngest swap with zero schema churn. Phase 8 AM review surface reads from this table directly.
- **D-15:** `cascade_review_queue` is tenant-scoped + RLS + FORCE (matches Phase 2 D-19 pattern for new tenant-scoped tables). `tenant_id uuid NOT NULL` denormalized from `program_version.tenant_id` at trigger time (avoids a JOIN on every queue read). Two-policy shape: `cascade_review_queue_tenant_isolation` (FOR ALL TO public USING tenant_id = GUC, WITH CHECK tenant_id = GUC) + `cascade_review_queue_system_write` (FOR ALL TO system_role USING true WITH CHECK true). The trigger runs as the inserting role (postgres for migrations, system_role for cascade-aware writers); both are members of system_role so writes pass the system_write policy. Tenant reads pass the isolation policy.
- **D-16:** Cascade-write convention is two-step within a single transaction: (1) `UPDATE agency_rule_version SET superseded_by = $new_id, effective_period = (lower_bound, $new_effective_date) WHERE id = $prior_id`, (2) `INSERT INTO agency_rule_version (...)` with `[$new_effective_date, infinity)`. The trigger function reads `NEW.agency`, finds the prior version `WHERE agency = NEW.agency AND superseded_by = NEW.id`, then `INSERT INTO cascade_review_queue (...) SELECT pv.tenant_id, pv.id, prior.id, NEW.id, 'pending', now() FROM program_version pv WHERE pv.agency_rule_version_id = prior.id`. Phase 7+ poller and hand-authored updates follow this shape.
- **D-17:** `lib/cascade/poll.ts` ships at Phase 3 with a typed handler signature `pollAgencyPublications(): Promise<PollResult[]>` returning hardcoded empty result. Integration test at `tests/cascade/cascade-trigger.test.ts` simulates a new-version insert (using the two-step convention) and asserts the trigger creates queue rows for every affected program_version (test fixture seeds 2 tenants × 1 program_version each referencing the prior agency version, then inserts new agency_rule_version, then asserts cascade_review_queue contains 2 rows with the right tenant_ids and prior/new agency_rule_version_id pair). Satisfies Phase 3 SC#5 ("verified via integration test"). Phase 6 lands real HTTP fetch + sha256-diff + Vercel Cron wiring.
- **D-18:** `cascade_review_queue` columns: `id uuid pk`, `tenant_id uuid NOT NULL`, `program_version_id uuid NOT NULL`, `prior_agency_rule_version_id uuid NOT NULL`, `new_agency_rule_version_id uuid NOT NULL`, `status text NOT NULL DEFAULT 'pending' CHECK IN ('pending','claimed','completed','dismissed')`, `claimed_at timestamptz NULL`, `claimed_by text NULL`, `completed_at timestamptz NULL`, `created_at timestamptz NOT NULL DEFAULT now()`. Phase 6 worker uses `UPDATE ... SET status='claimed', claimed_at=now(), claimed_by=$worker_id WHERE id=$row AND status='pending'` with SKIP LOCKED for concurrent claim safety. Phase 8 AM UI filters `status IN ('pending','claimed')` for the inbox and reads `('completed','dismissed')` for history.
- **D-19:** Retention policy = keep forever at Phase 3. cascade_review_queue is low-volume (< 100 rows/year at Phase 1 scale: 50 programs × occasional agency updates). AM dashboards filter on status. Matches the audit-log keep-forever posture (legal-defensibility leans toward retention). Phase 13+ revisits if scale demands.

### FHFA conforming loan limits (AGY-09)

- **D-20:** Two-table split mirroring agency_rule_version + agency_rule pattern: `conforming_loan_limit_version (id uuid pk, year int NOT NULL, effective_period daterange NOT NULL, source_url text NOT NULL, source_pdf_sha256 text NULL, recorded_at timestamptz NOT NULL DEFAULT now())` with `EXCLUDE USING gist (year WITH =, effective_period WITH &&)`. Plus `conforming_loan_limit_county (limit_version_id uuid NOT NULL FK, county_fips text NOT NULL, state_code char(2) NOT NULL, one_unit_baseline numeric NOT NULL, two_unit_baseline numeric, three_unit_baseline numeric, four_unit_baseline numeric, one_unit_high_balance numeric, two_unit_high_balance numeric, three_unit_high_balance numeric, four_unit_high_balance numeric, is_high_cost bool NOT NULL DEFAULT false, PRIMARY KEY (limit_version_id, county_fips))`. ~3,200 counties × 4 unit-tiers × (baseline, high-balance) = 25,600 rows per year. System-owned (no tenant_id; world-readable via SELECT TO public; system_role write).
- **D-21:** Commit the canonical FHFA 2026 CSV/XLSX to `lib/agency-seeds/fhfa/2026-conforming-limit-values-by-county.csv` (download from FHFA's annual publication page). TS loader at `scripts/seed-fhfa.ts` (or extension to `scripts/seed-agency.ts`) reads + parses + INSERTs via the same `pnpm db:seed` script. Per-row Zod validation possible (county_fips length 5, numeric ranges sane). Source-of-truth (the actual FHFA file) lives in git; annual update workflow = download new CSV + commit + re-run seed.
- **D-22:** `program_version.conforming_loan_limit_version_id uuid NULL REFERENCES conforming_loan_limit_version(id)` ships as a schema delta at Phase 3 (one new nullable column on Phase 2's `program_version` table). Conforming/conventional programs set the FK; non-QM/DSCR/bank-statement/jumbo/HFA programs leave NULL. Phase 4 evaluator dereferences when non-null and the scenario hits a county-level loan-amount check; non-conforming programs ignore the field entirely. Deterministic per-program-version replay because the FK pins which year's limits applied at evaluation time.
- **D-23:** Annual update path = manual `pnpm db:seed` run with new CSV. Loader detects existing 2026 row and follows the same two-step daterange close convention as agency_rule_version: `UPDATE conforming_loan_limit_version SET effective_period = '[2026-01-01,2027-01-01)' WHERE year = 2026` then `INSERT (year=2027, effective_period='[2027-01-01,infinity)', source_url=...)` plus the 25,600 new conforming_loan_limit_county rows. README at `lib/agency-seeds/fhfa/README.md` documents the procedure. No automation at Phase 3; FHFA-as-a-cascade-poller-source is Phase 6+ scope creep.

### Claude's Discretion

- Exact pg_cron job naming + schedule cadence (likely first-of-month at 02:00 UTC; planner picks)
- `evaluator_version text` source format on `evaluation_event` — semver string vs git sha vs evaluator-config hash; planner picks (the value gets written by Phase 4 — Phase 3 just defines the column with a CHECK that it's non-empty)
- Whether `lib/audit/snapshotId.ts` returns a 64-char hex string or 43-char base64url-encoded sha256 (both are deterministic; pick whichever is cheaper to log)
- Index strategy on `cascade_review_queue` beyond the mandatory `(tenant_id, status, created_at)` — likely `(status, created_at)` partial index `WHERE status = 'pending'` for the worker claim path
- Whether the 6 forward `evaluation_event` partitions land as inline `--custom` migration SQL or as a single `SELECT create_next_evaluation_event_partition()` call repeated 6× from the migration; either works
- Decision on whether to extract the SYSTEM-tenant + agency-version-fixture-bootstrap helpers into `tests/_shared/agency-fixture.ts` per existing 02-CONCERNS.md WR-05 — Phase 3 has more agency-fixture call sites; this is the right time to consolidate, but optional
- Where to author the FHFA CSV parser (e.g., `csv-parse` npm dep vs hand-rolled split-on-comma) — `csv-parse` adds a dep; hand-rolled fragile against quoted fields — planner decides based on the actual FHFA file format

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/PROJECT.md` §Conventions — append-only audit log (REVOKE UPDATE/DELETE), citation discipline, bitemporal versioning, staging schema for extraction, tenant filtering at the database
- `.planning/PROJECT.md` §Architecture — agency cascade infrastructure (item 7: trigger + per-affected-program review queue), build order
- `.planning/PROJECT.md` §Out of Scope — cross-tenant overlay visibility (release-blocker), no Pricing-Insight-style competitive analytics
- `.planning/REQUIREMENTS.md` §AUD — AUD-01 through AUD-04 (4 requirements: append-only partitioned by month, columns, REVOKE, deterministic replay)
- `.planning/REQUIREMENTS.md` §AGY — AGY-01 through AGY-09 (9 requirements: agency_rule_version per agency, FNMA matrix, FHLMC §5202.5, FHA HUD 4000.1 + Back-to-Work DEPRECATED, VA Pamphlet 26-7, program_version → agency_rule_version FK, daily polling, cascade fan-out, FHFA loan limits)
- `.planning/ROADMAP.md` §"Phase 3: Audit Log + Agency Rule Encoding" — goal + 5 success criteria

### Architecture and patterns
- `.planning/research/ARCHITECTURE.md` §"Pattern 5: Append-Only Audit Log with Snapshot ID" — evaluation_event shape, ruleset_snapshot_id, partition strategy
- `.planning/research/ARCHITECTURE.md` §"Audit Trail Design" — concrete properties + scenario re-runnable + tenant-scoped via RLS
- `.planning/research/ARCHITECTURE.md` §"Cascade Trigger" — pg_boss-shaped reference (Phase 3 substitutes table-write); `superseded_by` lookup pattern
- `.planning/research/ARCHITECTURE.md` §"Snapshot at Evaluation Time" — sha256 of canonicalized {agency_versions, program_versions, overlay_versions} sorted by id
- `.planning/research/ARCHITECTURE.md` §"Flow 3: Agency Cascade (Async, System-Owned)" — daily Vercel Cron → fetch → hash compare → trigger fan-out
- `.planning/research/ARCHITECTURE.md` §"Build Order" item 8 (audit log emit) + item 11 (cascade infrastructure)
- `.planning/research/ARCHITECTURE.md` §"Concrete Schema (Sketch)" — full DDL covering evaluation_event partitioned by month
- `.planning/research/ARCHITECTURE.md` §"Anti-Pattern: Mutable Audit Trail" — the failure mode REVOKE UPDATE/DELETE prevents

### Pitfalls (Phase 3-relevant)
- `.planning/research/PITFALLS.md` §1.1 — derog as boolean fails; structured event-typed model is mandatory (drives D-11 full event-type parity)
- `.planning/research/PITFALLS.md` §1.2 — FNMA 3-to-7-year post-foreclosure 90% LTV window must be encoded structurally (Phase 3 SC#3)
- `.planning/research/PITFALLS.md` §1.3 — `measurement_anchor` varies by event type per agency (BK discharge vs foreclosure completion vs deed-transfer)
- `.planning/research/PITFALLS.md` §1.4 — FHA Back-to-Work phantom; encode as DEPRECATED with sunset 2016-09-30 (Phase 3 SC#4)
- `.planning/research/PITFALLS.md` §1.5 — multi-filing window stacking (FNMA 5y from most recent discharge, not 4y)
- `.planning/research/PITFALLS.md` §1.6 — mortgage-included-in-BK rule branch (anchor = BK discharge per FNMA; 4y vs 7y delta)
- `.planning/research/PITFALLS.md` §3.4 — agency cascade not detected; weekly Selling Guide scrape minimum, MoLs + VA Circulars added in v2

### Stack rationale (do not relitigate)
- `.planning/research/STACK.md` §Postgres 16 — native declarative partitioning for evaluation_event (drives D-01)
- `CLAUDE.md` §Conventions — append-only audit log; tenant filtering at the database, never the application; pure-TS evaluator at lib/eval/
- `CLAUDE.md` §Architecture — anti-patterns (embedding agency rules per program, mutable audit log)

### Phase 1 + Phase 2 carry-forward
- `.planning/phases/01-tenant-isolation-foundation/01-CONTEXT.md` — D-04..D-12 (RLS, FORCE, GUC, two-connection-string, Drizzle pattern, pen-test harness, t3-env)
- `.planning/phases/02-rule-schema/02-CONTEXT.md` — D-01..D-21 (citation FK, layer storage shape, rule_body validation strictness, loosening rejection, bitemporal versioning, migration tooling, test approach)
- `.planning/phases/02-rule-schema/02-CONTEXT.md` §Out of Scope — explicit Phase 3 deferrals from Phase 2 (`agency_rule_version.superseded_by` self-FK ready for Phase 3 cascade trigger)
- `db/schema/agency-rule-version.ts` — existing table; Phase 2 ships `superseded_by` self-FK that Phase 3 trigger consumes
- `db/schema/agency-rule.ts` — existing table; Phase 2 ships `primary_citation_id NOT NULL FK` that Phase 3 hand-authoring populates
- `db/schema/program-version.ts` — existing table; Phase 3 adds `conforming_loan_limit_version_id uuid NULL FK` column
- `lib/rules/schemas/derog-seasoning.ts` — Zod schema for derog rule_body (event_type enum, measurement_anchor, post_event_LTV_caps, mortgage_included_in_bk_rule); Phase 3 fixtures conform to this shape
- `lib/rules/schemas/index.ts` — `parseRuleBody(kind, body)` dispatch table; Phase 3 fixtures pass through this at compile time
- `lib/tenant/context.ts::setTenantContext` — used in cascade tests + integration tests
- `db/migrations/0006_detect_loosenings.sql` — `--custom` migration pattern for SQL functions; Phase 3 cascade trigger function follows the same shape
- `tests/rls/global-setup.ts` + `tests/schema/setup.ts` — extend to call `pnpm db:seed` after migrate
- `tests/rls/seedTwoTenants.ts::seedSharedAgency` — SYSTEM tenant + agency_rule_version bootstrap pattern; Phase 3 production seed follows the same shape
- `tests/schema/fixtures/seed.ts::seedAgencyDerogRule` — agency derog rule seeding pattern (per-event-type rows)
- `drizzle.config.ts` — two-connection-string pattern (DATABASE_MIGRATION_URL = postgres for migrations + system_role-grant writes)
- `scripts/init-db.sh` — system_role provisioning; Phase 3 may extend to grant pg_cron usage if Supabase managed-tier requires explicit GRANT

### Source-of-truth domain references (Phase 3 hand-authoring targets)
- FNMA Selling Guide B3-5.3-07 (Significant Derogatory Credit Events — Waiting Periods and Re-establishing Credit) at https://selling-guide.fanniemae.com/sel/b3-5.3-07/significant-derogatory-credit-events-waiting-periods-and-re-establishing-credit — base derog rules for BK7, BK13, MULTIPLE_BK, FORECLOSURE, DEED_IN_LIEU, SHORT_SALE, MORTGAGE_CHARGE_OFF, mortgage-in-BK exception
- FHLMC Single-Family Seller/Servicer Guide §5202.5 — derog rules with FHLMC-specific anchors
- HUD 4000.1 (FHA Single-Family Housing Policy Handbook) §II.A.5.b — derog seasoning + standard EC provision; Mortgagee Letter 2016-14 sunsetting Back-to-Work on 2016-09-30
- VA Pamphlet 26-7 Chapter 4 Topic 7 — VA derog seasoning with VA-specific anchors
- FHFA 2026 Conforming Loan Limit Values by County — published annually each November at https://www.fhfa.gov/data/publications/conforming-loan-limit-values

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `db/schema/agency-rule-version.ts` — Phase 2 ships table + `superseded_by uuid NULL` self-FK + `system_role`-write policy; Phase 3 cascade trigger consumes the FK
- `db/schema/agency-rule.ts` — Phase 2 ships table + `primary_citation_id NOT NULL FK`; Phase 3 hand-authored seeds populate via the loader
- `db/schema/program-version.ts` — Phase 2 ships `agency_rule_version_id NOT NULL FK`; Phase 3 adds `conforming_loan_limit_version_id uuid NULL FK` (one-column delta)
- `db/schema/rule-citation.ts` — Phase 2 ships table + `source_pdf_sha256 IS NOT NULL OR source_url IS NOT NULL` CHECK; Phase 3 agency citations satisfy via URL path
- `lib/rules/schemas/derog-seasoning.ts` — Zod schema with `event_type` enum (BK7/BK13_DISCHARGED/BK13_DISMISSED/MULTIPLE_BK/FORECLOSURE/DEED_IN_LIEU/SHORT_SALE/MORTGAGE_CHARGE_OFF/MOD/FORBEARANCE), `measurement_anchor`, `base_waiting_months`, `extenuating_circumstances_waiting_months`, `post_event_LTV_caps[]`, `reestablished_credit_required`, `mortgage_included_in_bk_rule`, `notes_citations[]`; Phase 3 fixtures conform
- `lib/rules/schemas/index.ts::parseRuleBody` — dispatch table; Phase 3 TS fixtures pass through `parseRuleBody(kind, body)` at compile time and at loader insert time
- `lib/tenant/context.ts::setTenantContext` — pen-test/integration-test primitive; Phase 3 cascade integration tests reuse
- `db/migrations/0006_detect_loosenings.sql` — `--custom` migration template for SQL function definitions; Phase 3 cascade trigger function (`enqueue_agency_cascade()`) follows the same shape
- `db/migrations/0001_force_rls.sql` + `0003_force_rls_program.sql` + `0005_force_rls_agency.sql` — `--custom` migration pattern for FORCE RLS + GRANTs; Phase 3 mirrors for `cascade_review_queue` + `evaluation_event` + `conforming_loan_limit_*` tables
- `tests/rls/seedTwoTenants.ts` — SYSTEM tenant + agency_rule_version bootstrap (Pitfall G: agency-table writes require admin pool)
- `tests/schema/fixtures/seed.ts::seedAgencyDerogRule` — per-event-type seeding pattern; Phase 3 generalizes into the loader
- `drizzle.config.ts` + `lib/db/client.ts` — two-connection-string pattern (DATABASE_MIGRATION_URL for migrations + agency writes; DATABASE_URL for runtime + tenant reads)
- `scripts/init-db.sh` — provisions `system_role` (NOLOGIN, NOBYPASSRLS) granted to `postgres`; Phase 3 may need to extend if pg_cron requires explicit role privileges

### Established Patterns
- Schema-as-code in TypeScript: `pgTable()` + `pgPolicy()` + `pgEnum()` from `drizzle-orm/pg-core`
- NodeNext `.js` extensions on relative imports (TS2835)
- `current_setting('app.tenant_id', true)::uuid` is canonical RLS predicate; only references are `db/schema/*.ts` policies, `lib/tenant/context.ts`, `tests/rls/*`. Phase 3 must NOT introduce a fourth reference site
- `--custom` migration for FORCE RLS, EXCLUDE constraints, SQL functions, system_role policies, partitioned tables, triggers, CREATE EXTENSION (Drizzle 0.45 doesn't model these natively)
- Two-connection-string: DATABASE_MIGRATION_URL (postgres superuser) for migrations + agency writes; DATABASE_URL (app_user, NOBYPASSRLS NOSUPERUSER) for runtime + pen tests
- Post-migrate GRANT step: every new table needs `GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE <new_table> TO app_user` after migrate
- Two-policy shape on system-owned tables: `*_world_read` (SELECT TO public) + `*_system_write` (ALL TO system_role); cascade_review_queue extends with tenant_isolation policy for tenant reads
- TDD pattern from Plan 01-07: tests for new constraints land in the same commit as the constraint (RED+GREEN folding when system under test exists prior)
- Idempotent seed: ON CONFLICT DO NOTHING keyed on stable identifiers (e.g., agency + version_label + rule_kind + event_type)

### Integration Points
- `lib/audit/snapshotId.ts` is the integration seam Phase 4 evaluator imports as the canonical `ruleset_snapshot_id` writer; signature locks at Phase 3 so Phase 4 plans don't relitigate
- `cascade_review_queue` is the integration seam Phase 6 Inngest worker reads (SKIP LOCKED claim) and Phase 8 AM review surface displays
- `lib/cascade/poll.ts::pollAgencyPublications` is the typed handler Phase 6 implements; Phase 3 ships the signature + integration test of the trigger path it eventually feeds
- `program_version.conforming_loan_limit_version_id` FK is the integration seam Phase 4 evaluator dereferences when scenario hits a county-level loan-amount check
- `pnpm db:seed` is the integration seam CI + tests/rls + tests/schema + production-deploy use to populate agency rules
- `agency_rule.field_confidence` defaults to `'{}'::jsonb` for hand-authored rules (Phase 2 D-10 — confidence implicitly 1.0 for hand-authoring); Phase 7 extracted agency rules may override
- `evaluation_event.ruleset_snapshot_id` text column is the integration seam between the lib/audit/snapshotId.ts helper and the deterministic-replay AUD-04 contract; Phase 5 golden set acceptance test re-evaluates historical scenarios via this column
- The cascade trigger function `enqueue_agency_cascade()` follows the same `STABLE SECURITY INVOKER`/`PLPGSQL` posture as `detect_loosenings`; tests must verify the trigger fires for every affected program_version across multiple tenants

</code_context>

<specifics>
## Specific Ideas

- Phase 3 SC#3 explicit acceptance line: "BK7 (4y / 2y EC), BK13 (2y discharged / 4y dismissed), multi-filing (5y / 7y), foreclosure (7y / 3y EC + 90% LTV cap window), DIL/short sale/charge-off (4y / 2y EC), mortgage-included-in-BK exception". Per-rule structural assertions (D-08) must hit each of these line items as a discrete Vitest test for traceability.
- Phase 3 SC#4 explicit acceptance: "FHA HUD 4000.1 standard extenuating-circumstances provision is encoded; FHA Back-to-Work is marked DEPRECATED with sunset: 2016-09-30 and is queryable but not active." Tests must assert both the active-EC row exists AND the deprecated Back-to-Work row exists with the sunset date.
- Phase 3 SC#5 explicit acceptance: "verified via integration test." D-17's integration test at `tests/cascade/cascade-trigger.test.ts` is the literal SC artifact.
- pg_cron may require Supabase managed-tier upgrade or explicit extension enablement (it's not in the Postgres 16-alpine docker image by default). The Phase 3 partition auto-create function works under any scheduling mechanism — pg_cron is the default, but Phase 6 may need to migrate to Supabase's native scheduler if cost or compatibility forces it. Plan should include a fallback step (manual partition creation as a Phase 6+ TODO) just in case.
- SYSTEM tenant must exist before agency citation rows can land. Phase 1 D-04 + Phase 2 fixtures already pre-create it in tests; production seed needs an explicit "ensure SYSTEM tenant exists" step at the top of `scripts/seed-agency.ts` that runs the bootstrap pattern (gen_random_uuid → set_config → INSERT tenant kind=SYSTEM) idempotently.
- Drizzle 0.45 does NOT model `PARTITION BY RANGE`, triggers, `CREATE EXTENSION pg_cron`, or REVOKE statements — Phase 3 ships every such DDL via `--custom` migrations. Phase 1+2 already established this pattern; no relitigation.
- The cascade trigger function is `LANGUAGE plpgsql` (not `sql`) because it does an INSERT side-effect from a row-level trigger context — research's verbatim shape uses plpgsql. `STABLE` is wrong for a trigger that writes; use `VOLATILE` (default) and `SECURITY INVOKER` (caller's role; the system_role-write policy on cascade_review_queue handles cross-tenant inserts).
- Citation excerpts on FNMA Selling Guide must be verbatim text from the Selling Guide page so tampering against the URL is detectable manually. Excerpt length: ≤500 chars per citation; if a rule needs more context, use multiple `rule_citation` rows with the Phase 2 D-02 `secondary_for_rule_id` back-pointer.
- `lib/audit/snapshotId.ts` deterministic round-trip test: same canonical input → same hash; reorder agency_versions array → same hash; one extra version → different hash; mutate one recorded_at → different hash. These four assertions cover the canonicalization contract.
- FHFA CSV format: county_fips is FIPS code (5 digits, leading zero matters for state codes 01-09 — California = '06037' for LA County). Loader must preserve as text, not parse as integer.

</specifics>

<deferred>
## Deferred Ideas

These came up during analysis but belong in later phases. Captured to avoid loss; explicitly out of scope for Phase 3.

- **Vercel Cron wiring + actual HTTP fetch in `lib/cascade/poll.ts`** — Phase 6 (CFG-01); Phase 3 ships stub handler + integration test of the trigger consumer side.
- **Inngest 4.2 worker pool consuming cascade_review_queue with SKIP LOCKED** — Phase 6 (CFG-04); Phase 3 ships the table shape + status enum the worker reads.
- **HTTP scraping of FNMA Selling Guide announcements + HUD Mortgagee Letters + VA Circulars** — Phase 7 extraction pipeline extends the Phase 6 polling hook.
- **Saved-scenario re-run alerting based on snapshot_id delta (Flow 4 in research/ARCHITECTURE.md)** — Phase 14 v3 (WKF-03); Phase 3 ships the audit-log primitives that make it queryable.
- **Cold-archive automation for evaluation_event partitions older than 24 months** — Phase 13+; Phase 1-3 scale stays trivial (research forecasts 400k rows/day at maturity, but Phase 11's 50 LOs × 8 scenarios/day is ~400 rows/day).
- **cascade_review_queue retention/archival** — Phase 13+; queue stays small at Phase 1 scale.
- **USDA full agency rule encoding** — Phase 12 v2 (COV-v2-01); Phase 3 ships agency_rule_version stub row only.
- **HFA + second-lien CES/HELOC + construction-to-perm program rules** — Phase 12 v2 (COV-v2-02..04).
- **Brokerage LENDER_OVERLAY author UI consuming cascade_review_queue + Phase 8 AM commit pattern** — Phase 12 v2 (LOV-01..03).
- **Per-MI-provider overlay matching** — Phase 13 (PRC-05); Phase 2's tightest-overlay heuristic in program_rule covers MVP.
- **Live-pricing tables `pricing_feed`, `pricing_quote`** — Phase 13 (PRC-01..05).
- **Agency-rule deprecation lifecycle beyond the FHA Back-to-Work case** — Phase 8 (AM-driven `state` transitions on agency_rule rows when agencies retire entire programs); Phase 3 ships the column + the FHA-specific data point.
- **AM commit transaction calling `detect_loosenings()` to block bad commits** — Phase 8 (AM-01..09); Phase 2 shipped the function, Phase 3 doesn't change it.
- **Extracting SYSTEM-tenant + agency-version-bootstrap helpers into `tests/_shared/agency-fixture.ts`** — refactor candidate from `02-CONCERNS.md` WR-05; Phase 3 has more agency-fixture call sites so this is the right time, but optional.
- **Pure-TS evaluator at `lib/eval/`** — Phase 4 (EVL-01..09); Phase 3 schema designs the `evaluation_event` shape so the evaluator is a pure consumer + writer.
- **`json-rules-engine@7.x` vs ~500-LOC custom evaluator spike** — Phase 4 (EVL-09).
- **200-scenario golden set** — Phase 5 (GLD-01..06); Phase 3 hand-authored agency rules unblock the golden set's expected-deciding-rule references.
- **Reducto extraction + Claude Sonnet 4.6 vision consensus pass** — Phase 7 (EXT-01..10); Phase 3 hand-authoring is the explicit no-extraction-pipeline path.
- **`agency_publication_source` table caching last-fetched URLs + sha256** — could land at Phase 3 with the stub poller, but deferred to Phase 6 with the real poller (avoid shipping a table with no writers for 3 phases).

</deferred>

---

*Phase: 03-audit-log-agency-rule-encoding*
*Context gathered: 2026-05-04*
