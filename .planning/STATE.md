# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-29)

**Core value:** Correctness on the long tail of derogatory and non-QM scenarios — eligibility decisions an LO can defend without calling a wholesale lender to confirm.
**Current focus:** Phase 1: Tenant Isolation Foundation

## Current Position

Phase: 1 of 15 (Tenant Isolation Foundation)
Plan: 1 of 8 in current phase complete (next: 01-02-PLAN.md t3-env validation)
Status: In progress (Wave 0 complete; Wave 1 unblocked)
Last activity: 2026-04-29 — Plan 01-01 complete (workspace + tooling bootstrap; pnpm + TS 5.7 + docker-compose Postgres 16 + drizzle/vitest config shells)

Progress: [█░░░░░░░░░] 12%

## Performance Metrics

**Velocity:**
- Total plans completed: 1
- Average duration: 15 min
- Total execution time: 15 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1     | 1     | 15 min | 15 min |

**Recent Trend:**
- Last 5 plans: 01-01 (15 min)
- Trend: -

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap: 4-phase PRD shape (Phase 0 / 1 / 2 / 3) honored; sliced fine into 15 sub-phases (11 v1 at full fidelity, 4 v2/v3 sketched)
- Roadmap: Tenant isolation (RLS + pen tests) is Phase 1 — schema cannot land safely without it (antitrust posture from Oct 2025 OB class action)
- Roadmap: Differentiator #2 (structured derog) lands in Phase 2 schema; Differentiator #3 (AM extraction with confidence) lands in Phase 7-8 — both unowned by 2026 incumbents
- Roadmap: Phase 0 exit gates (Reducto acceptance, library spike, golden set ≥98%/95%, RLS pen tests) consolidated in Phase 5
- Roadmap: GTM-01 (rename) and GTM-02 (buyer persona) treated as Phase 11 exit-gate success criteria, not separate phases
- Plan 01-01: Adopted pnpm 9.15.0 as packageManager; deleted legacy npm lockfile + node_modules in a single transition step (Task 2) so package.json shape and node_modules shape never disagree
- Plan 01-01: Excluded legacy `src/` from tsconfig.json `include` set; deletion of the prototype itself deferred to Phase 6 per RESEARCH §Open Questions Q1 to keep Phase 1 diffs scoped
- Plan 01-01: Provisioned `app_user` with both NOBYPASSRLS *and* NOSUPERUSER (plan-mandated) — superuser implicitly bypasses RLS even without `BYPASSRLS`, so dropping both flags closes the gap RESEARCH Pitfall 4 calls out
- Plan 01-01: Locked `.npmrc save-exact=true` so future `pnpm add` cannot reintroduce caret/tilde ranges and break CI reproducibility

### Pending Todos

None yet.

### Blockers/Concerns

- REQUIREMENTS.md summary states "95 total" but category-by-category sum is 110; mapping covers all 110 — discrepancy flagged for milestone review
- Reducto vendor lock pending Phase 5 acceptance test (≥95% cell accuracy on 10 non-QM matrices) or consensus-pass mitigation
- External expert reviewer for golden set (paid senior underwriter) needs sourcing before Phase 5 enters
- Plan 01-01 (forward-looking): typescript-eslint@8.46.0 declares peer eslint@^8.57.0||^9.0.0 but pinned eslint@10.2.1 — non-blocking for Plan 01-01 (no lint config exists yet); Plan 08 (CI + ESLint wiring) must choose between bumping typescript-eslint or pinning eslint to 9.x

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none — first milestone)* | | | |

## Session Continuity

Last session: 2026-04-29
Stopped at: Completed 01-01-PLAN.md (workspace + tooling bootstrap)
Resume file: .planning/phases/01-tenant-isolation-foundation/01-02-PLAN.md (next: t3-env boot-fail-closed validation; runs in Wave 1 alongside 01-03)
