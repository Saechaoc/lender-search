# Stack Research

**Project:** Lender Search — eligibility-first US-residential-mortgage program-search tool with AI-assisted document extraction
**Domain:** Multi-tenant SaaS, deterministic rule engine, document-extraction pipeline with human-in-the-loop review
**Researched:** 2026-04-29
**Overall Confidence:** HIGH on framework/runtime choices and Claude-related decisions; MEDIUM on extraction-vendor primary pick (single highest-stakes decision); HIGH on multi-tenant pattern.

## Executive Summary

The recommended stack is a **TypeScript-everywhere, Postgres-everything, Vercel + Supabase** core, with **Inngest** for the durable extraction pipeline and **Reducto (primary) + Claude Sonnet 4.6 vision (backup)** for matrix PDF parsing. The rationale, in one paragraph: a solo developer building a multi-tenant, audit-heavy, eligibility-correctness-gated product cannot afford to operate infrastructure. Postgres + RLS solves tenant isolation, audit, JSONB rule storage, and full-text search in one engine. Next.js + Drizzle keeps the surface to one language and one schema source of truth. Reducto is the only vendor with a published, peer-validated benchmark advantage on dense, multi-cell tables of the FICO×LTV matrix shape; Claude vision is the natural backup because the project already operates an Anthropic relationship and Sonnet 4.6 ranked 9.5/10 on independent table-extraction benchmarks. Inngest is chosen over Supabase Queues because the extraction pipeline is a multi-step durable workflow, not a fire-and-forget message queue, and Inngest's step functions + free tier (50K runs/month) match a solo-dev cost profile while removing the 60-second Vercel function ceiling.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **TypeScript** | 5.7+ | Single language across UI, API, edge, jobs | One language for solo dev; strict types catch rule-schema regressions at compile time before they corrupt eligibility output. Zod-derived types tie Postgres schema to UI forms. |
| **Next.js** | 16.2.4 (App Router) | Full-stack framework — UI, server actions, API routes | 2026 default for Vercel-deployed full-stack TS apps. App Router server components keep eligibility evaluation server-side (no LLM keys leak to browser, fixing the prototype's biggest sin). Cache Components (`"use cache"` directive) is opt-in, which matches a system where freshness matters per-rule. **Pin to 16.2.x; do not chase canary** — the 15→16 migration's async-params change has bitten production apps; rebuild starts on 16.2 directly. |
| **React** | 19.2 (ships with Next 16) | UI rendering | Bundled with Next.js 16; React Compiler (1.0 stable) removes most manual `useMemo` / `useCallback`. Three-pane AM review UI benefits from View Transitions + Activity for keeping PDF viewer state warm during navigation. |
| **Node.js** | 20.9+ LTS | Server runtime | Next.js 16 minimum; matches Vercel and Supabase runtimes. Avoid Node 22 until Vercel's runtime defaults catch up (currently 20.x on Pro plan). |
| **Postgres (via Supabase)** | 16+ | System of record + rule store + FTS + audit trail + queue | One engine handles RLS for tenant isolation, JSONB for normalized-but-flexible rule storage, GIN full-text indexes for program/lender search, partitioned audit log via triggers, and (optionally) pgmq for background work. Eliminates 4-5 separate services a solo dev cannot operate. |
| **Supabase** | Cloud (managed) | Auth, RLS-protected Postgres, Storage (PDFs), Edge Functions | The Auth + RLS combination is the multi-tenant pattern: tenant_id in JWT app_metadata, RLS policies match tenant_id column. Storage gives signed-URL'd PDF buckets with the same RLS guards. Eliminates writing tenant-isolation middleware. |
| **Vercel** | Pro ($20/seat/mo) | Hosting, edge, build, observability | Native Next.js 16 host; automatic preview deployments per PR; built-in OpenTelemetry via `@vercel/otel`. **Pro plan required** — Hobby is non-commercial only and lacks the $20 included credit, Turbo build, and 60s function duration. |
| **Drizzle ORM** | 0.45.x | Type-safe DB layer + migrations | 200× smaller bundle than Prisma (7.4kb vs 1.6MB), zero binary deps, runs on edge. Code-first schema in TypeScript means rule-schema changes are PR-reviewable diffs in `.ts` files. With Supabase, requires `prepare: false` for transaction pooling. **Do not use Prisma** — its query engine + bundle size is a tax on serverless cold starts that buys nothing here, and its DSL adds a second source of truth alongside Postgres types. |
| **Anthropic SDK** | `@anthropic-ai/sdk` 0.91.1 | Claude API client (extraction + scenario parsing) | Official TS SDK; supports PDFs as input, prompt caching (critical for repeated matrix-extraction prompts), Zod-schema structured outputs (lands the rule object in the right shape on first pass). |
| **Claude Sonnet 4.6** | Model alias `claude-sonnet-4-6` | Document extraction + scenario NL parsing | Best price/intelligence ratio at $3/$15 per MTok; 1M token context (entire matrix PDF + full schema fits); supports vision and structured outputs; 9.5/10 on independent table-extraction benchmarks. **Sonnet 4.6, not Opus 4.7** — 5× cheaper, near-parity on extraction tasks. Use Opus 4.7 only for the AM-review "explain this rule" path where reasoning quality > cost. |
| **Reducto** | API (managed) | Primary PDF table/matrix extraction | **The single highest-stakes vendor pick.** Public benchmarks show 20% higher accuracy than LlamaParse / Unstructured / Docling on dense multi-cell tables; agentic multi-pass OCR/VLM with confidence scores and bbox citations (citations are required for the AM three-pane UI). 15K free credits then $0.015/page. See "Highest-Risk Decision" section for the failure-mode plan. |
| **Inngest** | 4.2.x | Durable async workflows for extraction pipeline | Multi-pass extraction (OCR → structural parse → rule normalization → confidence scoring) is a durable step function, not a queue message. Inngest survives Vercel's 60s function limit, retries idempotently per step, and replays on failure. 50K free runs/month covers MVP volume; Vercel Marketplace integration is one-click. |
| **Sentry** | Cloud | Error tracking + traces + LLM monitoring | First-class Next.js 16 integration; AI agent observability views show Claude-call traces with token costs; OpenTelemetry interop with `@vercel/otel`. Generous free tier (5K errors, 10K transactions/mo) covers MVP. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **Zod** | 4.4.x | Runtime validation + schema source of truth | Define rule schema in Zod; derive TS types, JSON Schema for Claude structured outputs, Drizzle column types. One schema, four uses. |
| **json-rules-engine** | 7.3.x | Deterministic eligibility evaluator | Evaluator runs against normalized rule objects per `evaluateProgram()`-style flow but as a library, not 1,775-line custom code. v7.3 (Aug 2025 release) added prioritized + cached fact resolution, hitting sub-100ms per program; with 50 programs in MVP the P50 ≤2s budget is comfortable. **MEDIUM confidence** — the alternative is rolling your own evaluator (the prototype already proved it's <500 lines of code if you control the schema). Decision deferred to Phase 0 spike: prototype both, pick by lower-rule-corruption-blast-radius. |
| **TanStack Query** | 5.x | Client data fetching, caching, optimistic updates | Three-pane AM review UI needs aggressive client-side caching of the PDF + extracted-rule + edit-form trio; TanStack Query handles invalidation when an AM edits a rule. |
| **shadcn/ui + Radix UI + Tailwind 4** | latest | Component primitives + styling | Solo-dev productivity; forms-heavy app (LO scenario form, AM rule edit form) benefits from accessible Radix primitives without writing dialog/popover/combobox from scratch. |
| **react-hook-form + Zod resolver** | 7.x / 4.x | Form state for LO scenario + AM rule edit | Pairs with the Zod schema source of truth; gives the AM review UI its undo/dirty/validation state for free. |
| **react-pdf or pdf.js** | 9.x | PDF render in AM review pane | Display source matrix with citation highlight (bbox from Reducto). pdf.js is the workhorse; react-pdf wraps it in a React-friendly API. |
| **Vercel AI SDK** | 5.x | Streaming Claude responses to UI | Useful for streaming the "explain why this program is eligible" path so LOs don't wait 3-4s for the full response; not strictly required for the extraction pipeline (which is server-only). |
| **date-fns** | 4.x | Effective-date arithmetic on rule versions, derog seasoning windows | Mortgage rules are date-heavy ("60-month seasoning from BK7 discharge", "rule effective 2025-09-01 through 2026-03-31"); date-fns is pure functions, no Moment-style mutability traps. |
| **pino** | 9.x | Structured server logs | Faster than Winston, JSON output by default, ships into Sentry/Axiom via OpenTelemetry. |
| **dotenv-cli** + **t3-env** | latest | Type-safe env var validation | Refuses to boot if `ANTHROPIC_API_KEY` / `REDUCTO_API_KEY` / Supabase keys are missing; closes the prototype's "API key in localStorage" attack surface at the framework level. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **pnpm** | Package manager | Strict node_modules; faster CI; matches Vercel build defaults. |
| **Biome** | Linter + formatter (replaces ESLint+Prettier) | Next.js 16 removed `next lint`; Biome is 25× faster than ESLint and has flat-config out of the box. |
| **Vitest** | Unit/integration test runner | 10× faster than Jest, native ESM, native TypeScript. The 200-scenario golden test set runs as a Vitest snapshot suite — every PR proves precision/recall don't regress. |
| **Playwright** | E2E browser tests | AM three-pane review UI is the only flow worth E2E-testing; Playwright handles the PDF viewer better than Cypress. |
| **GitHub Actions** | CI/CD | Free for public repos / 2K mins/mo for private; Vercel preview deployments handle the deploy half. |
| **Drizzle Kit** | Schema migrations | `drizzle-kit generate` produces SQL migrations from schema diffs; `drizzle-kit push` applies to Supabase. Audit migrations into Git as the single source of truth. |
| **Supabase CLI** | Local dev (Postgres in Docker), seed scripts, type generation | Required for local dev against the same RLS policies that run in prod. |

## Highest-Risk Technical Dependency: PDF Matrix Extraction

This is the single decision that, if wrong, sinks the AM-onboarding-time KPI (≤45 min standard non-QM matrix). The four candidates were evaluated on the cell-grid (FICO×LTV) shape that dominates lender matrices, not on generic invoice/form OCR.

| Vendor | Cell-Grid Accuracy | Confidence Scores | Bbox Citations | Pricing | Solo-Dev Friction |
|--------|--------------------|--------------------|------------------|---------|-------------------|
| **Reducto (primary)** | ~99% on RD-TableBench (their published benchmark; corroborated by independent benchmarks showing 20% lead over LlamaParse) | Yes, per-field | Yes — required for AM review highlight | $0.015/page after 15K free credits | Single API call; structured-extraction endpoint returns JSON shape you define |
| **Claude Sonnet 4.6 vision (backup)** | 9.5/10 on independent table-extraction eval; less proven on dense matrices specifically | Native via structured-output schema | Indirectly via prompt ("cite page + cell coordinates") — less reliable than Reducto's bbox | $3/$15 MTok (~$0.05/page typical) | Already integrated; one less vendor relationship |
| **Google Document AI Form Parser** | ~95.8% generic; struggles with merged cells and borderless tables (Document AI's documented weakness) | Yes | Yes | ~$0.01-0.065/page depending on processor | Most ergonomic of the hyperscaler options; GCP-only adds an account |
| **AWS Textract Tables** | ~94.2% generic; weakens on irregular layouts | Yes | Yes | $0.015/page tables endpoint | AWS account overhead; already-on-AWS shops only |
| **Azure Document Intelligence** | 96% printed-text; strong custom-train UX (32 min) | Yes | Yes | $10/1K pages prebuilt | Microsoft-stack overhead; not relevant given Vercel + Supabase |
| **LlamaParse** | Mid-tier; decent on simple tables, slips on dense cell grids | Limited | Limited | ~$0.003/page | Cheapest; quality unsuitable for the precision KPI |
| **Unstructured** | Open-source available; cell accuracy below Reducto and the hyperscalers | Limited | Limited | Self-host or $1/1K pages SaaS | Self-host adds ops a solo dev shouldn't take on |

**Primary: Reducto.** It's the only vendor with a published edge on the exact failure mode (dense cell tables) that owns this product's accuracy KPI.

**Backup: Claude Sonnet 4.6 vision via the existing Anthropic SDK.** Two reasons to keep it warm: (1) if Reducto pricing or accuracy regresses, the project's most expensive vendor migration is already pre-validated; (2) the AM-review "second opinion" pattern — run Reducto, then have Claude read the same PDF and flag cells where extracted values disagree — is a measurable accuracy lift documented in the Rocket Close + Bedrock + Textract case study.

**What we won't do:** Roll our own pdf.js + tabula extraction. Three weeks of work, fragile on every new lender's PDF format, no confidence scoring, no bbox citations — exactly the kind of "build it ourselves" trap a solo dev is most vulnerable to.

## Multi-Tenant Isolation Pattern

**Recommendation: Postgres Row-Level Security (RLS) with `tenant_id` in JWT `app_metadata`.**

| Pattern | Verdict | Why |
|---------|---------|-----|
| **RLS with tenant_id column (chosen)** | Strong fit | Single Postgres instance, single schema, single connection pool, lowest ops cost. RLS is enforced at the database layer — even a server-side query bug cannot leak across tenants. Supabase Auth's custom-access-token hook puts `tenant_id` in JWT app_metadata; RLS policy `USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)` on every tenant-scoped table. |
| **Schema-per-tenant** | Reject | N tenants = N schemas to migrate. Drizzle migrations against 50+ schemas is painful; Supabase's pooler doesn't love this pattern. |
| **Database-per-tenant** | Reject for MVP | Strongest isolation but operationally untenable for a solo dev; revisit only if a brokerage demands data-residency or a customer signs an enterprise contract requiring it. |

**Critical RLS implementation rules** (these are the foot-guns):

1. Index `tenant_id` on every tenant-scoped table — missing indexes are the #1 RLS performance killer.
2. Use `WITH CHECK` clauses on `INSERT` and `UPDATE` policies — `USING` only blocks reads, not cross-tenant writes.
3. Test policies against the client SDK, not the SQL Editor — the SQL Editor bypasses RLS and produces false-positive test results.
4. The `service_role` key bypasses all RLS. Use it only in trusted server contexts (extraction worker, agency-rule cascade migrations); never expose to client.
5. Tenant boundaries cross joins. If `programs` joins `program_versions`, both tables need RLS policies — Postgres checks each independently.
6. Custom claims aren't auto-refreshed; users may need to log out/in after tenant changes. For MVP, tenant assignment at signup is set-once.

The `LENDER_OVERLAY` cross-tenant invisibility requirement is enforced at the database, not the application — this is exactly the antitrust-environment posture (post-OB October-2025 case) the PRD calls for.

## Sub-2-Second P50 Evaluation: Feasibility and Caching

**Verdict: Feasible without exotic infrastructure** at MVP scale (50 programs, growing to 1,000 by month 12).

The math: For a single LO scenario at MVP, the eligibility evaluator runs against 50 programs. Each program is a normalized rule object (~20-50 rules per program). With json-rules-engine's prioritized fact-resolution + caching, per-program evaluation is sub-100ms. **50 programs × <40ms = <2s P50** comfortably, before any caching.

Where it gets harder:

- **At 1,000 programs**, naive sequential evaluation hits ~40s. Mitigation: parallelize via `Promise.all` (Postgres handles the read concurrency), pre-filter programs by hard ineligibility gates (FICO floor, occupancy, loan amount range) before running the full rule engine. This is a 10-line filter, not a re-architecture.
- **At 5,000+ programs** (Phase 2 ambition): introduce a Redis (Upstash) cache keyed on `(programVersion, scenarioHash)` — borrower scenarios cluster around common shapes (700 FICO / 80 LTV / W2). Hit rate measured > 60% in adjacent products. Defer this until measured need.

**Caching layer recommendation:**
- **MVP:** No external cache. TanStack Query handles client-side; Supabase connection pooling handles read scaling. Postgres on a Supabase Small ($25/mo) plan absorbs 50 programs × 50 LOs × 8 scenarios/day comfortably.
- **Phase 2 trigger:** P95 latency exceeds 5s on dashboards. Add Upstash Redis ($0.20 per 100K commands; pay-per-use matches solo-dev cost profile) as a read-through cache on `(programVersion, scenarioHash)`.

**Database design notes for sub-2s:**
- Materialize the `programs` summary view (FICO floor, FICO ceiling, max LTV, max DTI, allowed occupancies) — these are pre-filter columns; evaluator only loads full rule blob for surviving programs.
- JSONB `rules` column with a **GIN index on the `layer` key path** so "show me all `LENDER_OVERLAY` rules in this scenario" doesn't full-scan.
- `program_versions.effective_date` indexed; eligibility evaluator passes `effective_date <= scenario.run_date` as a hard filter.

## Audit Trail and Versioning

**Pattern: Append-only `program_versions` table + JSONB-delta audit log via triggers.**

| Concern | Mechanism |
|---------|-----------|
| Per-`ProgramVersion` source-document fingerprint + `effective_date` | First-class columns on `program_versions`; `archived_at` set when a new version supersedes; never delete — query historical versions by `effective_date` range. |
| Per-field confidence score | JSONB `field_confidences` map on `extracted_rules`; preserved through to the LO-result confidence badge. |
| Versioned audit trail of which rule fired at scenario time | `scenario_evaluations` table records the full `(program_version_id, rule_id, layer, decision)` tuple per evaluation; serves both the "stale scenario" alert (`/saved-scenarios` re-run when `program_version_id` no longer current) and the liability-defense path. |
| Schema-change audit | Trigger-based audit log (`audit_logs` table partitioned by month, JSONB `before`/`after` deltas) on `programs`, `program_versions`, `extracted_rules`. |

**Why not `temporal_tables` Postgres extension:** Not supported on Supabase / managed Postgres. The trigger-based pattern (per the January 2026 OneUptime guides) is the standard alternative; pgMemento is the reference implementation if you'd rather not write the triggers yourself, but for a solo dev a 50-line trigger function is simpler than adopting an extension that may lag Postgres major upgrades.

## Authentication and Authorization

**Auth: Supabase Auth** (built on GoTrue).
- Email + password, magic link, optional Google/Microsoft OAuth (LOs frequently have Microsoft 365 accounts at brokerages).
- TOTP MFA on by default for AM accounts (the audit-trail target).
- Session JWT carries `tenant_id` and `role` (`am`, `lo`, `tenant_admin`) in `app_metadata`, set via the `before_user_created_hook` Edge Function during signup.

**AuthZ: Two layers**
1. **Database (RLS):** policies match `tenant_id` and `role` claims from `auth.jwt()`.
2. **Application (Next.js middleware via `proxy.ts`):** route-level guards on `/admin/*` (tenant_admin only) and `/am/*` (am or tenant_admin); LO-facing routes are tenant-scoped but role-agnostic.

## Observability

| Concern | Tool | Why |
|---------|------|-----|
| **Errors + traces + LLM call traces** | Sentry | First-class Next.js 16 integration; AI agent observability surfaces Claude / Reducto call costs and token counts; OpenTelemetry interop. |
| **Logs** | Vercel built-in + Axiom (free tier, 0.5GB/mo) | Vercel's log retention is 1 day on Hobby / 1 day on Pro for runtime logs; Axiom integrates via OTLP for searchable retention without paying Datadog prices. |
| **DB metrics** | Supabase Studio dashboards | Supabase ships Postgres slow-query log + index advisor in-product; sufficient for MVP. |
| **Uptime + SLO** | Better Stack (free tier 10 monitors) | Public status page + on-call paging if/when there's an on-call. |

## CI/CD

| Stage | Tool | Detail |
|-------|------|--------|
| **Source** | GitHub | Required for Vercel + Inngest + Supabase native integrations. |
| **CI** | GitHub Actions | Lint (Biome) + types (`tsc --noEmit`) + unit/integration (Vitest) + Playwright smoke. The 200-scenario golden-set test runs on every PR; precision/recall regressions block merge. |
| **DB migrations** | Drizzle Kit + Supabase CLI | `drizzle-kit generate` in CI; `supabase db push` against staging; manual review + push to prod. |
| **Preview deploys** | Vercel | Per-PR preview URL; auto-injected `SUPABASE_*` and `ANTHROPIC_API_KEY` from Vercel project secrets (never committed). |
| **Prod deploys** | Vercel | Promote-from-preview on PR merge to `main`; instant rollback to any prior deployment via dashboard. |

## Installation

```bash
# Project init
pnpm create next-app@latest lender-search --ts --tailwind --app --src-dir --import-alias "@/*"
cd lender-search

# Core runtime
pnpm add next@16 react@19 react-dom@19
pnpm add @supabase/supabase-js@2 @supabase/ssr
pnpm add drizzle-orm@0.45 postgres
pnpm add @anthropic-ai/sdk@0
pnpm add inngest
pnpm add zod@4 @t3-oss/env-nextjs
pnpm add @tanstack/react-query@5
pnpm add react-hook-form@7 @hookform/resolvers
pnpm add date-fns@4 pino
pnpm add json-rules-engine@7
pnpm add reducto # placeholder — install per Reducto's current SDK guidance

# UI
pnpm add @radix-ui/react-dialog @radix-ui/react-popover @radix-ui/react-tabs # etc per shadcn/ui add
pnpm add class-variance-authority clsx tailwind-merge lucide-react
pnpm add react-pdf pdfjs-dist

# Observability
pnpm add @sentry/nextjs @vercel/otel @axiomhq/js

# Dev
pnpm add -D typescript@5 @types/node @types/react @types/react-dom
pnpm add -D drizzle-kit
pnpm add -D vitest @vitest/ui @testing-library/react @testing-library/jest-dom
pnpm add -D playwright @playwright/test
pnpm add -D @biomejs/biome
pnpm add -D supabase
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| **Next.js 16 App Router** | Remix / TanStack Start / Astro | If team grows and wants stricter loader/action separation, Remix's data flow is cleaner. Astro for content-heavy marketing site (you may want this *alongside* Next.js for the public site). |
| **Supabase** | Neon + Clerk + Cloudflare R2 | If RLS performance becomes the bottleneck or you need branched-DB-per-PR for migrations. Neon's branching is more powerful than Supabase's; Clerk auth is more polished than Supabase Auth. Tradeoff: 3 vendors, 3 bills, 3 dashboards. |
| **Drizzle** | Kysely | Kysely is closer to raw SQL; preferred if you find Drizzle's relations API too magical. No bundle-size or type-safety win over Drizzle for this workload. |
| **Inngest** | Trigger.dev v3 / Hatchet / Supabase Queues + Cron | Trigger.dev for jobs that legitimately need 1+ hour duration (not the case here); Hatchet for self-hosted DAG workflows; Supabase Queues + Cron for *simple* background tasks but lacks Inngest's step-function durability and replay model. |
| **Reducto** | Claude Sonnet 4.6 vision | Already covered in Highest-Risk Decision section. Backup, not alternative. |
| **Sentry** | Highlight.io / PostHog | Highlight has session replay built-in (PostHog also); useful for the AM review UI debugging story. Sentry's LLM tracing is currently superior, which matters more here. |
| **Claude Sonnet 4.6** | GPT-5 / Gemini 3 Pro | Project already runs Claude; switching costs > marginal accuracy gain. Revisit if Anthropic pricing shifts materially. |
| **json-rules-engine** | Custom evaluator (~500 LOC) | Custom is justified if rule-engine library introduces a correctness bug you can't quickly fix, OR if rule-language complexity grows beyond what json-rules-engine's `all`/`any`/`fact-comparison-operator` model supports cleanly. Decide in Phase 0 spike. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Create React App / `react-scripts`** | Deprecated; the existing prototype's substrate. Webpack 5 + CRA has known cold-start and incremental-rebuild problems Turbopack solves. | Next.js 16 with Turbopack (default). |
| **Browser-side Anthropic API calls** | The prototype's most dangerous pattern; API keys leak via browser, every request's full prompt is exposed. | Server-only via Next.js route handlers / Server Actions; key in Vercel project env, never in client bundle. |
| **localStorage for secrets / API keys** | Prototype pattern. Browser extensions, XSS, JS console all read it. | Vercel encrypted env vars + `t3-env` for type-safe access. |
| **Prisma** | 1.6MB bundle, separate DSL, slower cold starts on Vercel functions. The Prisma 7 rewrite improves this but doesn't beat Drizzle. | Drizzle ORM. |
| **TypeORM / Sequelize** | Decorator-heavy, weaker TypeScript inference, lagging Postgres feature support (RLS, JSONB indexing). | Drizzle ORM. |
| **MongoDB / DynamoDB** | Eligibility rules + audit + multi-tenant + FTS = textbook relational workload with structured-but-flexible JSONB. NoSQL adds operational variance for zero gain. | Postgres (Supabase). |
| **Self-hosted Postgres on EC2/Render/Fly** | Solo dev cannot operate backups, point-in-time-recovery, replica failover, RLS auditing, connection pooling, and patching while also writing the product. | Supabase (managed). |
| **Tabula / pdfplumber / pdf.js for matrix extraction** | No confidence scores, no LLM-assisted column detection, no bbox out of the box. Acceptable for clean financial statements; fails on the 1,000+ unique matrix layouts indexed lenders publish. | Reducto (primary), Claude vision (backup). |
| **GPT-5 / OpenAI as primary LLM** | Adds a second LLM vendor relationship for marginal accuracy gain on a workload Claude already handles well. | Claude Sonnet 4.6 (primary), Claude Opus 4.7 (when reasoning > cost). |
| **Drools / RETE-based engines (in JVM, port via JNI/HTTP)** | RETE optimizes high-cardinality cross-rule inference; eligibility rules are mostly single-fact-against-single-condition. Drools is overkill and adds JVM ops. | json-rules-engine or hand-rolled evaluator. |
| **AWS Step Functions for the extraction pipeline** | The pipeline is workflow logic in TypeScript, not a service-orchestration DAG. Step Functions adds AWS account, IAM, SAM/CDK, and a DSL for what fits in 100 lines of Inngest steps. | Inngest. |
| **Vercel Hobby plan for production** | Hobby is non-commercial; lacks the included $20 credit, Turbo build, 60s function duration, team features. | Vercel Pro from day one. |
| **`middleware.ts` (deprecated in Next 16)** | Renamed to `proxy.ts`; the old name still works on edge runtime but is deprecated. | `proxy.ts` on Node runtime. |
| **`revalidateTag(tag)` single-argument form (deprecated in Next 16)** | Loses stale-while-revalidate semantics. | `revalidateTag(tag, 'max')` or `updateTag(tag)` in Server Actions. |

## Stack Patterns by Variant

**If non-QM matrix extraction accuracy falls below 90% on AM-correction-rate KPI:**
- Run Reducto + Claude vision as a *consensus* pass: any cell where the two disagree is auto-flagged for AM review. Increases per-PDF cost ~$0.05 but eliminates silent errors. Document this as the Phase 1.5 mitigation if Phase 1 KPI misses.

**If a brokerage tenant requires data residency (e.g., Canadian or EU customer):**
- Migrate that tenant to a separate Supabase project in the relevant region; RLS pattern unchanged but now per-region. Keeps the rest of the stack identical.

**If a customer requires SOC2 / HIPAA-style controls earlier than expected:**
- Reducto offers Business Associate Agreement on Growth tier; Anthropic's Zero Data Retention is on enterprise. Vercel + Supabase ship SOC2 Type II out of the box. The shortest path to SOC2 readiness on this stack is < 4 weeks of policy + Drata.

**If P50 eligibility evaluation latency starts trending toward 2s as program count grows:**
- Add `@upstash/redis` (5-line client) and a `(programVersion, scenarioHash)` read-through cache. No architecture change.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `next@16.2.x` | `react@19.2`, `node>=20.9` | Hard requirements; do not mix with React 18. Pin minor versions in CI. |
| `drizzle-orm@0.45` | `postgres@3` (postgres-js driver), Supabase pooler | Set `prepare: false` on the postgres client when using Supabase transaction-mode pooler. |
| `@supabase/ssr@0.x` | `@supabase/supabase-js@2.105+` | Use `@supabase/ssr` for Next.js 16 server components, not the legacy `@supabase/auth-helpers-nextjs`. |
| `@anthropic-ai/sdk@0.91+` | Claude API 2024-10-01+ | Prompt caching + structured outputs require recent SDK; bump on every minor. |
| `inngest@4.x` | `next@16` | Uses the Next.js route handler pattern; `proxy.ts` rename does not affect Inngest's serve handler. |
| `json-rules-engine@7.x` | Node 20+, TS 5+ | Includes ESM exports; works in Vercel functions and edge runtime. |
| `zod@4` | Drizzle Zod adapter, TanStack Query, react-hook-form, Anthropic SDK structured outputs | Zod 4 is a major rewrite from Zod 3 — verify all four integrations resolved their Zod 4 compatibility before pin (they have, as of April 2026). |
| `vercel @vercel/otel` | Sentry SDK, Axiom OTLP | Both Sentry and Axiom register as OTLP exporters via `@vercel/otel` — single trace pipeline, two backends. |

## Confidence Levels

| Decision | Confidence | Notes |
|----------|------------|-------|
| Next.js 16.2 + React 19.2 | HIGH | Verified versions on npm registry (16.2.4); Next 16 release notes confirm GA October 2025; React 19.2 ships with it. |
| TypeScript everywhere + Drizzle | HIGH | Multi-source verified; Drizzle's bundle/perf advantage on serverless is documented and reproduced. |
| Supabase + RLS multi-tenancy | HIGH | Pattern documented in Supabase official docs and multiple production case studies; the JWT-claim + tenant_id-column pattern is the explicit Supabase recommendation. |
| Claude Sonnet 4.6 (model + SDK) | HIGH | Verified from Claude API docs (April 2026); $3/$15 per MTok pricing confirmed; structured outputs GA on Sonnet 4.5+. |
| **Reducto as primary extraction vendor** | **MEDIUM** | Strong on benchmarks but pricing past 15K credits is volume-dependent; mortgage-matrix-specific accuracy is inferred from "complex tables" benchmarks, not a published mortgage-domain study. **Phase 0 acceptance test required**: extract 10 representative non-QM matrices, AM-grade the output. If <95% cell accuracy, escalate to Reducto + Claude consensus pass before MVP. |
| Claude vision as backup | HIGH | Already integrated; 9.5/10 table-extraction benchmark; pricing predictable. |
| Inngest for durable workflows | HIGH | Free tier covers MVP; Vercel Marketplace integration; step-function model maps cleanly to extraction pipeline. |
| json-rules-engine choice | MEDIUM | Library is solid but maintenance velocity has slowed in 2024-2025. The custom-evaluator alternative remains live; Phase 0 spike decides. |
| Postgres trigger-based audit | HIGH | Standard pattern, no exotic dependencies, supported on managed Postgres. |
| Vercel Pro plan | HIGH | Pricing and limits verified from Vercel pricing page (2026); $20/seat plus usage. |
| Sentry observability | HIGH | Free tier covers MVP; integration paths verified. |
| Sub-2s P50 feasibility at MVP scale | HIGH | Math is conservative; mitigation path (parallel + pre-filter + cache) is well-trodden in adjacent products. |

## Sources

- Next.js 16 release notes (verified Oct 2025 GA, React 19.2 inclusion, breaking changes catalog) — https://nextjs.org/blog/next-16
- Next.js 15 vs 16 migration guide — https://nextjs.org/docs/app/guides/upgrading/version-16
- Claude Models Overview (Sonnet 4.6 pricing, vision, context) — https://platform.claude.com/docs/en/about-claude/models/overview
- Anthropic SDK TypeScript GitHub — https://github.com/anthropics/anthropic-sdk-typescript
- Anthropic Structured Outputs docs — https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Reducto pricing (15K free credits, $0.015/page) — https://reducto.ai/pricing
- Reducto Document Parser Comparison (vs LlamaParse / Unstructured / Docling, RD-TableBench) — https://llms.reducto.ai/document-parser-comparison
- Gemini / Claude Sonnet 4 image-table extraction benchmark (9.5/10 score) — https://eval.16x.engineer/blog/image-table-data-extraction-evaluation-results
- AWS Textract vs Google Document AI vs Azure Document Intelligence comparison — https://invoicedataextraction.com/blog/aws-textract-vs-google-document-ai-vs-azure-document-intelligence
- Rocket Close Mortgage Document Processing case study (Textract + Bedrock) — https://aws.amazon.com/blogs/machine-learning/rocket-close-transforms-mortgage-document-processing-with-amazon-bedrock-and-amazon-textract/
- Supabase RLS multi-tenant best practices — https://makerkit.dev/blog/tutorials/supabase-rls-best-practices
- Supabase Custom Access Token Hook docs — https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook
- Supabase RLS pitfalls and performance — https://supabase.com/docs/guides/database/postgres/row-level-security
- Drizzle vs Prisma 2026 comparison — https://makerkit.dev/blog/tutorials/drizzle-vs-prisma
- Drizzle on Supabase configuration (`prepare: false`) — https://orm.drizzle.team/benchmarks
- Inngest pricing (50K free runs/month) — https://www.inngest.com/pricing
- Inngest vs Trigger.dev for Vercel deployments — https://nextbuild.co/blog/background-jobs-vercel-inngest-trigger
- Supabase Queues / pgmq docs — https://supabase.com/docs/guides/queues
- json-rules-engine 7.x GitHub — https://github.com/CacheControl/json-rules-engine
- json-rules-engine vs alternatives (npm trends + analysis) — https://npmtrends.com/json-logic-js-vs-json-rules-engine-vs-nools-vs-rulejs
- Postgres temporal tables vs trigger-based audit (managed Postgres limitation) — https://wiki.postgresql.org/wiki/Temporal_Extensions
- OneUptime audit-trails-with-triggers guide (Jan 2026) — https://oneuptime.com/blog/post/2026-01-25-postgresql-audit-trails-triggers/view
- Supabase Full Text Search docs (tsvector + GIN) — https://supabase.com/docs/guides/database-/full-text-search
- Vercel Pricing (2026) — https://vercel.com/pricing
- Vercel Function Limits (60s on Pro) — https://vercel.com/docs/functions/limitations
- Sentry Pricing + Next.js integration — https://sentry.io/pricing/
- npm registry: verified versions (`@anthropic-ai/sdk@0.91.1`, `next@16.2.4`, `drizzle-orm@0.45.2`, `@supabase/supabase-js@2.105.1`, `inngest@4.2.6`, `zod@4.4.1`, `json-rules-engine@7.3.1`)

---
*Stack research for: Lender Search (eligibility-first multi-tenant mortgage SaaS)*
*Researched: 2026-04-29*
