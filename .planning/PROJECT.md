# Lender Search

> **Working name only.** Scotsman Guide already operates a marketing-directory product called "Lender Search" at lendersearch.com (March 2023). Capability gap is enormous (theirs has no eligibility engine), but SEO/word-of-mouth confusion is real. **Rename before any external GTM activity.** Tracked in Open Questions and as a Phase 1 exit-gate item.

## What This Is

An eligibility-first lender/program search tool for mortgage loan officers. An LO enters a borrower scenario (FICO, LTV, DTI, occupancy, derogatory history, doc type, special situation) and gets back a ranked list of programs the borrower actually qualifies for, with explicit reasons each program is eligible, near-miss, or ineligible — citing the rule and the layer that fired (agency base, investor overlay, product feature, lender overlay). Account managers onboard programs through an AI-assisted document-extraction pipeline that turns lender matrix PDFs into a normalized rules schema with per-field confidence scores and human-in-the-loop review.

## Core Value

**Correctness on the long tail of derogatory and non-QM scenarios** — every other capability (speed, ranking, near-miss, AM tooling, pricing) is in service of returning eligibility decisions an LO can defend to a borrower or AE without calling a wholesale lender to confirm.

## Requirements

### Validated

(None yet — ship to validate. Existing React prototype is being rebuilt from scratch; nothing in the current `src/App.js` carries forward as a validated capability.)

### Active

**Phase 0 — Schema and golden set (foundation, no customer-visible product)**

