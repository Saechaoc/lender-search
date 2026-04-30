# Pitfalls Research

**Domain:** Eligibility-first mortgage PPE with AI-assisted matrix extraction (US residential, wholesale-broker channel, non-QM-weighted)
**Researched:** 2026-04-29
**Confidence:** HIGH on agency derog rules (verified against current FNMA/FHLMC Selling Guides), HIGH on Optimal Blue antitrust posture (Oct 2025 filing verified via Housingwire/NMP/MLex coverage), MEDIUM on per-investor non-QM normalization specifics (verified against Newrez/AmWest/NQM Funding marketing & guideline PDFs but program-by-program nuance moves quickly), HIGH on PDF/LLM extraction failure modes.

---

## How to read this document

Pitfalls are grouped by **bucket**:

1. **Eligibility-modeling correctness** — the rules themselves are wrong, oversimplified, or missing nuance
2. **Extraction-pipeline correctness** — the AM onboarding pipeline produces a rule that doesn't match the matrix
3. **Operational / business** — the product is technically correct but legally, commercially, or contractually exposed
4. **Solo-dev execution** — the developer kills the project by working on the wrong thing or in the wrong order

Every pitfall has:
- **What goes wrong** (concrete failure mode)
- **Why incumbents simplify it** (root cause — usually historical: agency-rooted PPEs treated derog as a boolean because secondary-marketing desks priced common-case loans)
- **Warning signs** (how to detect early)
- **Prevention strategy** (concrete pattern, not "be careful")
- **Phase to address** (Phase 0 schema / Phase 1 MVP / Phase 2 coverage / Phase 3 workflow)
- **Impact if missed** (KPI hit, legal risk, rework cost)

KPI references throughout: precision ≥98% / recall ≥95% (PRD §6); AM correction rate <10% by month 6.

---

## Bucket 1: Eligibility-Modeling Correctness

This is the wedge. Every pitfall here directly threatens the precision/recall KPI and the strategic differentiator.

### Pitfall 1.1: Treating derogatory events as a single boolean or single-int "months since"

**What goes wrong:**
The default shortcut — and what every existing PPE does — is `derogatoryWaitMap = { "Chapter 7 BK": 48, "Foreclosure": 84, ... }` keyed by a single label, returning a single integer of months. The existing prototype at `src/App.js:959-962` does exactly this with a hardcoded fallback map. This collapses the actual FNMA B3-5.3-07 rule, which is a multi-dimensional state machine: each derogatory type has (1) a base waiting period, (2) an extenuating-circumstances waiting period that requires documented evidence, (3) for foreclosure specifically a 3-to-7-year band with **maximum LTV/CLTV/HCLTV of the lesser of 90% or matrix max** AND **purchase of principal residence only — no second homes, no investment, no cash-out at any occupancy**, (4) a re-establishment-of-credit requirement separate from time, (5) a measurement-anchor variation (discharge date vs. dismissal date vs. completion-of-foreclosure date vs. sale-confirmation date), and (6) the mortgage-included-in-BK rule that lets a borrower use the 4-year BK clock instead of the 7-year FC clock if the mortgage was discharged in the BK and not reaffirmed.

For FNMA conventional, the actual matrix is roughly:
- BK7: 4 years from discharge/dismissal (2 years with extenuating circumstances)
- BK13 discharged: 2 years from discharge / 4 years from dismissal
- Multi-filing (>1 BK in past 7y): 5 years from most recent discharge/dismissal
- Foreclosure: 7 years from completion (3 years with extenuating circumstances + 90% LTV cap + purchase-of-principal-residence only between yr 3 and yr 7)
- DIL/short sale/charge-off of mortgage: 4 years from completion (2 with extenuating circumstances)
- Mortgage-included-in-BK: lender may apply the 4-year BK waiting period if BK discharged the mortgage and the borrower did not reaffirm

A boolean or single-int model returns wrong eligibility for any borrower in years 3-7 post-FC, anyone with multi-filing history, anyone with mortgage-included-in-BK, and anyone with extenuating circumstances.

**Why incumbents simplify it:**
PPEs are rooted in secondary-marketing pricing engines where borrowers in tight derog windows are uncommon and underwriters resolve the edge case manually anyway. Optimal Blue/Polly/EPPS were never built around the derog axis as a first-class dimension. Agency-rooted PPEs treat non-QM derog tiers as a special-case bolt-on. There is no upstream pressure to model the matrix correctly because LOs already know to call the AE for derog scenarios — which is exactly the pain we're solving.

**Warning signs:**
- Schema has a single `waitingMonths` integer per (program, derogType)
- Schema lacks a `measurementAnchor` field (discharge vs. dismissal vs. completion)
- No separate `extenuatingCircumstancesMonths` field
- No `postEventLtvCapWindow` modeling the 3-to-7-year FC restriction
- No `purposeRestriction` / `occupancyRestriction` tied to a derog window
- No `mortgageIncludedInBk` Boolean on the borrower scenario, treated separately from derogatory type
- "Multi-filing" not a distinct event type in the schema

**Prevention strategy:**
Phase 0 schema must encode each derog event as a structured object, not a label-to-int lookup. Required fields:

```
DerogatoryRule {
  eventType: enum(BK7 | BK13_DISCHARGED | BK13_DISMISSED | MULTI_FILING | FORECLOSURE | DIL | SHORT_SALE | MORTGAGE_CHARGE_OFF | MOD | FORBEARANCE)
  measurementAnchor: enum(DISCHARGE | DISMISSAL | COMPLETION | SALE_CONFIRMATION | NOTE_DATE)
  baseWaitingMonths: int
  extenuatingCircumstancesWaitingMonths: int | null
  postEventCapWindows: [
    { fromMonths: int, toMonths: int,
      maxLtv: number, maxCltv: number, maxHcltv: number,
      purposeAllowList: ["PURCHASE", "RATE_TERM_REFI"],
      occupancyAllowList: ["PRIMARY"] }
  ]
  reEstablishedCreditRequired: bool
  reEstablishmentCriteria: text  // free-text per program; AM confirms
  mortgageIncludedInBkException: bool  // can the BK clock be used?
}
```

The eligibility evaluator reads (eventDate, eventType, mortgageIncludedInBk, hasExtenuatingCircumstances, scenario.purpose, scenario.occupancy, scenario.ltv) and walks the rule, returning the binding constraint with citation. If a derog event lacks any required field at extraction time, mark the rule UNVERIFIED and surface the confidence badge.

