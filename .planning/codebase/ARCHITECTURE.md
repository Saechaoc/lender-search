<!-- refreshed: 2026-04-30 -->
# Architecture

**Analysis Date:** 2026-04-30

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                    React Application                         │
│                   `src/App.js` (main)                        │
├──────────────────┬──────────────────┬───────────────────────┤
│   Search View    │   Results View   │    Admin View         │
│  (scenario      │  (matched        │  (program mgmt,      │
│   inputs)       │   programs)      │   import/delete)      │
└────────┬─────────┴────────┬─────────┴──────────────────────┘
         │                  │
         └──────────┬───────┘
                    ▼
┌─────────────────────────────────────────────────────────────┐
│                Matching Engine                               │
│  `evaluateProgram()` eligibility checker                     │
│  Compares scenario to program rules (LTV, FICO, DTI, etc)    │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                  Data Layer                                  │
│  SEED_LENDERS, SEED_PROGRAMS (hardcoded)                     │
│  customPrograms (localStorage: "ls_programs")                │
│  localStorage: "ls_claude_api_key" (optional)                │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| App (main) | View orchestration, state management, scenario form, results rendering | `src/App.js` |
| evaluateProgram() | Core matching logic: evaluates single program against scenario | `src/App.js` (lines 842–1100) |
| Matching Engine | Filters programs by lender, processes eligibility rules | `src/App.js` (lines 842–1100) |
| Input Components | Form builders for scenario inputs (sel, inp, chk helpers) | `src/App.js` (lines 1116–1137) |
| Admin Panel | Manage custom programs, import/delete, display seed data | `src/App.js` (lines 1705–1771) |

## Pattern Overview

**Overall:** Single-page form-based application with conditional view switching and localStorage persistence.

**Key Characteristics:**
- **Monolithic component:** Entire logic in single `App.js` (1775 lines) — no component decomposition
- **Form-driven:** Collects borrower/property scenario via controlled inputs
- **Rule-engine pattern:** `evaluateProgram()` evaluates scenario against ~80 mortgage programs (Fannie Mae, Freddie Mac, VA, FHA, USDA, Jumbo, Non-QM, DSCR)
- **Client-side only:** All data loaded in memory; no backend API calls
- **localStorage persistence:** Custom programs and API key stored in browser storage

## Layers

**UI Layer:**
- Purpose: Render views (search, results, admin) and collect user input
- Location: `src/App.js` (lines 1219–1774, JSX rendering)
- Contains: View switching logic, form controls, result display cards
- Depends on: React hooks (useState, useCallback), form helpers (sel, inp, chk)
- Used by: React renderer; exports App as default

**Matching/Business Logic Layer:**
- Purpose: Evaluate borrower scenario against all programs; determine eligibility
- Location: `src/App.js` (lines 842–1100, evaluateProgram function)
- Contains: LTV validation, FICO checks, DTI rules, derogatory waiting periods, loan amount limits, state restrictions, income documentation rules
- Depends on: Program data, scenario values
- Used by: Search view when user clicks "Search"

**Data Layer:**
- Purpose: Hold program definitions and lender metadata
- Location: `src/App.js` (lines 3–816, SEED_LENDERS and SEED_PROGRAMS arrays)
- Contains: ~80 mortgage programs with detailed overlays, special features, LTV matrices, MIP/funding fee tables
- Depends on: Nothing (pure data)
- Used by: evaluateProgram(), matching engine, admin panel

**Storage Layer:**
- Purpose: Persist custom programs and user-provided API key in browser
- Location: localStorage API calls throughout `src/App.js`
- Contains: "ls_programs" (custom programs JSON), "ls_claude_api_key" (Anthropic API key)
- Depends on: Browser localStorage API
- Used by: App state initialization, import/delete handlers

## Data Flow

### Primary Request Path (Search)

1. User fills search form (loan type, purpose, occupancy, property type, FICO, LTV, DTI, etc.) → `scenario` state
   - File: `src/App.js` (lines 1219–1228, state initialization)
2. User clicks "Search" button → calls `handleSearch()` callback (lines 1230–1248)
   - Combines SEED_PROGRAMS + customPrograms
   - Filters by loan type and lender (if selected)
   - Maps each program through `evaluateProgram(scenario, program)` (lines 842–1100)
3. evaluateProgram() returns: `{ program, matched, fails, warnings, passes }`
   - Matched = no fails detected
   - Fails = hard disqualifiers (too low FICO, LTV exceeds max, DTI too high)
   - Warnings = soft alerts (missing verification, state-specific overlay)
   - Passes = met requirements
4. Results displayed as cards (lines 1541–1704)
   - Matched programs first (green checkmark)
   - Mismatched below (red X)
   - Each card expandable to show detailed matching rationale

### Secondary Flow: Natural Language Processing (Optional)

1. User enters plain English description (e.g., "Veteran wanting to refinance a VA loan")
2. App checks for Claude API key in localStorage (line 1728–1732)
3. If key present: sends NL text + program summary to Claude API
4. Claude parses response and fills scenario fields (if implemented)
5. Triggers search automatically

### Admin Panel Flow

1. View toggle to "admin" (lines 1705–1771)
2. Display all seed + custom programs
3. Import flow: paste program JSON → conflict detection → add to customPrograms → persist to localStorage
4. Delete flow: click trash icon → confirm → remove from customPrograms → persist

