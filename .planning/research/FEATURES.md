# Feature Research

**Domain:** US residential mortgage origination — eligibility-first lender/program search for loan officers + AM program-onboarding workflow
**Researched:** 2026-04-29
**Confidence:** HIGH (cross-validated against 2026 vendor releases, press, and product pages for OB, Polly, LoanPASS, LoanNEX, Zeitro, Candor, Lender Toolkit, ARIVE; one MEDIUM-confidence claim flagged below)

## Important Naming Conflict

**Scotsman Guide already operates a product called "Lender Search" at lendersearch.com** (launched March 2023). It is a marketing-style **directory** of wholesale lenders filterable by loan amount, occupancy, credit, location — *not* an eligibility/rule engine, no derog modeling, no PDF extraction, no per-program rule citations. Brand collision is a real problem; rename the product before any external GTM activity. The capability gap from the Scotsman tool is enormous, but the SEO/word-of-mouth confusion is not. Flag for `/gsd-transition` at the end of Phase 0.

## Executive Summary of Competitive Landscape (2026-current)

The named PPE incumbents have moved meaningfully since the PRD competitive landscape was drafted. Three updates matter:

1. **Polly/AI shipped explicit "near-miss" detection** ("suggested actions" feature, GA in early 2025, refined through 2026) — Polly now claims to surface what an LO can change to make a deal eligible, including FICO/LTV deltas. This **partially closes** Differentiator #4 (explainable ranking with near-miss). Polly's published positioning still does not claim explicit per-rule citations or modeling of multi-filing BK windows or post-foreclosure LTV cap windows.
2. **Optimal Blue Originator Assistant** (GA via 2025-2026) is positioned as a *pricing* recommender — it surfaces alternate scenarios with better pricing and detects pricing breakpoints. Public messaging says ineligible products "display a reason for ineligibility" but does not claim citation back to source guideline text. Differentiator #1 (eligibility-first vs. pricing-first) holds, but is now narrower than when the PRD was written.
3. **Zeitro Strata AI** (rebrand of Scenario AI as of March 2026) **does provide explicit guideline citations** (link to source rule text) for guideline Q&A across 100+ investors / 300+ guidelines. This is a real new entrant that materially overlaps the explainability claim. Zeitro is, however, a **Q&A copilot**, not a structured rules engine — it does not produce a normalized rule object an AM has reviewed and approved, and its outputs are not deterministic across runs.

What no incumbent has shipped in 2026:
- Vendor-curated, **structured derogatory event model** with explicit measurement-anchor / waiting-month / extenuating-circumstance / post-event LTV cap window / re-established-credit / mortgage-included-in-BK fields. Polly, LoanNEX, and LoanPASS allow lenders to *configure* derog rules but treat them as another configurable rule type, not a first-class domain model. Polly's own non-QM blog acknowledges the range ("two to seven years or even longer") without claiming Polly's PPE models the full matrix.
- **AI-native AM onboarding pipeline** with per-field confidence scores, three-pane review UI, and "bulk-accept above threshold" workflow over a normalized rule schema. LoanNEX uses vendor analysts to manually build programs; Lender Toolkit Guideline Agent is a Q&A surface over already-configured guidelines (it does not turn matrix PDFs into structured rule objects); Candor extracts loan-file documents, not lender matrix PDFs.
- **Explicit overlay layering** (`AGENCY_BASE` / `INVESTOR_OVERLAY` / `PRODUCT_FEATURE` / `LENDER_OVERLAY`) with "most restrictive wins" conflict resolution surfaced to the LO. Incumbents flatten overlays into a single rule set per program.

The four PRD differentiators all survive the 2026 audit, but #4 (explainable ranking with rule citations) has narrowed — Polly does near-miss, Zeitro does citations. The defensible wedge is the **combination**: structured derog model + AM-confirmed rules + per-rule citation + overlay layer attribution, all in one decision-support output.

## Feature Landscape

### Table Stakes (Users Expect These)

#### Loan Officer (LO) Surface

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Borrower scenario form (FICO, LTV, DTI, occupancy, property type, doc type, loan purpose, state, derog history, special flags) | Universal across PPEs; LOs already know the input shape from OB / LoanSifter / Polly | M | Existing prototype's `scenario` object is the right shape; PRD §4a is comprehensive. Watch for non-QM-specific inputs (12/24-month bank stmt, P&L, asset depletion, DSCR ratio, foreign national flag, ITIN, recent derog tier) |
| Eligibility result split: Eligible / Conditional (near-miss) / Ineligible | Every modern PPE shows eligible/ineligible; users expect categorical output, not a scored list | M | Prototype's `evaluateProgram` returns matched/fails/warnings/passes — the right structure, just needs the near-miss tier formalized |
| Per-row rule details: max LTV/CLTV/HCLTV, max DTI, MI requirement, reserves, derog seasoning, pricing if in scope | LOs scan rows for the deciding rule; collapsed rows force them back to a matrix PDF | M | Already in prototype's expandable card pattern; refine for non-QM fields |
| Comparison view: pin 2–4 programs side-by-side | Polly, LoanPASS, LoanNEX all support this; LOs use it for the borrower presentation conversation | S–M | LoanPASS LoanCOMPASS pattern is well-known; do PDF export with disclaimer at MVP |
| Saved scenarios per LO | Every PPE saves; LOs return to scenarios over multi-day sales cycles | S | Server-persisted (not localStorage) — multi-device is table stakes |
| Sub-2-second P50 response time | Incumbents publish sub-second; lag erodes trust and pushes LOs back to spreadsheets | M | Achievable with indexed rules + materialized eligibility computation; not free though |
| Encompass / LendingPad export (FNM 3.2 or MISMO 3.4) | The mortgage industry's universal handoff format; LOs will not adopt a tool that creates rekey work | M | Encompass MISMO 3.4 export is documented; Zeitro and ARIVE both ship it. LendingPad has its own JSON. Both are required for broker channel |
| State / license filtering | LO can't quote a program that isn't licensed in the property state | S | Already in prototype |
| Loan-amount and conforming-limit filtering | Conforming vs. high-balance vs. jumbo determines program set; getting this wrong invalidates results | S | Already in prototype; needs FHFA limit table refresh per year |
| Result row pricing if in scope | Polly, OB, LoanPASS all show note rate and points on the row; absent pricing, LOs go elsewhere for pricing decisions | XL (Phase 2) | Eligibility-only at MVP per PRD is defensible *only* if the eligibility wedge is real. Phase 2 must add this or churn risk to incumbents on commodity scenarios |