- [ ] Rule schema with explicit `layer` field (`AGENCY_BASE` / `INVESTOR_OVERLAY` / `PRODUCT_FEATURE` / `LENDER_OVERLAY`) and "most restrictive wins" conflict resolution
- [ ] Structured derogatory-event model (BK7, BK13 discharged/dismissed, multi-filing, foreclosure, DIL, short sale, mortgage charge-off, modification, forbearance) with measurement anchor, base waiting months, extenuating-circumstances waiting months, post-event LTV cap windows (FNMA's 3-to-7-year post-foreclosure 90% LTV / primary-purchase-or-rate-and-term-only window encoded explicitly, not paraphrased), re-established-credit requirement, mortgage-included-in-BK rule. (Note: FHA "Back to Work — Extenuating Circumstances" was discontinued 2016-09-30 by Mortgagee Letter 2016-14. Encoded as DEPRECATED with sunset date 2016-09-30; standard HUD 4000.1 extenuating-circumstances provision remains. Extraction pipeline rejects rules referencing Back to Work from post-2016 source documents.)
- [ ] Encoded agency base rule sets: FNMA, FHLMC, FHA, VA (USDA deferred to Phase 2)
- [ ] Per-`ProgramVersion` source-document fingerprint and `effective_date` for auditability
- [ ] Per-field confidence score persisted on every extracted rule
- [ ] Citation discipline as a hard schema constraint: rules without `sourceCitation` (page + bbox + textSpan) cannot persist; server-side post-extraction validation that `textSpan` actually appears in the cited PDF page at the specified bbox before any rule lands in staging
- [ ] 200-scenario golden test set with ≥1 paid external expert reviewer (senior underwriter); scenarios sourced 50% from real anonymized broker-shop LO outreach + 25% from incumbent public examples + 25% from constructed adversarial cases (specifically designed to break boolean derog handling); expected outcomes lock with citations to FNMA Selling Guide / lender matrix / Mortgagee Letter (not to the evaluator); scenarios locked before evaluator runs against them. Self-selection bias is the existential Phase 0 risk; external validation is non-negotiable.
- [ ] Agency-rule cascade: agency rules versioned; programs reference an agency version; an agency update creates a system-level review queue
- [ ] Eligibility evaluator that returns categorized result: `eligible` / `near-miss` / `ineligible`, with the deciding rule, its layer, and the full rule stack

**Phase 0 entry/exit gates (KPI-driven, not calendar)**

- [ ] Reducto vendor acceptance test passes — ≥95% cell accuracy on 10 representative non-QM matrices — OR consensus-pass mitigation (Reducto + Claude Sonnet 4.6 vision) documented and budgeted
- [ ] Rule-engine library spike completed — `json-rules-engine` 7.x vs. ~500-LOC custom evaluator decided on lower-rule-corruption-blast-radius criterion
- [ ] Golden-set ≥98% precision and ≥95% recall against expert-reviewed expected outcomes
- [ ] All RLS pen tests pass (CI gate before any tenant data exists)

**Phase 1 — MVP: LO search + AM onboarding (wholesale-broker channel)**

- [ ] LO scenario form covering borrower, loan, property, ratios, doc type, derog history, special flags (per PRD §4a)
- [ ] Eligibility evaluation against indexed programs, results split into Eligible / Conditional (near-miss) / Ineligible
- [ ] Near-miss surface: minimum-edit-distance fix per ineligible program (FICO delta, LTV delta, DTI delta, doc-type swap, seasoning months remaining)
- [ ] Result row exposes max LTV/CLTV/HCLTV, max DTI, MI requirement, reserves, derog seasoning, pricing if in scope, expandable "why" with rule citations
- [ ] Comparison view: pin up to four programs side-by-side; export to PDF with disclaimer
- [ ] Saved scenarios per LO; shareable link with optional borrower-safe view (no LO comp, no overlay tags); stale-scenario tagging when underlying program version changes
- [ ] AM onboarding: PDF upload, OCR, multi-pass extraction (structural → rule normalization → overlay detection → confidence scoring)
- [ ] AM three-pane review UI: source PDF with citation highlight, extracted rule object, edit form; confidence-sorted queue; bulk-accept above threshold
- [ ] Program version control: matrix upload creates draft version; AM reviews delta only; commit archives prior version with effective-date bracketing
- [ ] Program lifecycle states: `draft → in review → active → deprecated → sunset`
- [ ] 50 programs indexed at MVP launch, weighted toward non-QM (target ≥60% non-QM)
- [ ] Eligibility-only at launch (no live pricing); each result links to matrix citation
- [ ] Encompass and LendingPad export
- [ ] Confidence badge surfaced on result rows when the deciding rule has confidence < 90 ("AM has not confirmed this rule — verify with lender")

**Phase 2 — Coverage and pricing (post-MVP)**

- [ ] USDA, HFA, second-lien CES/HELOC, construction-to-perm
- [ ] Live pricing feeds for opt-in lenders (note rate, points, APR; no lock execution)
- [ ] Multi-tenant `LENDER_OVERLAY` layer for retail shops and brokerages
- [ ] Mobile-optimized scenario flow (responsive web, no native app yet)
- [ ] Encompass Partner Connect and Byte integrations

**Phase 3 — Workflow and intelligence (year 2+)**

- [ ] Borrower-safe shareable scenario landing pages
- [ ] Account-executive collaboration surface (LoanNEX-style two-way messaging on a scenario)
- [ ] Scenario re-run alerting when an indexed program changes a rule that affects a saved scenario
- [ ] Native iOS/Android (only if mobile-first usage shows in LO base)
- [ ] Optional E&O warranty product (Candor-style insurance backing on eligibility decisions)

### Out of Scope

- **Live rate locking and best-efforts/mandatory delivery** — Optimal Blue / Polly territory; regulated workflow we explicitly avoid
- **AUS submission (DU/LPA/GUS)** — accept AUS outcome as scenario input, never as output
- **LOS replacement** — integrate with Encompass / Byte / LendingPad via export and API; not the system of record for the loan file
- **Borrower-facing matchers (Own Up, Credible style D2C)** — shareable view is borrower-safe presentation of an LO-driven scenario, not a self-serve consumer flow
- **Hedging, MSR valuation, secondary trading** — out of scope for v1 and v2
- **Guideline interpretation as legal/compliance advice** — eligibility output is decision-support; underwriting remains the lender's responsibility
- **Competitive analytics / "Pricing Insight"-style benchmarking of lenders against each other** — exactly the territory the October 2025 Optimal Blue antitrust complaint targets
- **Cross-tenant overlay visibility** — a brokerage's `LENDER_OVERLAY` is not visible to other tenants
- **USDA / HFA / construction at MVP** — deferred to Phase 2
- **Live pricing at MVP** — eligibility-only at launch; sidesteps lender data-licensing exposure until the eligibility differentiator is real and measured
- **Native mobile at MVP** — incumbents' mobile apps are used for quote refreshes, not scenario discovery; responsive web is enough until usage data says otherwise

## Context

**Domain.** US residential mortgage origination. The PPE category (Optimal Blue, Polly, LoanSifter, Mortech, LenderPrice, EPPS, ReadyPrice, LoanNEX, LoanPASS) was built for secondary-marketing desks — eligibility is downstream of margin/lock workflow. AI-native entrants (Polly/AI, OB Originator Assistant, Lender Toolkit Guideline Agent, Zeitro, Candor) are reactive copilots over rule sets the lender already configured, or document Q&A without normalized structured output. No incumbent has shipped a vendor-curated, eligibility-first data model with explicit overlay layering and full FNMA-style derog matrix, fed by AI-extraction with a confidence-scored AM review surface.

**Practitioner pain (consolidated from industry press, vendor positioning, broker forums, Polly non-QM blog).**
- Overlay opacity — PPEs surface eligible/ineligible but not the *reason*; LOs maintain personal spreadsheets and call AEs to confirm
- Derogatory event seasoning is reduced to single booleans; multi-filing windows, post-foreclosure 3–7y LTV cap, re-established credit, mortgage-included-in-BK are not modeled
- Non-QM (bank statement, DSCR, ITIN, foreign national, post-derog) is a second-class citizen in agency-rooted PPEs
- Sub-second response is the published incumbent standard — lag erodes LO trust; LOs treat PPEs as quote tools, not discovery tools
- Stale guidelines — agency Selling Guide changes cascade through investor matrices with no automated detection across the indexed corpus
- Antitrust / data-licensing overhang — October 2025 OB class action alleges Pricing Insight enables price-fixing data exchange; resets how vendors think about lender data rights

**Existing codebase.** Single-page React 19 app at `src/App.js` (1,775 lines): hardcoded `SEED_LENDERS`/`SEED_PROGRAMS` arrays, an `evaluateProgram()` rule engine, Search/Results/Admin views, localStorage persistence, optional Claude API for natural-language scenario parsing. Per the Codebase user's decision, this is a throwaway prototype — useful as a reference for the LO scenario form shape and the matching-result structure, but not a starting point for the new architecture. The codebase map at `.planning/codebase/` documents what exists.

**Strategic wedges (the four differentiators that compound).**
1. **Eligibility-first vendor-curated data model** — leapfrogs OB / Polly / Mortech / EPPS (eligibility is downstream of pricing in those tools)
2. **First-class derogatory event modeling** — leapfrogs every existing tool; full FNMA/FHLMC/FHA/VA matrix with re-establishment criteria explicit
3. **AM onboarding via document extraction with confidence scoring → normalized rule object** — leapfrogs LoanNEX (vendor-analyst manual build), Lender Toolkit (Q&A only), Zeitro (corpus shallow, no structured output). **Unowned by any 2026 incumbent.**
4. **Explainable structured eligibility with citation + layer attribution** — distinguishes structured rules-engine output (with deciding rule + full layer stack) from Polly/AI's near-miss copilot prose (May 2024) and Zeitro Strata AI's citation-grounded Q&A (March 2026). The surviving moat after the 2026 competitive audit is *structured-vs-Q&A* combined with *layer-attribution-vs-citation-alone*. Originally framed in the PRD as "explainable ranking with rule citations" — narrowed by research because incumbents shipped citation-grounded Q&A; the structural moat moved one level down.

**KPI targets (PRD §6).**
- Eligibility precision (false-positive rate): ≥98% at v1, ≥99.5% at maturity
- Eligibility recall: ≥95% within indexed coverage
- Time-to-results: P50 ≤2s, P95 ≤5s
- AM onboarding time per program: ≤45 min standard non-QM matrix; ≤15 min delta on existing program
- Coverage staircase: 50 programs at MVP, 250 by month 6, 1,000 by month 12
- Extraction quality: AM correction rate <10% by month 6
- LO engagement: 8+ scenarios per active LO per day

## Constraints

- **Tech stack**: Solo developer with Claude Code; rebuild from scratch. Stack resolved after research: TypeScript + Next.js 16.2 (App Router) + React 19.2 + Postgres 16+ via Supabase + Drizzle ORM 0.45 + Vercel Pro + Inngest 4.2 (durable workflows) + Reducto (primary PDF/matrix extraction, MEDIUM confidence pending Phase 0 acceptance) + Claude Sonnet 4.6 (NL parsing + extraction backup) + json-rules-engine 7.3 OR ~500-LOC custom evaluator (decided in Phase 0 spike) + shadcn/ui + Tailwind + Sentry + Axiom. Single-language full-stack; managed-everything; LLM keys stay server-side via Server Actions
- **Timeline**: KPI-gated quality first; no fixed calendar deadline. Phase 0 (schema + golden set) lands before any customer-visible product. Phase 1 ships when eligibility precision and onboarding-time KPIs hit their targets, not on a date
- **Team**: One developer (single-threaded execution); roadmap granularity should be coarse-to-standard, not finely sliced
- **GTM**: Initial buyer (broker MLOs vs. retail LOs vs. wholesale AEs) deferred to research phase; coverage weighting at MVP is non-QM-heavy regardless, since that's where the incumbents are weakest
- **Data licensing (working answer, will harden in research)**: lender opt-in required for live pricing feeds and side-by-side rate comparison; published guideline matrices indexed under a license-to-use granted at lender onboarding; no "Pricing Insight"-style competitive analytics
- **Tenant isolation (architectural commitment, not a soft constraint)**: enforced at the database via Postgres Row-Level Security with `FORCE ROW LEVEL SECURITY` and `tenant_id` from JWT app_metadata — not at the application layer. CI pen-test suite blocks merge on any cross-tenant query that succeeds. The October 2025 *Smith et al. v. Optimal Blue, LLC et al.* (M.D. Tenn.) class action makes a single cross-tenant leak existentially expensive; RLS turns "forgot a `WHERE` clause" into a no-rows-returned bug instead of a data-exfiltration incident
- **Liability posture**: every result carries a "decision-support, not credit decision" disclaimer; confidence badges on low-confidence rules; versioned audit trail of which rule fired at scenario time; ToS liability cap; E&O insurance is a forward path (not v1)
- **Security**: no plaintext API keys in localStorage (the existing prototype's pattern); secrets behind server-side proxy
- **Accuracy gate**: any rule used to disqualify a borrower must be either AM-confirmed or flagged "unverified" in the result — no silent failure
- **Phase ordering**: Phase 0 (schema + golden set) is non-negotiable before MVP. Accuracy claims need measurable ground truth before any UI work; without it every later iteration is guessing

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Rebuild from scratch (not evolve `src/App.js`) | Existing prototype's monolithic 1,775-line component, hardcoded data, client-only architecture, and plaintext-localStorage API key cannot host the eligibility-first schema, multi-tenant overlay layer, or extraction pipeline. Reference value > carry-forward value | — Pending |
| Phase 0 before any UI work | Eligibility accuracy is the wedge; without a measurable golden set there's no way to claim correctness. Saves rework relative to building a UI on rules that turn out wrong | — Pending |
| Eligibility-only at MVP (no live pricing) | Sidesteps lender data-licensing exposure and the OB-antitrust adjacent territory; lets us prove the wedge before adding pricing complexity | — Pending |
| Wholesale-broker channel + non-QM-weighted at MVP | Where incumbents are weakest (LoanNEX is the only serious non-QM PPE; agency-rooted vendors barely model non-QM derog tiers); sharpest wedge with smallest viable surface | — Pending |
| Solo dev, KPI-gated timeline | Quality bar (precision ≥98%, recall ≥95%) is what gates phase transitions, not calendar dates. Avoids shipping a wedge that doesn't actually beat incumbents on the dimension we claim | — Pending |
| Stack: Next.js 16 + Postgres/Supabase + Vercel + Drizzle + Inngest + Reducto/Claude | Single-language full-stack TypeScript; managed-everything reduces ops surface for solo dev; Postgres handles rule store + RLS + FTS + audit + queue in one engine; Reducto leads on dense FICO×LTV cell extraction; Claude is already-integrated backup + scenario NL parser. All version pins verified against npm registry as of 2026-04-29 | — Pending |
| Reducto as primary extraction vendor with Phase 0 acceptance gate | RD-TableBench shows ~20% accuracy lead on dense cell tables vs. LlamaParse / Unstructured / Docling; bbox citations required for AM three-pane review. MEDIUM confidence pending acceptance test on 10 representative non-QM matrices; consensus-pass mitigation (Reducto + Claude vision) at +~$0.05/PDF documented | — Pending |
| `tenant.kind` enum from day one (BROKERAGE / RETAIL_LENDER / WHOLESALE_LENDER) | GTM persona is deferred to research, but the Phase 0 schema must accommodate the eventual choice without rework. All three channel types share the same rule + program model; only UX and tenant-scope rules differ | — Pending |
| GTM persona deferred to research | Broker MLO is the PRD default; retail LO and wholesale AE channels each carry different coverage and integration trade-offs. Phase 1 ships broker-channel only per PRD; final commit deferred until pilot data | — Pending |
| Tenant isolation lifted to architectural commitment (RLS, not application-layer) | October 2025 OB antitrust class action makes a single cross-tenant leak existentially expensive. Database-enforced isolation is the only posture that's regulator-defensible and doesn't depend on every SQL query in the codebase being correct | ✓ Locked |
| Differentiator #4 reframed to "explainable *structured* eligibility with citation + layer attribution" | Polly/AI shipped near-miss in 2024-2025; Zeitro Strata AI shipped citation-grounded Q&A in March 2026. The surviving moat is structured-rules-engine output (vs. copilot Q&A) combined with layer attribution (vs. citation alone). Pure-prose ranking with citations is no longer a differentiator | — Pending |
| Brand "Lender Search" is a working name only | Scotsman Guide owns lendersearch.com since March 2023 (marketing directory). Internal Phase 0 / Phase 1 work proceeds under the working name; rename is a Phase 1 exit-gate item before any external GTM | — Pending |
| FHA "Back to Work — Extenuating Circumstances" referenced in PRD §4a is discontinued | Mortgagee Letter 2016-14 ended the program 2016-09-30. Agency rule encoding marks Back to Work DEPRECATED with sunset date; extraction pipeline rejects rules referencing it from post-2016 source documents. Standard HUD 4000.1 extenuating-circumstances provision remains active | ✓ Locked |

## Open Questions / Risks (from PRD §8 — to revisit at phase boundaries)

- **Liability and disclaimer model.** Forward path: prominent decision-support disclaimer; confidence badges; versioned audit trail; ToS liability cap; E&O insurance modeled on Candor's repurchase-warranty framing
- **Lender data licensing.** Working answer above; harden via legal review before Phase 2 live-pricing rollout
- **Agency guideline cascade.** Build pattern: agency rules versioned, programs reference an agency version, agency update creates a prioritized review queue
- **Extraction accuracy / human-in-the-loop tradeoff.** Target 80%+ fields auto-accepted (≥95% confidence) on first-time matrix uploads; remaining 20% in AM review; quarterly recalibration
- **Non-QM vocabulary normalization.** "12-month bank statement" means slightly different things at AmWest vs. AD Mortgage vs. Newrez. Schema must accommodate per-program calculation methods, not just doc-type names
- **Brokerage overlay ownership.** Default: brokerage owns its `LENDER_OVERLAY` layer in its own tenant
- **Antitrust and competitor data exposure.** Multi-lender comparison surface for brokers is core; exposing one lender's confidential pricing detail to another lender is not. Strict tenant isolation + per-lender data-egress controls
- **Brand rename.** Working name "Lender Search" collides with Scotsman Guide's lendersearch.com (March 2023). Required before any external GTM. Domain availability + trademark search needed
- **Reducto vendor commit (Phase 0 gate).** Acceptance test ≥95% cell accuracy on 10 representative non-QM matrices. If miss, escalate to Reducto + Claude Sonnet 4.6 vision consensus-pass at +~$0.05/PDF cost
- **Rule-engine library vs. custom evaluator (Phase 0 spike).** json-rules-engine 7.3 vs. ~500-LOC custom — decided on lower-rule-corruption-blast-radius criterion before Phase 1 entry
- **Non-QM vocabulary deeper than labels.** Schema needs typed `IncomeDocMethod` (per-investor bank-statement methodology — personal vs. business, expense factor 50% / CPA / borrower-attest, comingled treatment, NSF treatment) and `DscrMethod` (numerator rule, denominator rule, IO handling, ARM qualification, no-ratio option). PRD §8 names this; Phase 0 schema must encode it
- **External expert reviewer for golden set.** Sourcing required (paid senior underwriter / consultant). Highest-ROI consulting spend in Phase 0; without it the precision claim is unsupported

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-29 after research synthesis (4-stream parallel research + SUMMARY.md)*
