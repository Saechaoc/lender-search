# Requirements: Lender Search

**Defined:** 2026-04-29
**Core Value:** Correctness on the long tail of derogatory and non-QM scenarios — eligibility decisions an LO can defend to a borrower or AE without calling a wholesale lender to confirm.

> **REQ-ID conventions.** Categories below derive from research/FEATURES.md and PROJECT.md Active set. v1 = Phase 0 (foundation, no UI) + Phase 1 (MVP). v2 = Phase 2 (coverage + pricing). v3 = Phase 3 (workflow + intelligence). Each requirement is user-centric where the user exists; foundational schema/engine requirements are written from the system's contract perspective because they pre-date the UI.

## v1 Requirements

Requirements for initial release. Each maps to exactly one roadmap phase below.

### Schema (SCH) — Phase 0

- [ ] **SCH-01**: System persists a normalized rule schema with explicit `layer` enum field on every rule (`AGENCY_BASE` | `INVESTOR_OVERLAY` | `PRODUCT_FEATURE` | `LENDER_OVERLAY`)
- [ ] **SCH-02**: System enforces "most restrictive applicable rule wins" per dimension at evaluation time and emits the full rule stack alongside the deciding rule
- [ ] **SCH-03**: System rejects loosenings on `INVESTOR_OVERLAY` (only tightenings vs. `AGENCY_BASE` are valid) and surfaces them as data-quality errors during AM review
- [ ] **SCH-04**: System persists a structured `DerogRule` per event type with required fields: `event_type` (BK7 / BK13_DISCHARGED / BK13_DISMISSED / MULTIPLE_BK / FORECLOSURE / DEED_IN_LIEU / SHORT_SALE / MORTGAGE_CHARGE_OFF / MOD / FORBEARANCE), `measurement_anchor` (discharge / dismissal / deed-transfer / sale-close / etc.), `base_waiting_months`, `extenuating_circumstances_waiting_months`, `post_event_LTV_caps[]` (with `months_since` range, `max_LTV` percent, allowed occupancy list, allowed purpose list), `reestablished_credit_required` boolean, `mortgage_included_in_bk_rule` enum, `notes_citations[]`
- [ ] **SCH-05**: System encodes the FNMA post-foreclosure 3-to-7-year window as a structured `post_event_LTV_cap` (`max_LTV: 90`, `purposeAllowList: [PURCHASE, RATE_TERM_REFI]`, `occupancyAllowList: [PRIMARY]`) so cash-out and second-home and investment-property scenarios in that band are correctly disqualified
- [ ] **SCH-06**: System persists a typed `IncomeDocMethod` per program (personal-vs-business, expense-factor source, comingled-account treatment, NSF treatment, qualifying-period months) so "12-month bank statement" is not flattened to a label across investors
- [ ] **SCH-07**: System persists a typed `DscrMethod` per DSCR program (numerator rule, denominator rule, IO handling, ARM qualification, no-ratio option)
- [ ] **SCH-08**: System persists `tenant.kind` enum on every tenant (`BROKERAGE` | `RETAIL_LENDER` | `WHOLESALE_LENDER` | `SYSTEM`) so the deferred GTM-persona decision can land later without rework
- [ ] **SCH-09**: System persists per-`ProgramVersion` `effective_period` (daterange with `effective_at` valid time + `expires_at`) and a content-addressed `source_document_fingerprint`; bitemporal versioning supports the "what was true on date X" audit question
- [ ] **SCH-10**: System persists per-field `confidence` numeric (0–1) on every extracted rule field; field-level granularity (not row-level)
- [ ] **SCH-11**: System persists per-program `eligible_loan_purposes`, `eligible_property_types`, `eligible_occupancies`, `eligible_doc_types` enumerated lists with explicit negation columns (`ineligible_*`) for matrix-stated exclusions
- [ ] **SCH-12**: System persists state-level eligibility plus county overlay (high-cost / declining-market / USDA-eligibility scaffolding only; USDA fully populated in v2)
- [ ] **SCH-13**: System enforces a database constraint that no `program_rule` row persists without a `rule_citation` row pointing at a source document page + bbox + textSpan (citation discipline as schema constraint, not soft validation)
- [ ] **SCH-14**: System records every `program_rule` insert with the originating `extraction_run_id` so any rule can be traced back to the matrix PDF that produced it

### Agency (AGY) — Phase 0