#### Account Manager (AM) Surface

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Upload a matrix PDF and create a draft program | Without this, AM is rekeying matrix to web form — LoanNEX charges customers extra for analyst-built programs explicitly because the input is painful | M | OCR + multi-pass LLM extraction; existing OSS like Landing.AI, Sensible, Paradatec for the OCR/extraction layer |
| Edit an extracted rule object | First-pass extraction will not be perfect; AM must be able to fix per-field values | M | Form per rule type (FICO, LTV, DTI, derog, doc, overlay); edits create audit entries |
| Persist program drafts; commit to active | Without staging, every edit is live — unsafe for production catalog | S | `draft → in review → active → deprecated → sunset` lifecycle from PRD §4 is the right model |
| See source PDF page next to extracted rule | AM must be able to verify against the document — without this, AM trust collapses | M | Sensible.so style three-pane layout; PDF.js viewer + bbox highlight |
| Diff a new matrix version against existing program | AMs do not want to re-enter the entire program when a lender pushes a guideline update; only changed rules need review | M | Effective-date bracketing per `ProgramVersion`; field-level diff |
| Bulk-accept high-confidence fields | Without bulk accept, every program review requires per-field clicking and AM time-per-program target (45 min) is impossible | S–M | Threshold-driven (e.g., ≥95% confidence auto-accepts on uncontested fields) |

### Differentiators (Competitive Advantage)

#### Strategic Differentiator #1 — Eligibility-first, vendor-curated data model

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Explicit `layer` field on every rule (`AGENCY_BASE` / `INVESTOR_OVERLAY` / `PRODUCT_FEATURE` / `LENDER_OVERLAY`) | LO sees *which layer* fired the disqualifier; OB / Polly / Mortech / LoanSifter / EPPS all flatten overlays into a single rule set | M | This is the schema decision in Phase 0. Wrong here means re-platform later. **Differentiates from:** all PPEs in the secondary-marketing tradition (eligibility downstream of pricing, overlays opaque). LoanNEX comes closest but does not surface layer attribution to LOs |
| Most-restrictive-wins conflict resolution surfaced to user | LOs currently call AEs to confirm overlays — disclosing which overlay/lender narrowed the rule eliminates the AE call | S–M (after schema) | Conflict resolution is mechanical once layers are well-typed; UX is the work |
| Vendor-curated agency rule sets (FNMA, FHLMC, FHA, VA) shared across all programs | Lenders maintain agency overlay deltas only, not full rule sets — drives onboarding time down (PRD KPI: 45 min for new program) | L | Initial encoding is real work; ongoing agency cascade is a system-level review queue |
| Agency-rule cascade: agency version bump creates review queue across all dependent programs | Selling Guide changes today cascade through investor matrices with no automated detection — LOs run stale rules without knowing it | M | Versioned agency ruleset; programs reference an agency version; bump triggers prioritized AM review |

**Why this differentiator survives 2026 audit (HIGH confidence):** OB, Polly, Mortech, LoanSifter, EPPS, LoanPASS, LenderPrice all expose configurable eligibility rules per program but do not surface the layer that fired. LoanPASS markets configurable "investor-specific overlays" but the configuration is per-tenant lender, not a normalized cross-tenant data model. LoanNEX is the only PPE with non-QM eligibility as a first-class concern, but its programs are vendor-analyst-built and overlay layering is not surfaced. **Sources:** Polly product page, OB Originator Assistant press, LoanPASS non-QM page, LoanNEX product page (all referenced below).

#### Strategic Differentiator #2 — First-class derogatory event modeling

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Structured derog event types: BK7, BK13 discharged, BK13 dismissed, multi-filing, foreclosure, DIL, short sale, mortgage charge-off, modification, forbearance | Today every PPE reduces this to a few booleans + a numeric waiting period. The compound cases (mortgage included in BK7, BK13 with foreclosure during plan, multi-filing, foreclosure-after-modification) are where LOs lose deals because of bad guesses | L | Phase 0 schema work. Source: FNMA Selling Guide B3-5.3-07, FHA 4000.1, VA Lenders Handbook, FHLMC Single-Family Seller/Servicer Guide |
| Per event type: measurement anchor, base waiting months, extenuating-circumstances waiting months | FNMA reduced post-BK from 4y to 2y with extenuating circumstances — the calculation is conditional. Most PPEs hardcode the base case only | M (after schema) | Anchor matters: FNMA measures from discharge date for BK; from completion date for foreclosure. Different anchors change ineligibility outcome at the date margin |
| Post-event LTV cap windows (e.g., FNMA 3-7y post-foreclosure: max 90% LTV, primary residence only, no cash-out) | Critical case where borrower is technically past the waiting period but the program still imposes restrictions. Today this is buried in matrix prose; LOs miss it | M | Encoded as a conditional max-LTV rule keyed off seasoning months |
| Re-established credit requirements (e.g., no late >30d on housing in past 12 months post-event, minimum tradeline count, no new derog) | The "you waited but you didn't re-establish" case is a borrower disqualifier today that PPEs miss because they only check the seasoning math | M | Schema: structured re-establishment criteria object, evaluator runs against scenario credit profile |
| Mortgage-included-in-BK rule (4y from discharge per FNMA, regardless of foreclosure date) | Compound case where BK and foreclosure both happen — most PPEs use whichever waiting period is shorter; FNMA uses BK discharge date. Wrong answer here is a credit pull on a borrower who can't qualify | S–M (after schema) | Specific rule type with explicit anchor; encoded once, applies everywhere |

**Why this differentiator survives 2026 audit (HIGH confidence):** Polly's own non-QM blog (cited below) acknowledges the range ("two to seven years or even longer") without claiming Polly's PPE models the full matrix. Polly's "suggested actions" feature can compute "wait N months" for the simple seasoning case but the public messaging does not address multi-filing, post-event LTV cap windows, or mortgage-included-in-BK. Optimal Blue Originator Assistant is positioned as a pricing recommender, not a derog reasoner. LoanNEX models non-QM derog tiers per program-as-configured but does not normalize them into a shared cross-program model. Zeitro answers derog questions via Q&A with citation back to the lender's matrix but produces non-deterministic answers, not structured eligibility. **Net: no incumbent ships a normalized derog event model with measurement anchor + waiting month + extenuating + LTV cap window + re-established credit + multi-filing all as first-class fields.**

