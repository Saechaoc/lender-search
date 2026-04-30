# `evaluateScenario` — Qualification Logic

`evaluateScenario(scenario, programs) → Array<{program, matched, fails[], warnings[], passes[]}>` at `src/App.js` ~L858–L1099.

Pure function. Iterates each program, accumulates strings into `fails`, `warnings`, `passes`. `matched = fails.length === 0`.

## Checks performed (in order)
1. **Loan type** — `program.loanTypes.includes(scenario.loanType)`.
2. **Purpose** — substring match against `program.purposes`.
3. **Cash-out** — `program.cashOutAllowed===false` blocks Cash-Out Refi.
4. **Occupancy** — `program.occupancy.includes(scenario.occupancy)`.
5. **Property type** — fail if in `ineligiblePropertyTypes`.
6. **FICO** — `scenario.fico < program.minFico` fails. PennyMac < 680 → escrow warning.
7. **DTI** — `scenario.dti > program.maxDti` fails.
8. **LTV grid** — nested lookup `program.ltv[occKey][purposeKey][unitKey]`. Unit key resolution handles MH-Advantage, ARM vs FRM, multi-unit. High-balance reduces caps for 2-4 units.
9. **High balance** — `program.highBalance===false` blocks.
10. **ARM** — `program.armsAllowed===false` blocks ARM-requested.
11. **Income limits** — 80% AMI (HomeReady), 100% AMI (RefiNow), USDA area limits.
12. **Prior agency loan** — RefiNow / Refi Possible require prior Fannie/Freddie loan; no added borrowers.
13. **Forbearance** — PennyMac fails outright; others warn.
14. **Veteran / rural / streamline** — warnings only.
15. **Derogatory waiting** — uses `program.derogatoryWaitMap` if present, else default map (`Ch7=4, Ch13d=2, Ch13m=4, FC=7, SS/DIL=4, Multi=5`). Freddie Mac always warning-only.
16. **State rules** — TX 50(a)(6) cash-out blocked on RefiNow/`txCashOutIneligible`. `program.ineligibleStates` blocks.
17. **Loan amount** — agency programs default min $75k; `program.minLoanAmount` / `maxLoanAmount` enforced.
18. **Vesting** — non-Individual/Trust requires `specialFeatures` mention of "entity borrower".
19. **ADUs / Condo warrantability / Deed restriction** — fail or warn based on program flags.
20. **Foreign national** — universal fail.
21. **Income doc type** — `program.supportedIncomeDocs` if defined; otherwise hardcoded list of Non-QM IDs (`pm-nonqm-aminus/a/aplus`) for alt doc; asset depletion only on `pm-nonqm-a/aplus` with FICO/LTV/occupancy/purpose constraints.
22. **DSCR ratio** — `dscrRatio` parsed; "no-ratio" requires `specialFeatures` mention. Otherwise compares to `program.minDscr`.
23. **Interest-only** — requires `terms[]` containing "IO" string. `ioRules` applies FICO/LTV gates.
24. **Prepayment penalty** — checks `specialFeatures` for "prepayment penalty available". Honors `prepayIneligibleStates`/`prepayRestrictedStates`.
25. **Partial data flag** — `program.partialData` adds a guideline-uploaded warning.

## Adding a new check
- Add to the chain inside `evaluateScenario` map callback.
- Push human-readable strings into one of `fails / warnings / passes`.
- If gating off a new program field, document it in `code_style_and_conventions` memory under "Program data shape".
