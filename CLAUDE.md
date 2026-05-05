<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **lender-search** (453 symbols, 482 relationships, 2 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/lender-search/context` | Codebase overview, check index freshness |
| `gitnexus://repo/lender-search/clusters` | All functional areas |
| `gitnexus://repo/lender-search/processes` | All execution flows |
| `gitnexus://repo/lender-search/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Lender Search** is an eligibility-first lender/program search tool for mortgage loan officers, paired with an account-manager workflow that turns lender matrix PDFs into a normalized rules schema via AI-assisted extraction with human-in-the-loop review. Core value: **correctness on the long tail of derogatory and non-QM scenarios** — every other capability is in service of returning eligibility decisions an LO can defend without calling a wholesale lender to confirm.

The codebase at `src/App.js` is a legacy React prototype being rebuilt from scratch. Do not extend it. New work targets the Next.js 16 + Supabase stack described below.

Phasing (KPI-gated, not calendar-gated):
- **Phase 0** (sub-phases 1–5): tenant isolation foundation, rule schema, audit + agency rules, evaluation engine, golden set + exit gates. No customer-visible product.
- **Phase 1** (sub-phases 6–11): MVP — app skeleton, extraction pipeline, AM review surface, LO scenario flow, saved scenarios, coverage build-out + brand rename.
- **Phase 2** (sub-phases 12–13): coverage expansion + multi-tenant overlays + mobile-responsive + live pricing + counsel-led antitrust review.
- **Phase 3** (sub-phases 14–15): workflow intelligence + native mobile (conditional) + optional E&O warranty.

Source: `.planning/PROJECT.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

**Resolved by Phase 0 research.** Detailed rationale in `.planning/research/STACK.md`.

- **Language:** TypeScript 5.7 everywhere (no JavaScript outside generated code)
- **Frontend / API:** Next.js 16.2 (App Router) + React 19.2; pin to 16.2.x — do not chase canary
- **Database:** Postgres 16+ via Supabase. Single engine handles system of record + rule store + FTS + audit + (optionally) job queue
- **ORM:** Drizzle 0.45 with `prepare: false` for the Supabase pooler; schema-as-code in `.ts` files. Explicitly **not Prisma**
- **AuthN/AuthZ:** Supabase Auth with `tenant_id` in JWT app_metadata; `current_setting('app.tenant_id')::uuid` propagated to RLS
- **Tenant isolation:** Postgres Row-Level Security with `FORCE ROW LEVEL SECURITY` (database-enforced, not application-layer)
- **Background jobs / durable workflows:** Inngest 4.2 worker pool (separate from Vercel functions; survives the 60s ceiling)
- **PDF / matrix extraction:** Reducto (primary, MEDIUM-confidence pending Phase 5 acceptance test on 10 non-QM matrices ≥95% cell accuracy) with Reducto + Claude Sonnet 4.6 vision consensus-pass mitigation as fallback
- **LLM:** Claude Sonnet 4.6 via `@anthropic-ai/sdk@0.91+`. Server-side only — no client-side SDK use, no API keys in localStorage
- **Rule engine:** `json-rules-engine@7.3` vs. ~500-LOC custom evaluator — decided in Phase 4 spike on lower-rule-corruption-blast-radius criterion
- **UI:** shadcn/ui + Tailwind 4 + react-pdf (AM three-pane review) + react-hook-form + Zod 4 + TanStack Query
- **Observability:** Sentry (errors + performance) + Axiom (log retention beyond Vercel's 1-day window) + LLM call traces with token costs
- **Hosting:** Vercel Pro from day one (Hobby is non-commercial and lacks 60s function duration)
- **Env management:** Vercel encrypted env + `t3-env` runtime validation; no plaintext secrets in source

What NOT to use: CRA / `react-scripts` (the prototype's substrate), browser-side LLM calls, Prisma, MongoDB / DynamoDB, Tabula / pdfplumber for matrices, Drools / RETE engines, AWS Step Functions, `middleware.ts` (deprecated → `proxy.ts`), `revalidateTag(tag)` single-arg form (deprecated).
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:research/ARCHITECTURE.md -->
## Conventions

The project is a from-scratch rebuild. Conventions emerge as code lands; the prototype's patterns at `src/App.js` are explicitly NOT carried forward. Follow these architectural commitments from day one:

- **No client-side secrets.** All LLM calls run server-side via Server Actions or route handlers. The prototype's `localStorage` API-key pattern is excluded by design.
- **Citation discipline as a hard constraint.** A `program_rule` row cannot persist without a corresponding `rule_citation` row pointing at a source document page + bbox + textSpan. Server-side validation confirms the textSpan actually appears at the cited bbox before the rule lands in staging.
- **Tenant filtering at the database, never the application.** RLS policies enforce tenancy; "forgot a `WHERE` clause" must be a no-rows-returned bug, not a data-exfiltration incident.
- **Pure-TS evaluation engine will live at `lib/eval/` (Phase 4+, not yet created).** No I/O, no framework deps. `evaluate(scenario, snapshot)` is the canonical entry point. The engine is portable: it must be lift-and-shiftable into a separate service if Phase 2 latency demands it without rewriting business logic.
- **Append-only audit log.** `evaluation_event` has `REVOKE UPDATE, DELETE` from the application role enforced at the database level. Never write code that requires mutating an audit row.
- **Staging schema for extraction.** The pipeline writes only to `staging.draft_rule` / `staging.draft_rule_field_confidence` / `staging.extraction_run`. Canonical tables are mutated only by AM commit transactions.
- **Bitemporal versioning.** `program_version`, `agency_rule_version`, etc. carry `effective_period` daterange + `expires_at`; `EXCLUDE USING gist` exclusion constraints prevent overlapping active versions.
- **Cross-tenant data exposure is a release-blocker.** No admin "view as another tenant," no cross-tenant analytics, no aggregated competitive-analytics surface — explicit antitrust posture from the October 2025 Optimal Blue class action.

Detailed patterns and anti-patterns: `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md`.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:research/ARCHITECTURE.md -->
## Architecture

Postgres-centric Next.js monolith with strict separation between the synchronous evaluation hot path and the asynchronous extraction pipeline. Detailed schema and flow diagrams in `.planning/research/ARCHITECTURE.md`.

**Components:**

1. **Web frontend (Next.js)** — LO search, results, comparison; AM three-pane review (`react-pdf` + bbox overlay)
2. **Pure-TS evaluation engine (`lib/eval/`, Phase 4+, not yet created)** — dependency-free, no I/O, takes hydrated `RuleSnapshot` + `Scenario`, returns `{decision, rule_stack, deciding_rule, near_miss}`
3. **Centralized rule store** — `agency_rule_version` (system-owned) + `program_version` (tenant-scoped, FK to agency version) + `program_rule` (with `layer` enum + per-field confidence) + `rule_citation` (page + bbox + excerpt)
4. **Staging schema (`staging.*`)** — extraction pipeline never writes canonical tables; AM commit promotes staging → canonical in a single transaction
5. **Extraction pipeline (Inngest)** — durable multi-step: OCR (Reducto) → structural parse → LLM normalization → overlay diff → confidence scoring; idempotent per step
6. **Append-only `evaluation_event`** — content-addressed `ruleset_snapshot_id` (sha256 of canonical bundle) + `rule_stack` jsonb + deciding rule; partitioned by month
7. **Agency cascade infrastructure** — daily Vercel Cron polls FNMA / FHLMC / FHA / VA publications; new `agency_rule_version` → trigger → fan-out review queue per affected program

**Build order (also Phase 0 → Phase 1 sub-phase order in ROADMAP.md):** RLS + pen tests → schema → audit + agency rules → evaluator → golden set → app skeleton → extraction pipeline → AM review → LO surface → saved scenarios → coverage + GTM exit.

**Anti-patterns to avoid:** embedding agency rules per program (cascade becomes unbuildable); application-layer tenant filtering; mutable audit log; extraction pipeline writing canonical tables; synchronous extraction in the request path; storing scenario_payload without hashing for stable replay.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

| Skill | Description | Path |
|-------|-------------|------|
| gitnexus-cli | GitNexus CLI commands (analyze, status, clean, wiki) | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |
| gitnexus-debugging | Trace bugs and "why is X failing" via the call graph | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| gitnexus-exploring | Understand architecture / "how does X work" via execution flows | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| gitnexus-guide | Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| gitnexus-impact-analysis | "What breaks if I change X" — blast-radius analysis before edits | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| gitnexus-refactoring | Safe rename / extract / split / move with call-graph awareness | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.

**Project-specific reminders:**
- Phase 1 (Tenant Isolation Foundation) is the very first phase. RLS policies + CI pen-test suite must land before any tenant-scoped data exists.
- Phase 5 (Golden Set + Phase 0 Exit Gates) is the gate before any customer-visible UI work. Do not start Phase 6 until golden set ≥98% precision / ≥95% recall and Reducto acceptance both pass.
- KPI gates govern phase transitions; calendar dates do not.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` — do not edit manually.
<!-- GSD:profile-end -->