#### Strategic Differentiator #3 — AM document-extraction onboarding with confidence scoring → normalized rule object

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| OCR + multi-pass LLM extraction over matrix PDF (structural pass → rule normalization pass → overlay detection pass → confidence scoring pass) | Turn a 30-page matrix PDF into a normalized rule object in one upload. LoanNEX's vendor-analyst model is the existing baseline; vendor analyst ≈ days, this should be ≈45 minutes including AM review | XL | Sequential LLM passes with structured outputs. Tools: Claude/GPT-4 with JSON schema mode; Sensible.so / Landing.AI / Paradatec for the OCR coordinate-grounding layer if needed |
| Per-field confidence score persisted on every extracted rule | Without per-field confidence, AM cannot prioritize review and downstream LO cannot be warned about uncertain rules | M | Per-field, not per-document. Computed from LLM logits + OCR confidence + cross-pass agreement |
| AM three-pane review UI: PDF source with citation highlight ↔ extracted rule object ↔ edit form | Reviewer cannot trust extraction without seeing the source. Sensible.so pattern is well-validated for this | M | PDF.js viewer + bbox overlay; click rule → highlight source span. Table-stakes in document AI tooling |
| Confidence-sorted review queue + bulk-accept above threshold | Drives AM time-per-program down; PRD KPI is ≤45 min | S–M | Sortable queue; checkbox bulk-accept on a confidence threshold per field type |
| Per-`ProgramVersion` source-document fingerprint and `effective_date` for auditability | Required for "which rule fired at scenario time" audit trail under decision-support liability posture | S | Hash + effective_date bracketing per ProgramVersion |
| Stale-scenario tagging when underlying program version changes | LOs return to saved scenarios days/weeks later; if the rule that decided eligibility changed, the scenario is stale and should be re-run | S–M | Triggered by ProgramVersion commit; saved scenarios index by referenced ProgramVersion |
| Confidence badge surfaced on result rows when deciding rule has confidence < threshold | "AM has not confirmed this rule — verify with lender" — explicit liability posture, addresses PRD §8 disclaimer model | S | Already in PRD §4 active list; UI work only |

**Why this differentiator survives 2026 audit (HIGH confidence):** **No incumbent has this loop.** Polly/AI is configurable per-lender but lenders push their own data; Polly does not extract from PDFs and turn them into rules. LoanNEX builds programs via vendor analysts, not extraction. Lender Toolkit Guideline Agent is a Q&A surface over already-configured lender guidelines (Toolshed); it does not produce a normalized rule object an AM reviews. Candor Technology runs underwriting on loan files (W2s, paystubs, asset statements) — not lender matrix PDFs. Zeitro Strata AI ingests ~300 lender guidelines but the output is Q&A with citation, not structured rules with per-field confidence. Generic mortgage IDP vendors (Paradatec, DocVu, Infrrd, MortgageOCR.com, Ocrolus) extract loan-file documents, not lender program matrices, and they don't produce a deterministic rules engine target schema. **The combination of "matrix PDF in → normalized rule object out with per-field confidence + three-pane AM review + draft/active/deprecated lifecycle + program version diff" is unowned in 2026.**

#### Strategic Differentiator #4 — Explainable ranking and near-miss with rule citations

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Near-miss surface: minimum-edit-distance fix per ineligible program (FICO delta, LTV delta, DTI delta, doc-type swap, seasoning months remaining) | Polly shipped this in 2024-2025 ("suggested actions"); OB shipped pricing-breakpoint version. Differentiation here is on **structural fixes** (doc-type swap, seasoning) not just pricing/numeric tweaks | M | Per ineligible program: search the rule space for the smallest scenario change that flips eligible. Combinatorial but bounded |
| Per-rule citation back to source matrix page + bbox | Zeitro shipped this for Q&A in 2026; nobody else has shipped it for structured eligibility output | S–M (given AM extraction stores citation) | Citation is a side effect of extraction step's source highlighting; just need to plumb through to result UI |
| Layer attribution on the deciding rule ("max LTV 80% from PennyMac investor overlay over FNMA base of 95%") | LoanNEX surfaces the program-level overlay; nobody surfaces the layer that fired. This is the explainability moat | S–M (after layered schema) | Just need result object to carry layer + source on the deciding rule |
| Borrower-safe shareable scenario view (no LO comp, no overlay tags, decision-support framing) | Differentiates from D2C borrower marketplaces (Own Up, Credible) and from incumbent borrower portals (which are co-branded LO landing pages, not scenario presentations) | M | Tokenized URL; field-level redaction policy; rendered server-side |

**Why this differentiator partially-survives 2026 audit (MEDIUM-HIGH confidence):**
- **Near-miss alone is now competitive, not differentiating.** Polly/AI's "suggested actions" (May 2024 launch, refined through 2026) does FICO/LTV deltas and rate-improvement recommendations. OB's Originator Assistant detects pricing breakpoints. The pure near-miss claim has caught up.
- **Citations alone are now competitive, not differentiating.** Zeitro Strata AI (March 2026) provides explicit guideline citations with link-to-source. Lender Toolkit Guideline Agent (live as of 2026) provides "responses with supporting sources and references."
- **The combination — near-miss + per-rule citation + layer attribution + borrower-safe view — is unowned.** Polly does not cite; Zeitro does not give structured eligibility output and does not do layer attribution; nobody does borrower-safe presentation. This is the surviving differentiator.

**Action:** Reframe Differentiator #4 in the roadmap as "**explainable structured eligibility with citation + layer attribution**" — distinguishing structured rules-engine output from Q&A copilot output, and citation+layer from citation alone. Polly's near-miss now narrows the gap; the structural moat is the underlying rule schema, not the near-miss UI feature.

### Anti-Features (Deliberately Avoided — Strategic Reason)

