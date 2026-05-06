<!-- generated-by: gsd-doc-writer -->
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

See [Local Development (Phase 1+)](#local-development-phase-1) below for the full setup, including Postgres provisioning and the RLS pen-test suite.

```bash
pnpm install
pnpm db:up
pnpm db:migrate
pnpm test:rls
```

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

- **Frontend / API**: Next.js 16.2 (App Router) + React 19.2 — pinned to 16.2.x
- **Language**: TypeScript 5.7 (strict)
- **Database**: Postgres 16+ via Supabase
- **ORM**: Drizzle 0.45 (schema-as-code, `prepare: false` for the Supabase pooler)
- **Package manager**: pnpm 9 (npm is not supported)
- **Legacy reference only**: `src/App.js` is a Create React App prototype kept for scenario-form shape; do not extend it

## Learn More

- [Next.js docs](https://nextjs.org/docs)
- [Drizzle ORM docs](https://orm.drizzle.team/docs/overview)
- [Supabase docs](https://supabase.com/docs)
- [React docs](https://react.dev/)

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

## Project Layout

Top-level directories that matter for new contributors:

```
lender-search/
├── app/                 Reserved for Next.js App Router routes (empty until Phase 6)
├── db/
│   ├── migrations/      Drizzle SQL migrations (0000 → 0006), applied in order
│   └── schema/          Drizzle table definitions (tenant, program, agency rules, citations)
├── lib/
│   ├── db/              Postgres client wrapper (lib/db/client.ts)
│   ├── env.ts           t3-env runtime validation — boot fails closed on missing vars
│   ├── rules/schemas/   Per-rule-kind Zod schemas (fico-min, ltv-max, derog-seasoning, etc.)
│   └── tenant/          setTenantContext primitive at lib/tenant/context.ts
├── scripts/
│   └── init-db.sh       Provisions app_user (NOBYPASSRLS) on first Postgres boot
├── tests/
│   ├── _shared/         Shared test fixtures (agency-fixture)
│   ├── rls/             Cross-tenant pen-test suite (D-03 matrix)
│   ├── rules/           Per-rule-kind schema validation tests
│   └── schema/          Database constraint tests (FK, EXCLUDE, CHECK, generated columns)
├── src/                 Legacy CRA prototype (App.js) — reference only, do not extend
├── docs/                Reserved for generated project docs (currently empty)
└── .planning/           GSD planning artifacts (PROJECT, ROADMAP, REQUIREMENTS, phases)
```

Configuration files at the project root:
- `drizzle.config.ts` — Drizzle Kit configuration (migration directory, schema input)
- `docker-compose.yml` — Local Postgres 16 service definition
- `eslint.config.mjs` — Flat-config ESLint rules (blocks `process.env` reads from app paths)
- `tsconfig.json` — TypeScript strict mode configuration
- `vitest.config.ts`, `vitest.schema.config.ts`, `vitest.env-boot.config.ts` — Vitest configs per test bucket

## Further Reading

The `.planning/` directory holds the architectural source of truth. New contributors should read these in order:

| Document | Purpose |
| --- | --- |
| [.planning/PROJECT.md](.planning/PROJECT.md) | Product mission, target user, scope, KPI gates |
| [.planning/ROADMAP.md](.planning/ROADMAP.md) | Phase sequencing (Phase 0 → Phase 3) and gate criteria |
| [.planning/REQUIREMENTS.md](.planning/REQUIREMENTS.md) | Functional and non-functional requirements |
| [.planning/research/STACK.md](.planning/research/STACK.md) | Resolved technology stack and rationale |
| [.planning/research/ARCHITECTURE.md](.planning/research/ARCHITECTURE.md) | Postgres-centric Next.js monolith design |
| [.planning/research/PITFALLS.md](.planning/research/PITFALLS.md) | Anti-patterns and security guardrails |
| [.planning/research/FEATURES.md](.planning/research/FEATURES.md) | Feature inventory by phase |
| [.planning/STATE.md](.planning/STATE.md) | Current phase status and shipped work |
| [CLAUDE.md](CLAUDE.md) | Agent guidance, conventions, and architectural commitments |
| [AGENTS.md](AGENTS.md) | GitNexus code-intelligence usage |

A `docs/` directory is reserved for generated project documentation (architecture, getting-started, development, testing, configuration, deployment). Files will be added as later phases produce contributor-facing material.

## Contributing

This is a private, pre-MVP project; external contributions are not accepted at this stage. Internal contributors should follow the GSD workflow:

- Use `/gsd-quick` for small fixes and doc updates.
- Use `/gsd-debug` for investigation and bug fixing.
- Use `/gsd-execute-phase` for planned phase work.
- Do not bypass GSD entry points without an explicit instruction from the project owner.

Every pull request must pass the [PR Gate](#pr-gate-phase-1) checks above. RLS pen-test regressions are treated as security incidents.

A formal `CONTRIBUTING.md` will be added when the project opens to external contributors.

## License

This repository is private and currently has no published license. The `package.json` `private: true` flag prevents accidental publication to npm. A license will be selected before any public release.

## Support

For questions or issues, contact the project maintainer (`chris.saechao@gmail.com`) or open a GitHub issue against this repository. There is no public support channel while the project is pre-MVP.
