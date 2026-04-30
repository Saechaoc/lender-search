# Project Research Summary

**Project:** Lender Search (working name — see Brand Conflict gap below)
**Domain:** Eligibility-first multi-tenant mortgage SaaS — US residential origination, wholesale-broker channel, non-QM-weighted, with AI-assisted matrix-PDF extraction and human-in-the-loop AM review
**Researched:** 2026-04-29
**Confidence:** HIGH overall (HIGH on stack, features, architecture; HIGH on pitfalls primary sources; MEDIUM on Reducto vendor lock-in until Phase 0 acceptance test)

## Executive Summary

Lender Search is a regulated, audit-heavy, multi-tenant SaaS whose entire wedge is correctness on the long tail of derogatory and non-QM scenarios. Research across stack, features, architecture, and pitfalls converges on a single canonical shape: a **TypeScript-everywhere, Postgres-centric Next.js + Supabase + Vercel monolith**, with **Reducto (primary) / Claude Sonnet 4.6 (backup) for matrix-PDF extraction**, **Inngest** for the durable extraction workflow, and a **pure-TS in-process eligibility evaluator** running against a hydrated `RuleSnapshot`. Tenant isolation is enforced at the database via Postgres RLS with `tenant_id` in JWT claims — not at the application layer — because the October 2025 Optimal Blue antitrust class action makes cross-tenant data egress an existential risk, not just a product-hygiene concern. The agency-rule cascade (FNMA/FHLMC/FHA/VA versioned and FK-referenced from `program_version`) is the architectural lynchpin that makes Differentiator #1 buildable; embedded per-program agency rules would render it impossible.

All four PRD strategic differentiators survive the 2026 competitive audit, but #4 (explainable ranking) **narrows from "ranking with citations" to "structured eligibility with citation + layer attribution"** — Polly/AI shipped near-miss in 2024-2025 and Zeitro Strata AI shipped citation-grounded Q&A in March 2026. Differentiators #2 (structured derog model with measurement-anchor / waiting-month / extenuating-circumstances / post-event LTV cap window / re-established-credit / mortgage-included-in-BK) and #3 (matrix-PDF → normalized rule object with per-field confidence and three-pane AM review) remain **completely unowned by any 2026 incumbent** and are the strongest moats to build first.

The dominant risks are correctness risks, not infrastructure risks. **Phase 0 must produce an extensible derog/rule schema, encoded agency-base rule sets, a 200-scenario expert-validated golden set, and the deterministic evaluator before any UI work.** Five non-negotiable mitigations: (1) Reducto must clear a 10-non-QM-matrix Phase 0 acceptance test before vendor commit; (2) FHA Back-to-Work must be removed from PRD references because FHA discontinued the program 2016-09-30; (3) the post-foreclosure 3-to-7-year window is primary-purchase-or-RT-refi-only at ≤90% LTV (every PPE simplifies this); (4) LLM citation discipline must be a hard schema constraint (no citation → no row persists), not soft validation; and (5) the golden set must include ≥1 external expert reviewer with scenarios sourced 50% from real LO outreach + 25% from incumbent samples + 25% from constructed adversarial cases — self-selection bias here is the existential Phase 0 risk.

## Key Findings

### Recommended Stack

The stack is opinionated and resolved: a managed-everything pattern that lets a solo developer focus on the rule schema and extraction pipeline rather than ops. Detailed rationale in [STACK.md](./STACK.md).

