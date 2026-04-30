# Testing Patterns

**Analysis Date:** 2026-04-30

## Test Framework

**Runner:**
- React Scripts / Jest (via Create React App)
- Version: `react-scripts@5.0.1` (bundled Jest)
- Config: Implicit CRA configuration (no `jest.config.js` file)

**Assertion Library:**
- Testing Library (`@testing-library/react@16.3.2`)
- DOM assertions: `@testing-library/jest-dom@6.9.1`
- User interaction: `@testing-library/user-event@13.5.0`

**Run Commands:**
```bash
npm test              # Run all tests (watch mode default in CRA)
npm test -- --coverage   # Run with coverage report
```

## Test File Organization

**Location:**
- Co-located with source files using `.test.js` suffix
- Example: `src/App.js` paired with `src/App.test.js`

**Naming:**
- Pattern: `[FileName].test.js`
- Test files: `App.test.js`, `setupTests.js`

**Structure:**
```
src/
├── App.js
├── App.test.js
├── App.css
├── index.js
├── index.css
├── reportWebVitals.js
└── setupTests.js
```

## Test Structure

**Suite Organization:**
```javascript
// src/App.test.js
import { render, screen } from '@testing-library/react';
import App from './App';

test('renders learn react link', () => {
  render(<App />);
  const linkElement = screen.getByText(/learn react/i);
  expect(linkElement).toBeInTheDocument();
});
```

**Patterns:**
- Setup: Import Testing Library components and target component
- Render: Call `render(<Component />)` to mount component in test DOM
- Query: Use `screen.getByText()`, `screen.getByRole()`, etc. to find elements
- Assert: Use `.toBeInTheDocument()` and other jest-dom matchers for assertions
- Single test per file pattern observed (only one `test()` block in current test suite)

## Mocking

**Framework:** Jest (built into react-scripts)

**Patterns:**
- jest-dom matchers: `@testing-library/jest-dom` imported in `setupTests.js`
- Component isolation: components tested in isolation without external dependencies

**What to Mock:**
- External APIs (not exercised in current test suite)
- Child components (if isolating parent logic)
- localStorage calls (if testing Admin features)

**What NOT to Mock:**
- React component rendering — use real components
- User events — use `@testing-library/user-event` for real interaction simulation
- DOM APIs — Testing Library provides abstraction

## Fixtures and Factories

**Test Data:**
- Seed data defined in main `App.js`: `SEED_LENDERS`, `SEED_PROGRAMS`
- Can be imported in tests if needed (not currently imported)
- Test-specific data: create inline within `test()` blocks as needed

**Location:**
- No separate fixtures directory detected
- Test data co-located in test files or reused from source module exports

## Coverage

**Requirements:** 
- Not enforced (no coverage thresholds in configuration)

**View Coverage:**
```bash
npm test -- --coverage
```

## Test Types

**Unit Tests:**
- Scope: Individual components and their rendering behavior
- Approach: Render component, query for expected elements, assert presence
- Current implementation: Basic render tests (e.g., `App.test.js` verifies text appears)

**Integration Tests:**
- Not implemented in current test suite
- Would test: Scenario matching logic, data flow between components

**E2E Tests:**
- Framework: Not used
- Would test: Full user workflows (scenario entry → matching → results display)

## Setup and Teardown

**Module-level Setup:**
```javascript
// src/setupTests.js
import '@testing-library/jest-dom';
```

**Purpose:**
- Extends Jest matchers with jest-dom assertions (e.g., `.toBeInTheDocument()`)
- Automatically run before each test file

**Per-Test Setup/Teardown:**
- Not explicit in current tests
- Testing Library handles component unmounting automatically via `render()` context

## Common Patterns

**Component Rendering:**
```javascript
import { render, screen } from '@testing-library/react';

test('renders learn react link', () => {
  render(<App />);
  const linkElement = screen.getByText(/learn react/i);
  expect(linkElement).toBeInTheDocument();
});
```

**Querying Elements:**
- `screen.getByText(/regex/)` — find by visible text with regex
- `screen.getByText("exact string")` — find by exact string match
- `screen.getByRole("button")` — find by semantic role
- `screen.getByTestId("custom-id")` — find by data-testid attribute (not used currently)

**Async Testing:**
- Not required in current simple render tests
- For async operations: use `waitFor()` and `findBy*` queries from Testing Library
- Example pattern (not in codebase):
```javascript
test('async operation', async () => {
  render(<Component />);
  const element = await screen.findByText('loaded');
  expect(element).toBeInTheDocument();
});
```

**User Interaction Testing:**
- Framework: `@testing-library/user-event`
- Pattern: Simulate user clicks, form input, keyboard events
- Example pattern (not in codebase):
```javascript
import userEvent from '@testing-library/user-event';

test('button click', async () => {
  const user = userEvent.setup();
  render(<Button onClick={handler} />);
  await user.click(screen.getByRole('button'));
  expect(handler).toHaveBeenCalled();
});
```

**Error Testing:**
- Testing Library recommends testing error states through user interaction
- Test visible error messages rendered to screen
- Use `expect(screen.getByText(/error message/)).toBeInTheDocument()`

## Testing Best Practices Applied

1. **Render in isolation** — Each test renders component independently
2. **Query by semantics** — Use `getByText()` and `getByRole()` rather than implementation details
3. **Assert on visual output** — Check what user sees, not internal state
4. **No mocking internals** — Test real component behavior
5. **Descriptive test names** — Test descriptions indicate what is being verified

## Current Coverage

**Tested:**
- `App.js` — basic render verification
- `setupTests.js` — jest-dom setup

**Untested:**
- Complex scenario matching logic (1700+ lines in `App.js`)
- Program filtering logic
- Validation rule application
- Admin panel features
- State management (hooks)
- User interactions and form submissions

**Recommendation:**
- Add tests for core matching algorithm
- Add integration tests for scenario validation
- Add tests for admin panel data import/export

---

*Testing analysis: 2026-04-30*
