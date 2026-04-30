# Codebase Concerns

**Analysis Date:** 2026-04-30

## Tech Debt

### Monolithic Component Architecture

**Issue:** Entire application logic and UI concentrated in single 1775-line React component
- Files: `src/App.js`
- Impact: Nearly impossible to test individual features, reuse components, or reason about data flow. Changes in one area risk breaking unrelated functionality. Component is at critical complexity threshold.
- Fix approach: Extract concerns into separate modules — create `evaluateScenario` utility, separate API clients for Claude/Anthropic, extract filtering/formatting logic into helper functions, split UI into smaller presentational components

### Massive Inline Data Structure

**Issue:** 1400+ lines of hardcoded loan program data embedded directly in component initialization
- Files: `src/App.js` lines 3-856 (SEED_PROGRAMS and SEED_LENDERS)
- Impact: Data updates require code changes and redeployment. Difficult to version control mortgage guideline changes. No schema validation. Should be externalized to JSON/database.
- Fix approach: Move SEED_LENDERS and SEED_PROGRAMS to separate JSON file or database. Implement data validation schema on load.

### Inconsistent State Management

**Issue:** 16+ useState hooks managing interconnected state without clear ownership
- Files: `src/App.js` lines 1220-1239
- Impact: State updates can become de-synchronized (e.g., scenario changes don't reset filter state). No single source of truth. Testing becomes brittle.
- Fix approach: Consolidate related state into unified context or reducer. Create custom hook to manage scenario + results + filter as coherent unit.

## Known Bugs

### localStorage Silent Failure Risk

**Issue:** JSON.parse calls wrapped in try-catch that silently returns empty array/object on error
- Files: `src/App.js` lines 1225, 1239
- Impact: Corrupted or invalid JSON in localStorage silently discards user data without notification. User has no way to know their custom programs were lost.
- Workaround: Manual browser DevTools inspection of localStorage
- Fix: Log to console and show user-facing notification when localStorage recovery fails. Implement validation schema before parsing.

### Unvalidated JSON Import

**Issue:** Program import validates presence of `name` and `lenderId` fields only; no schema validation
- Files: `src/App.js` lines 1247-1252
- Impact: Malformed program objects can be stored in localStorage with missing critical fields (minFico, purposes, ltv, etc.), causing runtime errors during scenario evaluation.
- Trigger: User imports custom JSON missing required fields
- Fix: Validate against full program schema before storing. Provide field-by-field validation feedback to user.

### API Key Stored in localStorage

**Issue:** Claude API key stored unencrypted in browser localStorage
- Files: `src/App.js` lines 1280, 1350, 1729-1732
- Impact: CRITICAL SECURITY RISK. Any XSS vulnerability or malicious script can read API key. Compromised key can be used to make unauthorized API calls to Anthropic at significant cost. Key visible in browser DevTools Storage tab.
- Current mitigation: Single-user local app (not shared/deployed), password field type hides on-screen
- Recommendations: 
  - Never store secrets in browser localStorage
  - Implement backend proxy to handle Claude API calls instead
  - Use secure HTTP-only cookies if backend auth required
  - Add warning in Admin panel about security implications

### Regex-Based JSON Extraction

**Issue:** Extracts JSON from API response using simple regex pattern match
- Files: `src/App.js` line 1297 (`raw.match(/\{[\s\S]*\}/)`)
- Impact: If Claude response contains multiple JSON objects or malformed JSON, regex will match first `{...}` which may not be the intended object. Could capture partial/corrupt data. No schema validation on extracted JSON.
- Fix: Use strict JSON parsing or schema validation (e.g., Zod). Validate response structure before using parsed data.

### Floating Promise in Handleable Error Path

**Issue:** `handleImport()` doesn't prevent race conditions if called multiple times rapidly
- Files: `src/App.js` lines 1245-1275
- Impact: If user clicks "Import program" multiple times quickly, concurrent state updates could cause unpredictable results. No debounce/throttle on button.
- Fix: Disable button during import or debounce handler.

## Security Considerations

### Direct Anthropic API Calls from Browser

**Issue:** Claude API calls made directly from browser with explicit CORS header
- Files: `src/App.js` line 1286 (`"anthropic-dangerous-direct-browser-access":"true"`)
- Risk: This header exists specifically because direct browser access is dangerous. Exposes API to rate limiting attacks, key theft, and man-in-the-middle interception of mortgage data.
- Current mitigation: Single-user local app
- Recommendations: 
  - Route all API calls through backend server
  - Implement request signing/authentication
  - Rate-limit API calls per session
  - Never expose keys to client

### Mortgage Data Privacy

**Issue:** Sensitive borrower scenario data (FICO, DTI, income, state, derogatory history, etc.) sent to third-party API
- Files: `src/App.js` lines 1284-1292, 1355-1375
- Risk: Personally identifiable financial information transmitted to Anthropic for natural language processing. No encryption in transit (relies on HTTPS only). User may not realize data is leaving their device.
- Current mitigation: User controls what data they enter
- Recommendations:
  - Implement on-device parsing model (TensorFlow.js or similar) if privacy critical
  - Add explicit privacy disclosure when using Claude features
  - Implement data minimization (don't send unnecessary fields)
  - Add option to anonymize data in API calls (remove identifiable info, send only loan type/purpose/etc)

### No Input Sanitization

**Issue:** User-entered scenario values used directly in string interpolation for error messages and API requests
- Files: `src/App.js` lines 869, 874, 879-880, etc.
- Risk: While JSON.stringify provides some protection, untrusted user input echoed back in error messages with minimal escaping. Could theoretically enable stored XSS if error messages displayed in unsanitized contexts elsewhere.
- Fix: Sanitize all user-facing error output. Use JSON for structured error messages.

### Natural Language Parsing System Prompt Injection

**Issue:** User-provided natural language text (`nlText`) sent to Claude with minimal guardrails
- Files: `src/App.js` lines 1284-1292
- Risk: Malicious user could craft input to override system prompt instructions ("You are now a calculator..."). Could trick parser into accepting false data or leaking system prompt.
- Fix: Implement prompt injection detection/filtering. Use structured extraction (e.g., zero-shot CoT with fixed schema validation) rather than free-form text parsing.

## Performance Bottlenecks

### Scenario Evaluation on Large Program List

**Issue:** `evaluateScenario()` iterates through all programs with nested condition checks on every search
- Files: `src/App.js` lines 858-1098 (evaluateScenario function), called on every scenario change
- Problem: No memoization. Nested loops checking LTV matrices, derogatory waiting maps, income docs for 100+ programs repeatedly
- Current capacity: Works fine with ~100 programs. Will slow significantly at 500+ programs.
- Improvement path: 
  - Memoize evaluateScenario with useMemo
  - Create program index/lookup tables for FICO, LTV, purposes (O(1) instead of O(n) checks)
  - Implement lazy evaluation (only evaluate programs that match basic filters)
  - Consider moving to Web Worker for heavy computation

### Render Performance with Expanded Results

**Issue:** Full program details (overlays, derogatory maps, special features) rendered for all programs in DOM simultaneously
- Files: `src/App.js` lines 1522-1620 (results rendering)
- Impact: Each program can have 50+ overlay strings, complex nested objects. With 100+ programs rendered, DOM becomes very large. Expanding all programs creates thousands of DOM nodes.
- Improvement path: Virtual scrolling for large result sets. Lazy-load program details on expansion only.

### No Debounce on Filter/Search Input

**Issue:** State updates and re-evaluations triggered on every keystroke
- Files: `src/App.js` lines 1220-1240
- Impact: User typing scenario values triggers full re-evaluation on every character. With large program list, causes jank/lag.
- Fix: Debounce scenario change handlers (300-500ms).

## Fragile Areas

### LTV Matrix Matching Logic

**Files:** `src/App.js` lines 895-915
**Why fragile:** Complex nested object structure with inconsistent keys:
- Some programs have `ltv[occupancy][purpose][loanType]` structure
- Some have null for entire occupancy
- Some have string values like "Not Eligible"
- No type checking or schema validation
- Typos in key names silently return undefined instead of failing loudly

**Safe modification:** 
- Add TypeScript interfaces for program structure
- Validate program data on load against schema
- Create helper function getLtvForScenario that validates keys before access
- Write comprehensive unit tests for all LTV combination scenarios

**Test coverage:** Untested — no tests for LTV logic. Edge cases likely exist.

### Derogatory Waiting Period Fallback

**Files:** `src/App.js` lines 959-962
**Why fragile:** Falls back to hardcoded default waiting map if program has none or is empty. Default map may not match all derogatory types user enters.

```javascript
const defaultWm={"Chapter 7/11 BK":4,"Chapter 13 BK (discharge)":2,...};
const wm=(program.derogatoryWaitMap&&Object.keys(program.derogatoryWaitMap).length>0)?program.derogatoryWaitMap:defaultWm;
const req=wm[derogatoryType];  // Returns undefined if derogatoryType not in map
```

Risk: Returns undefined, which causes silent NaN in comparison at line 968. User sees no error, just confusing results.

**Safe modification:**
- Validate all derogatory types have values in map
- Throw clear error if derogatory type not found
- Add validation test

### Income Documentation Type Matching

**Files:** `src/App.js` lines 1007-1018
**Why fragile:** Checks if incomeDocType is in supportedIncomeDocs array with no normalization
- Case-sensitive comparison
- No fuzzy matching for typos
- Some programs have no supportedIncomeDocs field (undefined)
- Silently accepts if field missing

Risk: User enters "bank statement 12 month" (lowercase) but program has "Bank Statement 12 Month" → mismatch not flagged.

**Safe modification:**
- Normalize both sides to lowercase before comparison
- Provide autocomplete dropdown for income doc types (don't allow free text)
- Validate against finite set of known types

### Purpose String Matching

**Files:** `src/App.js` lines 872-875
**Why fragile:** Case-insensitive includes() check that could match unintended purposes:
```javascript
if (!program.purposes.some(p=>p.toLowerCase().includes(purpose.toLowerCase())))
```

Risk: "Rate Refi" could match "Rate/Term Refi". "Purchase" matches "Purchase (Rent-to-Own)".

**Safe modification:**
- Use exact match instead of includes
- Define canonical purpose enum
- Validate user input against enum

## Test Coverage Gaps

### Zero Unit Tests

**What's not tested:** 100% of functionality
- Files affected: `src/App.js` (1775 lines, 0 test coverage)
- Coverage: Only basic smoke test in `src/App.test.js` checks if render works
- Risk: 
  - Core scenario evaluation logic untested (bugs could silently produce wrong lender matches)
  - Program import/export untested
  - API integration untested
  - Error handling untested
  - Edge cases in LTV/DTI/FICO logic untested
- Priority: CRITICAL

**Recommended test structure:**
- Unit tests for `evaluateScenario()` with comprehensive test cases:
  - LTV validation for each occupancy/purpose/property type combination
  - FICO threshold checks
  - DTI calculations with null/undefined handling
  - Derogatory waiting period calculations
  - Income doc type matching
  - State eligibility filters
- Unit tests for data import/export
- Integration tests for Claude API integration
- Component tests for each major UI section

### No Type Safety

**Issue:** JavaScript with no TypeScript or JSDoc type hints
- Files: `src/App.js`
- Impact: IDE can't catch property access errors. Runtime errors possible from undefined properties on program objects.
- Fix: Migrate to TypeScript or add JSDoc type annotations. Create interface definitions for Program, Scenario, EvaluationResult types.

## Scaling Limits

### Browser localStorage Limit

**Current capacity:** Browser localStorage typically 5-10MB per domain
**Current usage:** Seed programs (JSON encoded) + custom programs + QA history + API key
**Limit:** At 100 custom programs + full QA history, could exceed limits. No warning shown.
**Scaling path:** Move custom program storage to IndexedDB (much larger) or implement backend API to persist user data

### Memory Usage with Large Program Lists

**Current state:** All programs (seed + custom) kept in memory in state array
**Limit:** At 1000+ programs, array operations (filter, map) become noticeably slower. useState array copies on each add/update.
**Improvement:** Use Web Worker for heavy computations. Implement pagination/virtual list for results.

### No Async Data Loading

**Current:** All program data must load before app is usable
**Issue:** If mortgage guideline database grows to 10000+ programs, initial load will block UI
**Fix:** Implement lazy loading/pagination. Load programs on-demand from backend API instead of hardcoded SEED_PROGRAMS.

## Dependencies at Risk

### @testing-library/user-event Outdated

**Package:** @testing-library/user-event
**Current:** 13.5.0
**Latest:** 14.6.1
**Risk:** Not a direct risk (older versions still work), but represents 1+ major version behind. May miss bug fixes and improvements.
**Migration plan:** Update to 14.x series. Review breaking changes. Re-run tests.

### react-scripts 5.0.1

**Package:** react-scripts (Create React App build tool)
**Current:** 5.0.1
**Risk:** CRA is in maintenance mode. React 19 (latest in package.json) is cutting-edge with potential compatibility issues. No major version upgrade available for CRA, which limits ability to use latest features safely.
**Migration plan:** Consider migrating away from CRA to Vite or Next.js for better dependency management and build performance. CRA 5.x was released in 2022; no new major versions planned.

### react/react-dom Minor Version Lag

**Packages:** react 19.2.4, react-dom 19.2.4
**Current:** 19.2.4
**Latest:** 19.2.5
**Risk:** Low risk (patch version). Suggests no automated dependency updates enabled.
**Fix:** Enable Dependabot or similar to automate patch updates.

## Missing Critical Features

### No Persistent Backend

**Problem:** All data stored in browser localStorage only. No server persistence.
**Blocks:** 
- Multi-device access (user must use same browser on same computer)
- Data backup/recovery
- Team collaboration (multiple lenders/brokers using same app)
- Audit trail of scenario evaluations
- Compliance reporting

**Scope:** Major architectural change. Would require backend API, user authentication, database schema.

### No Audit Trail / Scenario History

**Problem:** QA history tracks asked questions but not scenario evaluations. No way to track what scenarios were evaluated or when.
**Blocks:** Compliance documentation, performance analysis, troubleshooting user issues
**Fix:** Create scenario evaluation history with full scenario snapshot, results, and timestamp. Export capability for compliance.

### No Scenario Sharing

**Problem:** Users cannot share mortgage scenarios with colleagues, underwriters, or customers
**Blocks:** Collaboration workflows
**Fix:** Implement scenario export as JSON or shareable URL. Add scenario permalink support.

### No Program Update Notifications

**Problem:** When mortgage guidelines change (common in this industry), app has no way to notify users that loaded programs are outdated
**Blocks:** Users could work with stale information
**Fix:** Add program version/lastUpdated metadata. Compare against latest and warn if >30 days old. Implement update mechanism.

### No Search/Filter on Program List

**Problem:** Can only evaluate full scenarios. Cannot browse/search programs by lender, agency, or loan type without running evaluation
**Blocks:** Exploratory research workflow
**Fix:** Add dedicated program browser with search, sort, and filter capabilities.

---

*Concerns audit: 2026-04-30*