- [ ] **AGY-01**: System encodes a versioned `agency_rule_version` row per agency release for FNMA, FHLMC, FHA, and VA Selling/Underwriting Guides (USDA scaffolded; full encoding deferred to v2)
- [ ] **AGY-02**: System encodes the FNMA Selling Guide B3-5.3-07 derogatory waiting-period matrix in full — BK7 (4y / 2y w/ EC), BK13 (2y discharged / 4y dismissed), multi-filing (5y / 7y stacking), foreclosure (7y / 3y w/ EC + 90% LTV cap window), DIL (4y / 2y w/ EC), short sale (4y / 2y w/ EC), mortgage charge-off (4y / 2y w/ EC), modification rule, mortgage-included-in-BK exception
- [ ] **AGY-03**: System encodes the FHLMC §5202.5 derog waiting-period rules with their own anchor and timing nuances
- [ ] **AGY-04**: System encodes the FHA HUD 4000.1 derog waiting periods (BK7 2y / 1y w/ extenuating circumstances per HUD 4000.1, foreclosure 3y, DIL/short-sale 3y, mortgage charge-off 3y) with the FHA Back-to-Work program marked `DEPRECATED` with `sunset: 2016-09-30` (Mortgagee Letter 2016-14); standard extenuating-circumstances provision remains active
- [ ] **AGY-05**: System encodes the VA Pamphlet 26-7 derog waiting periods (BK7 2y / 1y w/ extenuating circumstances, foreclosure 2y, DIL/short-sale 2y, mortgage-included-in-BK exception)
- [ ] **AGY-06**: System encodes a `program_version → agency_rule_version` foreign-key relationship so every program inherits from a specific dated agency snapshot
- [ ] **AGY-07**: System polls FNMA Selling Guide / FHLMC Bulletins / FHA Mortgagee Letters / VA Circulars on a daily schedule and creates a draft `agency_rule_version` when a published change is detected
- [ ] **AGY-08**: System fans out a per-affected-program review job to a queue when a new `agency_rule_version` is committed, so AM can prioritize re-validation of programs whose rules depend on the changed agency rule
- [ ] **AGY-09**: System encodes 2026 FHFA conforming loan limit values and high-balance county-level overlays as a separate versioned table referenced by `program_version`

### Evaluation engine (EVL) — Phase 0