**Golden-set must include scenarios that exercise each branch:**
- Yr 3-7 post-FC, primary purchase, 88% LTV → eligible (under 90 cap)
- Yr 3-7 post-FC, primary purchase, 95% LTV → ineligible (above 90 cap)
- Yr 3-7 post-FC, second home → ineligible (occupancy restriction)
- Yr 3-7 post-FC, cash-out → ineligible (purpose restriction)
- Multi-filing yr 4 → ineligible (5y rule)
- Multi-filing yr 6 → eligible
- Mortgage-included-in-BK yr 5 (BK clock applies, FC clock doesn't) → eligible
- Mortgage NOT included in BK yr 5 → ineligible (still in 7y FC window)

**Phase to address:** Phase 0 (schema). This rule shape determines every later phase; getting it wrong here is a full rewrite.

**Impact if missed:**
Direct hit on the precision KPI. Worse than a missed match: a *false-positive* "eligible" decision on a borrower in the 3-7y FC window at 95% LTV is the exact failure mode the LO was using their personal spreadsheet to avoid. One LO showing one false-positive to a borrower destroys trust and erases the wedge. Estimated rework if discovered post-MVP: ~3 weeks of schema + evaluator + golden-set rebuild.

---

### Pitfall 1.2: Missing the 3-to-7-year post-foreclosure 90% LTV / purchase-and-rate-term-only window

**What goes wrong:**
This is a sub-case of Pitfall 1.1 deserving its own callout because it's the single most-cited example of incumbent-PPE simplification. Per FNMA B3-5.3-07: between year 3 and year 7 after foreclosure completion *with documented extenuating circumstances*, the borrower can qualify but only for a primary-residence purchase or limited cash-out refinance, with maximum LTV/CLTV/HCLTV of the lesser of 90% or the Eligibility Matrix max. **Cash-out refis are not permitted, second homes are not permitted, investment properties are not permitted** until the full 7-year clock has run.

A naive "months since FC ≥ 36" check returns a green light for an investment-property purchase at 95% LTV. That's a false-positive eligibility on multiple axes simultaneously.

**Why incumbents simplify it:**
The interaction between time-window, LTV cap, occupancy restriction, and purpose restriction requires a 4-dimensional rule. Most PPE schemas don't have a way to express "this rule fires only in this time window AND only for this occupancy AND only for this purpose AND caps these metrics."

**Warning signs:**
- Eligibility evaluator runs each constraint independently and ANDs the result
- No notion of conditional-LTV-cap whose activation depends on a different rule's state
- "Window-bound" rules absent from the schema vocabulary
- Test scenarios don't cover yr 4 + investment + 95% LTV expecting `ineligible (post-FC occupancy restriction)`

**Prevention strategy:**
Schema-level: every rule object can declare an `activationCondition` that references the derogatory state machine. Evaluator processes derog events first, computes the active windows, then layers in the window-conditional caps before evaluating the standard LTV/purpose/occupancy rules. The deciding rule that blocks the transaction must be returned with the citation back to B3-5.3-07.

Specifically test the case in the golden set:
- Same borrower, two purpose values: PURCHASE (eligible at 88%) vs. CASH_OUT (ineligible: post-FC purpose restriction). Same FICO, same DTI, same everything else. The evaluator must return different verdicts.

**Phase to address:** Phase 0 (schema design must allow window-conditional rules), Phase 1 (evaluator implementation).

**Impact if missed:**
Single highest-visibility false-positive scenario. Demoing this scenario correctly is the wedge-proof — every existing PPE returns wrong here. Estimated retrofit cost if missed: re-architecting the evaluator to support conditional-rule activation (~1-2 weeks).

---

### Pitfall 1.3: Confusing measurement anchors across derog types

**What goes wrong:**
The starting clock is different per event type and per rule:
- BK7: discharge date OR dismissal date (whichever applies)
- BK13: discharge date if discharged; **dismissal date** if dismissed (4y, not 2y)
- Foreclosure: completion date as reported on credit report or foreclosure documents — not the date of default, not the trustee sale notice
- DIL/short sale: completion date (deed recording or sale confirmation)
- Charge-off of mortgage: charge-off date per the trade line

If extraction reads "foreclosure 7 years" and the evaluator anchors to the borrower's reported "default date" or "missed-payment date", the eligibility verdict shifts by 12-24 months in either direction.

**Why incumbents simplify it:**
The anchor isn't usually called out explicitly in lender matrices — they assume "from the date of the event" and let the underwriter resolve the anchor at file-review time. An extraction pipeline that treats the rule as "84 months since X" without nailing down what X is will produce systematic errors.

**Warning signs:**
- LO scenario form has a single "date of derogatory event" field
- Schema doesn't differentiate `discharge_date` vs. `dismissal_date` vs. `completion_date`
- Extraction prompt to the LLM doesn't ask the model to identify which anchor the rule uses

**Prevention strategy:**
Borrower scenario captures a *typed* event with a typed anchor (`{eventType: "BK7", anchorType: "DISCHARGE", anchorDate: "2022-08-15"}`). Schema enforces compatibility — a BK7 event must have a DISCHARGE or DISMISSAL anchor; a foreclosure must have a COMPLETION anchor.

For extraction: the prompt asks the LLM to emit `measurementAnchor` as a discrete field. If the source text is ambiguous ("84 months from event"), the LLM emits `measurementAnchor: UNCERTAIN` and the rule is queued for AM review with the source span highlighted.

**Phase to address:** Phase 0 (schema), Phase 1 (LO form + extraction prompts).

**Impact if missed:**
~6-month systematic skew in eligibility verdicts for any borrower in the 1-2 year window post-event. Recall hit and precision hit both possible depending on direction.

---

### Pitfall 1.4: FHA Back-to-Work as if it still exists

**What goes wrong:**
The PRD-level question explicitly cites "FHA Back to Work documentation" as a derog modeling axis. **FHA discontinued the Back to Work — Extenuating Circumstances program on September 30, 2016.** It does not exist as an active program. Modeling it as a current FHA pathway introduces a phantom rule that returns "eligible under Back to Work" for borrowers with 12-month seasoning post-FC.

What *is* still alive on the FHA side: the standard extenuating-circumstances provision (HUD 4000.1) which can reduce the BK7 waiting period from 2 years to 1 year with documented circumstances. There is no longer a 1-year-post-FC pathway.

**Why incumbents/practitioners conflate it:**
Back to Work was a major FHA initiative from 2013-2016. Industry vocabulary persisted long after the program ended; many broker forums and MLO training materials still reference it. The trap is encoding it because the term keeps showing up in lender matrices' historical text.

**Warning signs:**
- A FHA-program rule references "Back to Work" in current-effective-date matrix
- Golden set has a 12-months-post-FC FHA scenario expected to be eligible
- Extraction confidence is high on a Back-to-Work rule but the source matrix is post-2016
- Source-document fingerprint shows a recent matrix but the rule references a discontinued program

**Prevention strategy:**
Phase 0 agency-rule encoding marks "FHA Back to Work" as DEPRECATED with sunset date 2016-09-30. Any extracted rule that references Back to Work fails extraction validation if the source document's effective date is post-2016 — it's flagged for AM review with an explicit warning. Borrower scenario form does not offer a "Back to Work" toggle; instead offers `extenuatingCircumstances: bool` with a documentation-required note.

This is a Phase 0 sanity check that catches stale lender matrices in general — it's the prototype for the agency-rule cascade-detection mechanism.

**Phase to address:** Phase 0 (agency rule encoding with active/deprecated state), Phase 1 (extraction validation guard).

**Impact if missed:**
Direct false-positive eligibility decisions for FHA-seeking borrowers in 1-2y post-FC. Public-facing credibility hit if a competitor or industry observer points out the phantom program.

---

### Pitfall 1.5: Multi-filing window collapsed into single-filing rule

**What goes wrong:**
FNMA's rule for borrowers with more than one BK filing in the past 7 years is **5 years from the most recent discharge/dismissal**, not 4. The 5y vs. 4y delta affects any borrower in years 4-5 with prior BK history. Most PPEs don't expose multi-filing as an event type at all — borrower fills in "BK7" and gets the standard 4y rule.

Additionally: the "extenuating circumstances" pathway for multi-filing scenarios requires that **the most recent BK filing was the result of extenuating circumstances**, not the original filing. This is a subtle distinction the rule schema must capture.

**Why incumbents simplify it:**
"Multi-filing" requires a list-of-events on the borrower scenario, not a single event. Form design defaults to single-event input. The 5y-vs-4y differential is small enough that even underwriters resolve it case-by-case.

**Warning signs:**
- Borrower scenario form accepts only one derog event
- No `priorFilingsInLast7Years` count field
- Golden set lacks multi-filing scenarios

**Prevention strategy:**
Borrower scenario captures a list of derog events with their full anchor/type/date. Evaluator identifies multi-filing automatically (≥2 BK events with anchors in the last 84 months) and applies the 5y rule from the most recent. Surfacing the multi-filing detection in the result explanation builds trust ("This program requires 5 years from the most recent BK because you have a prior 2018 BK7 within the 7-year window").

**Phase to address:** Phase 0 (borrower scenario as event list), Phase 1 (evaluator multi-filing detection).

**Impact if missed:**
Specific high-stakes false-positive: borrower with two BKs at the 4.5y mark would be told "eligible" by a single-event evaluator. This is a small slice of borrowers but a 100% wrong answer when it occurs.

---

### Pitfall 1.6: Mortgage-included-in-BK exception treated as borrower preference instead of rule branch

**What goes wrong:**
When a mortgage is discharged in a Chapter 7 BK and the borrower did not reaffirm the loan, FNMA permits the lender to apply the BK waiting period (4y from discharge) instead of the FC waiting period (7y from completion). This is a 3-year acceleration. The rule has hard documentation requirements: BK discharge order, schedule listing the mortgage, evidence of no reaffirmation.

A naive eligibility evaluator picks up "BK7 + foreclosure both on credit report" and applies the *longer* of the two waiting periods (7y), missing the exception entirely. Or worse: it asks the LO to choose, leaving the rule selection in human hands without checking documentation requirements.

**Why incumbents simplify it:**
Conditional rule application based on documentation possession is hard to encode. It's an "if the borrower has X document, then rule A applies, else rule B applies" structure. Form-driven scenarios don't capture document possession.

**Warning signs:**
- Borrower scenario doesn't have a `mortgageIncludedInBk` boolean
- Borrower scenario doesn't have a `reaffirmedMortgage` boolean
- Evaluator treats BK and FC events independently
- Golden set has no scenario testing the exception

**Prevention strategy:**
Borrower scenario captures the relationship between BK and FC events: when a BK is present and a FC is present, the form asks `wasMortgageIncludedInBk: bool` and `wasMortgageReaffirmed: bool`. Evaluator branches based on the answers. If `mortgageIncludedInBk == true && reaffirmed == false`, evaluator applies the 4y BK clock; else applies the 7y FC clock. Result message explicitly cites the branch taken and the documentation the borrower needs.

**Phase to address:** Phase 0 (borrower scenario), Phase 1 (evaluator).

**Impact if missed:**
~3-year systematic over-restriction for a recognizable subset of post-2008-crisis borrowers. Direct recall hit. This is the kind of "incumbents miss this so we look smart for catching it" wedge.

---

### Pitfall 1.7: VA / USDA timeline rules treated as agency uniform when they're not

**What goes wrong:**
- VA: the VA itself imposes no formal waiting period after short sale, and no formal waiting period after FC for a borrower using *new* VA entitlement. Lenders typically impose 2-year overlays. Borrowers with remaining VA entitlement after a prior VA-loan FC may use second-tier entitlement to get a new VA loan, but the entitlement balance is reduced by the amount the VA paid out on the prior claim. Net: VA scenarios require modeling **entitlement** as a borrower attribute, not just timeline.
- USDA: 3-year waiting period after FC, BK7, DIL is the standard. Property must be in a USDA-eligible rural area — a per-property eligibility check, not a per-borrower check. USDA rural classification updates are tied to Census/MSA data and shift periodically; an address that was USDA-eligible in 2019 may not be in 2026.

If the schema treats "Agency = VA" as having a uniform 2y FC waiting period, it misses both the lender-overlay-vs-VA-rule distinction and the second-tier-entitlement complexity.

**Why incumbents simplify it:**
VA is a small enough share of total volume that the entitlement nuance is treated as an underwriter problem. USDA rural eligibility is treated as a binary that the LO checks separately on the USDA eligibility map.

**Warning signs:**
- Schema has a single `agencyBase.VA.foreclosureWait = 24` constant
- Borrower scenario has no `vaEntitlementRemaining` or `priorVaLoanForeclosed` fields
- USDA programs reference a single `ruralEligible: bool` instead of a property-address lookup
- No effective-date tracking for USDA rural-area boundaries

**Prevention strategy:**
- VA: model the formal VA rule (no waiting) separately from the typical lender overlay (2y). The result presentation surfaces both: "VA permits this; this lender's overlay imposes a 2-year wait." Borrower scenario captures `priorVaLoanForeclosed: bool` and triggers the entitlement-reduction calculation pathway.
- USDA: defer to Phase 2 per the PRD scope, but Phase 0 schema must accommodate per-address property-eligibility lookup, not just program-level boolean. Phase 2 implementation hits the USDA Eligibility Map API (or its successor) at scenario-time. Cache results with a 90-day TTL because the USDA rural-area boundaries change.

**Phase to address:** Phase 0 (schema accommodates VA entitlement and USDA per-property lookup), Phase 1 (VA modeling), Phase 2 (USDA implementation).

**Impact if missed:**
Direct precision/recall hit on VA scenarios. Phase-2 rework cost if the schema can't carry per-property eligibility data later.

---

### Pitfall 1.8: Non-QM "12-month bank statement" treated as a single doc-type label

**What goes wrong:**
"12-month bank statement" is not a normalized doc type across investors. Implementation specifics that vary materially:
- **Personal vs. business statements**: personal usually 100% of deposits; business applies an expense factor
- **Expense factor**: AmWest, AD Mortgage, Newrez, Verus, Angel Oak each have different defaults — 50% is common but some use a CPA-derived factor, some let the borrower self-attest, some require P&L reconciliation
- **Statement period**: 12 vs. 24 months changes the qualifying income materially
- **Co-mingled accounts**: rules differ on how to treat personal accounts that receive business deposits
- **Transfer exclusions**: which deposits are excluded as "non-income transfers" varies
- **NSF treatment**: number of NSFs in trailing period that disqualifies the program varies
- **Seasoning of deposits**: some require deposits to be regular ("monthly") not lumpy

A scenario "borrower wants 12-month bank statement, $20K/mo personal account average deposits" can produce qualifying income of $20K/mo at one investor and $10K/mo at another (50% expense factor), shifting DTI and program eligibility.

**Why incumbents simplify it:**
A normalized "Bank Statement Loan" doc type label is convenient for browsing and matrix display. The detailed methodology is buried in the matrix's overlay text, often as a footnote. Existing PPEs treat it as a tag, not a calculation method.

**Warning signs:**
- Schema has a `supportedIncomeDocs: ["12mo_bank_stmt", "24mo_bank_stmt", ...]` flat string list
- No per-program calculation-method object
- LO scenario captures `incomeDocType` as a string but not a per-investor methodology
- Two programs with different expense factors return identical qualifying income for the same scenario

**Prevention strategy:**
Schema models bank-statement income as a typed `IncomeDocMethod` object per program:

```
BankStatementMethod {
  accountType: PERSONAL | BUSINESS | EITHER
  monthsOfStatements: int  // 12 | 24
  expenseFactor: number | null  // 0.50 | 0.30 | computed-via-cpa
  expenseFactorSource: FIXED | CPA_LETTER | P_AND_L_RECONCILIATION | BORROWER_ATTESTATION
  excludeTransfers: bool
  maxNsfPerPeriod: int | null
  comminglingTreatment: ALLOWED | DISALLOWED | SEASONED
  qualifyingDepositSeasoning: text  // "regular monthly", "any frequency"
}
```

LO scenario captures `bankStatementInput { monthlyDeposits, accountType, businessExpensesProvided }` and the evaluator computes program-specific qualifying income per program's `IncomeDocMethod`. Result presentation shows per-program qualifying income side-by-side ("AmWest qualifies you at $10,000/mo (50% factor); AD Mortgage at $14,000/mo (30% factor with CPA letter)").

This is a wedge feature — incumbents do not surface this. It directly addresses PRD §8 "Non-QM vocabulary normalization" open question.

**Phase to address:** Phase 0 (schema), Phase 1 (evaluator + LO form).

**Impact if missed:**
This is *the* non-QM wedge feature. Missing it returns the product to "another agency-rooted PPE that pretends to handle non-QM." Direct hit on the strategic differentiator, not just KPI.

---

### Pitfall 1.9: DSCR ratio calculation methodology variance

**What goes wrong:**
DSCR = monthly gross rent ÷ monthly PITIA (Principal + Interest + Taxes + Insurance + Association dues). Investor differences:
- **Numerator (rent)**: most use "lower of in-place lease and market rent (1007 form)"; some use the higher; some accept market rent only when no lease exists; some require lease seasoning of 6+ months; short-term-rental income (Airbnb) requires 12-month operator history at most investors
- **Denominator (PITIA)**: interest-only loans use ITIA (no P), which raises the ratio. Some investors require qualifying at the fully-amortized payment even if the loan is IO. ARM-period qualification varies: qualify at note rate, qualify at index+margin, qualify at index+margin+2%
- **Min DSCR thresholds tier by FICO and LTV** — same investor may offer 0.75 DSCR at 60% LTV but require 1.0 DSCR at 80% LTV
- **No-ratio DSCR products** exist where DSCR isn't computed; the scenario evaluator must know the program is no-ratio and skip the calculation

A naive DSCR check (`grossRent / pitia >= 1.0`) returns the wrong verdict for IO products, ARM products, programs requiring fully-amortized qualifying, and any program that uses lower-of-lease-or-market.

**Why incumbents simplify it:**
DSCR programs are a non-QM specialty; agency-rooted PPEs treat them as "non-QM bucket" without per-program ratio methodology. LoanNEX is the closest serious competitor on this axis.

**Warning signs:**
- Schema has `minDscr: 1.0` as a flat number per program
- No `dscrCalculation: { numeratorMethod, denominatorMethod }` per program
- LO scenario doesn't capture `existingLease`, `marketRent1007`, `loanFeature.interestOnly`
- Same scenario produces same DSCR across investors with materially different methodologies

**Prevention strategy:**
Schema models DSCR as:

```
DscrMethod {
  numeratorRule: enum(LOWER_OF_LEASE_AND_MARKET | HIGHER_OF | LEASE_ONLY | MARKET_ONLY | LEASE_WITH_MARKET_FALLBACK)
  shortTermRentalAllowed: bool
  shortTermRentalSeasoning: months | null
  denominatorMethod: enum(NOTE_RATE_PITIA | NOTE_RATE_ITIA_FOR_IO | FULLY_AMORTIZED_QUALIFYING | INDEX_PLUS_MARGIN | INDEX_PLUS_MARGIN_PLUS_2)
  minDscrByLtvTier: [{ ltvMax: 0.60, minDscr: 0.75 }, { ltvMax: 0.80, minDscr: 1.00 }, ...]
  noRatioOption: bool
  noRatioMaxLtv: number | null
}
```

LO scenario captures the property's lease + market rent + IO option + ARM type, and the evaluator computes per-program DSCR using each program's method. Surface the calculation method in the result expansion.

**Phase to address:** Phase 0 (schema), Phase 1 (evaluator + form).

**Impact if missed:**
Same shape as Pitfall 1.8 — direct hit on the non-QM wedge. DSCR is the highest-volume non-QM product line.

---

### Pitfall 1.10: FICO mid-score rule wrong for multi-borrower scenarios

**What goes wrong:**
- Single borrower: middle of three bureau scores (mid-score)
- Multiple borrowers: **lowest of each borrower's mid-score** is the qualifying score (most agencies and most non-QM)
- **Fannie Mae conventional permits averaging the mid-scores of borrower and co-borrower** — a specific exception
- For single-bureau borrowers (only 2 scores reporting): rules on whether to use the lower of two, or treat the middle of two as undefined, vary

A naive `fico = scenario.fico` capture loses the distinction. A naive multi-borrower implementation that averages by default is wrong everywhere except FNMA conventional. A naive "use the higher score" is wrong everywhere.

**Why incumbents simplify it:**
LO scenario forms typically have one FICO field. The mid-vs-lowest distinction is treated as something the LO already resolved before opening the PPE.

**Warning signs:**
- LO scenario form has a single `fico: number` field
- No `coBorrowerFico` field
- No `useFnmaAveraging` flag (exception toggle)
- Schema doesn't differentiate per-program qualifying-score rules (FNMA average vs. lowest mid)

**Prevention strategy:**
LO scenario captures per-borrower FICO objects: `[{borrowerId, equifax, experian, transunion}, ...]`. Evaluator computes per-borrower mid-score, then applies program rule (lowest-of-mid OR FNMA average) at evaluation time. Default is lowest-of-mid; FNMA conventional programs flip a flag. Result explanation shows the qualifying-score derivation.

**Phase to address:** Phase 0 (scenario shape), Phase 1 (evaluator).

**Impact if missed:**
Single-borrower scenarios are unaffected (most LO traffic). Multi-borrower scenarios get systematic ~10-30 point FICO mismatches, hitting precision on conventional programs that have FICO-tiered LTV/pricing.

---

### Pitfall 1.11: Condo project review state under-modeled

**What goes wrong:**
Condo eligibility involves multiple rule layers:
- **Project Type (V, P, Q, R, S, F, T)** under FNMA Loan Delivery — a project classification, not a property classification
- **Limited Review** vs. **Full Review** vs. **Waiver of Project Review** (Type V) — the review path is not borrower-driven, it's matrix-driven by occupancy + LTV
- **Warrantable vs. Non-Warrantable** — binary outcome of the review process
- **Project Eligibility Gates**: HOA reserves (15% of annual budget effective 2026, up from 10%), insurance coverage (RCV not ACV; deductible cap; per-unit deductible cap of $50K effective July 2026), litigation status, single-investor concentration, commercial-space percentage
- **Non-warrantable financing** is a separate non-QM market with its own program list, often available via portfolio lenders only
- **Florida condos post-Surfside** have additional state-specific overlays around structural reserve studies

A scenario "borrower wants to buy a condo" requires more than a `propertyType: "condo"` flag — it needs the project's review status, which in production comes from CPM (Condo Project Manager) lookup or PERS approval.

**Why incumbents simplify it:**
Condo project review is treated as a separate workflow step outside the PPE. PPEs return "eligible" for a generic condo and let the underwriter resolve project status separately.

**Warning signs:**
- Schema has `propertyType: condo` as a single value
- No `condoReviewType: LIMITED | FULL | WAIVED` capture
- No `warrantable: bool` capture
- No project-level metadata (HOA reserves percent, insurance compliance, litigation status)
- Florida special-case missing

**Prevention strategy:**
- Phase 0 schema models condo as a property type with subordinate project-review state. Borrower scenario captures `condoProject: { reviewType, warrantable, projectType, hasLitigation, reservesAdequate, insuranceCompliant, state }`.
- Programs declare their condo eligibility per review type and per warrantable/non-warrantable axis.
- Phase 1 LO form has a "Condo project status" sub-form that asks about CPM/PERS status. If LO doesn't know, the form returns programs filtered to Limited Review acceptance only and surfaces a "verify project status with lender" warning.
- Phase 2 considers integration with FNMA Condo Project Manager API for automated lookup.

**Phase to address:** Phase 0 (schema), Phase 1 (form + evaluator), Phase 2 (CPM integration).

**Impact if missed:**
Florida condo scenarios in particular will produce wrong verdicts post-Surfside. This is a state-specific overlay axis that demos badly.

---

### Pitfall 1.12: High-balance / high-cost county overlay treated as price-only adjustment

**What goes wrong:**
2026 baseline conforming limit is $832,750 (1-unit); high-cost ceiling is $1,249,125. Counties have specific FHFA-published limits between baseline and ceiling. High-balance loans:
- Trigger LLPAs (price), but also
- Trigger overlay underwriting requirements (FICO floors, reserves requirements, max LTV reductions on certain occupancies/property types)
- Are not accepted by every lender even on conforming-eligible borrowers
- Have different limits in 2-, 3-, 4-unit configurations
- Limits change annually, every November

A naive "loanAmount > $832,750 → high-balance" check misses the per-county lookup, the per-unit-count lookup, the overlay underwriting tightening, and the annual update cadence.

**Why incumbents simplify it:**
Pricing engines handle this well because they map LLPAs to loan amount; eligibility engines often treat high-balance as a price-axis only.

**Warning signs:**
- Loan amount compared against a single national cap
- No per-county lookup table
- No annual-effective-date tracking on the limit table
- No high-balance overlay logic (FICO floor / LTV cap / reserves)
- No 2-/3-/4-unit limit differentiation

**Prevention strategy:**
- Encode FHFA county-by-county limits as versioned data with `effectiveDate: 2026-01-01`. Refresh annually in November when FHFA publishes.
- Programs declare per-program high-balance overlays separately from base rules.
- LO scenario captures property county; evaluator looks up the limit for the county+units+effectiveDate combination.
- Phase 0 includes a loan-limit-table data import + version-management process; this is the prototype for all annually-changing data (USDA rural boundaries, MSA designations, etc.).

**Phase to address:** Phase 0 (schema for versioned data tables), Phase 1 (FHFA limit data load + lookup).

**Impact if missed:**
Direct precision hit on jumbo-edge scenarios in high-cost counties. Recall hit when high-balance overlays exclude scenarios that are agency-conforming but lender-overlaid.

---

### Pitfall 1.13: MI provider tier overlays missing

**What goes wrong:**
MI is required on conventional loans >80% LTV. The MI provider sets its own underwriting standard, which functions as a hidden overlay on top of agency rules. Examples:
- Some MI providers won't insure FICO < 660 even though FNMA permits down to 620 with overlays
- Some MI providers won't insure investment property MI; some only insure primary
- Some MI providers tier rates by DTI bands above 45%
- Multi-bureau-out borrowers (single-bureau FICO) face MI provider restrictions
- COVID-era MI provider overlays (post-March 2020) tightened on cash-out and self-employed; some have not fully relaxed

A program is "agency-eligible" but "not MI-insurable" → effectively ineligible. PPEs that don't model MI overlays return false-positive eligibility on >80% LTV scenarios.

**Why incumbents simplify it:**
MI-provider overlay is treated as a downstream lender problem. The lender selects MI at lock time. PPEs often surface "MI required" as a checkbox without modeling which provider's rules apply.

**Warning signs:**
- Result for an 85% LTV scenario doesn't mention which MI provider is used
- No `eligibleMiProviders: [...]` per program
- No MI provider FICO/LTV/occupancy overlays in the data model

**Prevention strategy:**
Phase 0 schema includes MI providers as a layer (`MI_PROVIDER` overlay layer in the rules layering). Phase 1 acceptable shortcut: model MI provider overlays as a flat "tightest of any MI overlay this lender uses" — gets you 80% of correctness without the per-provider matching. Phase 2 hardens to per-program-per-provider matching.

**Phase to address:** Phase 0 (layer model accommodates MI), Phase 1 (tightest-MI-overlay heuristic), Phase 2 (per-provider modeling).

**Impact if missed:**
Specific false-positive class on >80% LTV scenarios. Smaller volume than Pitfalls 1.1-1.3 but a recognizable category.

---

### Pitfall 1.14: Manual underwriting paths absent

**What goes wrong:**
DU/LPA "Approve/Eligible" is the common path; "Refer/Eligible" or "Manual UW" is the long tail that incumbents skip. Manual underwriting for FHA below 620 FICO is *required* (per HUD 4000.1 / 2025 guidance). Manual UW has its own DTI ceilings, compensating-factor requirements (3 months reserves, payment shock <5%, residual income, additional income), and is allowed only on certain occupancies.

A scenario that DU would Refer might be Manual-UW-eligible at one lender and not at another (lender overlay). Eligibility engines that assume "AUS Approve required" return false-negative on legitimate manual-UW scenarios.

**Why incumbents simplify it:**
Manual UW is a small percentage of volume and varies sharply by lender. Most PPEs skip it.

**Warning signs:**
- No `manualUwAllowed` flag per program
- No compensating-factor capture in LO scenario
- AUS outcome treated as binary (approved/not-approved) rather than as state (Approve/Refer/Manual)

**Prevention strategy:**
- LO scenario accepts `ausOutcome: APPROVE_ELIGIBLE | REFER_ELIGIBLE | INELIGIBLE | MANUAL_REQUIRED | NONE`.
- Programs declare per-program manual-UW acceptance and required compensating factors.
- Evaluator surfaces "Eligible via Manual Underwriting (requires X compensating factor documentation)" as a distinct result class, separate from standard eligible.

**Phase to address:** Phase 1 (form + evaluator branch). Phase 0 schema must accommodate the AUS-outcome state field.

**Impact if missed:**
Recall hit on FHA-below-620 and DTI-above-43 scenarios with strong compensating factors. Wedge-relevant for manual-UW-strong lenders.

---

### Pitfall 1.15: Forbearance / modification post-COVID rules treated as long-tail derog

**What goes wrong:**
COVID forbearance is *not* a derogatory event under FNMA rules:
- Borrowers who reinstated (paid the missed amounts in full): no waiting period
- Borrowers who exited via repayment plan / payment deferral / loan modification: 3 consecutive on-time payments under the new terms, then eligible
- Forbearance plans entered post-COVID under non-COVID hardship may have lender-overlay restrictions

A naive treatment that buckets "forbearance" with "BK7" and applies a multi-year wait is wrong.

**Why incumbents simplify it:**
Forbearance as a credit event has been moving rapidly since 2020. The CARES Act provisions, the GSE flex policies, and the post-pandemic rule snapback created a sequence of changes that's hard to keep current.

**Warning signs:**
- "Forbearance" listed as a derogatory event with a fixed waiting period
- No distinction between "reinstated" and "modified" forbearance exits
- No effective-date tracking on the forbearance rules (which were COVID-flexed)

**Prevention strategy:**
Schema models forbearance as a distinct event type with sub-states: `forbearanceExitType: REINSTATED | REPAYMENT_PLAN | DEFERRAL | MODIFICATION | STILL_ACTIVE`. Evaluator branches per agency rule. Document the specific FNMA / FHLMC / FHA / VA forbearance rules and their effective dates.

**Phase to address:** Phase 0 (schema), Phase 1 (evaluator).

**Impact if missed:**
Recall hit on the population of post-COVID forbearance-exit borrowers, who are a non-trivial cohort in 2024-2026.

---

## Bucket 2: Extraction-Pipeline Correctness

These pitfalls hit the AM correction-rate KPI (<10% by month 6) and threaten the "AI-assisted matrix extraction" pillar of the wedge.

### Pitfall 2.1: FICO×LTV grid extraction loses cell→value alignment

**What goes wrong:**
Lender matrices typically present FICO×LTV as a 2D grid where rows are FICO bands and columns are LTV bands (or vice versa). The cell value is "OK / Not Eligible / 90% / 95%" or similar. Common extraction failures:
- LLM extracts the cells as a flat list, losing row-column association
- Merged cells (e.g., "FICO 720+, all LTVs eligible") get duplicated or dropped
- Diagonal cells (where the table author drew a strikethrough) become "STRIKETHROUGH" text rather than "ineligible" semantics
- Table is rotated or split across pages → extraction stitches incorrectly
- The grid has hidden column headers (above the table, not above each column) → values lose column meaning

A grid with 6 FICO bands × 7 LTV bands = 42 cells. One misalignment cascades — every cell to the right of the misalignment is wrong.

**Why incumbents-with-extraction simplify it:**
LLM extraction without strong table-structure scaffolding hallucinates plausible numbers. Pure-text-extraction tools (PyPDF2, pdfminer) lose the 2D structure entirely. Production extraction needs a layout-preserving step before the LLM.

**Warning signs:**
- Extracted matrix returns 35 cells when the source has 42 (off by row or column count)
- Row/column header values appear as cell values
- Diagonal-strike cells extracted as eligibility values rather than as ineligible markers
- Manual AM review consistently catches FICO×LTV cell errors

**Prevention strategy:**
Two-phase extraction:
1. **Layout phase**: use a layout-preserving parser (pdfplumber, Camelot, AWS Textract, Azure Document Intelligence, Reducto, or similar) to extract the table as a 2D structured object with explicit row/column headers and cell values. Validate that the 2D shape matches the page rendering.
2. **Semantic phase**: feed the structured 2D table to the LLM with a prompt asking it to interpret each cell value (translate "—", "N/A", "X", strikethroughs, "Ineligible" into a normalized ELIGIBLE | INELIGIBLE | NUMERIC enum).

Cell-level extraction validation: for each cell, the LLM emits `{row: "FICO 660-679", col: "LTV 80-85", value: "ELIGIBLE", confidence: 0.92, sourceText: "exact text from cell"}`. The AM review UI shows cell-by-cell with the source PDF cell highlighted.

For diagonal-strike cells: the layout parser must detect the strike line as a graphical element. If it can't, prompt the LLM with instructions: "Cells with a strike-through pattern indicate INELIGIBLE — emit value INELIGIBLE." Validate by sampling: known strike-cells should emit INELIGIBLE.

**Phase to address:** Phase 0 (extraction architecture), Phase 1 (extraction implementation + AM review UI).

**Impact if missed:**
Direct hit on AM correction rate KPI. If 5% of cells are wrong on a 42-cell grid, the AM is correcting 2 cells per matrix — that's the entire corrective-effort budget for one matrix.

---

### Pitfall 2.2: Footnotes lose anchor to the cell they modify

**What goes wrong:**
Lender matrices use footnotes heavily. A FICO×LTV cell might say "90¹" with footnote 1 saying "Limited cash-out only, primary residence, 12 months reserves required." The footnote often appears at the bottom of the page or on a separate page. Common failures:
- LLM extracts the cell as "90" and drops the footnote indicator
- LLM extracts the footnote as separate text, losing the cell-anchor
- Footnotes are shared across multiple cells; LLM duplicates the constraint into one cell and loses it from the others
- Footnotes reference other footnotes (chained); LLM loses the chain
- Footnotes are visually separated by line breaks but logically continuous; LLM splits them wrong

Lost footnotes = silent constraint loss = false-positive eligibility.

**Why this is hard:**
Footnote anchors are visual artifacts (superscript glyphs, asterisks). PDF text streams often present them as inline characters without spatial relationship to the cell. The footnote text is structurally separate from the cell text.

**Warning signs:**
- Extracted cells lack `footnoteRefs: ["1", "2"]`
- Footnotes extracted as separate text entries with no cell association
- AM review catches "constraint missing from cell" errors
- Eligibility verdicts demonstrably wrong on cells with footnotes

**Prevention strategy:**
- Layout phase preserves superscript glyphs and tracks their position in the cell.
- LLM prompt explicitly asks: "List the footnote reference numbers attached to this cell value."
- Footnote text itself is extracted as a separate `Footnote` object with `noteId` and `noteText`.
- Schema attaches footnotes to cells: `cell.footnoteRefs: ["1", "2"]`. Eligibility evaluator must apply every footnote constraint that fires on the matched cell.
- AM review UI shows the cell with its footnotes attached and the source PDF showing the footnote location.
- Validation rule: every footnote in the source PDF must have at least one cell pointing to it. Orphan footnotes are an extraction failure flag.

**Phase to address:** Phase 0 (schema includes cell-footnote linkage), Phase 1 (extraction prompt design + AM review).

**Impact if missed:**
Single highest-frequency source of false-positive eligibility decisions in matrix-driven products. The constraints that aren't extracted don't fire in the evaluator. Direct precision hit, hard to detect without comprehensive AM review.

---

### Pitfall 2.3: Lender matrix layout drift across versions breaks extraction silently

**What goes wrong:**
A lender publishes "Non-QM Bank Statement Matrix v3.2" in March, then v3.3 in May with the same columns reordered or renamed. An extraction pipeline that hardcoded "FICO is column 2" against v3.2 produces wrong results against v3.3 without erroring. The product silently degrades.

This is especially common when:
- Lender adds a new product and shifts the existing programs over by one column
- Lender renames "Min FICO" to "Min Credit Score" or "Cred Score Floor"
- Lender changes the LTV banding ("80-85" becomes "≤85, >80")
- Lender consolidates multiple products into a single matrix

**Why this is hard:**
Layout drift is a covariate shift, not a pipeline bug. The extraction completes successfully and produces plausible output; only careful comparison detects the drift.

**Warning signs:**
- Extraction confidence stays high but field-level values change between versions
- Source-document fingerprint changes but the extracted rule object barely changes (suggests over-fit caching)
- AM review catches "this column is now FICO not LTV" errors

**Prevention strategy:**
- Per-program-version source-document fingerprint (already in PRD). Detect when fingerprint changes.
- On version change, compute the diff between v3.2 extracted rules and v3.3 extracted rules. AM reviews the diff, not the full matrix.
- Layout phase emits a layout signature (row count, column count, header text). Sharp changes in signature trigger a "layout drift detected" warning to the AM.
- Header normalization: "Min FICO", "Min Credit Score", "Cred Score Floor" map to a canonical `MIN_FICO` field via a header dictionary that's curated and grows over time.
- Test set: golden extractions from prior versions. Re-running extraction against an old PDF must produce the same rule object (idempotency check).

**Phase to address:** Phase 1 (versioning + diff review). Phase 0 schema must include the per-version fingerprint.

**Impact if missed:**
Slow degradation. AM correction rate creeps up over time as more versions land. Hard to attribute to a specific cause.

---

### Pitfall 2.4: OCR misreads on low-contrast or scanned matrices

**What goes wrong:**
Lender matrices come in two flavors:
- **Native-text PDFs**: text layer extractable by PDF library directly, ~99% character accuracy
- **Scanned PDFs**: image of a printed page, requires OCR. Accuracy drops to 79-88% under ideal conditions, 28-62% with skew/blur/low contrast (Jumio 2019 study)

Common OCR errors that produce wrong eligibility:
- "0" vs "O" vs "Ø" (decimal placement: 80% becomes 8O%)
- "1" vs "l" vs "I" (FICO 100 vs FICO IOO)
- "5" vs "S" (LTV 5 vs S)
- Decimal point / comma confusion ("1,000,000" vs "1.000.000")
- Strikethrough lines parsed as letters

**Warning signs:**
- Extracted numeric values that don't make sense (FICO 8OO, LTV 1OO%)
- AM review consistently corrects single-character substitutions
- Confidence scores high but values nonsensical
- Source PDF doesn't have a selectable text layer

**Prevention strategy:**
- Detect scanned vs. native PDFs at upload time (presence/absence of text layer).
- For scanned PDFs: re-OCR at 300 DPI minimum; preprocess for skew correction and contrast enhancement.
- Schema-level validation: numeric ranges (FICO must be 300-850; LTV must be 0-100; loan amounts must be > 50000). Out-of-range values flag the cell as extraction-failed.
- Cross-validation against domain dictionaries: "FICO 8OO" — if the OCR has "OO" emit a confidence penalty and prefer "FICO 800."
- For low-confidence cells, present the cropped source-image patch alongside the extracted value in the AM review UI for easy visual confirmation.

**Phase to address:** Phase 1 (extraction pipeline, OCR strategy).

**Impact if missed:**
Direct AM correction rate hit on scanned matrices. Common in smaller-lender source documents.

---

### Pitfall 2.5: Multi-program PDFs with shared headers create cross-program contamination

**What goes wrong:**
A lender publishes "Q4 2025 Wholesale Programs" as a single PDF with 8 programs. Each program shares a header section ("All programs require…"), and each program has its own matrix. Extraction failure modes:
- Shared overlay constraints don't get applied to each program
- Constraints from program 5 leak into program 4 (boundary detection failure)
- Page-spanning programs lose their boundary
- Common header overlay applied to programs that explicitly opt out

**Why this is hard:**
Document segmentation requires understanding the narrative structure of the document, not just the visual layout. Section boundaries are sometimes marked clearly (page break, large header), sometimes only by a small bold line.

**Warning signs:**
- Programs have nearly-identical extracted rules (over-application of shared header)
- Programs have wildly different rules where they should be similar (boundary leakage missed)
- Same source PDF produces N programs with N+1 or N-1 in the extraction output

**Prevention strategy:**
- Document segmentation phase: split the multi-program PDF into per-program sections before extraction, using header-detection heuristics + LLM-assisted section identification.
- Extraction prompt explicitly asks: "What is the program name for the section starting on page X?" and validates the answer against the page header text.
- Shared-overlay extraction: identify shared constraints up front, apply to every program in the document, allow per-program opt-out via "Program X excludes this overlay" detection.
- AM review presents per-program scoped extractions, not a single document-wide blob.

**Phase to address:** Phase 1 (extraction segmentation logic).

**Impact if missed:**
Direct AM correction rate hit. Can produce silent wrong-by-design results when shared overlays don't fire.

---

### Pitfall 2.6: LLM hallucination of rules not in the source matrix

**What goes wrong:**
LLMs generate plausible-but-fabricated content when source ambiguity is high. In matrix extraction, this manifests as:
- Inventing a footnote constraint that isn't in the source
- Filling in a "typical" FICO floor of 620 when the source omits it
- Adding "borrower must have 12 months reserves" when the source doesn't say so
- Generating a `purposeRestriction: ["PURCHASE", "RATE_TERM_REFI"]` based on training-data prior knowledge of this program type, when the actual source matrix permits cash-out

This is the highest-stakes extraction failure: the system reports a rule with high confidence, the AM doesn't catch it because the rule sounds normal, and the rule fires in production producing wrong eligibility.

**Why this is hard:**
Hallucinated rules look "right." They're consistent with the lender's typical product lineup. Detection requires source-grounding verification at extraction time, not just at review time.

**Warning signs:**
- Rules emit with high confidence but no `sourceCitation` field populated
- Rule references concepts ("compensating factors", "extenuating circumstances") that don't appear in the source PDF text
- Extracted rules from a thin matrix (1 page) have more constraints than from a thick matrix (10 pages) of a similar lender

**Prevention strategy:**
- **Citation discipline at the prompt level**: every emitted rule MUST include `sourceCitation: { page: int, bbox: [x,y,w,h], textSpan: "exact text from PDF" }`. Rules without citation are rejected at the extraction-pipeline level, not at AM review.
- **Citation validation**: post-extraction, verify the `textSpan` actually appears in the page text at the specified bbox. Mismatched citations → rule rejected, queued for re-extraction or manual entry.
- **Counter-example testing**: for each lender, maintain a small "what's NOT in the matrix" set. If extraction produces a rule that's in the not-in-matrix set, flag for review.
- **Constraint provenance**: every constraint has a chain back to the textSpan. If multiple constraints share a span, that's fine; if a constraint has no span, it's hallucinated.
- **Two-pass extraction with consistency check**: run extraction twice with different prompts; rules that don't appear in both runs are flagged. (Expensive but valuable for high-confidence rules that disqualify borrowers.)
- **No silent fill-in**: prompt explicitly forbids "if the matrix doesn't specify, assume X" — every rule must come from the source.

**Phase to address:** Phase 0 (citation requirement in schema), Phase 1 (extraction pipeline implementation). This is non-negotiable for the wedge.

**Impact if missed:**
Direct precision KPI hit. Hallucinated disqualifying rules produce false-negative eligibility (recall hit). Hallucinated permissive rules produce false-positive eligibility (precision hit). Both are bad. This is the failure mode that destroys the "AI extraction with confidence scoring" credibility.

---

### Pitfall 2.7: Conflicting tables in a single PDF

**What goes wrong:**
A lender PDF often contains:
- The "headline" matrix (purchase/primary)
- A separate "second home" matrix
- A separate "investment property" matrix
- A "minimum FICO by occupancy" reference table
- A "max LTV by FICO band" reference table

These tables can conflict: the headline matrix shows 80% LTV at 700 FICO; the reference table shows 75% at 700. The reference table's footnote says "for second home only" but the table was on the primary-residence page. Resolution depends on the page context, the footnote scope, and the lender's drafting conventions.

**Why this is hard:**
Conflict resolution requires understanding which table governs which scenario type. LLMs do not natively understand precedence; they extract both tables and emit conflicting rules.

**Warning signs:**
- Schema has multiple rules for the same (FICO band, LTV band, occupancy) with different values
- AM review surfaces "which max LTV applies?" questions
- Per-program rule count is unusually high (3x the typical program rule count)

**Prevention strategy:**
- Schema enforces that for any (program, scenario-axis) tuple there's a single binding rule. Multiple matches trigger a conflict-resolution step at extraction time.
- Conflict resolution is encoded as a precedence rule: occupancy-specific tables override general matrix; loan-program-specific tables override agency tables; product-feature tables override loan-program tables.
- "Most restrictive wins" is the default tie-breaker, matching the PRD's layering rule.
- AM review presents conflicts explicitly: "These two extracted rules disagree. Which applies in the (Primary, Purchase, FICO 700, LTV 80) scenario?"

**Phase to address:** Phase 0 (rule layering + precedence in schema), Phase 1 (extraction conflict resolution).

**Impact if missed:**
Eligibility evaluator returns inconsistent verdicts (run twice, get different answers if rule selection is non-deterministic). Trust collapse.

---

### Pitfall 2.8: Citation discipline neglect ("trust the model")

**What goes wrong:**
The temptation: ship extraction with the citation field as nice-to-have. When extraction confidence is high (>95%), the AM accepts without verifying the source. Over time, hallucinated high-confidence rules accumulate in the index. When precision drops, root-causing requires going back through every rule.

**Why this is tempting:**
Citation discipline doubles the AM review effort initially and slows the onboarding-time-per-program KPI. There's a real tradeoff against the 45-min/15-min targets.

**Prevention strategy:**
- **Schema-level enforcement**: rules without `sourceCitation` cannot persist in the database. Hard constraint, not soft validation.
- **Confidence-citation interaction**: `confidence: 0.99` with empty `sourceCitation` auto-rejects.
- **Bulk-accept above 95%** is permitted, but the citation must still be present and the source-text-span must be validated to exist in the source PDF (cheap server-side check).
- **Periodic random audit**: 1% of high-confidence rules are sampled for AM re-review monthly. Audit precision is reported as a KPI distinct from total precision — if audit precision drops below 99%, raise the bulk-accept threshold.

**Phase to address:** Phase 0 (schema), Phase 1 (audit cadence). The 45-min onboarding target is achievable WITH citation discipline if the extraction pipeline emits citations natively.

**Impact if missed:**
Existential. The wedge is "extraction with confidence scoring." Without enforced citation discipline, the confidence scores are decoration.

---

## Bucket 3: Operational / Business

These pitfalls don't show up as KPI misses. They show up as letters from a law firm.

### Pitfall 3.1: Optimal Blue antitrust class action (Oct 3, 2025) reshapes the data-licensing posture for new entrants

**What goes wrong:**
On October 3, 2025, four homeowners filed an antitrust class-action lawsuit (`Smith et al. v. Optimal Blue, LLC et al.`, M.D. Tenn.) against Optimal Blue and 26 of the largest mortgage lenders. The complaint alleges:
- Optimal Blue's **Pricing Insight** and **Competitive Analytics** / **Competitive Data License** tools facilitate price-fixing by enabling lenders to exchange non-public, real-time, granular pricing data
- Economic analysis shows mortgages issued via OB users carry rate spreads ~2.68 bps (~49.2%) higher than non-OB-user mortgages from 2020-2024
- Plaintiffs seek treble damages and a permanent injunction barring use of OB's analytics tools

This complaint isn't directly against new entrants. But it sets the standard for what kinds of competitive-pricing data exchange are now considered antitrust-actionable. Specifically: **showing one lender what another lender's confidential pricing/eligibility data is** — even in aggregate, even anonymized — is now legally exposed in a way it wasn't before October 2025. The DOJ Algorithmic Pricing antitrust posture (RealPage, etc.) reinforces this trend; AI-driven price coordination is a 2025-2026 enforcement priority.

For Lender Search specifically:
- A multi-lender comparison surface is core to the LO use case (compare 4 programs side-by-side)
- Per-lender confidential data (pricing, internal LLPAs, exclusive overlays) cannot be exposed across tenants
- "Competitive analytics" features that benchmark Lender X against Lender Y are antitrust-exposed
- Even the appearance of facilitating competitive intelligence between lenders is risky

**Why this is easy to miss:**
The first instinct on a multi-lender PPE is "show LOs what every lender offers." That's the use case. The line is between *providing decision support to an LO with a borrower scenario* (legitimate) and *enabling lenders to see each other's data* (antitrust-exposed). The line gets blurry when the same vendor curates the data and serves both LOs and lenders.

**Warning signs:**
- "Pricing Insight"-style features in the roadmap (cross-lender pricing benchmarks)
- Lender X's overlay visible inside Lender Y's tenant
- Lender-to-lender comparative reports
- Aggregate "industry pricing" reports that lenders pay for
- Any feature where lender admins can see competitor pricing

**Prevention strategy (matching PRD Out of Scope decisions):**
- **Eligibility-only at MVP**: do not surface live pricing in v1. The OB complaint is centrally about pricing data exchange.
- **Strict tenant isolation from day one**: a brokerage's `LENDER_OVERLAY` is only visible inside that tenant's scope. No cross-tenant data egress.
- **No "Pricing Insight"-style features ever**: explicitly off the roadmap (PRD already has this). Document this as a permanent constraint.
- **Lender-facing analytics scoped to own data only**: a lender admin sees their own programs and overlays; not other lenders'.
- **LO-facing comparison is per-borrower-scenario only**: the LO compares 4 programs FOR ONE BORROWER. They don't get a "Lender X charges 25 bps more than Lender Y for FICO 700+ purchases" report.
- **Data-licensing terms with each lender**: written license-to-use for the published guideline matrix only; explicit prohibition on aggregating their data into competitive-intelligence outputs.
- **Liability framing in ToS**: decision-support, not credit decision; LO is responsible for verifying with the lender; no representation that comparison reflects competitive market intelligence.

**Phase to address:** Phase 0 (architecture must enforce tenant isolation; scope decisions); ongoing legal review at Phase 2 transition (live pricing) and Phase 3 (cross-LO collaboration).

**Impact if missed:**
Existential. A class-action lawsuit against a solo-developer-stage startup ends the company regardless of merit. Defensive legal posture: stay clearly in "decision support to one LO with one borrower" use case, never in "competitive intelligence between lenders" use case.

---

### Pitfall 3.2: Liability framing — "decision support, not credit decision" must be load-bearing in ToS, UI, and audit trail

**What goes wrong:**
A borrower is told by an LO "you qualify for this program" based on Lender Search's eligibility verdict. The borrower makes financial decisions (deposit on a house, lease termination). The lender's underwriter declines the loan. Borrower sues the LO; LO's E&O carrier subrogates to Lender Search.

The defense rests on:
1. **Disclaimer language**: every result presentation says "decision support, not credit decision; verify with lender."
2. **Confidence badges**: low-confidence rules are visibly flagged.
3. **Versioned audit trail**: at scenario time, exactly which rule fired, what its source was, what its confidence was.
4. **ToS liability cap**: contractually limited damages.
5. **No representation as "underwriting"**: marketing language never claims the product underwrites loans.

If any of these is weak, the defense weakens. Candor's framing is instructive: they back their underwriting decisions with an AAA-rated insurer warranty up to 60 months post-closing — that's a different posture (active risk transfer) and Candor is selling to lenders, not LOs. Lender Search is decision-support tooling for LOs and explicitly should not represent the underwriting-warranty posture until/unless E&O insurance is structured (Phase 3 forward path per PRD).

**Why this is easy to miss:**
The product feels like "the LO's tool"; the LO uses it; the LO interfaces with the borrower. The liability is one degree removed but real.

**Warning signs:**
- Marketing copy uses words like "approved," "qualified," "decision," "underwrites"
- UI returns "ELIGIBLE" without an accompanying "verify with lender" disclaimer
- No confidence badge on result rows
- Audit trail doesn't capture which agency/program/lender version was active at scenario time
- ToS lacks a liability cap

**Prevention strategy:**
- Result presentation language: "Eligible based on indexed program rules — verify with lender" (not "Approved")
- Confidence badge on every result row that was decided by a confidence < 95% rule
- Audit trail entry for every scenario evaluation: scenario snapshot, program version, agency version, deciding rule, deciding rule's confidence, citation
- ToS includes liability cap (typical: cap at 12 months of paid fees) and explicit "decision support" framing
- Scenario presentation explicitly distinguishes "Eligible per indexed rules" from "Underwriting decision"
- Marketing site, sales decks, and demos consistently use the decision-support frame

**Phase to address:** Phase 0 (ToS draft, audit-trail data model), Phase 1 (UI disclaimer and confidence badges), ongoing in every customer interaction.

**Impact if missed:**
First lawsuit ends the company. Even a meritless suit costs more in legal fees than a bootstrapped solo company has.

---

### Pitfall 3.3: Lender data licensing not negotiated up front

**What goes wrong:**
Lender X publishes their wholesale rate sheet and matrix on their broker portal. Lender Search downloads it (with an account or not), extracts it, and indexes the rules. Lender X's terms of service for the portal say "for internal lender business use only; not for redistribution or aggregation." Lender Search is now in violation of TOS, exposed to a cease-and-desist or worse.

This is the data-acquisition mirror image of the Optimal Blue antitrust posture. OB has explicit lender data-license agreements; their problem is what they do with the aggregated data. A new entrant without explicit licenses is in worse shape because they don't have a leg to stand on.

**Why this is easy to miss:**
"It's published" is not "it's licensed for our use." Mortgage industry guideline matrices are intellectual property. Indexing without a license is exposed.

**Warning signs:**
- Matrices are scraped from broker portals without lender-onboarding consent
- Lender lists are populated faster than relationships are formed
- No record of which lenders have signed a data-license agreement
- "Coverage" KPI prioritized over relationship-formation KPI

**Prevention strategy:**
- **Lender onboarding includes a written license-to-use** for the matrices the lender publishes through their wholesale channel. The license grants Lender Search the right to extract, index, normalize, and display rules for the purpose of LO decision-support.
- **License explicitly prohibits competitive intelligence or aggregation outside the per-LO use case**, matching the antitrust posture.
- **No matrix is indexed without a corresponding signed license.** Phase 0 schema includes `lenderLicenseId` on every program; programs without a license cannot be made active.
- **Account manager workflow** (Phase 1) starts with license confirmation before AM review of the matrix.
- **Public rate sheets** (those with no portal login required) are a different category but still warrant a "published rate-sheet aggregation" license terms understood with the lender.

**Phase to address:** Phase 0 (license requirement in schema, contract template), Phase 1 (AM workflow gate), ongoing.

**Impact if missed:**
Cease-and-desist letters. Lost programs. Reputational damage with target lender population.

---

### Pitfall 3.4: Stale guidelines — agency Selling Guide cascade not detected

**What goes wrong:**
FNMA publishes a Selling Guide update (these come monthly). The change affects, say, condo project insurance requirements (the per-unit deductible cap going to $50K effective July 2026). 100 indexed programs reference the old rule. The new rule fires for every program. If the cascade isn't detected, every indexed program's condo eligibility is wrong starting July 2026.

Same pattern: HUD 4000.1 updates, VA Pamphlet 26-7 updates, FHFA loan-limit annual updates (every November), FHA MIP changes, GSE LLPA changes (every March-ish), FHFA Selling Guide updates. The agency-rule layer is the foundation; changes cascade through every program that references that layer.

**Why this is hard:**
Each agency has its own update cadence and notification mechanism. FNMA publishes Selling Guide announcements. HUD publishes Mortgagee Letters. VA publishes Circulars. FHFA publishes Notices. None of them have an API; they publish PDFs and HTML pages. Detecting "rule X changed" requires either (a) parsing every announcement and matching to indexed rules, or (b) periodic re-extraction of the agency rule sets and diff detection.

**Warning signs:**
- Agency rules in the index have not been refreshed in 90+ days
- Programs reference an agency rule version that's no longer current
- LO scenarios using "FHA Back to Work" or other deprecated programs return eligible (Pitfall 1.4)
- AM review queue has no "agency cascade alert" mechanism

**Prevention strategy:**
- Agency rules are versioned with effective-date brackets. Each rule has `effectiveStart: date`, `effectiveEnd: date | null`.
- Programs reference an agency-version pointer, not an agency-rule snapshot. When the agency version updates, every dependent program is flagged for review.
- **Cascade detection workflow**: on agency rule update, the system creates a system-level review queue listing every (program, rule) pair that references the changed agency rule. AM reviews the queue and decides per program whether the agency change pulls through, is overridden by the lender's overlay, or requires a new lender-matrix re-extraction.
- **Subscription to agency announcements**: at minimum, scrape the FNMA Selling Guide announcements page weekly. Phase 2 adds Mortgagee Letters and VA Circulars.
- **Effective-date brackets** in the schema let the evaluator return "this scenario at this effective date used rule version X" — auditable.

**Phase to address:** Phase 0 (versioning + cascade architecture in schema), Phase 1 (AM cascade-review queue), Phase 2 (announcement scraping).

**Impact if missed:**
Slow precision degradation, hard to attribute. Liability exposure if a borrower's eligibility verdict was based on a rule that was superseded before the scenario was run.

---

### Pitfall 3.5: Tenant isolation breached by "shared overlay" convenience features

**What goes wrong:**
Brokerage A has its `LENDER_OVERLAY` layer with their internal "no-cash-out below 700 FICO" rule. Lender Search's product person says "let's offer a 'industry overlays' aggregate view to help small brokerages benchmark." Brokerage B sees Brokerage A's overlay in the aggregate. Brokerage A discovers it. Lawsuit.

Or: a "shared rule library" feature lets a brokerage admin import overlays from the public library. The library was seeded with overlays from Brokerage A's tenant. Same problem.

**Warning signs:**
- "Aggregate insights" or "shared rule library" feature proposals
- Cross-tenant data queries in the codebase
- Database schema lacks tenant_id on overlay tables
- Internal "anonymized benchmarking" features

**Prevention strategy:**
- Database schema has `tenant_id` on every overlay-layer row. Queries are tenant-scoped at the ORM level. Cross-tenant queries require explicit elevated permission and are logged/audited.
- Per-tenant data egress controls: API endpoints can return data only from the requester's tenant.
- "Industry insights" features either operate on agency-base / investor-overlay layers (vendor-curated, not tenant-specific) or are prohibited.
- The PRD already has this in Out of Scope ("Cross-tenant overlay visibility"); enforce it architecturally, not just in product policy.

**Phase to address:** Phase 0 (schema + ORM-level tenant scoping). This is foundational; retrofitting is high-risk.

**Impact if missed:**
Tenant trust collapse + legal exposure. A breach is hard to recover from in a multi-tenant SaaS.

---

### Pitfall 3.6: Broker-channel vs. retail-LO vs. wholesale-AE channel conflation

**What goes wrong:**
The PRD calls out broker MLOs as the default ICP but flags retail LOs and wholesale AEs as alternatives deferred to research. The conflation risk:
- A retail LO works for a single lender and has the lender's overlays loaded by default. Their PPE use case is "what programs at MY lender does this borrower qualify for?" — single-lender.
- A broker MLO works across many lenders and needs the multi-lender comparison. Their use case is "what programs at any of my available lenders does this borrower qualify for?" — many-lender, with a brokerage overlay.
- A wholesale AE works for a lender and supports brokers. Their use case is "for this scenario, what's the right program at MY lender?" — single-lender, scenario-curated for the broker on the other end.

A product design that treats all three the same misses the wedge for each. Single-tenant retail-LO products are fine; many-lender broker products are fine; AE-facing products are fine — but the data model, tenant model, and UX are different per channel.

**Why this is easy to miss:**
"It's a search UI for LOs" sounds like one product. The channel-specific variations are second-order until you hit them.

**Warning signs:**
- LO scenario form doesn't capture "who is this LO?" (broker vs. retail vs. AE)
- Pricing model assumes one persona
- No per-tenant channel configuration

**Prevention strategy:**
- Phase 0 schema accommodates a per-tenant channel: `BROKERAGE` | `RETAIL_LENDER` | `WHOLESALE_LENDER`. Default settings differ (broker tenants see all programs from licensed lenders; retail tenants see only their own lender's programs).
- Phase 1 ships the broker-channel variant (per PRD). Wholesale AE channel and retail variant are explicit Phase 2/3 decisions.
- Channel-specific pricing model: per-LO (retail) vs. per-brokerage-seat (broker) vs. per-AE (wholesale).

**Phase to address:** Phase 0 (channel as schema concept), Phase 1 (broker-channel implementation), defer others per PRD.

**Impact if missed:**
Strategic confusion. Trying to serve all three channels with one product spreads the wedge thin.

---

### Pitfall 3.7: AUS scope creep into "we replace DU/LPA"

**What goes wrong:**
The PRD explicitly excludes AUS submission as out of scope: "accept AUS outcome as scenario input, never as output." The temptation under the "we have all the rules; why not run AUS ourselves?" framing is real and dangerous:
- DU and LPA are proprietary, GSE-controlled systems. Running an AUS-equivalent is a regulatory and IP minefield.
- Borrowers and lenders trust the AUS output specifically because it carries the GSE's representation. A third-party "shadow AUS" carries no such weight.
- The work effort to maintain AUS-equivalence is massive and ongoing.

If the eligibility evaluator drifts into "well, here's what DU would have decided" framing, the product loses its decision-support positioning and acquires AUS-replacement risk.

**Why this is tempting:**
Once you have agency rules + lender overlays + AUS-acceptance metadata, the gap to "run AUS" feels small. It is not. The gap is in the rep-and-warrant the GSE makes about the AUS output, and that gap is uncrossable for a third party.

**Warning signs:**
- Roadmap items use words like "automated underwriting" or "AUS replacement"
- Marketing language drifts from "decision support" to "underwriting"
- Result presentation reads like an AUS findings report

**Prevention strategy:**
- Hard PRD-level boundary: the product accepts AUS outcome as a scenario input, never produces AUS-equivalent output.
- Result presentation explicitly says "Eligibility per indexed rules" — not "Approve / Refer / Manual" (AUS-style outcomes).
- Disambiguation in marketing: "find programs the borrower qualifies for; submit to the lender for AUS."

**Phase to address:** Ongoing scope discipline.

**Impact if missed:**
Existential — third-party AUS-equivalent is a regulatory minefield. Also a moat-destroyer; the wedge is decision support, not underwriting replacement.

---

## Bucket 4: Solo-Dev Execution

These are the pitfalls of being one person trying to ship correctly under quality gates.

### Pitfall 4.1: Building a UI before the schema is stable

**What goes wrong:**
The temptation: "I want to see this work." Build a search form, see results render, feel motion. The cost: the schema isn't fully shaped yet. Every schema iteration cascades through the UI. Each iteration costs more than the last. By the time the schema settles, the UI is half-rebuilt and the developer is exhausted.

The PRD already enforces "Phase 0 before any UI work" as a key decision. The pitfall is not respecting it.

**Warning signs:**
- React component scaffolding before the rule schema is locked
- LO scenario form built before the borrower-scenario data model is locked
- Result presentation built before the evaluator output is locked
- "Just a quick prototype" that becomes the foundation

**Prevention strategy:**
- Phase 0 deliverables are: (1) rule schema, (2) borrower scenario shape, (3) evaluator with structured output, (4) golden test set, (5) extraction pipeline producing schema-shaped output. None of these has a UI. They're all CLI-runnable.
- Phase 1 starts when Phase 0 hits its KPI gates (golden-set precision/recall pass). Until then, no UI.
- The discipline is: if you find yourself wanting to build a UI to "feel progress," instead expand the golden set to feel progress in correctness. The KPI is the wedge.

**Phase to address:** Phase 0 discipline. The PRD already locks this in; the developer must hold the line.

**Impact if missed:**
Schema instability cascades. 2-4 weeks of wasted UI work on each schema rev.

---

### Pitfall 4.2: Premature optimization on the rule engine

**What goes wrong:**
The rule engine is the wedge. The temptation: optimize for performance early ("let's index every rule for fast lookup," "let's compile rules to a finite-state machine"). The optimizations introduce complexity that makes correctness harder to verify. Bugs hide in the optimization layer.

At Phase 1 MVP scale (50 programs), a rule engine that evaluates every program linearly takes <100ms even on a bad day. Performance is not the bottleneck.

**Warning signs:**
- Talk of compiled rule engines, FSMs, or rule indices before the rules are correct
- Premature caching layers
- Pre-computed eligibility tables
- "It runs in 5ms" as a milestone before "it returns the right answer"

**Prevention strategy:**
- Phase 1 evaluator is a straightforward linear pass: for each program, evaluate each rule against the scenario, return the first failing rule. Maybe a few tens of ms per scenario.
- Performance optimization happens when the P50/P95 latency targets (≤2s / ≤5s per PRD) are at risk, not before.
- Correctness has 100x the priority of performance in Phase 0/1. Phase 2 may revisit if the program count grows past 250.

**Phase to address:** Phase 1 discipline.

**Impact if missed:**
Bugs hide in optimization. Rebuild cost on a bad rule engine: weeks.

---

### Pitfall 4.3: Golden set self-selection bias

**What goes wrong:**
The 200-scenario golden set is the precision/recall measurement instrument. If the developer writes the scenarios *and* writes the evaluator *and* validates the outcomes, the set is biased toward what the evaluator can already handle. Hitting 100% precision on a self-selected set is meaningless.

A defensible golden set:
- **Includes scenarios the evaluator CAN'T handle** at first — these are the work items, not the success metric
- **Has expert-validated expected outcomes** — a senior underwriter or seasoned LO confirms each scenario's expected verdict
- **Covers edge cases proportionate to their importance, not their frequency** — derog scenarios are 5% of LO traffic but 80% of incumbent error rate, so 40% of golden-set scenarios should be derog
- **Includes adversarial scenarios** — borderline cases where reasonable underwriters disagree (and the verdict captures that disagreement)
- **Is locked before the evaluator is finalized** — adding scenarios after the evaluator passes is acceptable; tweaking expected outcomes to match what the evaluator does is not

**Why this is easy to miss:**
"I wrote 200 scenarios; the evaluator passes them; we're at 98% precision." Sounds like the KPI is met. The KPI is meaningless if the scenarios are easy.

**Warning signs:**
- Same person wrote scenarios + evaluator + expected outcomes
- All scenarios are "reasonable agency-conforming" cases (no derog edge cases)
- Scenario expected outcomes were generated by running the evaluator
- Precision rate is very high (98%+) very fast (<2 weeks)
- Expected-outcome rationale is "because the evaluator says so" not "because FNMA Selling Guide says so"

**Prevention strategy:**
- **Engage at least one external expert reviewer** (a paid senior underwriter / consultant) to validate scenario expected outcomes. This is the highest-ROI consulting spend in Phase 0.
- **Scenario sourcing**: pull 50% from real anonymized scenarios via outreach to broker-shop LOs (offer free pilot access in exchange for scenario contributions). Pull 25% from incumbent-vendor public examples / sample reports. Pull 25% from constructed adversarial cases (specifically designed to break boolean derog handling).
- **Expected outcome must cite a rule source** (FNMA Selling Guide section, lender matrix page, Mortgagee Letter, etc.) — not the evaluator's output.
- **Lock expected outcomes before running the evaluator against them.** Treat the golden set as ground truth, not as evaluator regression set.
- **Track per-scenario the rule that decides eligibility** — the evaluator must agree with the expected rule, not just the expected verdict. (Right answer for the wrong reason is a different bug class.)
- **Quarterly golden-set audit**: external reviewer re-validates a sample. If reviewer-evaluator disagreement rate exceeds 5%, the set is suspect.

**Phase to address:** Phase 0. The golden set IS Phase 0's exit gate.

**Impact if missed:**
Existential. The KPI claim ("≥98% precision") is the wedge. A self-selected golden set means the KPI claim is unsupported, the wedge is unproven, and customer trust evaporates the first time an LO runs a scenario the golden set didn't cover.

---

### Pitfall 4.4: Scope creep into pricing or AUS at Phase 1

**What goes wrong:**
Phase 1 MVP is eligibility-only. Once eligibility ships, the LO immediately asks "what's the rate?" The temptation to add live pricing in Phase 1 is strong because "it's just one more API call." The cost: live pricing pulls in lender-specific licensing (Pitfall 3.3 amplified), latency requirements (sub-second per incumbents), regulatory exposure (the Optimal Blue zone), and a different data model (LLPA grids, base rate, lock period).

Same with AUS: "let's just send this to DU and show the result" pulls in GSE relationships and IP exposure (Pitfall 3.7).

**Warning signs:**
- Phase 1 backlog includes "pricing display" or "LLPA calculation"
- Phase 1 backlog includes "DU integration" or "AUS submission"
- Customer feedback on "it's just eligibility" interpreted as "we need pricing"

**Prevention strategy:**
- Hold Phase 1 to PRD scope: eligibility-only, broker-channel, non-QM-weighted.
- Customer feedback is a Phase 2 input, not a Phase 1 scope expansion.
- Live pricing is a Phase 2 capability with explicit antitrust + licensing review.
- AUS stays out of scope permanently per the PRD.

**Phase to address:** Phase 1 discipline.

**Impact if missed:**
Phase 1 takes 2x as long; quality gates miss; the wedge is diluted.

---

### Pitfall 4.5: Rebuilding the existing prototype's mistakes

**What goes wrong:**
The existing `src/App.js` (1775 lines) has documented architectural and correctness issues (Codebase CONCERNS.md):
- Hardcoded program data inline
- API key in localStorage (security)
- No type safety
- No tests
- Boolean derogatory handling
- Case-sensitive includes() for purpose matching
- Default waiting-map fallback returns undefined silently

The PRD already decided to rebuild from scratch (Key Decisions). The pitfall is reaching for the prototype as a reference for "how it works" and inadvertently replicating its shape. Specifically:
- Treating programs as flat-object dictionaries rather than typed entities with explicit layering
- LO scenario form shape carrying forward unchanged (the prototype's form has the right intent but the wrong derog modeling)
- Result-presentation structure (matched/fails/warnings/passes) carrying forward without thinking through the layered-rule citation requirement

**Warning signs:**
- New code mirrors the prototype's structure too closely
- Schema decisions justified by "that's how the old one did it"
- LO scenario form has a single FICO field, single derog event, single date

**Prevention strategy:**
- The prototype is a reference for *visual layout* and *form-field intent*, not for data shape or rule logic.
- Phase 0 schema design happens before any code reuse from the prototype.
- The new evaluator returns layered rule citations (which agency rule, which investor overlay, which lender overlay), which the prototype does not.

**Phase to address:** Phase 0 + Phase 1 discipline.

**Impact if missed:**
Carries forward the exact failures the rebuild is supposed to fix.

---

### Pitfall 4.6: Underestimating the AM review UI's importance

**What goes wrong:**
Phase 1 MVP is "LO search + AM onboarding." The LO search side is exciting; the AM review UI is not. The temptation: ship a minimal AM tool ("just a JSON editor") and put effort into the LO side.

The reality: AM review IS the data-quality engine. If AM review is painful, AMs avoid using it; the index decays; precision drops; the KPI fails. The 45-min onboarding-time-per-program target requires a *good* AM review UI, not a minimum-viable one.

The three-pane review UI specified in the PRD (source PDF + extracted rule + edit form, with citation highlighting and confidence sorting) is non-trivial. Cell-level citation highlighting on the source PDF requires bbox tracking through the extraction pipeline. Confidence-sorted queues require per-rule confidence scoring (which itself requires careful prompt engineering).

**Warning signs:**
- AM workflow described in Phase 1 plan with vague time-effort estimates
- AM review UI scoped as "an admin form" rather than a first-class product surface
- No bbox-level citation in the extraction pipeline (so PDF highlighting can't work)
- Confidence scores are coarse (high/medium/low) rather than continuous

**Prevention strategy:**
- The AM review UI is a Phase 1 first-class deliverable. Plan it to consume comparable effort to the LO search UI.
- Extraction pipeline emits bbox-level citations from the start; the AM UI consumes them.
- AM workflows are tested with real lender matrices, not synthetic ones, before Phase 1 launch.
- Onboarding-time-per-program is measured continuously from week 1.

**Phase to address:** Phase 1.

**Impact if missed:**
KPI miss on AM correction rate (<10% by month 6) and onboarding time (≤45 min standard non-QM matrix). Failed KPIs delay Phase 1 close; the project stays in Phase 1 indefinitely.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Single integer for derog waiting period (label → months) | 1-day schema work | All of Pitfalls 1.1-1.6; Phase 0 rewrite | Never. Foundation. |
| Skip extraction citation field | 50% faster extraction prompt iteration | Hallucinated rules accumulate (Pitfall 2.6, 2.8); precision KPI miss | Never. The wedge claim depends on it. |
| Skip multi-tenant scoping ("we'll add it later") | Faster Phase 1 ship | Cross-tenant breach risk (Pitfall 3.5); retrofit is high-risk | Never if multi-tenant is in the roadmap. |
| Single FICO field, no co-borrower | Simpler LO form | Pitfall 1.10; recall hit on multi-borrower scenarios | Phase 1 MVP only with a flagged limitation surfaced to LO; Phase 2 must add. |
| Defer condo project review modeling | Smaller schema | Pitfall 1.11; FL condo demos break | MVP if scenarios with condos are filtered out by default; never if condos are in MVP scope. |
| Hardcode FNMA loan limits | No data-table infrastructure | Pitfall 1.12; annual rebuild required | Phase 0 if explicitly tagged for Phase 1 replacement. |
| Skip golden-set external review | Solo-dev velocity | Pitfall 4.3; KPI claim is unfounded | Never for a precision-claim product. The external review IS the validation. |
| AUS outcome as binary (approved/not) | Simpler form | Pitfall 1.14; recall hit on Manual UW | MVP if Manual UW scenarios are filtered out; never if they're in scope. |
| Auto-accept extraction at confidence ≥0.95 without citation validation | Higher AM throughput | Pitfall 2.6, 2.8; hallucinated rules persist | Acceptable IF citation textSpan-validation is automated; never without. |
| Treat lender data as "available because published" | Faster coverage growth | Pitfall 3.3; cease-and-desist risk | Never. License must precede indexing. |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Anthropic / OpenAI API for extraction | Prompt assumes structured output; LLM occasionally returns prose | Use structured-output mode (JSON schema enforced at API level); validate with Zod / Pydantic; reject and retry on parse failure |
| FNMA Selling Guide reference | Treat as static text; no version tracking | Version each section by effective date; track Selling Guide announcement updates; map announcement → affected sections → cascading review queue |
| Lender broker portal (matrix download) | Scrape without verifying TOS | Get explicit written license from lender; record license terms with each indexed program |
| FHFA loan-limit data | Hardcode per project initialization | Versioned data table with effective-date brackets; refresh annually in November |
| USDA eligibility map (Phase 2) | Per-scenario API call without caching | Cache per-address with 90-day TTL; surface "data updated as of Y" timestamp |
| FNMA Condo Project Manager (Phase 2) | Treat condo as boolean | Per-project review-status lookup with project ID; cache project state; surface review-type (Limited/Full/Waived) in LO output |
| Encompass / LendingPad export (Phase 1) | Use vendor's standard fields without scenario context | Include audit-trail blob in export: which rule fired, which version, which confidence; export per LOS-vendor schema |
| Brave Search / Exa / Firecrawl (research) | Use as primary source | Always cite primary source (FNMA Selling Guide, HUD 4000.1, etc.); these are research tools, not authoritative for production rules |

---

## Performance Traps

These are real but secondary to correctness for this project.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Linear evaluator with N programs × M rules | P95 latency drift past 5s | Index programs by FICO/LTV/loanType bucket; pre-filter before deep evaluation | ~250 programs (Phase 2 KPI) |
| Per-scenario LLM call for natural-language parsing | Latency hit if NL parse on every search | NL parse only on explicit user request; cache parse output keyed on input text hash | Always; not load-bearing |
| Loading entire program corpus into client | Initial load slowness, memory bloat | Server-side scenario evaluation; client receives only matched programs | ~500 programs |
| Synchronous extraction in AM upload flow | AM blocks on long-running extraction | Async extraction job queue; AM gets notified when ready | Always; UX issue at Phase 1 |
| Re-extracting matrix on every re-render of AM UI | High API cost; slow UI | Cache extraction by document hash; re-extract only on document change | Always |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| API key in client localStorage (existing prototype's pattern) | Key theft via XSS; unauthorized API spend | Backend proxy; key never reaches browser |
| Borrower PII (FICO, income, derog history) sent to third-party LLM unscoped | Compliance exposure; data leakage | Server-side LLM call with PII minimization (no name, no address, no SSN); document data flows; explicit consent |
| Cross-tenant query in dev mode left enabled in prod | Tenant data breach (Pitfall 3.5 amplified) | Row-level security at DB; tenant-scoped service-role key; integration tests for cross-tenant access denial |
| Audit trail mutable post-creation | Inability to defend liability claims | Append-only audit log table with cryptographic hash chain (or equivalent immutability) |
| Lender data egress without scoping | Tenant A sees tenant B's overlays | Per-tenant data boundaries; API responses filtered by tenant_id; logged egress audit |
| Plaintext sensitive fields in LLM extraction logs | Leakage via log analysis | Redact PII from logs; structured logs only; access-controlled retention |
| Confidence-score inflation by retry | High-confidence hallucinations from repeated extraction passes | Cap confidence by per-attempt cap, not max across attempts |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Single-result "ELIGIBLE" verdict without rule citation | LO can't defend the verdict to AE or borrower; trust collapse | Every result row exposes "Why eligible: agency rule X (FNMA B3-5.3-07), lender overlay Y (matrix p.5)"; click to expand the full rule stack |
| Confidence badge buried in details pane | LO doesn't see the warning; relies on a low-confidence rule | Confidence < 95% surfaced as a row-level visual indicator; click reveals "This rule was extracted from a low-resolution scan and has not been AM-confirmed" |
| Near-miss surface shows "ineligible" without an actionable fix | LO discards the program | Every ineligible rule has a "minimum-edit-distance fix" — "Increase FICO to 680 to qualify" or "Wait 6 months to qualify" |
| Result presentation conflates "agency-eligible" with "lender-eligible" | LO trusts the verdict without checking lender overlay | Layered presentation: "Agency Base: ELIGIBLE / Investor Overlay: ELIGIBLE / Product Feature: ELIGIBLE / Lender Overlay: NOT ELIGIBLE — see overlay #3" |
| Borrower-safe shareable view exposes LO comp or overlay tags | Borrower sees pricing/comp not intended for them | Borrower-safe view is explicitly content-filtered: no comp, no overlay tags, no internal-only metadata |
| Comparison view (4 programs) doesn't surface non-QM methodology differences | LO compares Lender A's "12-month bank statement" to Lender B's same-named product without seeing the expense factor difference | Comparison shows the IncomeDocMethod / DscrMethod side-by-side, including expense factor and qualifying-income computation |
| AM review UI shows extracted JSON without source PDF citation | AM rubber-stamps high-confidence rules without verifying | Three-pane: source PDF (citation highlighted), extracted rule, edit form. Bulk-accept above threshold acceptable IF citation validates server-side |
| Saved scenarios stale-tagged by date alone | LO doesn't know if the underlying program changed | Per-scenario watermark of program-version + agency-version; if any changed, scenario auto-tagged "needs re-run" |

---

## "Looks Done But Isn't" Checklist

Phase 0 / Phase 1 verification items where surface-level signs say "complete" but critical pieces are missing.

- [ ] **Schema for derogatory events**: Often missing → mortgage-included-in-BK rule branch; verify by golden-set scenario "BK7 yr 5 with mortgage included; FC yr 6" → eligible because BK clock applies.
- [ ] **Schema for foreclosure rule**: Often missing → 3-7 year LTV cap window with purpose+occupancy restrictions; verify by golden-set scenario "FC yr 4 + extenuating + investment purchase" → ineligible because occupancy restriction.
- [ ] **Borrower scenario form**: Often missing → multi-event derog input; verify by entering "two BKs, dates 2019 and 2023" and checking evaluator detects multi-filing.
- [ ] **Borrower scenario form**: Often missing → per-borrower FICO with co-borrower; verify by entering 2 borrowers with different mid-scores and checking evaluator computes lowest-of-mid (or FNMA average if applicable).
- [ ] **Eligibility evaluator output**: Often missing → layered rule citation (which layer fired); verify by inspecting result and confirming AGENCY_BASE / INVESTOR_OVERLAY / PRODUCT_FEATURE / LENDER_OVERLAY tagged.
- [ ] **Extraction output**: Often missing → bbox-level source citation per rule; verify by clicking a rule in AM UI and seeing the exact PDF region highlighted.
- [ ] **Extraction validation**: Often missing → server-side textSpan-presence check on the cited PDF region; verify by manually mutating an extracted rule's textSpan to a value not in the PDF and confirming auto-rejection.
- [ ] **Footnote handling**: Often missing → footnoteRefs array on each cell; verify by extracting a matrix with footnotes and checking each footnote constraint fires in the evaluator on a matching scenario.
- [ ] **AM review UI**: Often missing → three-pane with PDF citation highlight; verify by reviewing 5 lender matrices and checking that PDF region highlights match cell extraction.
- [ ] **Confidence scoring**: Often missing → continuous score (0-1) per rule, not coarse high/medium/low; verify by sorting AM queue by confidence and seeing distribution, not buckets.
- [ ] **Tenant isolation**: Often missing → row-level security at DB layer; verify by attempting cross-tenant query with tenant A's service role key and confirming denial.
- [ ] **Audit trail**: Often missing → append-only with cryptographic chain or equivalent immutability; verify by attempting to mutate a past audit row and confirming rejection.
- [ ] **Liability disclaimer**: Often missing → on every result row, every shareable view, every export PDF; verify by checking each output surface.
- [ ] **Confidence badge**: Often missing → on result rows, not buried in detail pane; verify by running a scenario with a known-low-confidence deciding rule and observing visual indicator.
- [ ] **Lender data license**: Often missing → record per program of which license-version applies; verify by querying programs and checking each has a non-null license_id.
- [ ] **Agency-rule cascade**: Often missing → on agency-rule update, system creates per-affected-program review queue items; verify by simulating an agency rule version bump and observing queue creation.
- [ ] **Per-program effective-date bracketing**: Often missing → versioned program with effectiveStart and effectiveEnd; verify by retrieving "this scenario at this date" and getting the right version's rules.
- [ ] **Golden set**: Often missing → external expert validation, scenarios spanning derog edge cases, expected outcomes citing rule sources, locked before evaluator runs against; verify by reviewing the scenario list and outcome-rationale documents.
- [ ] **Non-QM bank-statement method**: Often missing → per-program calculation method (expense factor, account type, statement period); verify by running same scenario through 2 bank-statement programs with different expense factors and confirming different qualifying income computed.
- [ ] **DSCR method**: Often missing → per-program ratio computation (numerator rule, denominator rule, IO handling, ARM qualification); verify by running same property through 2 DSCR programs with different methods and confirming different DSCR ratios.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Pitfall 1.1-1.6 (derog modeling shortcuts) caught in Phase 1 | HIGH (3-4 weeks) | Rebuild schema; rerun extraction on every program; re-validate full golden set; communicate KPI delay |
| Pitfall 1.1-1.6 caught in Phase 2+ | CRITICAL (8+ weeks) | Same as above plus customer communication; possible refunds; reputation rebuild |
| Pitfall 2.6 (hallucinated rules in production) | HIGH | Pull all extractions for the affected lender(s); re-extract with citation validation; manually audit; surface impacted scenarios to LOs |
| Pitfall 2.3 (layout drift undetected) | MEDIUM | Add layout-signature detection; re-extract recent versions; AM diffs pre/post; communicate KPI variance to customers |
| Pitfall 3.1 (antitrust posture exposed) | CRITICAL | Cease the offending feature immediately; legal counsel; preserve evidence; consider voluntary disclosure |
| Pitfall 3.3 (lender license missing on indexed program) | MEDIUM | Pull the program from production; reach out to lender for license; re-onboard with consent |
| Pitfall 3.4 (stale agency rule in production) | HIGH | Identify all affected programs/scenarios; re-evaluate; notify any LO who ran the affected scenario |
| Pitfall 3.5 (cross-tenant breach) | CRITICAL | Disable cross-tenant queries; security audit; notify affected tenants; legal counsel |
| Pitfall 4.3 (golden set is self-selecting) | HIGH | Engage external reviewer; validate sample of expected outcomes; re-source 30%+ scenarios; re-run KPI calculation |
| Pitfall 4.6 (AM UI insufficient, AM correction rate climbing) | MEDIUM | Add three-pane UI with PDF citation; re-train AMs; re-baseline correction-rate KPI |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address each pitfall.

| Pitfall | Bucket | Prevention Phase | Verification Mechanism |
|---------|--------|------------------|------------------------|
| 1.1 Derog single-int collapse | Eligibility | Phase 0 | Golden-set scenarios for each derog branch; schema review |
| 1.2 Post-FC LTV/purpose/occupancy window | Eligibility | Phase 0 / Phase 1 | Specific golden-set scenario (FC yr 4 + investment + 95% LTV → ineligible) |
| 1.3 Measurement anchor confusion | Eligibility | Phase 0 / Phase 1 | Borrower scenario shape review; extraction prompt review |
| 1.4 FHA Back-to-Work phantom | Eligibility | Phase 0 | Agency rule sunset state; extraction validation guard |
| 1.5 Multi-filing window | Eligibility | Phase 0 / Phase 1 | Borrower scenario as event list; multi-filing detection in evaluator |
| 1.6 Mortgage-included-in-BK rule branch | Eligibility | Phase 0 / Phase 1 | Borrower scenario captures relationship; evaluator branches |
| 1.7 VA entitlement / USDA per-property | Eligibility | Phase 0 (schema), Phase 2 (USDA impl) | Schema accommodates entitlement & per-property lookup |
| 1.8 Bank statement methodology | Eligibility | Phase 0 / Phase 1 | Per-program IncomeDocMethod object; same-scenario different-investor income comparison test |
| 1.9 DSCR methodology | Eligibility | Phase 0 / Phase 1 | Per-program DscrMethod object; same-scenario different-investor DSCR comparison test |
| 1.10 FICO multi-borrower rule | Eligibility | Phase 0 / Phase 1 | Per-borrower scenario shape; FNMA averaging exception toggle |
| 1.11 Condo project review | Eligibility | Phase 0 (schema), Phase 1 (form), Phase 2 (CPM API) | Subordinate condo-project state in schema; FL condo scenarios in golden set |
| 1.12 High-balance / county overlay | Eligibility | Phase 0 (versioned table) / Phase 1 | FHFA limit data load with effective-date brackets |
| 1.13 MI provider tier | Eligibility | Phase 0 (layer model), Phase 1 (heuristic), Phase 2 (per-provider) | MI layer in schema; tightest-MI-overlay heuristic in Phase 1 |
| 1.14 Manual UW path | Eligibility | Phase 0 (AUS state), Phase 1 (evaluator branch) | LO scenario captures AUS outcome; manual-UW result class |
| 1.15 Forbearance post-COVID | Eligibility | Phase 0 / Phase 1 | Forbearance event with sub-state; evaluator per agency |
| 2.1 FICO×LTV grid alignment | Extraction | Phase 0 (architecture), Phase 1 (impl) | Layout-preserving parser; cell-count validation; AM cell-by-cell review |
| 2.2 Footnote anchor loss | Extraction | Phase 0 / Phase 1 | Cell.footnoteRefs in schema; orphan-footnote detection |
| 2.3 Layout drift | Extraction | Phase 1 | Per-version fingerprint diff; layout signature detection |
| 2.4 OCR misreads | Extraction | Phase 1 | Numeric range validation; image-patch shown in AM UI |
| 2.5 Multi-program contamination | Extraction | Phase 1 | Document segmentation phase; per-program scoped extraction |
| 2.6 LLM hallucination | Extraction | Phase 0 (citation in schema), Phase 1 (impl) | Server-side textSpan-presence validation; counter-example testing |
| 2.7 Conflicting tables in PDF | Extraction | Phase 0 / Phase 1 | Schema enforces single binding rule; conflict-resolution AM step |
| 2.8 Citation discipline | Extraction | Phase 0 / Phase 1 | Hard schema constraint (no citation → no persistence) |
| 3.1 Antitrust posture | Operational | Phase 0 (architecture + scope), ongoing | Tenant isolation enforced architecturally; "Pricing Insight" features explicitly out of scope |
| 3.2 Liability framing | Operational | Phase 0 (ToS + audit data model), Phase 1 (UI), ongoing | Disclaimer + confidence badge audit; legal review of marketing |
| 3.3 Lender data licensing | Operational | Phase 0 (contract), Phase 1 (workflow gate), ongoing | License_id on every program; AM workflow gate |
| 3.4 Stale guidelines / agency cascade | Operational | Phase 0 (versioning), Phase 1 (queue), Phase 2 (scraping) | Agency rule version bump triggers review queue |
| 3.5 Tenant isolation | Operational | Phase 0 (architecture) | Row-level security; cross-tenant query test |
| 3.6 Channel conflation | Operational | Phase 0 (channel as schema concept), Phase 1 (broker-only impl) | Tenant channel field; per-channel default config |
| 3.7 AUS scope creep | Operational | Ongoing scope discipline | PRD-level boundary; result-presentation language audit |
| 4.1 UI before schema | Solo-dev | Phase 0 discipline | No UI commit until Phase 0 KPI gates pass |
| 4.2 Premature optimization | Solo-dev | Phase 1 discipline | Linear evaluator until P95 latency at risk |
| 4.3 Golden set self-selection | Solo-dev | Phase 0 | External expert validation; scenarios from real LO outreach + adversarial cases |
| 4.4 Phase 1 scope creep | Solo-dev | Phase 1 discipline | Hold to PRD scope; pricing/AUS as Phase 2/never |
| 4.5 Rebuilding prototype mistakes | Solo-dev | Phase 0 / Phase 1 discipline | Schema decisions justified by Selling Guide, not prototype |
| 4.6 AM UI underestimated | Solo-dev | Phase 1 | Three-pane review UI as first-class deliverable; bbox citation in extraction from start |

---

## Sources

### Verified primary sources (HIGH confidence)

- [FNMA Selling Guide B3-5.3-07: Significant Derogatory Credit Events — Waiting Periods and Re-establishing Credit (08/07/2019)](https://selling-guide.fanniemae.com/sel/b3-5.3-07/significant-derogatory-credit-events-waiting-periods-and-re-establishing-credit) — base rules for BK, FC, DIL, short sale, multi-filing, mortgage-included-in-BK
- [FNMA Selling Guide B3-5.1-01: General Requirements for Credit Scores (11/05/2025)](https://selling-guide.fanniemae.com/sel/b3-5.1-01/general-requirements-credit-scores) — FICO scoring methodology
- [FNMA Selling Guide B4-2.2-01: Limited Review Process](https://selling-guide.fanniemae.com/sel/b4-2.2-01/limited-review-process) — condo project review
- [FNMA Selling Guide B4-2.2-02: Full Review Process](https://selling-guide.fanniemae.com/sel/b4-2.2-02/full-review-process) — condo project review
- [FNMA Selling Guide B2-1.3-03: Cash-Out Refinance Transactions](https://selling-guide.fanniemae.com/sel/b2-1.3-03/cash-out-refinance-transactions) — cash-out seasoning
- [FHFA Conforming Loan Limit Values for 2026](https://www.fhfa.gov/news/news-release/fhfa-announces-conforming-loan-limit-values-for-2026) — high-balance / high-cost county limits
- [HUD LDP / Limited Denial of Participation List](https://www.hud.gov/hud-partners/limited-denial) — exclusionary list reference
- [Freddie Mac Single-Family Seller/Servicer Guide §5202.5](https://guide.freddiemac.com/app/guide/section/5202.5) — Freddie derog waiting periods
- [Freddie Mac Exclusionary List](https://sf.freddiemac.com/working-with-us/fraud-prevention/emerging-fraud-trends/freddie-mac-exclusionary-list) — exclusionary list reference
- [USDA Property Eligibility Map](https://eligibility.sc.egov.usda.gov/eligibility/welcomeAction.do?pageAction=sfp) — USDA per-property lookup
- [FNMA Loan Quality Initiative — LDP/EPLS Checks for Interested Parties](https://www.mortgage-underwriters.org/mortgage-underwriting-news/2010/09/17/fannie-mae-loan-quality-initiative-now-requires-ldp-and-epls-c) — exclusionary list timing
- [MGIC Underwriting Guide effective June 25, 2025](https://www.mgic.com/-/media/mi/underwriting/71-40600-guide-pdf-underwriting-guide.pdf) — MI provider overlay structure

### Verified secondary sources (MEDIUM-HIGH confidence)

- [Optimal Blue Antitrust Litigation — Lockridge Grindal Nauen PLLP](https://www.locklaw.com/litigations/optimal-blue-antitrust-litigation/) — class-action plaintiffs' counsel
- [Housingwire: Antitrust lawsuit targets Optimal Blue and mortgage lenders](https://www.housingwire.com/articles/optimal-blue-antitrust-lawsuit/) — Oct 2025 filing reporting
- [Housingwire: Optimal Blue comes out swinging on price-fixing lawsuit](https://www.housingwire.com/articles/optimal-blue-lawsuit-response/) — defendant response
- [Housingwire: The Optimal Blue lawsuit: Data transparency or market manipulation?](https://www.housingwire.com/articles/the-optimal-blue-lawsuit-data-transparency-or-market-manipulation/) — analyst commentary
- [National Mortgage Professional: Homebuyers Sue Mortgage Giants, Alleging Nationwide Price-Fixing Scheme](https://nationalmortgageprofessional.com/news/homebuyers-sue-mortgage-giants-alleging-nationwide-price-fixing-scheme) — case overview
- [National Mortgage News: Optimal Blue, 26 mortgage lenders accused of price-fixing](https://www.nationalmortgagenews.com/news/optimal-blue-26-mortgage-lenders-accused-of-price-fixing) — case overview
- [MLex: Optimal Blue, loan originators price-fixed US mortgages, home buyers allege](https://www.mlex.com/mlex/antitrust/articles/2396596/optimal-blue-loan-originators-price-fixed-us-mortgages-home-buyers-allege) — antitrust analysis
- [DLA Piper: Antitrust meets AI: Plaintiffs, enforcers, and legislatures take aim at alleged AI-driven collusion](https://www.dlapiper.com/en-us/insights/publications/2025/11/antitrust-and-ai-plaintiffs-enforcers-and-legislatures-take-aim-at-alleged-ai-driven-collusion) — broader antitrust posture
- [Milbank General Counsel Blog: Antitrust Developments Impacting Providers and Users of Algorithmic Tools](https://www.milbankgeneralcounsel.com/2025/10/the-latest-intelligence-antitrust-developments-impacting-providers-and-users-of-algorithmic-tools-september-30-october-20-2025/) — algorithmic-pricing antitrust
- [Candor Technology: Award-Winning AI Underwriting](https://www.candortechnology.com/) — repurchase warranty framing reference
- [Candor Technology Press Release: First in Industry to Automate Underwriting for FHA Loans and Offer Buyback Warranty](https://www.prnewswire.com/news-releases/candor-technology-first-in-industry-to-automate-underwriting-for-fha-loans-and-offer-buyback-warranty-302271692.html) — warranty structure
- [HomeBuying Institute: Using an FHA Loan After Chapter 7 Bankruptcy: The Waiting Period](https://homebuyinginstitute.com/badcredit_article34.php) — FHA waiting periods
- [GCA Mortgage: FHA Back to Work Extenuating Circumstances Mortgage](https://gcamortgage.com/fha-loans-after-bankruptcy/) — confirms Back to Work discontinued 2016-09-30
- [The Mortgage Reports: FHA Back To Work Loan Rules](https://themortgagereports.com/13372/fha-back-to-work-mortgage) — Back to Work program reference (historical)
- [Lendmire: How Rental Income Is Calculated for DSCR Loans](https://www.lendmire.com/how-rental-income-is-calculated-for-dscr-loans/) — DSCR methodology
- [Visio Lending: How Real Estate Uses DSCR Ratio & PITIA](https://www.visiolending.com/blog/understanding-dscr) — DSCR / PITIA breakdown
- [Griffin Funding: Bank Statement Loans 2026](https://griffinfunding.com/non-qm-mortgages/bank-statement-loans/) — bank-statement methodology variance
- [NQM Funding: National Guide: Non-QM After Credit Events—Seasoning, Re-Establishing Tradelines, and Pricing Levers](https://www.nqmf.com/national-guide-non-qm-after-credit-events-seasoning-re-establishing-tradelines-and-pricing-levers/) — non-QM tiered LTV bands by months-since-event
- [Newrez: Understanding Non-QM Loan Options](https://www.newrez.com/blog/industry-insights/understanding-non-qm-loan-options-at-newrez/) — Newrez SmartEdge product reference
- [Homebridge Wholesale: Derogatory Credit Waiting Periods Fannie/VA/USDA matrix (8/22/24)](https://www.homebridgewholesale.com/wp-content/uploads/2025/09/Derogatory-Credit-Waiting-Periods-Fannie-VA-USDA-8-22-24-NL.pdf) — waiting periods cross-agency
- [GovermingDocs: 2026 Fannie Mae Condo Rules: Reserves Up to 15%, Limited Review Gone](https://governingdocs.dev/blog/fannie-freddie-condo-rules-2026/) — 2026 condo rule changes
- [Condo-Approval.com: Fannie Mae and Freddie Mac Condo Insurance Requirements](https://www.condo-approval.com/2025/11/03/condo-insurance-fannie-freddie-requirements/) — RCV vs ACV; deductible cap
- [Veterans United: Short Sales and Waiting Periods for VA Loans](https://www.veteransunited.com/valoans/short-sale-seasoning/) — VA short sale rules
- [Griffin Funding: VA Seasoning Rules](https://griffinfunding.com/blog/va-loans/va-waiting-periods-seasoning-for-foreclosures-short-sale-and-bankruptcy/) — VA seasoning detail
- [VA Loan Network: What Happens to My Entitlement If I Foreclose?](https://valoannetwork.com/what-happens-to-my-entitlement-if-i-foreclose/) — entitlement reduction mechanics
- [JVM Lending: Fannie Mae Bankruptcy Waiting Period](https://www.jvmlending.com/blog/what-is-the-fannie-mae-bankruptcy-waiting-period/) — multi-filing 5y rule
- [GustanCho: Waiting Period After Mortgage Part of Bankruptcy Guidelines](https://gustancho.com/waiting-period-after-mortgage-part-of-bankruptcy/) — mortgage-included-in-BK rule
- [Black Mann & Graham: Fannie Mae Announces New 12-Month Seasoning Requirement for Cash-Out Refinances](https://www.bmandg.com/fannie-mae-announces-new-12-month-seasoning-requirement-for-cash-out-refinances/) — cash-out seasoning effective Apr 2023
- [Fannie Mae: Options after a forbearance plan or resolved COVID-19](https://www.fanniemae.com/media/37661/display) — post-COVID forbearance rules

### LLM extraction & RAG hallucination references (HIGH confidence)

- [Forage AI: Tabular Data Extraction from PDF — Advanced Accuracy Techniques](https://forage.ai/blog/dive-in-how-to-extract-tabular-data-from-pdfs/) — table extraction failure modes
- [Nanonets: Table Extraction using LLMs: Unlocking Structured Data from Documents](https://nanonets.com/blog/table-extraction-using-llms-unlocking-structured-data-from-documents/) — LLM-based table extraction
- [arXiv 2510.24476: Mitigating Hallucination in LLMs: An Application-Oriented Survey on RAG, Reasoning, and Agentic Systems](https://arxiv.org/html/2510.24476v1) — RAG hallucination mitigation techniques
- [arXiv 2601.05866: FACTUM: Mechanistic Detection of Citation Hallucination in Long-Form RAG](https://arxiv.org/pdf/2601.05866) — citation hallucination detection
- [Maxim AI: Building a "Golden Dataset" for AI Evaluation](https://www.getmaxim.ai/articles/building-a-golden-dataset-for-ai-evaluation-a-step-by-step-guide/) — golden dataset design principles
- [Sigma AI: Golden datasets — Evaluating fine-tuned LLMs](https://sigma.ai/golden-datasets/) — golden set best practices
- [Ramamtech: Can OCR Automation Reliably Extract Tables From Scanned PDFs?](https://ramamtech.com/blog/ocr-table-extraction-scanned-pdfs) — OCR accuracy thresholds

### Internal references

- `.planning/PROJECT.md` — KPIs, scope, key decisions
- `.planning/codebase/CONCERNS.md` — existing prototype's known issues; concrete examples of Pitfall 4.5 (the trap of replicating prototype mistakes)
- `.planning/codebase/ARCHITECTURE.md` — existing prototype's structure, including the boolean-derog-handling at `src/App.js:959-962` that is Pitfall 1.1 in concrete code

---

*Pitfalls research for: Lender Search — eligibility-first mortgage PPE with AI-assisted matrix extraction*
*Researched: 2026-04-29*
