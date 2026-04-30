# Technology Stack

**Analysis Date:** 2026-04-30

## Languages

**Primary:**
- JavaScript (ES6+) - All source code in `src/` directory and React components
- CSS - Styling for React components (inline styles observed in `src/App.js`)

**Secondary:**
- JSON - Configuration and data structures (`package.json`, `public/manifest.json`)

## Runtime

**Environment:**
- Node.js (version not specified in `.nvmrc` or `.node-version`)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- React 19.2.4 - UI framework (`src/index.js`, `src/App.js`)
- React DOM 19.2.4 - DOM rendering

**Testing:**
- Jest - Test runner (via react-scripts)
- React Testing Library 16.3.2 - Component testing (`src/App.test.js`)
- @testing-library/dom 10.4.1 - DOM testing utilities
- @testing-library/jest-dom 6.9.1 - Jest matchers for DOM
- @testing-library/user-event 13.5.0 - User event simulation

**Build/Dev:**
- react-scripts 5.0.1 - CRA build toolchain (handles webpack, Babel, ESLint, Jest)

## Key Dependencies

**Critical:**
- react 19.2.4 - Core UI rendering
- react-dom 19.2.4 - DOM bindings for React

**Infrastructure:**
- web-vitals 2.1.4 - Web performance metrics collection (`src/reportWebVitals.js`)

## Configuration

**Environment:**
- No `.env` or `.env.*` files present
- API key storage: Browser localStorage (`ls_claude_api_key` key in `src/App.js`)
- No server-side environment variables detected

**Build:**
- `react-scripts` handles all build configuration
- ESLint config: extends `react-app` and `react-app/jest` (in `package.json`)
- Browser targets: >0.2% market share, excluding dead browsers and Opera Mini for production

## Platform Requirements

**Development:**
- Node.js runtime
- npm package manager
- Modern browser with JavaScript enabled

**Production:**
- Client-side web browser (React SPA)
- Anthropic Claude API endpoint: `https://api.anthropic.com/v1/messages`
- Internet connectivity for API calls

## External API Integration

**Anthropic Claude API:**
- Endpoint: `https://api.anthropic.com/v1/messages`
- Authentication: API key stored in browser localStorage
- Usage: Processing lender program data and question-answering features (`src/App.js`)
- Client-side: Direct fetch calls from browser (no backend proxy)

---

*Stack analysis: 2026-04-30*
