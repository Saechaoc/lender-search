# Tech Stack

- **React 19.2** (function components + hooks: `useState`, `useCallback`)
- **Create React App** (`react-scripts 5.0.1`) — not ejected
- **Testing**: `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, Jest (via CRA)
- **Web Vitals** measurement (unused — `reportWebVitals()` called with no callback)
- **No state management library** — all state local to `App`
- **No router** — view switching via `view` state variable (`"search" | "qa" | "admin"`)
- **No CSS framework** — inline `style={{}}` props throughout `App.js`
- **No TypeScript** — plain JS, but Serena treats it as TypeScript project per language detection
- **Persistence**: browser `localStorage` only (no backend)
- **External API**: Anthropic `/v1/messages` direct from browser (`claude-haiku-4-5-20251001`)
- **GitNexus** indexed: `.gitnexus/` directory, project name `lender-search` (134 symbols, 154 relationships)