| Feature | Why Tempting | Why We Don't Build | Strategic Reason |
|---------|--------------|---------------------|------------------|
| **Live rate locking + best-efforts/mandatory delivery** | OB / Polly territory — direct revenue per lock, embeds the tool in the workflow | Rate-lock execution is a regulated act tied to lender-broker capital markets agreements; the tooling, audit, surveillance, and delivery integrations are an order-of-magnitude scope | Sidesteps OB's category. Eligibility-first means we end at the eligibility decision; pricing/lock is a downstream tool |
| **AUS submission (DU / LPA / GUS)** | LO would love a "submit to DU" button | DU/LPA require seller-servicer credentials and are governed by Fannie/Freddie API agreements; Encompass / LOS already handles this | We accept AUS outcome as scenario *input*, never as output. Stay decision-support |
| **LOS replacement (compete with Encompass / Byte / LendingPad)** | The PRD §4 export integration would be smoother if we owned the LOS surface | LOS is a 5-year build minimum, regulated workflow tooling, deeply embedded in ops | Integrate, don't replace. Phase 1 ships Encompass + LendingPad export; Phase 2 adds Byte and Encompass Partner Connect |
| **D2C borrower marketplace (Own Up / Credible style)** | The shareable scenario URL is half a step from a consumer product | Borrower-facing marketplaces are a fundamentally different GTM (paid acquisition, RESPA-sensitive lender disclosures, consumer protection scrutiny). The shareable view is a presentation surface for an LO-driven scenario, not a self-serve borrower flow | Stays in B2B2C; shareable view is *borrower-safe presentation*, not borrower self-service |
| **Hedging, MSR valuation, secondary-market analytics** | Adjacent capital-markets tooling, OB ships these | Out of scope; capital-markets tooling is a different buyer (Treasurer / capital markets desk) and a different scope | v1 and v2 stay in the LO/AM workflow lane |
| **"Pricing Insight"-style cross-lender benchmarking** | Surface that's natural once we have multi-lender pricing | This is exactly the territory the **October 2025 OB antitrust class action** targets (US District Court for the Middle District of Tennessee, alleging Pricing Insight enables price-fixing data exchange among 26 mortgage lenders). Plaintiffs cite economist analysis showing 49.2% wider rate spreads on OB-user originations 2020-2024 | Strict tenant isolation; lender pricing visible only to the originating tenant. Zero cross-tenant pricing comparison surface |
| **Cross-tenant overlay visibility** | Brokerages might want to see what other brokerages' overlays look like | Same antitrust adjacency as Pricing Insight; competitor data exposure | `LENDER_OVERLAY` strictly scoped to the originating tenant from day one |
| **Guideline interpretation as legal/compliance advice** | "Is this loan FHA-eligible?" feels like a question to answer definitively | Underwriting is the lender's responsibility; we provide decision-support output, not credit decisions | Every result carries decision-support disclaimer; audit trail of which rule fired at scenario time; ToS liability cap; E&O insurance is a forward path (Phase 3+, Candor model) |
| **Native iOS/Android app at MVP** | Polly shipped mobile in May 2025; LOs use mobile for quick refreshes | Mobile is a "quote refresh" surface, not a "scenario discovery" surface; responsive web is enough until usage data forces a native build | Phase 3 only if usage data shows mobile-first scenario discovery |
| **Live pricing at MVP** | LOs eventually need rate + points + APR on the row | At launch we have not earned the lender data-licensing relationships nor proven the eligibility wedge. Adding pricing to an unproven eligibility tool is two unfamiliar product risks compounded | Phase 2 only, opt-in lender-by-lender. Eligibility-only at MVP keeps lender data-licensing exposure narrow until eligibility wedge is proven and measured |
| **USDA, HFA, construction-to-perm, second-lien CES/HELOC at MVP** | Coverage is a procurement criterion | Adds rule-encoding work that doesn't sharpen the wedge. Wholesale broker non-QM is the sharpest entry | Phase 2; LoanNEX recently expanded into CES and HELOC, validating the order |
| **"Black-box" AI scoring of borrower scenarios** | Generic AI mortgage apps do this; trendy | Hallucination rate at 3-27% (per Vectara research cited in NMP coverage) is incompatible with disqualifying a borrower; consumer trust in AI mortgage tools fell from 30% to 16% in 2026 (Cotality survey) | Determinist rules engine; LLM is in the *extraction* pipeline (offline, with AM in the loop), not the *eligibility* pipeline (online, deterministic) |
| **Real-time AE/scenario-desk chat thread on every scenario** | LoanNEX has scenario desk messaging; some brokers love it | Adds messaging-platform scope (notifications, threading, presence, attachments, archival) that pulls focus from the eligibility wedge | Phase 3, modeled on LoanNEX scenario desk |

## Feature Dependencies

```
Phase 0 (foundation):

[Rule schema with explicit `layer` field]
    ├─requires─> [Vendor-curated agency rule sets: FNMA, FHLMC, FHA, VA]
    └─enables──> [Most-restrictive-wins evaluator]
                     └─enables──> [Layer attribution on deciding rule]

[Structured derog event model]
    ├─requires─> [Rule schema] (derog fields are typed rules)
    └─enables──> [Compound derog cases: BK+foreclosure, multi-filing, mortgage-in-BK]
                     └─enables──> [Near-miss "seasoning months remaining" delta]

[Per-field confidence score]
    ├─requires─> [Rule schema with per-field granularity]
    └─enables──> [Confidence-sorted AM review queue]
    └─enables──> [Bulk-accept above threshold]
    └─enables──> [Confidence badge on LO result rows]

[Source-document fingerprint + effective_date]
    └─enables──> [Per-rule citation in result]
    └─enables──> [Stale-scenario tagging]
    └─enables──> [Audit trail "which rule fired at scenario time"]

[200-scenario golden test set]
    └─gates────> [Phase 1 launch] (eligibility precision ≥98%, recall ≥95%)


Phase 1 (MVP):

[LO scenario form] ──>──> [Eligibility evaluator]
                              ├─consumes─> [Rule schema]
                              ├─consumes─> [Derog event model]
                              └─emits────> [Categorized result: eligible / near-miss / ineligible]
                                                ├─enables──> [Comparison view (≤4 programs)]
                                                ├─enables──> [Saved scenarios]
                                                ├─enables──> [Encompass / LendingPad export]
                                                └─enables──> [Near-miss surface]
                                                                  └─requires─> [Min-edit-distance search over rule space]

[AM extraction pipeline]
    ├─requires─> [Rule schema as extraction target]
    ├─requires─> [OCR + multi-pass LLM]
    └─emits────> [Draft program with per-field confidence]
                     └─consumed-by─> [AM three-pane review UI]
                                          └─requires─> [PDF.js viewer + bbox overlay]
                                          └─enables──> [Confidence-sorted review queue]
                                          └─enables──> [Bulk-accept above threshold]
                                          └─emits────> [Active ProgramVersion]

[Program lifecycle: draft → in review → active → deprecated → sunset]
    └─requires─> [ProgramVersion as first-class entity]
    └─enables──> [New matrix upload creates draft only]
    └─enables──> [Field-level diff vs. prior version]


Phase 2 (post-MVP):

[Live pricing feeds] ──conflicts──> [Eligibility-only positioning]
    └─required─> [Per-lender data-licensing agreement at onboarding]
    └─required─> [Strict tenant isolation enforcement]

[`LENDER_OVERLAY` multi-tenant layer]
    └─requires─> [Tenant-scoped data egress controls]
    └─requires─> [Authentication + tenant routing]

[Borrower-safe shareable view]
    └─requires─> [Tokenized URL + signed payload]
    └─requires─> [Field-level redaction policy]


Phase 3 (intelligence):

[Scenario re-run alerting on rule change]
    └─requires─> [Saved scenarios index by ProgramVersion]
    └─requires─> [Notification system]

[E&O warranty product]
    └─requires─> [Eligibility precision ≥99.5% sustained]
    └─requires─> [Audit trail forensics]
    └─requires─> [Insurance-carrier partnership]
```

