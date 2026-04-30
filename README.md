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

## Local Development (Phase 1+)

Phase 1 introduces the Postgres tenant-isolation foundation. To run the pen-test suite locally:

```bash
# 1. Install dependencies (pnpm required — npm is not supported)
pnpm install

# 2. Bring up Postgres 16 (provisions NOBYPASSRLS app_user role on first boot)
pnpm db:up

# 3. Copy the env template and edit if needed
cp .env.local.example .env.local

# 4. Apply migrations (Plan 04+05 land them; this command will work once they exist)
pnpm db:migrate

# 5. Run the RLS pen-test suite
pnpm test:rls
```

To reset the local database (drops the docker volume and re-runs the init script):
```bash
pnpm db:reset
```

The init script provisions `app_user` (NOBYPASSRLS, NOSUPERUSER) — pen tests connect as this user so that `FORCE ROW LEVEL SECURITY` is meaningful. **Never connect tests as the `postgres` superuser; the pen-test setup file aborts the suite if it detects a privileged connection.**

### Run before merging any PR

```bash
pnpm test:rls
```

CI fails if any pen test fails. RLS regressions are treated as security incidents (see `CLAUDE.md` § Conventions and `.planning/research/PITFALLS.md` § 3.5).

## PR Gate (Phase 1+)

Every pull request runs the following checks. Any failure blocks merge.

| Check          | Command                    | What it asserts                                                                                              |
| -------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Typecheck      | `pnpm typecheck`           | TypeScript compiles strict                                                                                   |
| Lint           | `pnpm lint`                | App code does not access `process.env` directly; no service-role import patterns                             |
| Lint fixture   | `pnpm lint:fixture`        | The intentional ESLint fixture violates rules and is rejected (proves rules fire)                            |
| Migrate        | `pnpm drizzle-kit migrate` | Schema applies cleanly from a fresh DB                                                                       |
| FORCE RLS gate | psql introspection         | `pg_class.relforcerowsecurity = true` for both `tenant` and `_rls_canary`                                    |
| RLS pen tests  | `pnpm test:rls`            | All cross-tenant attacks return zero rows or are rejected                                                    |

Run all of these locally before pushing:

```bash
pnpm typecheck && pnpm lint && pnpm lint:fixture && pnpm test:rls
```

See `.github/workflows/ci.yml` for the full CI definition.

### Why these gates exist

Tenant isolation is the antitrust safety net — a single cross-tenant leak is existentially expensive in this domain (per `.planning/research/PITFALLS.md` § 3.1, citing the October 2025 Smith v. Optimal Blue class action). The pen-test suite turns "forgot a `WHERE` clause" into "no rows returned" instead of a data-exfiltration incident.

Any RLS pen-test regression is treated with the same severity as a security incident.

## Phase 1 Summary (Tenant Isolation Foundation)

Phase 1 ships:
- Postgres 16 schema with `FORCE ROW LEVEL SECURITY` on every tenant-scoped table
- Self-filtering RLS policies on `tenant` + `_rls_canary` using `current_setting('app.tenant_id', true)::uuid`
- `setTenantContext(tx, tenantId)` primitive at `lib/tenant/context.ts` (Phase 6 wraps in request middleware)
- Vitest pen-test harness at `tests/rls/` covering the D-03 matrix (cross-tenant SELECT/write, JWT tampering, service-role boundary, GUC reset, index scan)
- t3-env runtime validation at `lib/env.ts` (boot fails closed on missing/malformed env vars)
- ESLint flat config that blocks `process.env` reads + `service-role*` import patterns from app paths (forward-looking guard for Phase 6's first `app/` PR)
- GitHub Actions CI gating PRs on `pnpm test:rls` + `pnpm lint` + `pnpm typecheck`

Out of scope (deferred to later phases):
- Real domain tables (program, agency_rule, license, evaluation_event) → Phase 2+
- Supabase Auth + JWT verification → Phase 6
- `withTenantContext` request wrapper → Phase 6
- Inngest worker pool, Sentry, Axiom → Phase 6
