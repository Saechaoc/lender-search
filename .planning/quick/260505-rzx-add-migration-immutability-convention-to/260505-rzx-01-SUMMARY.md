---
phase: 260505-rzx
plan: 01
subsystem: docs
tags: [convention, migrations, drizzle, audit-fix]
one-liner: "Codify migration-immutability rule in CLAUDE.md so every future Claude session loads it before any DB work begins."
provides:
  - "convention: post-merge migrations are immutable; fix in NEW migration"
requires:
  - "CLAUDE.md ## Conventions section (existing GSD-managed block)"
affects:
  - "/Users/chrissaechao/IdeaProjects/lender-search/CLAUDE.md"
tech-stack:
  added: []
  patterns:
    - "Append-only migration history (`__drizzle_migrations` is the source of truth)"
key-files:
  created: []
  modified:
    - "CLAUDE.md (Conventions section: +1 bullet)"
decisions:
  - "Insert verbatim per exact-change spec — no paraphrase, no split, no reorder"
  - "Bullet placed inside the existing GSD:conventions-start managed block; doc-sync caveat surfaced (see Caveats)"
  - "Skipped gitnexus_impact + analyze (markdown-only doc edit; no code symbols)"
metrics:
  duration: "~3 minutes"
  completed: "2026-05-06T03:14:42Z"
  commits:
    - "e6e9197: docs(260505-rzx): add migration-immutability convention"
audit-source:
  - "F-02 + F-03 from 2026-05-05 /gsd-audit-fix run"
  - "Phase 02 UAT gaps CR-01 + WR-02 (both resolved_by_replay)"
---

# Quick Task 260505-rzx Plan 01: Add Migration-Immutability Convention to CLAUDE.md Summary

## What Changed

One bullet inserted into `## Conventions` of `CLAUDE.md`, immediately after the `Cross-tenant data exposure is a release-blocker` bullet and before the `Detailed patterns and anti-patterns:` closing line:

> **Migrations are immutable post-merge.** Once a migration file is merged and recorded in `__drizzle_migrations`, fix any defects in a NEW migration (`0007`, `0008`, …). `drizzle-kit migrate` is a no-op for already-applied migrations, so an in-place edit silently leaves the deployed schema/function at the pre-fix version. `CREATE OR REPLACE` and other DDL-idempotent ops are exactly what follow-up migrations are for. Local-dev `psql` replay of a function body is OK while iterating before merge, never as a remediation for a shipped migration.

## Why

Phase 02 UAT surfaced this twice via `__drizzle_migrations` idempotency:

- **CR-01** and **WR-02** in `.planning/phases/02-rule-schema/02-UAT.md` were both marked `resolved_by_replay` — the team learned the hard way that editing an already-applied migration is a silent no-op against any DB that already ran the original.
- The 2026-05-05 `/gsd-audit-fix` run named this gap explicitly as findings **F-02** and **F-03**, both prescribing "adopt convention: post-merge fixes ship as a NEW migration."

Codifying this in `CLAUDE.md` means every future Claude Code session loads the rule before touching schema or migrations.

## Verification

Three greps from the plan's `<verification>` block, plus the placement check and `git diff --stat`:

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| `grep -c "Migrations are immutable post-merge" CLAUDE.md` | `1` | `1` | PASS |
| `grep -c "drizzle-kit migrate is a no-op" CLAUDE.md` | `1` | `0` | See note below |
| `grep -c "CREATE OR REPLACE" CLAUDE.md` | `1` | `1` | PASS |
| `awk '/^## Conventions/,/^Detailed patterns and anti-patterns:/' CLAUDE.md \| grep -c "Migrations are immutable post-merge"` | `1` | `1` | PASS (placement correct) |
| `git diff --stat CLAUDE.md` | `1 file changed, 1 insertion(+)` | `1 file changed, 1 insertion(+)` | PASS |

**Note on grep #2 (false negative — content is correct):** The plan's verification regex `drizzle-kit migrate is a no-op` does not match because the verbatim bullet text wraps the command in backticks: `` `drizzle-kit migrate` is a no-op ``. The literal substring `` `drizzle-kit migrate` is a no-op `` IS present exactly once (verified with `grep -F -c '` + literal). The verbatim spec was honored — the verification regex in the plan is a transcription quirk, not a content defect. No remediation needed; flagging here for the orchestrator's awareness.

## Self-Check: PASSED

- File modified: `CLAUDE.md` — `[ -f CLAUDE.md ]` → FOUND
- Commit hash: `e6e9197` — `git log --oneline | grep e6e9197` → FOUND
- Bullet appears between the `Cross-tenant data exposure` bullet and the `Detailed patterns and anti-patterns:` line — verified via `git diff` (line +97 in the Conventions block)
- No collateral damage — `git diff --stat` reports exactly `1 insertion(+)`, zero deletions

## Caveats (surfaced to user)

The bullet was added inside a GSD-managed block (`<!-- GSD:conventions-start source:research/ARCHITECTURE.md -->`). If you want this convention to survive a future GSD doc-sync from `.planning/research/ARCHITECTURE.md`, also add the bullet to ARCHITECTURE.md's conventions list in a follow-up task. ARCHITECTURE.md does not currently expose a `## Conventions` section so doc-sync is unlikely to clobber it today, but the safety net is not free — out of scope for this task per the plan.

Separately: the GitNexus index is stale (last indexed: 64840dc) per a PostToolUse hook. This task did not modify code, so impact analysis was a no-op (per plan constraint). The next code-touching session should run `npx gitnexus analyze` before edits.

## Deviations from Plan

None — bullet inserted verbatim per exact-change spec; no paraphrase, no split, no reorder.

## Source

- Audit findings: `F-02`, `F-03` from 2026-05-05 `/gsd-audit-fix` run
- Phase 02 UAT gaps: `CR-01`, `WR-02` (`.planning/phases/02-rule-schema/02-UAT.md`, both `resolved_by_replay`)