### Critical Dependency Notes

- **Rule schema is the keystone.** Everything depends on it. Get layer + derog event types + per-field confidence right in Phase 0 or every later phase pays the rework cost. This is the PRD §3 phase 0 directive and the research validates it.
- **Derog modeling depends on the rule schema being typed for it.** A generic key-value rule schema cannot encode "measurement anchor + waiting months base + waiting months with EC + post-event LTV cap window." Schema must be domain-aware from day one.
- **Near-miss requires the rule schema to be navigable as a search space.** Min-edit-distance search needs each rule to expose its threshold (e.g., `min_fico: 680`) so the engine can compute the delta. Free-text rules cannot be near-miss searched.
- **AM review depends on the extraction pipeline persisting per-field confidence + source citation.** Without these, the three-pane UI has nothing to show; without the UI, AM cannot review at scale; without scale, KPI ≤45min/program is unreachable.
- **Citations on the LO result depend on the AM extraction pipeline having stored them.** Cannot retrofit citations onto already-extracted programs; bake into Phase 0 schema.
- **Stale-scenario tagging depends on saved scenarios indexing the ProgramVersion they ran against**, not just the program. Schema decision in Phase 0.
- **Phase 1 launch is gated on the 200-scenario golden test set**, not on a calendar date. Without ground truth, accuracy claims are unverifiable.

## MVP Definition

### Launch With (v1 — Phase 1 per PRD)

Per PRD §4 functional requirements + research-validated additions. Each item annotated [PRD] or [R-add] for research-recommended additions.

#### Foundation (Phase 0 — must complete before MVP)

- [ ] [PRD] Rule schema with explicit `layer` field (`AGENCY_BASE` / `INVESTOR_OVERLAY` / `PRODUCT_FEATURE` / `LENDER_OVERLAY`) and "most restrictive wins" conflict resolution **[Complexity: L]**
- [ ] [PRD] Structured derog event model with all fields specified **[Complexity: L]**
- [ ] [PRD] Encoded agency base rule sets: FNMA, FHLMC, FHA, VA **[Complexity: L]**
- [ ] [PRD] Per-`ProgramVersion` source-document fingerprint and `effective_date` **[Complexity: S]**
- [ ] [PRD] Per-field confidence score persisted on every extracted rule **[Complexity: M]**
- [ ] [PRD] 200-scenario golden test set with expert-reviewed expected outcomes **[Complexity: L — domain-expert work, not engineering]**
- [ ] [PRD] Agency-rule cascade: agency-version-bump triggers system-level review queue **[Complexity: M]**
- [ ] [PRD] Eligibility evaluator returning categorized result with deciding rule + layer + full rule stack **[Complexity: M after schema]**

#### LO Surface (Phase 1)

- [ ] [PRD] Scenario form covering borrower / loan / property / ratios / doc type / derog / special flags **[M]**
- [ ] [PRD] Eligibility evaluation, results split Eligible / Conditional / Ineligible **[M, depends on evaluator above]**
- [ ] [PRD] Near-miss minimum-edit-distance fix per ineligible program **[M]**
- [ ] [PRD] Result row exposes max LTV/CLTV/HCLTV, max DTI, MI, reserves, derog seasoning + expandable "why" with rule citations **[M]**
- [ ] [PRD] Comparison view: pin up to 4 programs side-by-side; export to PDF with disclaimer **[M]**
- [ ] [PRD] Saved scenarios per LO; shareable link with optional borrower-safe view; stale-scenario tagging **[M]**
- [ ] [PRD] Encompass and LendingPad export (FNM 3.2 / MISMO 3.4) **[M]**
- [ ] [PRD] Confidence badge on result rows when deciding rule has confidence < threshold **[S]**
- [ ] [R-add] Decision-support disclaimer prominent on every result, every PDF export, every shareable link **[S]** — addresses PRD §8 liability posture as concrete UI obligation
- [ ] [R-add] State / license filter (table stakes; was implicit in PRD) **[S]**
- [ ] [R-add] Loan-amount + conforming-limit filter (table stakes; was implicit in PRD) **[S]**

#### AM Surface (Phase 1)

- [ ] [PRD] PDF upload, OCR, multi-pass extraction (structural → rule normalization → overlay detection → confidence scoring) **[XL]**
- [ ] [PRD] Three-pane review UI: source PDF with citation highlight ↔ extracted rule object ↔ edit form **[M]**
- [ ] [PRD] Confidence-sorted queue; bulk-accept above threshold **[S–M]**
- [ ] [PRD] Program version control: matrix upload creates draft; AM reviews delta only; commit archives prior version with effective-date bracketing **[M]**
- [ ] [PRD] Program lifecycle states: `draft → in review → active → deprecated → sunset` **[S]**

#### Coverage + Quality Gate

- [ ] [PRD] 50 programs indexed at MVP launch; ≥60% non-QM **[L — content production, not engineering]**
- [ ] [PRD] Eligibility-only at launch (no live pricing); each result links to matrix citation **[Cross-cutting]**
- [ ] [PRD] Eligibility precision ≥98%, recall ≥95% measured against golden set **[Quality gate, not feature]**
- [ ] [PRD] AM onboarding time per program ≤45 min standard non-QM matrix **[Quality gate]**

### Add After Validation (v1.x — Phase 2 per PRD)

- [ ] [PRD] USDA, HFA, second-lien CES/HELOC, construction-to-perm coverage **[L]** — trigger: 50 programs indexed and AM extraction time KPI hit
- [ ] [PRD] Live pricing feeds for opt-in lenders **[XL]** — trigger: 250 programs indexed, eligibility precision ≥98% sustained, lender data-licensing terms negotiated
- [ ] [PRD] Multi-tenant `LENDER_OVERLAY` for retail shops + brokerages **[L]** — trigger: 5+ pilot brokerages with overlay needs
- [ ] [PRD] Mobile-optimized scenario flow (responsive web) **[M]**
- [ ] [PRD] Encompass Partner Connect + Byte integrations **[M each]**
- [ ] [R-add] FNM 3.4 export round-trip (import scenario from FNM 3.4 file, run eligibility) **[M]** — meaningful workflow win for brokers who already have a 3.4 from prior tool