**Core technologies:**
- **TypeScript 5.7 / Next.js 16.2 (App Router) / React 19.2** — single-language full-stack; pin to 16.2.x; App Router server components keep LLM keys server-side, fixing the prototype's biggest sin
- **Postgres 16+ via Supabase** — system of record + rule store + FTS + audit + (optionally) job queue in one engine; RLS gives database-enforced tenant isolation
- **Drizzle ORM 0.45** — 200× smaller bundle than Prisma; schema-as-code in `.ts` makes rule-schema changes PR-reviewable; explicitly **not Prisma**
- **Reducto (primary, $0.015/page after 15K free credits)** — 20% accuracy lead on dense FICO×LTV cell tables vs. LlamaParse / Unstructured / Docling; bbox citations required for the AM three-pane UI; **MEDIUM confidence pending Phase 0 10-matrix acceptance test**
- **Claude Sonnet 4.6 (backup + scenario NL parsing)** — already-integrated vendor relationship; 9.5/10 independent table-extraction benchmark; structured-output mode lands rule object on first pass; warm backup also enables consensus-pass mitigation if Reducto regresses
- **Inngest 4.2** — durable step-function workflows for the multi-pass extraction pipeline; survives Vercel's 60s function ceiling; 50K free runs/mo covers MVP; chosen over Supabase Queues because extraction is a workflow, not a fire-and-forget message
- **json-rules-engine 7.3 OR custom evaluator** — **Phase 0 spike decides**; library v7.3 added prioritized fact resolution at sub-100ms per program; alternative is ~500 LOC custom (the prototype proved that scope). Decision criterion: lower-rule-corruption-blast-radius wins
- **Vercel Pro ($20/seat)** — Hobby is non-commercial and lacks 60s function duration; Pro from day one
- **Sentry + Axiom** — first-class Next.js 16 integration; LLM call traces with token costs; Axiom for log retention beyond Vercel's 1-day window

**Critical version pins:** `next@16.2.x`, `react@19.2`, `node>=20.9`, `drizzle-orm@0.45` (set `prepare: false` for Supabase pooler), `@anthropic-ai/sdk@0.91+`, `zod@4`.

