# Lender Search

Eligibility-first lender/program search tool for mortgage loan officers. Enter a borrower scenario (FICO, LTV, DTI, occupancy, derogatory history, doc type, special situation) and get a ranked list of programs the borrower qualifies for—with explicit reasons for eligibility, near-miss, or ineligibility citing the rule and layer that fired.

## Core Value

**Correctness on the long tail of derogatory and non-QM scenarios.** Every loan officer can defend eligibility decisions to a borrower or account executive without calling a wholesale lender to confirm.

## What's Different

- **Eligibility-first data model**: agency base rules (FNMA, FHLMC, FHA, VA) + investor overlays + product features + lender overlays, with explicit layer attribution
- **Full derogatory event modeling**: BK7/BK13 discharged/dismissed, multi-filing, foreclosure, DIL, short sale, mortgage charge-off, modification, forbearance—with measurement anchors and re-establishment criteria
- **Non-QM first-class citizen**: ≥60% non-QM programs at MVP; not a second-class citizen in agency-rooted tools
- **Near-miss surface**: minimum-edit-distance fixes per ineligible program (FICO delta, LTV delta, DTI delta, doc-type swap, seasoning months remaining)
- **AM onboarding pipeline**: PDF → OCR → multi-pass extraction → rule normalization → overlay detection → confidence scoring → human review
- **Explainable results**: confidence badges on low-confidence rules, full rule stack, versioned audit trail

## Quick Start

```bash
npm install
npm start
```

Runs app in development mode at [http://localhost:3000](http://localhost:3000).

### Other Scripts

- `npm test` — Launch test runner in watch mode
- `npm run build` — Build for production
- `npm run eject` — Eject from Create React App (one-way operation)

## Development

Current prototype is being rebuilt from scratch. The existing `src/App.js` (1,775 lines) serves as a reference for LO scenario form shape and result structure only.

**Phase 0 (foundation, in progress):**
- Rule schema with explicit layer field
- Structured derogatory-event model
- Encoded agency base rule sets (FNMA, FHLMC, FHA, VA)
- 200-scenario golden test set with expert-reviewed outcomes
- Eligibility evaluator returning eligible / near-miss / ineligible

**Phase 1 (MVP):**
- LO scenario form + search interface
- Result ranking with comparison view
- Saved scenarios + shareable links
- AM onboarding UI (PDF upload, extraction review, version control)
- 50+ programs indexed

**Phase 2+ (post-MVP):**
- USDA, HFA, construction-to-perm
- Live pricing feeds (opt-in)
- Multi-tenant lender overlays
- Mobile optimization
- Borrower-safe shareable scenario pages

For full context, see [PROJECT.md](.planning/PROJECT.md).

## Stack

- **Frontend**: React 19 (Create React App)
- **Language**: JavaScript
- **Build**: Webpack (via CRA)
- **State**: localStorage (prototype) → planned migration to Supabase or similar

## Learn More

- [Create React App docs](https://facebook.github.io/create-react-app/docs/getting-started)
- [React docs](https://reactjs.org/)