### Future Consideration (v2+ — Phase 3 per PRD)

- [ ] [PRD] Borrower-safe shareable scenario landing pages (full presentation, not just link) **[M]** — trigger: LOs report manually building these for borrowers
- [ ] [PRD] AE collaboration surface (LoanNEX-style two-way messaging) **[L]** — trigger: 3+ wholesale lender partnerships requesting it
- [ ] [PRD] Scenario re-run alerting on indexed program rule change **[M]** — trigger: stale-scenario detection working at scale
- [ ] [PRD] Native iOS/Android **[XL]** — trigger: mobile usage >40% scenario discovery (not refresh)
- [ ] [PRD] Optional E&O warranty product (Candor-style) **[XL]** — trigger: precision ≥99.5%, audit trail forensics, insurance partner

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Rule schema with layer field | HIGH | M | P1 — Phase 0 |
| Structured derog event model | HIGH | L | P1 — Phase 0 |
| Agency rule sets encoded | HIGH | L | P1 — Phase 0 |
| 200-scenario golden test set | HIGH | L (domain-expert) | P1 — Phase 0 (gating) |
| Eligibility evaluator | HIGH | M | P1 — Phase 0/1 |
| LO scenario form | HIGH | M | P1 |
| Categorized results (Eligible/Conditional/Ineligible) | HIGH | M | P1 |
| Per-rule citation on result | HIGH | M | P1 (differentiator) |
| Layer attribution on result | HIGH | S | P1 (differentiator) |
| Confidence badge on low-confidence rules | HIGH | S | P1 (differentiator + liability) |
| Near-miss surface | HIGH | M | P1 (now competitive baseline given Polly 2025) |
| Comparison view (≤4) + PDF export | HIGH | M | P1 |
| Saved scenarios + shareable link | HIGH | M | P1 |
| Stale-scenario tagging | MEDIUM | S | P1 (differentiator) |
| Encompass + LendingPad export | HIGH | M | P1 (table stakes for broker channel) |
| AM PDF extraction pipeline | HIGH | XL | P1 (the differentiator) |
| AM three-pane review UI | HIGH | M | P1 |
| Confidence-sorted queue + bulk accept | HIGH | S–M | P1 |
| Program version control + effective-date | HIGH | M | P1 |
| Program lifecycle states | HIGH | S | P1 |
| Decision-support disclaimer (all surfaces) | HIGH | S | P1 (liability) |
| State + loan-amount filters | HIGH | S | P1 (table stakes) |
| 50 programs at launch (≥60% non-QM) | HIGH | L (content) | P1 (gating) |
| USDA / HFA / CES / HELOC | MEDIUM | L | P2 |
| Live pricing | HIGH | XL | P2 |
| Multi-tenant LENDER_OVERLAY | MEDIUM | L | P2 |
| Encompass Partner Connect + Byte | MEDIUM | M | P2 |
| Mobile responsive | MEDIUM | M | P2 |
| Borrower-safe presentation pages | MEDIUM | M | P3 |
| AE collaboration messaging | MEDIUM | L | P3 |
| Scenario re-run alerting | MEDIUM | M | P3 |
| Native iOS/Android | LOW (until usage data) | XL | P3 |
| E&O warranty | MEDIUM | XL | P3 |

## Competitor Feature Analysis

Validation of PRD competitive landscape against 2026-current vendor positioning. Sources cited at end.

| Feature | Optimal Blue (PPE + Originator Assistant) | Polly + Polly/AI | LoanNEX | LoanPASS | Zeitro Strata AI | Lender Toolkit Guideline Agent | Candor | ARIVE | Our Approach |
|---------|--------------------------------------------|------------------|---------|----------|-----------------|--------------------------------|--------|-------|--------------|
| Eligibility-first vs. pricing-first | Pricing-first (eligibility downstream) | Pricing-first (eligibility integrated) | **Eligibility-first** for non-QM | Configurable both | Q&A on guidelines | Q&A on guidelines | Loan-file underwriting | LOS+POS+PPE+marketplace | **Eligibility-first**, vendor-curated |
| Explicit overlay layering surfaced to LO | No (flattened per-program) | No | Partial (program-level) | No | No | No | N/A | No | **Yes — 4-layer with most-restrictive-wins** |
| Structured derog event model | Configurable rule type | Configurable rule type | Per-program tier | Configurable | Q&A only | Q&A only | N/A (loan file scope) | Inherits from PPE | **First-class normalized model** with anchor / EC / LTV cap window / re-establishment / multi-filing |
| Near-miss recommendations | Pricing breakpoints (Originator Assistant) | **Suggested actions** (FICO/LTV/rate deltas) | Scenario desk (manual) | No | No (Q&A only) | No | No | No | **Min-edit-distance over rule space** including doc-type swaps + seasoning months |
| Per-rule citation back to source | Reason text only, no citation | Suggested action text only | No | No | **Yes — link to source guideline** (Q&A) | **Yes — sources + references** (Q&A) | Audit trail (loan file) | No | **Yes — citation back to matrix page+bbox on structured eligibility output** |
| AM matrix-PDF → normalized rule extraction | No | No (lender-configured) | Vendor-analyst manual build | No (lender-configured) | Ingests guidelines for Q&A — output is text, not rules | No (Q&A over already-configured guidelines) | Loan-file extraction, not matrix | No | **Yes — multi-pass LLM with per-field confidence** |
| Confidence-scored AM review UI | N/A | N/A | N/A | N/A | N/A | N/A | Has internal review tooling for loan-file underwriting | N/A | **Yes — three-pane + confidence queue + bulk accept** |
| Program version control + effective-date | Lender manages | Lender manages | Vendor analyst manages | Lender manages | N/A | Auto-updated guidelines | N/A | Inherits from lender | **Yes — first-class with audit trail** |
| Stale-scenario detection on rule change | No | No | No | No | N/A | N/A | N/A | No | **Yes — scenarios index by ProgramVersion** |
| Live pricing | Yes (core) | Yes (core) | Yes (non-QM focus) | Yes (core) | No | No | No | Via PPE | No at MVP; opt-in Phase 2 |
| LO comparison view + PDF export | Yes | Yes | Yes (LoanNEX scenario desk) | Yes (LoanCOMPASS) | Limited | No | No | Yes | Yes |
| Encompass / LendingPad export | Yes | Yes | Yes | Yes | Yes (FNM 3.4) | No | Yes | Native | Yes |
| Decision-support disclaimer + audit trail | Indirect | Indirect | Indirect | Indirect | Indirect | Indirect | Warranty-backed | Indirect | **Prominent + per-result audit trail** |

