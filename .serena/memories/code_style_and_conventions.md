# Code Style & Conventions

## General
- Plain JavaScript (no TypeScript), React 19 function components with hooks.
- **Entire app in `src/App.js`** — no component or module split.
- **Inline styles only** — `style={{}}` props throughout. No CSS modules, no Tailwind, no styled-components.
- Default export from App.js: `export default function App()`.

## Formatting quirks (intentional — match when editing)
- **Compact, dense literals**: program objects span single very long lines with minimal whitespace. Don't reformat existing program data — it's intentionally compressed.
- Property keys often unquoted, values use double quotes.
- **No semicolons after some inline arrow expressions** but semicolons used at statement level. Mixed; follow surrounding lines.
- Helper functions like `inp / sel / chk` are lowercase one-letter style (`inp`, `sel`, `chk`, `set`, `m`, `p`).
- Short variable names favored inside callbacks: `o`, `e`, `p`, `r`, `lt`, `ph`.
- Ternaries chained heavily, e.g. `view==="search"?"...":"..."`.
- Arrow functions inline rather than extracted handlers.

## State naming
- `scenario` (the form), `set(k,v)` updater wrapping `setScenario`.
- Modal/conflict state objects named `pendingConflict`.
- LocalStorage keys: `ls_programs`, `ls_claude_api_key`, `ls_qa_history`.

## Program data shape (when adding programs)
Required: `id`, `lenderId`, `name`, `agency`, `loanTypes[]`, `purposes[]`, `occupancy[]`.
Optional but commonly present: `shortName`, `aus`, `ausRequired`, `updatedDate`, `propertyTypes[]`, `ineligiblePropertyTypes[]`, `terms[]`, `minFico`, `maxDti`, `dtiNote`, `highBalance`, `incomeLimit`, `manualUw`, `cashOutAllowed`, `armsAllowed`, `ltv{ownerOccupied,secondHome,investment}{purchase,rateTerm,cashOut}{unitKey:%}`, `overlays[]`, `derogatoryWaiting{}` or `derogatoryWaitMap{}`, `specialFeatures[]`, `ineligibleStates[]`, `minLoanAmount`, `maxLoanAmount`, `minDscr`, `supportedIncomeDocs[]`, `noIncomeRequired`, `txCashOutIneligible`, `partialData`.

## Editing rules
- **Must preserve `evaluateScenario` invariants**: returns `{program, matched, fails[], warnings[], passes[]}` per program. `matched === fails.length === 0`.
- `formatProgramContext` is consumed by Claude Q&A — keep stable shape if extending.
- Do not break localStorage key names — users have persisted data.

## Testing
- Only `App.test.js` exists (default CRA smoke test). No real coverage.
