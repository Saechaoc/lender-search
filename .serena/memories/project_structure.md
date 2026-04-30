# Project Structure

```
lender-search/
├── src/
│   ├── App.js          # ~1775 lines — entire app (data + logic + UI)
│   ├── App.css         # Default CRA styles
│   ├── App.test.js     # Default CRA smoke test
│   ├── index.js        # ReactDOM root mount
│   ├── index.css
│   ├── logo.svg
│   ├── reportWebVitals.js
│   └── setupTests.js
├── public/             # CRA static assets
├── build/              # Production build output (gitignored typically; present here)
├── node_modules/
├── .planning/          # GSD workflow directory (planning artifacts)
├── .claude/            # Claude Code skills, settings
├── .gitnexus/          # GitNexus code intelligence index
├── .serena/            # Serena project config + memories
├── package.json
├── README.md           # Default CRA boilerplate
├── CLAUDE.md           # GitNexus usage instructions for AI agents
└── AGENTS.md
```

## App.js anatomy (line ranges approximate)
- **L1–856**: `SEED_LENDERS` (~3) and `SEED_PROGRAMS` (~30+ hardcoded program objects). Massive inline data — each program is a multi-line literal with overlays, LTV grids, derogatory waiting periods.
- **L858–1099**: `evaluateScenario(scenario, programs)` — pure function returning `{program, matched, fails[], warnings[], passes[]}` per program. Encodes all qualification rules.
- **L1102–1114**: UI option constants (LOAN_TYPES, PURPOSES, OCCUPANCIES, PROPERTY_TYPES, STATES, DEROG_TYPES, INCOME_DOC_TYPES, DSCR_RATIO_OPTIONS, VESTING_TYPES, ADU_OPTIONS, CONDO_WARRANTABILITY, DEED_RESTRICTION_TYPES, EMPTY).
- **L1116–1137**: `inp / sel / chk` — inline form-control helpers.
- **L1139–1217**: `matchesLoanTypeFilter`, `formatProgramDetailed`, `formatProgramSummary`, `formatProgramContext` — used to build prompt context for Q&A.
- **L1219+**: `App()` component — single component holding all state, three view branches (search / qa / admin), and JSX.

## Important: single-file architecture
Everything is in `src/App.js`. Adding new features means editing this file. There is no `components/`, `lib/`, or `data/` split.