### Key Gaps the PRD Captured Correctly

- **OB / Polly / LoanSifter / Mortech / EPPS / LenderPrice are pricing-first** — eligibility is downstream of margin/lock workflow. Vendor positioning consistently leads with "pricing accuracy" or "best execution"; eligibility is mentioned as a sub-feature. **Validated 2026-current.**
- **Polly's "suggested actions" near-miss is real but bounded** — Polly's own non-QM blog acknowledges derog-tier complexity ("two to seven years or even longer") without claiming Polly's PPE explicitly models the full derog matrix. The product can compute "wait N months" for the simple seasoning case. **Validated 2026-current.**
- **LoanNEX is the only serious non-QM-first PPE** — its programs are vendor-analyst-built, which constrains scaling and creates a different cost structure. PRD's positioning is correct. **Validated 2026-current.**
- **No incumbent ships AM-facing PDF-extraction-to-rules tooling** — generic IDP vendors (DocVu, Ocrolus, Paradatec, MortgageOCR.com, Infrrd, Landing.AI) extract loan-file documents (W2s, paystubs, asset statements), not lender program matrices. Lender Toolkit Guideline Agent is Q&A over pre-configured guidelines, not extraction. Candor extracts loan files for warranted underwriting, not matrices. **Validated 2026-current.**

### Updates Since the PRD Was Written

- **Polly/AI's near-miss feature shipped May 2024 and was refined through 2026.** PRD listed Polly/AI as "competitive on near-miss." Refining: Polly is now competitive on the *concept* of near-miss but does not provide explicit per-rule citations or layer attribution; the structural moat moves down a level.
- **Optimal Blue's 2026 Summit announced Virtual Economist** (forecasting tool for capital markets) and "AI Rules Assistant" (natural-language rule authoring inside Rules Optimizer). Neither closes the LO-side eligibility gap; the AI Rules Assistant is for *administrators* configuring rules, not for *LOs* getting eligibility decisions. Strategic posture unchanged.
- **Zeitro rebranded Scenario AI as Strata AI in March 2026** with "agentic framework." Strata covers ~300 lender guidelines for ~100+ investors via Q&A with citation. Material competitive overlap with Differentiator #4's "citation" piece — but Zeitro is Q&A, not structured eligibility, and its outputs are non-deterministic. **Action:** the differentiator should be reframed as "explainable *structured* eligibility with citation + layer attribution" rather than "explainable ranking with citations" — distinguishing rules-engine output from copilot output.
- **Candor Technology launched next-gen UX in April 2026** with FHA underwriting warranty backed by AAA-rated insurer (60-month post-closing). Validates the warrantied-decisioning model as a forward path (PRD §4 Phase 3 E&O insurance product). Candor is loan-file underwriting, not lender-program search — the two are complementary, not competitive.
- **October 2025 Optimal Blue antitrust class action remains active.** Filed Oct. 3, 2025 in M.D. Tenn. against OB and 26 lenders, alleging Pricing Insight enables price-fixing data exchange. Plaintiffs' economist analysis cites 49.2% wider rate spreads for OB-user originations vs. non-users, 2020-2024. **Strategic implication:** the "no cross-tenant pricing comparison" anti-feature is not just defensive product hygiene — it's existential antitrust risk avoidance. Worth elevating in PROJECT.md if not already prominent.
- **Brand collision:** Scotsman Guide already operates a product called "Lender Search" at lendersearch.com. Capability gap is enormous (theirs is a marketing directory, no eligibility engine, no derog modeling, no AM tooling) but the brand collision will hurt SEO, partnership conversations, and word-of-mouth. **Recommend rename before any external GTM.**

### Net Differentiator Status (HIGH confidence)

| PRD Differentiator | 2026 Status | Action |
|--------------------|-------------|--------|
| #1: Eligibility-first vendor-curated data model | **Survives** — no incumbent has the layered schema or vendor-curated agency rules | Build as planned |
| #2: First-class derog event modeling | **Survives** — no incumbent ships normalized derog matrix with anchor/EC/LTV-cap/re-establishment/multi-filing as first-class fields | Build as planned; Phase 0 is critical |
| #3: AM extraction with confidence scoring → normalized rule object | **Survives** — no incumbent has matrix-PDF-to-rules with three-pane AM review and lifecycle | Build as planned; XL complexity but unowned moat |
| #4: Explainable ranking + near-miss with rule citations | **Narrowed** — Polly shipped near-miss, Zeitro shipped citations. Reframe as "explainable *structured* eligibility with citation + layer attribution" | Keep as differentiator; emphasize structured-vs-Q&A and layer-vs-citation-alone in messaging |

## Open Items for Roadmap

1. **Brand rename.** Scotsman Guide owns "Lender Search" at lendersearch.com. Add to `/gsd-transition` exit criteria for Phase 0.
2. **Liability posture concretization.** PRD §8 lists "decision-support, not credit decision" disclaimer as a forward path. Research recommends concretizing it as a Phase 1 feature: prominent disclaimer on every result row, every comparison-view PDF export, every shareable link, with explicit text reviewed by counsel.
3. **Differentiator #4 reframing.** Marketing/positioning post-Phase 0 should emphasize "structured eligibility with citation + layer attribution" rather than "explainable ranking with citations" — Polly + Zeitro have moved into the latter.
4. **Antitrust posture in roadmap.** Consider lifting "strict tenant isolation + no cross-tenant pricing surface" from constraints into a first-class architectural commitment in `STACK.md` / `ARCHITECTURE.md` — this is product-defining, not just defensive.
5. **Live pricing in Phase 2 needs lender-data-licensing model resolution before scope-locking.** Suggest a research spike at Phase 1→2 transition.
6. **Mobile go/no-go decision needs usage-data trigger.** Research-recommended trigger: ≥40% of LO sessions on mobile-form-factor *for scenario discovery* (not just refresh).

## Sources