**State Management:**
- `view` (string): "search" | "results" | "admin"
- `scenario` (object): Form inputs (FICO, LTV, DTI, loan type, purpose, etc.)
- `results` (array): Matched/mismatched programs with rationale
- `filter` (string): Loan type filter for results display
- `expandedId` (string): Which program detail card is expanded
- `customPrograms` (array): User-imported custom programs (persisted)
- `nlText` (string): Natural language input (optional feature)
- `importJson`, `importError`, `pendingConflict` (strings/objects): Admin form state

## Key Abstractions

**Program Object:**
- Purpose: Represents a single mortgage program with all eligibility rules
- Examples: `SEED_PROGRAMS[0]` (PennyMac Fannie Mae Conforming), custom programs
- Pattern: Flat JavaScript object with nested LTV matrices, derogatory waiting maps, arrays of overlays/special features
- Fields: id, name, lenderId, agency, loanTypes[], purposes[], occupancy[], propertyTypes[], minFico, maxDti, ltv (nested), overlays[], specialFeatures[], etc.

**Scenario Object:**
- Purpose: Represents borrower/property characteristics for matching
- Examples: User input from search form
- Pattern: Flat object with string/number/boolean values matching form inputs
- Fields: loanType, purpose, occupancy, propertyType, units, fico, ltv, dti, loanAmount, isHighBalance, state, hasForbearance, derogatoryType, etc.

**Evaluation Result:**
- Purpose: Outcome of comparing one scenario to one program
- Pattern: Object with program reference + matched flag + categorized feedback
- Fields: program, matched (bool), fails[] (hard disqualifiers), warnings[] (soft alerts), passes[] (met criteria)

## Entry Points

**Page Load:**
- Location: `src/index.js` (lines 1–17)
- Triggers: React renders App component to `document.getElementById('root')`
- Responsibilities: Mount React app, initialize performance monitoring

**Search Button:**
- Location: `src/App.js` line ~1320 (handleSearch callback)
- Triggers: User clicks search; evaluates all programs against scenario
- Responsibilities: Filter programs, run evaluateProgram for each, sort results (matched first), display

**Admin Panel:**
- Location: `src/App.js` line ~1705 (conditional render on view==="admin")
- Triggers: User clicks admin tab
- Responsibilities: Display programs, handle import/delete, persist to localStorage

## Architectural Constraints

- **Monolithic component:** Entire app logic in single `App.js` file (1775 lines). Refactoring to extract components would improve testability but is not done.
- **In-memory data:** All 80+ programs loaded on page startup. No lazy loading or pagination.
- **Client-side only:** No backend API. All matching logic runs in browser. Scalability limited to program data size.
- **localStorage limits:** Browser storage typically 5–10MB. Current SEED_PROGRAMS array is well within limits (~200KB minified), but very large custom program imports may fail.
- **Linear matching:** No caching or optimization. Each search re-evaluates all programs from scratch.
- **Form state:** Scenario state is JavaScript object with many string fields. No validation layer; relies on evaluateProgram() to detect invalid inputs.
- **No async:** All synchronous. Claude API integration (if used) would need UI state management for pending/loading states (not shown in current code).

## Anti-Patterns

### Hardcoded Program Data

**What happens:** ~80 mortgage programs and overlays are embedded as JavaScript literals in `src/App.js` lines 3–816
**Why it's wrong:** Data and code are intermingled. Updates require editing code. No versioning or change tracking. Makes file very large (1775 lines).
**Do this instead:** Move SEED_LENDERS and SEED_PROGRAMS to separate JSON files (`src/data/lenders.json`, `src/data/programs.json`), import at startup. Easier to maintain, version, and update independently.

### No Component Decomposition

**What happens:** Single App component handles all views (search form, results, admin panel), state management, evaluation logic, and rendering (1775 lines)
**Why it's wrong:** Testing individual features is difficult. Reusing form components is impossible. Code is hard to navigate.
**Do this instead:** Extract SearchForm, ResultsView, AdminPanel, ProgramCard, MatchingEngine as separate components. Use context or props for shared state. Keep App as orchestrator only.

### Evaluation Logic Mixed with Rendering

**What happens:** evaluateProgram() handles business rules (LTV, FICO, DTI) but also returns warnings and passes that are mixed into JSX rendering (lines 1145–1171, 1541–1704)
**Why it's wrong:** Difficult to test matching logic independently. Hard to reuse evaluation result structure.
**Do this instead:** Keep evaluateProgram() pure (only evaluate, no side effects). Return structured result with reason codes or severity levels. Separate component handles rendering and formatting messages.

## Error Handling

**Strategy:** Validation happens in evaluateProgram() and catches are minimal. No error boundary component.

**Patterns:**
- Program import: Try-catch wraps JSON.parse (line ~1763), displays error message if malformed
- localStorage: Try-catch at customPrograms initialization (line 1225) to handle corrupted data
- Form input: No validation; invalid inputs (empty string, NaN) handled by evaluateProgram() logic (e.g., fico="" is treated as "not provided")
- No API error handling: If Claude API is called, no try-catch visible in current code (feature incomplete)

## Cross-Cutting Concerns

**Logging:** None. No console logging or structured logs in production build.

**Validation:** Inline validation in evaluateProgram(). Examples:
  - if (fico && fico < program.minFico) → push fail
  - if (ltv && ltv > maxLtv) → push fail
  - No pre-validation of form inputs before evaluateProgram() call

**Authentication:** None. Local storage access is unrestricted. Claude API key stored in plaintext in localStorage (security risk for production).

---

*Architecture analysis: 2026-04-30*
