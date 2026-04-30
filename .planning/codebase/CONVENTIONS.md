# Coding Conventions

**Analysis Date:** 2026-04-30

## Naming Patterns

**Files:**
- React components: `PascalCase.js` (e.g., `App.js`)
- Test files: `.test.js` suffix (e.g., `App.test.js`)
- Utility/library files: `camelCase.js` (e.g., `reportWebVitals.js`, `setupTests.js`)
- Style files: `.css` suffix (e.g., `App.css`, `index.css`)

**Functions:**
- React components and hooks: `PascalCase` (e.g., `App()`)
- Helper functions: `camelCase` (e.g., `reportWebVitals()`, `handleImport()`)
- Event handlers: `handle` + `PascalCase` (e.g., `handleImport()`, `commitProgram()`)
- Comparison/filter functions: `is` or verb prefix (e.g., `isSelfEmployed`, `hasPrepay`)

**Variables:**
- State variables: `camelCase` (e.g., `fico`, `ltv`, `customPrograms`)
- Array data: plural `camelCase` (e.g., `SEED_LENDERS`, `SEED_PROGRAMS`, `customPrograms`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `SEED_LENDERS`, `SEED_PROGRAMS`)
- Boolean flags: `is` or `has` prefix (e.g., `isForeignNational`, `hasPrepay`, `cashOutAllowed`)
- Collections: plural form (e.g., `fails`, `warnings`, `passes`)

**Types/Objects:**
- Object properties: `camelCase` (e.g., `lenderId`, `minFico`, `maxDti`, `cashOutAllowed`)
- Nested structures: `camelCase` property names with semantic hierarchy (e.g., `ltv.ownerOccupied.purchase`)

## Code Style

**Formatting:**
- ESLint config: `react-app` and `react-app/jest` (via `package.json`)
- No dedicated Prettier config; uses Create React App defaults
- Indentation: inferred from CRA (4 spaces typical for JavaScript)
- Line length: not explicitly restricted

**Linting:**
- Tool: ESLint via Create React App
- Config location: `package.json` eslintConfig section
- Extends: `react-app` (React-specific) and `react-app/jest` (Jest test rules)
- No custom `.eslintrc` file in root — inherits from CRA

## Import Organization

**Order:**
1. Third-party library imports (`react`, `react-dom`)
2. CSS imports (`.css` files)
3. Internal component imports (other `.js` files)

**Examples from codebase:**
```javascript
// src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
```

**Path Aliases:**
- Not detected in this project; all imports use relative paths

## Error Handling

**Patterns:**
- Validation arrays: `fails`, `warnings`, `passes` — collect errors/warnings in arrays during checks
- Conditional failures: items added to `fails` array if condition is not met
- Optional field handling: checks for undefined/null before accessing nested properties (e.g., `program.supportedIncomeDocs`, `ioRules.notes`)
- Error strings: descriptive messages with context (e.g., `"Foreign national borrowers are ineligible for all programs"`)

**Example from `src/App.js`:**
```javascript
const fails=[], warnings=[], passes=[];
if (isForeignNational) fails.push("Foreign national borrowers are ineligible for all programs");
if (ltv && ltv > ioRules.maxLtv) fails.push(`Interest-only max LTV is ${ioRules.maxLtv}% (scenario: ${ltv}%)`);
```

## Logging

**Framework:** Console (no logging framework detected)

**Patterns:**
- Console methods used in comments/documentation only (no active logging in source code)
- Example in `src/index.js`: comment references `reportWebVitals(console.log)` as possible usage
- No debug logging found in application logic

## Comments

**When to Comment:**
- Documentation of external APIs/dependencies (e.g., web-vitals setup in `index.js`)
- Educational comments explaining optional behavior (e.g., performance monitoring setup)
- Rare in application logic — code is self-documenting via descriptive variable/function names

**JSDoc/TSDoc:**
- Not detected in this codebase
- No type annotations (plain JavaScript, not TypeScript)

## Function Design

**Size:** 
- Component functions are large (e.g., `App()` is 1,775 lines) but organized into logical sections
- Helper functions are concise (e.g., `reportWebVitals()` is 13 lines)

**Parameters:**
- React components: accept props object destructured inline
- Utility functions: single parameter when possible (e.g., `onPerfEntry` in `reportWebVitals()`)
- Callback handlers: accept event object as parameter (e.g., `onChange={e=>...}`)

**Return Values:**
- Components: return JSX
- Data processors: return objects with structured results (e.g., `{ program, matched, fails, warnings, passes }`)
- Helper functions: return void or single value

**Ternary/Conditional:**
- Inline ternaries common for simple conditionals: `{condition ? <Yes /> : <No />}`
- Multiline conditions in logical sections with early returns in loops
- Array methods (`.map()`, `.filter()`, `.some()`) used for transformations

## Module Design

**Exports:**
- Default exports for main components (e.g., `export default App;`)
- Default exports for utilities (e.g., `export default reportWebVitals;`)
- Single export per file pattern

**Barrel Files:**
- Not used in this project — each file exports one primary symbol

**Module-Level State:**
- Seed data defined at module level: `SEED_LENDERS`, `SEED_PROGRAMS` arrays
- Used as immutable constants referenced by component logic
- Component state management: React hooks (`useState`, `useCallback`)

## Data Structure Patterns

**Complex Nested Objects:**
- Program objects have nested LTV structures: `ltv.ownerOccupied.purchase["1-unit-frm"]`
- Overlays stored as string arrays for easy rendering/checking
- Derogatory waiting periods: object with event keys mapping to period strings
- Conditional properties: properties may be `null`, `undefined`, or array depending on program type

**Inline Conditionals in Data:**
- Feature detection via property existence: `if (program.supportedIncomeDocs)...`
- Enum-like strings: `program.agency` in set of known values (e.g., `"Fannie Mae"`, `"VA"`, `"FHA"`)
- Optional features as arrays: `program.specialFeatures` — checked with `.some()` for matching features

---

*Convention analysis: 2026-04-30*