- [ ] **EVL-01**: Pure-TypeScript evaluator at `lib/eval/` exposes `evaluate(scenario, snapshot) → { decision, rule_stack, deciding_rule, near_miss }` with no I/O and no framework dependencies
- [ ] **EVL-02**: Evaluator categorizes every program-scenario pair as `eligible` | `near-miss` | `ineligible`; eligibility means no hard fails; near-miss means a single configurable-distance dimension change qualifies; ineligibility means the deciding hard fail is reported
- [ ] **EVL-03**: Evaluator processes derogatory events first to compute active LTV-cap windows (FNMA's 3-to-7-year band) before applying standard rules, so a fix to one dimension does not silently mask another
- [ ] **EVL-04**: Evaluator reports a minimum-edit-distance fix per ineligible program (FICO delta, LTV delta, DTI delta, doc-type swap, seasoning months remaining) with an explicit `cost` for ranking near-miss results
- [ ] **EVL-05**: Evaluator emits `rule_stack[]` (every applicable rule per dimension, ordered by restrictiveness) plus the single `deciding_rule` per failed dimension, so the explanation surface can show "FNMA allows 97% LTV; investor overlay caps at 95%"
- [ ] **EVL-06**: Evaluator distinguishes hard fails (move program to ineligible) from soft warnings (manual UW path, condo project review required, large deposit explanation); both are surfaced; only hard fails change the decision
- [ ] **EVL-07**: Evaluator reads from a hydrated `RuleSnapshot` (single SQL query per tenant per ~30s) and runs purely in-memory; the snapshot id is a deterministic sha256 hash of the canonical rule bundle so re-evaluating any historical scenario is a single JOIN
- [ ] **EVL-08**: Evaluator pre-filters by hard scenario keys (loan type, occupancy, state, FICO floor) before deep evaluation to keep latency budget at 1k programs without losing any eligible result
- [ ] **EVL-09**: Evaluator decision: json-rules-engine 7.x vs. ~500-LOC custom evaluator chosen on lower-rule-corruption-blast-radius criterion via Phase 0 spike

### Multi-tenant isolation (TNT) — Phase 0

- [x] **TNT-01**: System enforces Postgres Row-Level Security with `FORCE ROW LEVEL SECURITY` on every tenant-scoped table; even table owners are subject to policy
- [x] **TNT-02**: System reads `tenant_id` from JWT app_metadata via `current_setting('app.tenant_id')` at every request boundary; service-role connections never bypass RLS for application traffic
- [x] **TNT-03**: System indexes `tenant_id` on every tenant-scoped table to keep RLS policies on the fast path
- [x] **TNT-04**: CI pen-test suite (`tests/rls/`) blocks merge on any cross-tenant query that succeeds: cross-tenant read attempts, cross-tenant write attempts, service_role boundary tests, JWT-tampering tests
- [x] **TNT-05**: System has zero cross-tenant data egress paths; no admin "view as another tenant" feature, no cross-tenant analytics, no cross-tenant pricing comparison surface
- [x] **TNT-06**: System has no aggregate competitive-analytics surface comparing one lender's pricing or eligibility to another's — explicitly the territory of the October 2025 OB antitrust complaint

### Audit (AUD) — Phase 0

- [ ] **AUD-01**: System persists every evaluation result to an append-only `evaluation_event` table partitioned by month
- [ ] **AUD-02**: `evaluation_event` records `tenant_id`, `actor_id`, `scenario_payload` (or scenario hash), `ruleset_snapshot_id` (sha256 of canonical bundle at evaluation time), `decision`, `deciding_rule_id`, `rule_stack[]` jsonb, `evaluator_version`, `evaluated_at`
- [ ] **AUD-03**: `REVOKE UPDATE, DELETE ON evaluation_event FROM authenticated` enforced at the database level — tampering is structurally impossible, not policy-prohibited
- [ ] **AUD-04**: System replays any historical scenario against its historical `RuleSnapshot` deterministically, returning the same decision and rule stack the user originally saw

### Golden set (GLD) — Phase 0

- [ ] **GLD-01**: 200 borrower scenarios drafted with explicit category coverage: derog edge cases, non-QM doc-method variance, multi-borrower FICO mid-score, post-foreclosure 3–7y window, condo project review, manual UW paths, multi-filing windows, mortgage-included-in-BK exception, FHA extenuating circumstances (HUD 4000.1)
- [ ] **GLD-02**: Scenario sourcing follows the 50/25/25 mix: 50% from real anonymized broker-shop LO outreach (recruited explicitly), 25% from incumbent public examples (Polly/non-QM blog, Optimal Blue scenario examples, LoanNEX qualifier walkthroughs), 25% from constructed adversarial cases designed to break boolean derog handling
- [ ] **GLD-03**: ≥1 paid external expert reviewer (senior underwriter or mortgage consultant) reviews every scenario's expected outcome; expected outcomes lock with citations to FNMA Selling Guide / FHLMC §5202.5 / HUD 4000.1 / VA Pamphlet 26-7 / specific lender matrix; not citations to the evaluator
- [ ] **GLD-04**: Scenarios are locked before the evaluator runs against them; locking captures expected `decision`, expected `deciding_rule_id` reference, expected `rule_stack` skeleton
- [ ] **GLD-05**: Golden set ≥98% precision and ≥95% recall against expert-reviewed expected outcomes is the Phase 0 exit gate, not a Phase 1 deliverable
- [ ] **GLD-06**: Golden set runs in CI; regression on any scenario blocks merge

### Extraction pipeline (EXT) — Phase 1

- [ ] **EXT-01**: AM uploads a matrix PDF (or set of PDFs: matrix + rate sheet + guideline excerpt + addenda) and the system runs OCR + auto-classifies document type
- [ ] **EXT-02**: Pipeline runs Pass 1 — structural — to identify product blocks (e.g., "Bank Statement 24-mo", "DSCR 5/6 ARM"), grids of FICO×LTV, occupancy, purpose
- [ ] **EXT-03**: Pipeline runs Pass 2 — rule normalization — mapping cells and footnotes to the shared schema (max LTV at FICO band, DTI cap, reserves, derog seasoning, doc method, etc.), with footnote anchoring preserved
- [ ] **EXT-04**: Pipeline runs Pass 3 — overlay detection — diffing extracted rules against the relevant `agency_rule_version` and tagging deltas as overlays; loosenings flagged as data errors
- [ ] **EXT-05**: Pipeline runs Pass 4 — confidence scoring — emitting per-field 0–1 confidence with explicit reasons (low contrast on cell, ambiguous footnote reference, conflicting tables)
- [ ] **EXT-06**: Pipeline writes only to `staging.draft_rule` / `staging.draft_rule_field_confidence` / `staging.extraction_run`; canonical tables (`program_rule`, `rule_citation`, `program_version`) are never mutated by extraction
- [ ] **EXT-07**: Each step is durable and idempotent under Inngest; a re-run with a better OCR or LLM model produces a fresh `extraction_run` and never corrupts canonical state
- [ ] **EXT-08**: Server-side post-extraction validator confirms every staged rule's `textSpan` actually appears in the cited PDF page at the specified bbox before the rule becomes available for AM review; rules that fail validation are dropped with a logged reason
- [ ] **EXT-09**: Pipeline rejects rules referencing the FHA Back to Work program when the source document is dated after 2016-09-30
- [ ] **EXT-10**: Reducto is the primary extraction vendor; fallback consensus-pass mode (Reducto + Claude Sonnet 4.6 vision) is wired and toggleable per matrix run if Reducto cell accuracy on a specific matrix falls below the production threshold

### AM review surface (AM) — Phase 1

- [ ] **AM-01**: AM reviews extracted rules in a three-pane UI — source PDF with highlighted citation on the left, extracted normalized rule object in the middle, edit form on the right
- [ ] **AM-02**: Review queue is sorted by lowest-confidence-first; fields below a configurable threshold (default 0.85) require explicit AM confirmation
- [ ] **AM-03**: AM can bulk-accept fields above a configurable high-confidence threshold (default 0.95) with a single action; server-side textSpan validation must pass for any field included in a bulk-accept
- [ ] **AM-04**: AM can leave a per-field comment trail; comments persist across program versions
- [ ] **AM-05**: A new matrix upload creates a draft `program_version` with a delta view (added rules, changed cells, removed rules); AM reviews the delta only — high-confidence unchanged rules carry forward
- [ ] **AM-06**: Commit on a draft `program_version` archives the prior version with `effective_period` bracketing in a single transaction
- [ ] **AM-07**: AM workflow gates on a `license_id` reference for the lender; a matrix cannot enter `in review` without a license confirmation
- [ ] **AM-08**: AM completes a standard non-QM matrix in ≤45 minutes (KPI; measured continuously from the first AM commit)
- [ ] **AM-09**: AM completes a delta on an existing program in ≤15 minutes (KPI; measured continuously)

### Program lifecycle (PRG) — Phase 1

- [ ] **PRG-01**: Every program has a state in `draft → in review → active → deprecated → sunset` with auditable state transitions
- [ ] **PRG-02**: Only `active` programs surface in LO search by default; `deprecated` programs surface in historical scenario re-runs with a warning
- [ ] **PRG-03**: System tags a program as `stale` when `effective_period.expires_at` passes or when no refresh has occurred within a configurable threshold (default 90 days); stale programs remain searchable with a "last verified" timestamp
- [ ] **PRG-04**: System catches version-to-version layout drift on matrix re-uploads — a new `extraction_run` against an existing program with a fundamentally different table layout produces a layout-signature alert that pauses commit

### LO scenario flow (LO) — Phase 1

- [ ] **LO-01**: LO can fill a single scenario form covering borrower (FICO mid-score per borrower, co-borrower FICOs, citizenship/residency including ITIN and foreign national, veteran, first-time homebuyer, self-employment), loan (purpose including purchase / RT-refi / cash-out / construction / construction-to-perm / home-equity / HELOC / second-lien CES, loan amount, term, amortization fixed/ARM with index/margin, lien position), property (SFR / 2–4 unit / condo warrantable+non-warrantable / co-op / PUD / manufactured, occupancy, state, county, rural flag, HOA, condo project type), ratios (LTV / CLTV / HCLTV, DTI front+back, reserves months), income/doc type (full doc / 1-yr / bank statement 12-or-24 / 1099 / P&L only / asset depletion / DSCR with ratio / no-ratio / no-doc / VOE), derog history (per-event with type / date / EC flag / mortgage-included-in-BK), special flags (HFA, MCC, gift funds, non-occupant co-borrower, LDP/GSA which auto-checks)
- [ ] **LO-02**: LO sees results split into three sections: Eligible (ranked), Conditional / near-miss (with the single-dimension fix per row), Ineligible (with the deciding rule and the layer that fired)
- [ ] **LO-03**: Each result row exposes program name, lender, channel, max LTV / CLTV / HCLTV at this scenario, max DTI, MI requirement and provider tier, reserves, derog seasoning satisfied or not
- [ ] **LO-04**: Each result row has an expandable "why" view that shows the matched rule citations with `layer` attribution (agency / investor overlay / product feature / lender overlay) and a deep link to the source PDF page + bbox
- [ ] **LO-05**: Eligible programs sort by a configurable score (default: rate-where-available, then LTV headroom, then doc burden); near-miss programs sort by ascending edit cost
- [ ] **LO-06**: LO sees a confidence badge on a result row when the deciding rule has confidence < 0.90 ("AM has not confirmed this rule — verify with lender")
- [ ] **LO-07**: LO completes a fully-specified scenario in P50 ≤2s, P95 ≤5s wall time across the indexed corpus
- [ ] **LO-08**: LO can pin up to four programs into a side-by-side comparison view showing every qualification dimension and notes
- [ ] **LO-09**: LO can export a comparison view to PDF with the standard decision-support disclaimer
- [ ] **LO-10**: LO can run a scenario with eligibility-only output when the program has no pricing feed at MVP; result row shows "Eligibility only — confirm pricing with lender" linked to the matrix citation

### Saved scenarios + sharing (SHR) — Phase 1

- [ ] **SHR-01**: LO can save a scenario into a per-LO library with a name and notes
- [ ] **SHR-02**: LO can re-run a saved scenario; system flags it `stale` if any underlying `program_version` referenced in the saved result has changed since the last run
- [ ] **SHR-03**: LO can generate a shareable link to a saved scenario; the link supports an optional borrower-safe view that hides LO compensation and overlay tags
- [ ] **SHR-04**: Shared scenario links carry the same decision-support disclaimer prominently; borrower-safe view does not weaken the disclaimer

### Disclaimer + liability (DCL) — Phase 1

- [ ] **DCL-01**: Every result, every comparison-view PDF export, every shareable link carries a prominent "decision-support, not credit decision" disclaimer reviewed by counsel
- [ ] **DCL-02**: Terms-of-Service includes a liability cap and the audit-trail commitment; published before MVP launch
- [ ] **DCL-03**: A confidence badge fires on any result whose deciding rule has confidence < 0.90; copy is "AM has not confirmed this rule — verify with lender"
- [ ] **DCL-04**: Borrower-safe shared views render the disclaimer at full prominence (no de-emphasis vs. LO view)

### Lender data licensing (LCS) — Phase 1

- [ ] **LCS-01**: Lender onboarding requires a signed license-to-use template granting indexing of the lender's published guideline matrices
- [ ] **LCS-02**: System persists a `license_id` reference on every `program_version`; commits without a `license_id` are blocked
- [ ] **LCS-03**: License template explicitly prohibits aggregating data into competitive-intelligence outputs across lenders (matches the antitrust posture in PROJECT.md)
- [ ] **LCS-04**: Live-pricing licensing terms are deferred to v2; license template Phase 1 covers eligibility data only

### Integrations (INT) — Phase 1

- [ ] **INT-01**: LO can export a saved scenario as Encompass FNM 3.2 / MISMO 3.4 export
- [ ] **INT-02**: LO can export a saved scenario as a LendingPad-compatible payload
- [ ] **INT-03**: Export includes only data the LO supplied or that derives deterministically from the eligibility result; no cross-tenant program data leaks via export

### Configuration / hosting (CFG) — Phase 1

- [ ] **CFG-01**: Production app runs on Vercel Pro with the Next.js 16.2 App Router; no `revalidateTag(tag)` single-arg form, no `middleware.ts` (deprecated → `proxy.ts`)
- [ ] **CFG-02**: Database is Postgres 16+ via Supabase with Drizzle ORM 0.45; `prepare: false` set for the Supabase pooler
- [ ] **CFG-03**: All LLM calls run server-side via Server Actions / route handlers; no client-side Anthropic SDK usage; no API keys in localStorage (existing prototype's pattern is explicitly excluded)
- [ ] **CFG-04**: Inngest 4.2 runs as a separate worker pool for the extraction pipeline; survives Vercel's 60s function ceiling
- [x] **CFG-05**: Env-var management uses Vercel encrypted env + `t3-env` runtime validation; no plaintext secrets in source

### Observability (OBS) — Phase 1

- [ ] **OBS-01**: Sentry captures errors and performance traces with first-class Next.js 16 integration
- [ ] **OBS-02**: Axiom retains logs beyond Vercel's 1-day window; structured JSON logs with `tenant_id` redaction at egress
- [ ] **OBS-03**: LLM call traces capture token costs per call for ongoing extraction-cost monitoring
- [ ] **OBS-04**: P50 / P95 latency for evaluation, extraction-pipeline-step duration, AM time-to-commit, AM correction rate are tracked on dashboards

### Coverage (COV) — Phase 1

- [ ] **COV-01**: 50 programs indexed at MVP launch
- [ ] **COV-02**: ≥60% of MVP programs are non-QM (bank statement, DSCR, ITIN, foreign national, post-derog) — the wedge category where incumbents are weakest
- [ ] **COV-03**: All MVP programs reference a current `agency_rule_version` and have a `license_id`

### GTM / branding (GTM) — Phase 1 exit gate

- [ ] **GTM-01**: A non-conflicting product name is selected and trademark-cleared before any external GTM activity (the current "Lender Search" working name collides with Scotsman Guide's lendersearch.com from March 2023)
- [ ] **GTM-02**: Initial buyer persona (broker MLO vs. retail LO vs. wholesale AE running scenarios for partners) is committed based on Phase 1 pilot data

## v2 Requirements

Deferred to Phase 2. Tracked but not in v1 roadmap.

### Coverage expansion (COV-v2)

- **COV-v2-01**: USDA agency rules encoded (Phase 0 scaffolded, Phase 2 fully populated)
- **COV-v2-02**: HFA program family supported with first-time-homebuyer flag handling
- **COV-v2-03**: Second-lien CES and HELOC programs supported
- **COV-v2-04**: Construction and construction-to-perm programs supported
- **COV-v2-05**: 250 programs indexed by month 6

### Live pricing (PRC) — Phase 2

- **PRC-01**: Lender opt-in pricing data plane (`pricing_feed` + `pricing_quote` tables) ingests note rate, points/credit, APR, lock period from feeds
- **PRC-02**: Result row shows pricing where in scope (note rate, points, APR, lock period); no rate-lock execution
- **PRC-03**: Pricing eligibility predicate references the rule layer; pricing inherits hard-fail constraints from eligibility evaluation
- **PRC-04**: Side-by-side rate comparison surface lives strictly within a single tenant; no cross-tenant rate visibility (explicit antitrust posture)
- **PRC-05**: Per-MI-provider overlay matching hardens the Phase 1 tightest-overlay heuristic

### Multi-tenant overlay UI (LOV) — Phase 2

- **LOV-01**: Brokerage / retail-lender tenants can author their own `LENDER_OVERLAY` rules through the same three-pane review pattern
- **LOV-02**: Tenant-authored overlays are scoped to their tenant only; never visible to other tenants
- **LOV-03**: Tenant overlays apply on top of inherited investor overlays; "most restrictive wins" still holds

### Mobile (MOB) — Phase 2

- **MOB-01**: Scenario flow is mobile-responsive (Tailwind breakpoints; no separate codebase); native mobile is a Phase 3 conditional decision

### Additional integrations (INT-v2)

- **INT-v2-01**: Encompass Partner Connect deeper write-back integration
- **INT-v2-02**: Byte LOS integration
- **INT-v2-03**: USDA Eligibility Map API integration with cached property-eligibility lookup
- **INT-v2-04**: FNMA Condo Project Manager API integration with cached project-state lookup

### Antitrust + licensing review gate (LCS-v2)

- **LCS-v2-01**: Live-pricing-specific lender data-licensing terms negotiated with each opt-in lender
- **LCS-v2-02**: Counsel-led antitrust review of the data architecture before Phase 2 live-pricing rollout

## v3 Requirements

Deferred to Phase 3 (year 2+). Tracked but not in v1 or v2 roadmap.

### Workflow (WKF) — Phase 3

- **WKF-01**: Borrower-safe shareable scenario landing pages (full presentation, not just a link)
- **WKF-02**: AE collaboration surface — LoanNEX-style two-way messaging on a scenario, scoped to the lender's own AEs and the originating LO
- **WKF-03**: Saved-scenario re-run alerting when an indexed program changes a rule that affects a saved scenario's outcome (email + in-app)

### Mobile native (MOB-v3) — Phase 3 conditional

- **MOB-v3-01**: Native iOS/Android only if mobile usage data shows ≥40% of LO sessions on mobile form factor for *scenario discovery* (not just refresh)

### Eligibility warranty (EOW) — Phase 3 optional

- **EOW-01**: Optional E&O warranty product modeled on Candor's repurchase-warranty framing — AAA-rated insurer partnership, 60-month post-closing tail; gated on sustained eligibility precision ≥99.5%

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Live rate locking; best-efforts / mandatory delivery | Optimal Blue / Polly territory; regulated capital-markets workflow we deliberately stay out of |
| AUS submission (DU / LPA / GUS) | Accept AUS outcome as a scenario input only; never as an output. Underwriting is the lender's responsibility |
| LOS replacement | Integrate with Encompass / Byte / LendingPad via export and API; never the system of record for the loan file |
| Borrower-facing direct-to-consumer marketplace (Own Up, Credible style) | RESPA-sensitive; different GTM. Shareable view is borrower-safe presentation of an LO-driven scenario, not self-serve consumer flow |
| Hedging, MSR valuation, secondary trading | Out of scope for v1, v2, and v3 |
| Guideline interpretation as legal/compliance advice | Eligibility output is decision-support; underwriting and compliance remain the lender's responsibility |
| "Pricing Insight"-style cross-lender benchmarking / competitive analytics | The exact territory the October 2025 Optimal Blue antitrust complaint targets; existential antitrust risk |
| Cross-tenant overlay visibility | A brokerage's `LENDER_OVERLAY` is not visible to other tenants; per-lender data-egress control is a database-enforced commitment |
| Black-box AI scoring of eligibility | LLM lives in the extraction pipeline only; never in the online deterministic decision path |
| Real-time AE / scenario chat in MVP | Phase 3 only; layered on top of mature scenario data model |
| Native mobile in MVP | Incumbents' mobile apps are quote-refresh tools, not scenario-discovery tools; responsive web is sufficient until usage data argues otherwise |
| USDA / HFA / construction / second-lien at MVP | Deferred to Phase 2 to keep the wedge surface tight |
| Live pricing at MVP | Eligibility-only sidesteps lender data-licensing exposure and the OB-antitrust adjacent territory until the eligibility wedge is real and measured |
| Brand "Lender Search" as final product name | Working name; Scotsman Guide owns lendersearch.com (March 2023) — rename before any external GTM |
| FHA "Back to Work — Extenuating Circumstances" as an active program | Discontinued by Mortgagee Letter 2016-14 on 2016-09-30; encoded as DEPRECATED-2016-09-30; standard HUD 4000.1 EC provision remains |

## Traceability

Populated by gsd-roadmapper during roadmap creation. Each REQ-ID maps to exactly one roadmap phase.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SCH-01 | Phase 2 | Not started |
| SCH-02 | Phase 2 | Not started |
| SCH-03 | Phase 2 | Not started |
| SCH-04 | Phase 2 | Not started |
| SCH-05 | Phase 2 | Not started |
| SCH-06 | Phase 2 | Not started |
| SCH-07 | Phase 2 | Not started |
| SCH-08 | Phase 2 | Not started |
| SCH-09 | Phase 2 | Not started |
| SCH-10 | Phase 2 | Not started |
| SCH-11 | Phase 2 | Not started |
| SCH-12 | Phase 2 | Not started |
| SCH-13 | Phase 2 | Not started |
| SCH-14 | Phase 2 | Not started |
| AGY-01 | Phase 3 | Not started |
| AGY-02 | Phase 3 | Not started |
| AGY-03 | Phase 3 | Not started |
| AGY-04 | Phase 3 | Not started |
| AGY-05 | Phase 3 | Not started |
| AGY-06 | Phase 3 | Not started |
| AGY-07 | Phase 3 | Not started |
| AGY-08 | Phase 3 | Not started |
| AGY-09 | Phase 3 | Not started |
| EVL-01 | Phase 4 | Not started |
| EVL-02 | Phase 4 | Not started |
| EVL-03 | Phase 4 | Not started |
| EVL-04 | Phase 4 | Not started |
| EVL-05 | Phase 4 | Not started |
| EVL-06 | Phase 4 | Not started |
| EVL-07 | Phase 4 | Not started |
| EVL-08 | Phase 4 | Not started |
| EVL-09 | Phase 4 | Not started |
| TNT-01 | Phase 1 | Not started |
| TNT-02 | Phase 1 | Not started |
| TNT-03 | Phase 1 | Not started |
| TNT-04 | Phase 1 | Not started |
| TNT-05 | Phase 1 | Not started |
| TNT-06 | Phase 1 | Not started |
| AUD-01 | Phase 3 | Not started |
| AUD-02 | Phase 3 | Not started |
| AUD-03 | Phase 3 | Not started |
| AUD-04 | Phase 3 | Not started |
| GLD-01 | Phase 5 | Not started |
| GLD-02 | Phase 5 | Not started |
| GLD-03 | Phase 5 | Not started |
| GLD-04 | Phase 5 | Not started |
| GLD-05 | Phase 5 | Not started |
| GLD-06 | Phase 5 | Not started |
| EXT-01 | Phase 7 | Not started |
| EXT-02 | Phase 7 | Not started |
| EXT-03 | Phase 7 | Not started |
| EXT-04 | Phase 7 | Not started |
| EXT-05 | Phase 7 | Not started |
| EXT-06 | Phase 7 | Not started |
| EXT-07 | Phase 7 | Not started |
| EXT-08 | Phase 7 | Not started |
| EXT-09 | Phase 7 | Not started |
| EXT-10 | Phase 7 | Not started |
| AM-01 | Phase 8 | Not started |
| AM-02 | Phase 8 | Not started |
| AM-03 | Phase 8 | Not started |
| AM-04 | Phase 8 | Not started |
| AM-05 | Phase 8 | Not started |
| AM-06 | Phase 8 | Not started |
| AM-07 | Phase 8 | Not started |
| AM-08 | Phase 8 | Not started |
| AM-09 | Phase 8 | Not started |
| PRG-01 | Phase 8 | Not started |
| PRG-02 | Phase 8 | Not started |
| PRG-03 | Phase 8 | Not started |
| PRG-04 | Phase 8 | Not started |
| LO-01 | Phase 9 | Not started |
| LO-02 | Phase 9 | Not started |
| LO-03 | Phase 9 | Not started |
| LO-04 | Phase 9 | Not started |
| LO-05 | Phase 9 | Not started |
| LO-06 | Phase 9 | Not started |
| LO-07 | Phase 9 | Not started |
| LO-08 | Phase 9 | Not started |
| LO-09 | Phase 9 | Not started |
| LO-10 | Phase 9 | Not started |
| SHR-01 | Phase 10 | Not started |
| SHR-02 | Phase 10 | Not started |
| SHR-03 | Phase 10 | Not started |
| SHR-04 | Phase 10 | Not started |
| DCL-01 | Phase 10 | Not started |
| DCL-02 | Phase 10 | Not started |
| DCL-03 | Phase 10 | Not started |
| DCL-04 | Phase 10 | Not started |
| LCS-01 | Phase 8 | Not started |
| LCS-02 | Phase 8 | Not started |
| LCS-03 | Phase 8 | Not started |
| LCS-04 | Phase 8 | Not started |
| INT-01 | Phase 9 | Not started |
| INT-02 | Phase 9 | Not started |
| INT-03 | Phase 9 | Not started |
| CFG-01 | Phase 6 | Not started |
| CFG-02 | Phase 1 | Not started |
| CFG-03 | Phase 6 | Not started |
| CFG-04 | Phase 6 | Not started |
| CFG-05 | Phase 1 | Not started |
| OBS-01 | Phase 6 | Not started |
| OBS-02 | Phase 6 | Not started |
| OBS-03 | Phase 6 | Not started |
| OBS-04 | Phase 6 | Not started |
| COV-01 | Phase 11 | Not started |
| COV-02 | Phase 11 | Not started |
| COV-03 | Phase 11 | Not started |
| GTM-01 | Phase 11 | Not started |
| GTM-02 | Phase 11 | Not started |
| COV-v2-01 | Phase 12 | v2 — deferred |
| COV-v2-02 | Phase 12 | v2 — deferred |
| COV-v2-03 | Phase 12 | v2 — deferred |
| COV-v2-04 | Phase 12 | v2 — deferred |
| COV-v2-05 | Phase 12 | v2 — deferred |
| PRC-01 | Phase 13 | v2 — deferred |
| PRC-02 | Phase 13 | v2 — deferred |
| PRC-03 | Phase 13 | v2 — deferred |
| PRC-04 | Phase 13 | v2 — deferred |
| PRC-05 | Phase 13 | v2 — deferred |
| LOV-01 | Phase 12 | v2 — deferred |
| LOV-02 | Phase 12 | v2 — deferred |
| LOV-03 | Phase 12 | v2 — deferred |
| MOB-01 | Phase 12 | v2 — deferred |
| INT-v2-01 | Phase 12 | v2 — deferred |
| INT-v2-02 | Phase 12 | v2 — deferred |
| INT-v2-03 | Phase 12 | v2 — deferred |
| INT-v2-04 | Phase 12 | v2 — deferred |
| LCS-v2-01 | Phase 13 | v2 — deferred |
| LCS-v2-02 | Phase 13 | v2 — deferred |
| WKF-01 | Phase 14 | v3 — deferred |
| WKF-02 | Phase 14 | v3 — deferred |
| WKF-03 | Phase 14 | v3 — deferred |
| MOB-v3-01 | Phase 15 | v3 — deferred |
| EOW-01 | Phase 15 | v3 — deferred |

**Coverage:**
- v1 requirements: 110 total by category sum (SCH 14 + AGY 9 + EVL 9 + TNT 6 + AUD 4 + GLD 6 + EXT 10 + AM 9 + PRG 4 + LO 10 + SHR 4 + DCL 4 + LCS 4 + INT 3 + CFG 5 + OBS 4 + COV 3 + GTM 2). Source line stated "95 total" — discrepancy noted; mapping covers all 110 actual REQ-IDs.
- Mapped to v1 phases (1-11): 110 ✓
- v2 requirements (Phase 12-13): 19 mapped
- v3 requirements (Phase 14-15): 5 mapped
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-29*
*Last updated: 2026-04-29 — traceability populated by gsd-roadmapper after roadmap creation*
