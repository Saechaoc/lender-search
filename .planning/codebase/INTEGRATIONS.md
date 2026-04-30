# External Integrations

**Analysis Date:** 2026-04-30

## APIs & External Services

**AI/LLM:**
- Anthropic Claude API - AI-powered lender program analysis and Q&A
  - SDK/Client: Native `fetch()` calls (no SDK library)
  - Endpoint: `https://api.anthropic.com/v1/messages`
  - Auth: API key via `ls_claude_api_key` localStorage key
  - Usage: Parsing lender program requirements and answering user questions about lending products (`src/App.js`)

## Data Storage

**Databases:**
- None - Client-side only application

**File Storage:**
- Local filesystem only (no external storage service)
- Public assets: `public/` directory (favicon, logos, manifest)

**Caching:**
- Browser localStorage only for API key storage
- No Redis, Memcached, or other caching service

## Authentication & Identity

**Auth Provider:**
- Manual API key management (no OAuth, no service provider)
- Implementation: User-provided Anthropic API key stored in browser localStorage
- Location: Admin panel UI in `src/App.js` for key configuration
- Security: Client-side key storage (keys exposed to browser memory and localStorage)

## Monitoring & Observability

**Error Tracking:**
- None detected (no Sentry, Datadog, etc.)

**Logs:**
- Browser console only (console.log usage in parsing operations)
- Performance metrics: web-vitals sent to callback in `src/reportWebVitals.js`

## CI/CD & Deployment

**Hosting:**
- Not configured (no deployment target detected)
- Application: Static SPA suitable for CDN hosting (built with `npm run build`)

**CI Pipeline:**
- None detected (no GitHub Actions, CircleCI, etc.)

## Environment Configuration

**Required env vars:**
- None - All configuration via browser UI (Admin panel)
- API key: User-provided at runtime via Admin panel, stored in `ls_claude_api_key`

**Secrets location:**
- Browser localStorage only
- No `.env` file or environment variable support

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- Anthropic Claude API: REST POST to `https://api.anthropic.com/v1/messages` for each query

## Data Flow

**User Query Processing:**
1. User enters API key in Admin panel (`src/App.js`)
2. Key stored in `localStorage.getItem("ls_claude_api_key")`
3. User submits query with selected lender program
4. Client-side fetch() sends POST request to `https://api.anthropic.com/v1/messages`
5. Response streamed back and parsed by application
6. Results displayed in UI

**Lender Program Data:**
- Hardcoded seed data in `src/App.js` (SEED_LENDERS, SEED_PROGRAMS arrays)
- Data structure includes lending program details: LTV requirements, FICO minimums, DTI limits, overlays, derogatory waiting periods, etc.
- No database backend - all data in-memory in component state

---

*Integration audit: 2026-04-30*