- [PRD] `/Users/chrissaechao/IdeaProjects/lender-search/.planning/PROJECT.md` — strategic differentiators, KPIs, anti-features
- [Codebase] `/Users/chrissaechao/IdeaProjects/lender-search/.planning/codebase/STRUCTURE.md`, `ARCHITECTURE.md` — existing prototype reference for scenario/result shape
- [Optimal Blue Originator Assistant launch](https://www2.optimalblue.com/optimal-blue-brings-ai-powered-originator-assistant-to-market-helping-originators-present-best-possible-loan-options-to-borrowers) — capability scoping
- [Optimal Blue 2026 Summit announcement](https://massachusettsnewswire.com/2026-optimal-blue-summit-industry-first-ai-ml-powered-forecasting-tool-headlines-extensive-lineup-of-mortgage-capital-markets-innovations-unveiled-71869/) — Virtual Economist, AI Rules Assistant
- [Optimal Blue press center / PPE GA enhancements](https://www2.optimalblue.com/optimal-blue-amplifies-pricing-accuracy-and-originator-efficiency-through-no-cost-general-availability-of-two-ppe-product-enhancements) — current PPE feature set
- [Polly/AI product page](https://polly.io/artificial-intelligence/) — LO Agent, near-miss / suggested actions
- [Polly non-QM PPE blog](https://connect.polly.io/on-the-pulse/non-qm-five-ways-a-ppe-can-make-loan-officers-lives-easier) — derog tier acknowledgement, *no claim of full matrix modeling*
- [Polly LO mobile + AI announcement](https://www.businesswire.com/news/home/20250515114595/en/Polly-Further-Advances-its-Unrivaled-LO-Experience-with-Full-Mobile-Capabilities-and-AI-powered-Automation) — May 2025 mobile + LO Agent refinement
- [LoanNEX Qualifier + non-QM positioning](https://loannex.com/qualifier/) — eligibility-first non-QM PPE; vendor-analyst program build model
- [LoanPASS HousingWire 2026 Tech 100 Award + non-QM](https://www.loanpass.io/post/loanpass-receives-housingwire%E2%80%99s-2026-tech-100-award-for-ppe-non-qm-aus-innovation), [LoanPASS non-QM page](https://www.loanpass.io/pricing-non-qm-loans), [LoanCOMPASS 900-program comparison tool](https://www.loanpass.io/research-loan-products)
- [Zeitro Scenario AI / Strata AI](https://www.zeitro.com/scenario-ai), [Zeitro guideline checker review](https://www.bluerate.ai/blog/zeitro-strata-review) — citations + ~300 guidelines + ~100 investors; Q&A surface
- [Lender Toolkit Guideline Agent (Toolshed)](https://lendertoolkit.com/responsible-mortgage-ai/) — Q&A over already-configured guidelines, sources + references in responses
- [Candor Technology next-gen UX April 2026](https://www.globenewswire.com/news-release/2026/04/22/3279167/0/en/Candor-Technology-Unveils-Next-Generation-Automated-Underwriting-Experience.html), [Candor FHA warranty announcement](https://www.prnewswire.com/news-releases/candor-technology-first-in-industry-to-automate-underwriting-for-fha-loans-and-offer-buyback-warranty-302271692.html) — warranted decisioning model
- [ARIVE platform overview](https://www.arive.com/), [ARIVE wholesale lender marketplace](https://www.arive.com/wholesale-lenders) — broker LOS+POS+PPE+marketplace context
- [LoanSifter (Optimal Blue)](https://www2.optimalblue.com/loansifter) — broker-channel PPE; 120+ wholesale investors
- [Mortech mortgage pricing engine](https://www.mortech.com/mortgage-pricing-engine), [LenderPrice cloud-native PPE](https://lenderprice.com/), [ICE PPE (Encompass EPPS)](https://mortgagetech.ice.com/products/ice-product-and-pricing-engine) — pricing-first PPE positioning
- [October 2025 Optimal Blue antitrust class action — HousingWire](https://www.housingwire.com/articles/optimal-blue-antitrust-lawsuit/), [National Mortgage News coverage](https://www.nationalmortgagenews.com/news/optimal-blue-26-mortgage-lenders-accused-of-price-fixing), [Propmodo on RealPage parallel](https://propmodo.com/optimal-blue-faces-realpage-deja-vu-in-data-sharing-lawsuit/), [DLA Piper antitrust+AI brief](https://www.dlapiper.com/en-us/insights/publications/2025/11/antitrust-and-ai-plaintiffs-enforcers-and-legislatures-take-aim-at-alleged-ai-driven-collusion) — anti-feature rationale for Pricing Insight-style benchmarking
- [Scotsman Guide LenderSearch.com](https://www.lendersearch.com/) — pre-existing product with brand collision; marketing directory only
- [Scotsman Guide LenderSearch launch announcement](https://www.businesswire.com/news/home/20230306005128/en/Introducing-LenderSearch.com-The-Marketplace-of-Direct-Lenders-Built-for-Mortgage-Brokers) — capability scope
- [FNMA bankruptcy/foreclosure waiting periods 2026](https://gustancho.com/fnma-waiting-period-guidelines-after-foreclosure/), [Freddie Mac max LTV/TLTV/HTLTV requirements](https://sf.freddiemac.com/general/maximum-ltv-tltv-htltv-ratio-requirements-for-conforming-and-super-conforming-mortgages) — derog-modeling source-of-truth domain references
- [AI hallucination in mortgage — National Mortgage Professional](https://nationalmortgageprofessional.com/news/ai-hallucinations-mortgage-lenders-bad-dream), [Cotality 2026 consumer trust survey via HousingWire](https://www.housingwire.com/articles/homebuyers-want-ai-and-human-in-the-loop-cotality-2026-survey/) — anti-feature rationale for black-box AI eligibility
- [Sensible.so three-pane PDF review pattern](https://www.sensible.so/blog/how-to-extract-data-from-closing-disclosures) — UX precedent for AM review surface
- [Mortgage IDP landscape — DocVu, Infrrd, Paradatec, MortgageOCR.com, Landing.AI](https://www.docvu.ai/mortgage-data-extraction-the-complete-2026-guide-using-ai-idp/) — generic loan-file extraction vendors; do not target lender matrix PDFs
- [Encompass MISMO 3.4 export documentation](https://developer.icemortgagetechnology.com/developer-connect/reference/export-loan-to-mismo-34) — broker-channel integration target

---

*Feature research for: Lender Search — eligibility-first lender/program search + AM extraction onboarding*
*Researched: 2026-04-29*
*Confidence: HIGH overall, MEDIUM on the specific shape of OB Originator Assistant's "ineligibility reason" output (vendor docs are marketing-positioned; would need a sales demo to confirm whether reason text is generative-AI prose vs. structured rule attribution — the difference matters for the differentiator framing but does not change the strategic conclusion that no incumbent ships normalized layered rules with citation + AM extraction loop)*