**What NOT to use:** CRA/`react-scripts` (the prototype's substrate), browser-side LLM calls, localStorage for secrets, Prisma (bundle size + DSL tax), MongoDB/DynamoDB (textbook relational workload), Tabula/pdfplumber for matrices, Drools/RETE engines, AWS Step Functions, `middleware.ts` (deprecated → `proxy.ts`), `revalidateTag(tag)` single-arg form (deprecated).

### Expected Features

The 2026 competitive audit confirms all four PRD strategic differentiators, with one narrowed. Detailed analysis in [FEATURES.md](./FEATURES.md).

**Must have (table stakes — LO surface):** borrower scenario form (FICO, LTV, DTI, occupancy, doc type, loan purpose, state, derog history, special flags); eligibility result categorized as Eligible / Conditional (near-miss) / Ineligible; per-row rule details (max LTV/CLTV/HCLTV, max DTI, MI, reserves, derog seasoning) with expandable "why"; comparison view (pin 2-4 programs) + PDF export with disclaimer; saved scenarios + shareable links; sub-2-second P50; Encompass / LendingPad export; state-license + loan-amount filters.

**Must have (table stakes — AM surface):** matrix PDF upload → draft program; three-pane review UI with source PDF + extracted rule object + edit form; bulk-accept above confidence threshold; program lifecycle states (`draft → in review → active → deprecated → sunset`); field-level diff vs. prior `ProgramVersion`.

**Should have (differentiators):**
- **#1 Eligibility-first vendor-curated data model with explicit `layer` field** — survives audit; no incumbent surfaces layer attribution
- **#2 First-class structured derogatory event model** — survives audit; **completely unowned by any 2026 incumbent**
- **#3 AM matrix-PDF extraction with per-field confidence → normalized rule object + three-pane review + lifecycle** — **survives audit; completely unowned**
- **#4 Reframed: explainable structured eligibility with citation + layer attribution** — Polly shipped near-miss; Zeitro shipped Q&A citations; the surviving moat is structured-vs-Q&A combined with layer-attribution-vs-citation-alone

**Defer (Phase 2+):** live pricing; USDA, HFA, second-lien CES/HELOC, construction-to-perm; multi-tenant `LENDER_OVERLAY`; mobile-responsive; Encompass Partner Connect + Byte; borrower-safe shareable presentation pages (Phase 3); AE collaboration (Phase 3); saved-scenario re-run alerting (Phase 3); native mobile (Phase 3 conditional); E&O warranty (Phase 3, Candor-modeled).

**Anti-features (deliberately avoided — strategic):** live rate locking + best-efforts/mandatory delivery; AUS submission; LOS replacement; D2C borrower marketplace; "Pricing Insight"-style cross-lender benchmarking (the exact territory the October 2025 OB antitrust complaint targets); cross-tenant overlay visibility; black-box AI scoring of eligibility (LLM in extraction pipeline only, never online deterministic decisions); real-time AE/scenario chat (Phase 3 only).

### Architecture Approach

A Postgres-centric monolith with thin separation between the synchronous evaluation hot path and the asynchronous extraction pipeline. RLS enforces tenant isolation at the database. Bitemporal versioning (`effective_at` / `expires_at` daterange + `WITHOUT OVERLAPS` exclusion constraints) supports audit-defensibility. Detailed schema and flow diagrams in [ARCHITECTURE.md](./ARCHITECTURE.md).

**Major components:**
1. **Web frontend (Next.js)** — LO search, results, comparison; AM three-pane review (`react-pdf` + bbox overlay); server components for LO views, client components for AM PDF viewer
2. **Pure-TS evaluation engine (`lib/eval/`)** — dependency-free, no I/O; `evaluate(scenario, snapshot) → { decision, rule_stack, deciding_rule, near_miss }`; portable for future extraction into a dedicated service
3. **Centralized rule store (Supabase Postgres)** — canonical `agency_rule_version` (system-owned) + `program_version` (tenant-scoped, FK to agency version) + `program_rule` (with `layer` enum + per-field confidence + citation) + `rule_citation` (page + bbox + excerpt + embedding); cascade is a single trigger on `agency_rule_version` insert that enqueues review jobs
4. **Staging schema for in-flight drafts** — `staging.extraction_run` + `staging.draft_rule` + `staging.draft_rule_field_confidence`; extraction pipeline never writes canonical tables; AM commit promotes staging → canonical in a single transaction
5. **Extraction pipeline (Inngest worker pool)** — durable multi-step: OCR (Reducto with bbox) → structural parse → LLM normalization (Claude with structured output) → overlay diff vs. prior version → per-field confidence scoring; idempotent per step
6. **Append-only `evaluation_event` audit log** — content-addressed `ruleset_snapshot_id` (sha256 of canonical bundle) + full `rule_stack` jsonb + deciding rule; partitioned by month; `REVOKE UPDATE, DELETE ON evaluation_event FROM authenticated` makes tampering structurally impossible
7. **Agency cascade infrastructure** — daily Vercel Cron polls FNMA Selling Guide / FHLMC Bulletins / FHA Mortgagee Letters / VA Circulars; new agency_rule_version → trigger → fan-out review queue per affected program

**Key patterns:** snapshot-based evaluation (read-once, evaluate-many); database-enforced tenancy via RLS with `current_setting('app.tenant_id')` from JWT, `FORCE ROW LEVEL SECURITY`, indexed `tenant_id` on every tenant-scoped table, mandatory CI pen-test suite (`tests/rls/`); bitemporal versioning; rule-citation linkage as first-class table; pre-filter by hard scenario keys (loan type, occupancy, state, FICO floor) before deep evaluation.

**Anti-patterns to avoid:** embedding agency rules per program (cascade becomes unbuildable); application-layer tenant filtering; mutable audit log; extraction pipeline writing canonical tables; synchronous extraction in the request path.

### Critical Pitfalls

Top correctness and operational risks from [PITFALLS.md](./PITFALLS.md). Each has explicit prevention and phase mapping.

1. **Treating derog events as a single boolean / "months since"** — the prototype already does this (`src/App.js:959-962`). Required structured fields per event type: `measurementAnchor`, `baseWaitingMonths`, `extenuatingCircumstancesWaitingMonths`, `postEventCapWindows[]` (with `purposeAllowList` + `occupancyAllowList` + LTV caps), `reEstablishedCreditRequired`, `mortgageIncludedInBkException`. Phase 0 schema work; getting this wrong is a full rewrite. Golden set must exercise each branch.

2. **Missing the post-FC 3-to-7-year 90% LTV / primary-purchase-or-RT-refi window** — single highest-visibility false-positive. A naive "months since FC ≥ 36" returns green for an investment-property purchase at 95% LTV. Schema must allow `activationCondition` referencing the derog state machine; evaluator must process derog events first to compute active windows before evaluating standard rules. **Cash-out refis and second homes are not permitted in the 3-to-7-year band** until the full 7-year clock has run.

3. **FHA Back-to-Work referenced as if it still exists** — **FHA discontinued the Back to Work — Extenuating Circumstances program on 2016-09-30**. The PRD's §4a derog-modeling reference list cites it; **must be removed**. What remains alive is the standard extenuating-circumstances provision (HUD 4000.1) that can reduce BK7 from 2y to 1y. Phase 0 agency-rule encoding must mark Back to Work as DEPRECATED with sunset 2016-09-30; extraction guard rejects rules referencing it from post-2016 source documents.

4. **Non-QM doc-type names hide per-investor calculation-methodology variance** — "12-month bank statement" is a label, not a normalized doc type. Personal vs. business statements, expense factor (50% / CPA-derived / borrower-attest / P&L), comingled accounts, NSF treatment, transfer exclusions all vary materially across AmWest, AD Mortgage, Newrez, Verus, Angel Oak. Schema models bank-statement income as a typed `IncomeDocMethod` per program; result presentation shows per-program qualifying income side-by-side. Same pattern for DSCR (`DscrMethod`). **This is the non-QM wedge feature; missing it returns the product to "another agency-rooted PPE that pretends to handle non-QM."**

5. **October 2025 Optimal Blue antitrust class action makes strict tenant isolation existential** — `Smith et al. v. Optimal Blue, LLC et al.` (M.D. Tenn., Oct 3 2025) alleges Pricing Insight enables price-fixing data exchange. Tenant isolation must be at the database (RLS), not the application — defense in depth + auditability + regulator/litigant posture. CI pen-test suite is the antitrust insurance policy.

6. **LLM citation discipline must be a hard schema constraint, not soft validation** — schema-level: rules without `sourceCitation` cannot persist (database constraint, not application validation). Server-side post-extraction validation: `textSpan` must actually appear in the cited PDF page at the specified bbox. Hallucinated rules with high confidence are the highest-stakes extraction failure.

7. **Golden-set self-selection bias is the existential Phase 0 risk** — if the developer writes scenarios + evaluator + expected outcomes, the set is biased to what the evaluator already handles. Mitigation: ≥1 paid external expert reviewer (senior underwriter); scenario sourcing 50% from real anonymized broker-shop LO outreach + 25% from incumbent public examples + 25% from constructed adversarial cases; expected outcomes lock with citation to FNMA Selling Guide / lender matrix / Mortgagee Letter (not to the evaluator); evaluator must agree with expected rule, not just expected verdict.

**Other high-impact pitfalls (full list in PITFALLS.md):** measurement-anchor confusion (1.3); multi-filing 5y rule collapsed to single-filing 4y (1.5); mortgage-included-in-BK exception (1.6); VA entitlement / USDA per-property eligibility (1.7); FICO mid-score multi-borrower rule (1.10); condo project review state (1.11, especially FL post-Surfside); FHFA county-by-county high-balance limits (1.12); MI provider tier overlays (1.13); manual UW paths (1.14); post-COVID forbearance (1.15); FICO×LTV grid extraction loses cell→value alignment (2.1); footnotes lose anchor to cell they modify (2.2); layout drift across versions (2.3); OCR misreads on scanned matrices (2.4); multi-program PDF cross-program contamination (2.5); conflicting tables (2.7); lender data licensing not negotiated up front (3.3); stale agency Selling Guide cascade (3.4); broker-channel vs. retail-LO vs. wholesale-AE conflation (3.6); AUS scope creep (3.7); UI before schema (4.1); premature optimization (4.2); rebuilding prototype mistakes (4.5); AM UI underestimated (4.6).

## Implications for Roadmap

The roadmap is heavily constrained by PROJECT.md's existing phase structure. Research strongly reinforces that structure with concrete sub-phase shape inside Phase 0 and Phase 1, plus several non-negotiable gates and one explicit reframing of Differentiator #4.

### Phase 0: Schema, Engine, Golden Set (Foundation, No UI)

**Rationale:** PRD's existing decision; research validates exhaustively. Eligibility precision is the wedge; without a measurable golden set there's no way to claim correctness. Schema mistakes here cascade through every later phase. The 200-scenario golden set is the exit gate, not a calendar date.

**Delivers:**
- Postgres schema migrations (`tenant`, `agency_rule_version`, `agency_rule`, `program_version`, `program_rule`, `rule_citation`, `lender_overlay_rule`, `evaluation_event`, `staging.*`)
- RLS policies on every tenant-scoped table + CI pen-test suite blocking merge on cross-tenant leak
- Hand-authored agency-base rule seed: FNMA, FHLMC, FHA, VA (USDA deferred to Phase 2)
- Pure-TS evaluation engine (`lib/eval/`) with structured derog-event matrix evaluator (full FNMA-style waiting periods, post-event LTV cap windows, re-establishment criteria, mortgage-included-in-BK)
- Snapshot hydration query + content-addressed `ruleset_snapshot_id` hashing
- 200-scenario golden set with ≥1 external expert reviewer; 50% real LO outreach + 25% incumbent samples + 25% adversarial; expected outcomes cite Selling Guide / matrix / Mortgagee Letter
- Audit log emit (`writeEvaluationEvent`)
- ToS draft + audit-trail data model (liability framing)
- Lender-license contract template + `license_id` requirement on `program_version`

**Phase 0 exit gates (KPI-driven, not calendar):** golden set ≥98% precision / ≥95% recall against expert-reviewed expected outcomes; all RLS pen tests pass; Reducto Phase 0 acceptance test passes (≥95% cell accuracy on 10 representative non-QM matrices) OR consensus-pass mitigation documented; FHA Back-to-Work removed from PRD §4a; brand collision documented and rename decision flagged.

### Phase 1: MVP — LO Search + AM Onboarding (Wholesale-Broker Channel, Non-QM-Weighted)

**Rationale:** PRD-defined; research validates. Wholesale-broker channel + non-QM-weighted is where incumbents are weakest. This is the sharpest wedge with the smallest viable surface.

**Delivers:**
- Next.js app skeleton + Supabase Auth + tenant JWT claim + `withTenantContext` propagation
- LO scenario form covering borrower, loan, property, ratios, doc type, derog history, special flags
- Eligibility result split (Eligible / Conditional / Ineligible) with deciding rule + layer + full rule stack
- Near-miss min-edit-distance fix per ineligible (FICO delta, LTV delta, DTI delta, doc-type swap, seasoning months remaining)
- Result row with max LTV/CLTV/HCLTV, max DTI, MI, reserves, derog seasoning + expandable "why" with rule citations
- Comparison view (pin up to 4 programs) + PDF export with disclaimer
- Saved scenarios + shareable link with optional borrower-safe view + stale-scenario tagging
- Encompass + LendingPad export (FNM 3.2 / MISMO 3.4)
- Decision-support disclaimer prominent on every result, every PDF export, every shareable link
- Confidence badge on result rows when deciding rule has confidence < 0.90
- AM upload → Inngest pipeline (Reducto OCR with bbox → structural → LLM normalization with structured output → overlay diff → per-field confidence) → `staging.draft_rule`
- AM three-pane review UI (`react-pdf` + bbox overlay + edit form) with confidence-sorted queue
- Bulk-accept above threshold (server-side textSpan validation must pass)
- Program lifecycle states + version-control with effective-date bracketing + field-level diff
- Agency cascade infrastructure (daily Vercel Cron + trigger on `agency_rule_version` insert + per-affected-program review queue)
- 50 programs indexed (≥60% non-QM)
- Tightest-MI-overlay heuristic (Phase 1 shortcut)

**Phase 1 exit gates (KPI-driven, not calendar):** precision ≥98%; recall ≥95%; AM onboarding ≤45 min standard non-QM matrix and ≤15 min delta on existing program; AM correction rate <10% by month 6; P50 ≤2s, P95 ≤5s; 50 programs with ≥60% non-QM; brand renamed before any external GTM.

### Phase 2: Coverage + Pricing

**Rationale:** PRD-defined. Adding pricing to an unproven eligibility tool compounds two unfamiliar product risks; eligibility wedge must be measured first. Live pricing requires negotiated lender data-licensing terms.

**Delivers:** USDA agency rules; HFA, second-lien CES/HELOC, construction-to-perm; pricing data plane (new `pricing_feed` + `pricing_quote` tables; separate ingest pipeline behind opt-in lender consent); multi-tenant `LENDER_OVERLAY` UI for retail and brokerage; USDA per-address property-eligibility lookup + FNMA Condo Project Manager API integration; mobile-responsive scenario flow; Encompass Partner Connect + Byte integrations; per-MI-provider overlay matching; conditional extraction of evaluation engine into a dedicated service if Vercel cold starts blow latency budget.

**Phase 2 exit gates:** 250 programs indexed; precision ≥98% sustained; lender data-licensing terms negotiated; ≥5 pilot brokerages with overlay needs validated.

### Phase 3: Workflow + Intelligence (Year 2+)

**Rationale:** PRD-defined. Second-order capabilities depending on Phase 1/2 maturity.

**Delivers:** borrower-safe shareable scenario landing pages; AE collaboration (LoanNEX-style two-way messaging); saved-scenario re-run alerting when an indexed program changes a rule that affects the saved scenario; native iOS/Android (only if mobile usage data shows ≥40% scenario-discovery on mobile); optional E&O warranty product (Candor-modeled, AAA-rated insurer).

**Phase 3 exit gates:** precision ≥99.5% sustained; 1,000 programs indexed; insurance partner identified.

### Research Flags

Phases likely needing deeper research during planning (`/gsd-research-phase`):

- **Phase 0:** Reducto 10-non-QM-matrix acceptance test; rule-engine library spike (json-rules-engine v7.3 vs. ~500-LOC custom); golden-set sourcing (real LO outreach plan + paid external expert reviewer)
- **Phase 1:** OCR engine fallback selection if Reducto's bundled OCR insufficient; LLM prompt engineering for citation discipline + footnote anchoring + multi-program PDF segmentation
- **Phase 1→2:** lender data-licensing model + antitrust review before scope-locking pricing
- **Phase 2:** USDA Eligibility Map API integration + cache TTL; FNMA Condo Project Manager API access patterns
- **Phase 3:** mobile go/no-go usage trigger; E&O insurance carrier partnership

Lower-priority standard patterns: Phase 1 Encompass/LendingPad export; Phase 1 Comparison view + PDF export; Phase 1 Saved scenarios; Phase 2 mobile-responsive.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified against npm registry as of 2026-04-29; one MEDIUM-confidence vendor pick (Reducto) gated behind Phase 0 acceptance test |
| Features | HIGH | Cross-validated against 2026 vendor product pages, press, and industry coverage; one MEDIUM-confidence claim flagged (exact shape of OB Originator Assistant's "ineligibility reason" output) |
| Architecture | HIGH | Postgres + RLS + async extraction queue is well-trodden in regulated SaaS; bitemporal versioning is standard; in-process evaluation at MVP, extract at Phase 2 if latency demands |
| Pitfalls | HIGH | Agency derog rules verified against current FNMA/FHLMC Selling Guides; OB antitrust posture verified via legal-press coverage; PDF/LLM extraction failure modes verified across multiple primary sources; MEDIUM confidence on per-investor non-QM specifics |

**Overall confidence:** HIGH

### Gaps to Address

- **Reducto vendor commit (HIGH stakes):** Phase 0 acceptance test against 10 representative non-QM matrices required before vendor lock. If <95% cell accuracy, escalate to consensus pass (Reducto + Claude vision) at +~$0.05/PDF cost.
- **Brand rename:** Scotsman Guide owns "Lender Search" at lendersearch.com since March 2023. Rename before any external GTM; not blocking for internal Phase 0 / Phase 1 work.
- **PRD §4a derog references mention FHA Back-to-Work as if active:** must be removed. FHA discontinued the program 2016-09-30. Encode Back to Work as DEPRECATED-2016-09-30 in agency rules; add extraction-pipeline guard for post-2016 source documents.
- **Differentiator #4 reframing:** "explainable structured eligibility with citation + layer attribution" — distinguishing structured rules-engine output from copilot Q&A and citation+layer from citation alone.
- **GTM persona deferred:** Phase 0 schema accommodates `tenant.kind` as `BROKERAGE | RETAIL_LENDER | WHOLESALE_LENDER`. Phase 1 ships broker-channel only.
- **Liability posture concretization:** "decision-support, not credit decision" disclaimer concretized as Phase 1 feature; ToS draft + audit-trail data model in Phase 0.
- **Lender data licensing:** Phase 0 contract template, Phase 1 AM workflow gate (license confirmation before AM review of matrix), Phase 2 negotiated terms.
- **Antitrust posture lifted from constraint to first-class architectural commitment:** strict tenant isolation + no cross-tenant pricing surface explicit in ARCHITECTURE.md.

### Cross-stream Conflicts Surfaced

1. **PRD vs. FEATURES on Differentiator #4** — PRD frames it as "explainable ranking and near-miss with rule citations"; FEATURES narrows to "structured eligibility with citation + layer attribution" because Polly and Zeitro shipped competing pieces. Roadmap should treat #4 as a structural sub-property of the rule schema, not a standalone UI feature.

2. **STACK MEDIUM confidence on Reducto vs. PITFALLS HIGH-stakes extraction risk** — not contradictory, but a load-bearing dependency. Phase 0 acceptance test (10 non-QM matrices, ≥95% cell accuracy) is the gate; consensus pass with Claude vision is the documented escalation.

3. **PRD §4a vs. PITFALLS 1.4 on FHA Back-to-Work** — direct contradiction. FHA discontinued the program 2016-09-30; PRD references it as if active. Must remove during Phase 0.

4. **PRD says "rebuild from scratch" but `src/App.js:959-962` is the concrete embodiment of Pitfall 1.1** — research validates the rebuild decision and warns: the prototype is a reference for visual layout and form-field intent, not for data shape or rule logic.

5. **Architectural commitment vs. PRD constraint framing on antitrust posture** — PRD treats strict tenant isolation as a constraint; PITFALLS + ARCHITECTURE recommend lifting it to a first-class architectural commitment after Oct 2025 OB action.

## Sources

### Primary (HIGH confidence)

**Stack and architecture:**
- Next.js 16 release notes — https://nextjs.org/blog/next-16
- Claude Models Overview (Sonnet 4.6 pricing, vision, 1M context) — https://platform.claude.com/docs/en/about-claude/models/overview
- Reducto pricing + Document Parser Comparison — https://reducto.ai/pricing, https://llms.reducto.ai/document-parser-comparison
- Supabase RLS multi-tenant best practices + custom-access-token hook
- AWS multi-tenant data isolation with PostgreSQL RLS
- Drizzle vs Prisma 2026 comparison
- Inngest pricing + Trigger.dev comparison
- npm registry (April 2026): `next@16.2.4`, `@anthropic-ai/sdk@0.91.1`, `drizzle-orm@0.45.2`, `@supabase/supabase-js@2.105.1`, `inngest@4.2.6`, `zod@4.4.1`, `json-rules-engine@7.3.1`

**Mortgage agency rules and derog modeling:**
- FNMA Selling Guide B3-5.3-07 (significant derogatory credit events)
- FNMA Selling Guide B3-5.1-01 (FICO methodology), B4-2.2-01/02 (condo review), B2-1.3-03 (cash-out)
- Freddie Mac Single-Family Seller/Servicer Guide §5202.5
- FHFA 2026 Conforming Loan Limit Values
- HUD 4000.1 / VA Pamphlet 26-7

**Antitrust and liability posture:**
- Optimal Blue Antitrust Litigation (Oct 3, 2025 filing) — HousingWire, National Mortgage News, MLex
- DLA Piper antitrust+AI brief (Nov 2025)

**Competitive landscape:**
- Polly/AI product page + non-QM blog + LO mobile + AI announcement
- Optimal Blue Originator Assistant launch + 2026 Summit announcement
- LoanNEX Qualifier
- LoanPASS HousingWire 2026 Tech 100 Award
- Zeitro Scenario AI / Strata AI rebrand (March 2026)
- Lender Toolkit Guideline Agent (Toolshed)
- Candor Technology next-gen UX (April 2026) + FHA warranty
- ARIVE platform overview + wholesale lender marketplace

**Brand collision:**
- Scotsman Guide LenderSearch.com + March 2023 launch announcement

### Secondary (MEDIUM-HIGH confidence)

- json-rules-engine 7.x GitHub + npm trends
- Postgres temporal extensions wiki + OneUptime audit-trails-with-triggers (Jan 2026)
- Sensible.so three-pane PDF review pattern
- HealthEdge OCR Pipeline Architecture
- arXiv RAG hallucination mitigation + FACTUM citation hallucination detection
- Maxim AI / Sigma AI golden dataset best practices
- Mortgage IDP landscape (DocVu, Infrrd, Paradatec, MortgageOCR.com, Landing.AI)
- Per-investor non-QM specifics (Newrez SmartEdge, AmWest, AD Mortgage, Verus, Angel Oak)

### Internal references

- `.planning/PROJECT.md` — KPIs, scope, key decisions
- `.planning/codebase/ARCHITECTURE.md` + `.planning/codebase/CONCERNS.md` — concrete examples of pitfalls (`src/App.js:959-962` is Pitfall 1.1 in code)
- `.planning/research/STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md` — full research outputs

---
*Research completed: 2026-04-29*
*Ready for roadmap: yes*
