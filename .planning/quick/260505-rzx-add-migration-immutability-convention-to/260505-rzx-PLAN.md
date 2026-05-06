---
phase: 260505-rzx
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - CLAUDE.md
autonomous: true
requirements:
  - F-02
  - F-03
must_haves:
  truths:
    - "CLAUDE.md's Conventions section ends with a 'Migrations are immutable post-merge' bullet"
    - "The bullet is auto-loaded into every future Claude session via CLAUDE.md ingestion"
    - "The bullet text matches the exact-change spec verbatim (no paraphrase, no split)"
  artifacts:
    - path: "CLAUDE.md"
      provides: "Migration immutability convention as project-wide guidance"
      contains: "Migrations are immutable post-merge"
  key_links:
    - from: "CLAUDE.md Conventions section"
      to: "drizzle-kit migrate behavior + __drizzle_migrations idempotency"
      via: "documented convention bullet"
      pattern: "Migrations are immutable post-merge"
---

<objective>
Insert a single new convention bullet into the `## Conventions` section of `/Users/chrissaechao/IdeaProjects/lender-search/CLAUDE.md` that codifies the post-merge migration immutability rule surfaced by Phase 02 UAT gaps CR-01 and WR-02.

Purpose: Phase 02's `__drizzle_migrations` idempotency burned us twice — editing a recorded migration in place is a silent no-op against any DB that already applied the original. Both audit findings F-02 and F-03 explicitly identify "adopt convention: post-merge fixes ship as a NEW migration" as the missing follow-up. Putting this in CLAUDE.md ensures every future session loads the rule before any DB work begins.

Output: Modified CLAUDE.md with one new bullet appended as the last item under `## Conventions`, immediately before the closing `Detailed patterns and anti-patterns: ...` line.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@CLAUDE.md
@.planning/STATE.md
@.planning/phases/02-rule-schema/02-UAT.md
@.planning/phases/02-rule-schema/02-VERIFICATION.md

<placement_anchor>
The current last bullet under `## Conventions` is:

```
- **Cross-tenant data exposure is a release-blocker.** No admin "view as another tenant," no cross-tenant analytics, no aggregated competitive-analytics surface — explicit antitrust posture from the October 2025 Optimal Blue class action.
```

The closing line (which the new bullet must precede) is:

```
Detailed patterns and anti-patterns: `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md`.
```

Insert the new bullet on its own line BETWEEN those two lines (i.e., after the cross-tenant bullet, with one blank line before the "Detailed patterns" line preserved exactly as it is today).
</placement_anchor>

<managed_block_warning>
The `## Conventions` section in CLAUDE.md is wrapped in GSD-managed delimiters:

```
<!-- GSD:conventions-start source:research/ARCHITECTURE.md -->
## Conventions
...
<!-- GSD:conventions-end -->
```

This means a future GSD doc-sync from `.planning/research/ARCHITECTURE.md` could overwrite the manually-inserted bullet. ARCHITECTURE.md does not currently contain a `## Conventions` section, so doc-sync is unlikely to clobber it today, but the executor should:
  1. Make the edit anyway (the user's exact-change spec targets CLAUDE.md directly and is final)
  2. After the edit, surface a brief note to the user in the final summary: "Bullet was added inside a GSD-managed block (`<!-- GSD:conventions-start source:research/ARCHITECTURE.md -->`). If you want this to survive future doc-syncs, also add the bullet to `.planning/research/ARCHITECTURE.md` in a future task."

Do NOT propose or perform that follow-up edit in this task — it is out of scope. Just flag it.
</managed_block_warning>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Insert migration immutability bullet into CLAUDE.md Conventions section</name>
  <files>/Users/chrissaechao/IdeaProjects/lender-search/CLAUDE.md</files>
  <action>
Use the Edit tool to insert the following bullet into `/Users/chrissaechao/IdeaProjects/lender-search/CLAUDE.md`, on its own line, immediately AFTER the existing `Cross-tenant data exposure is a release-blocker.` bullet and BEFORE the existing `Detailed patterns and anti-patterns:` line. Keep the existing blank line between the bullet list and the "Detailed patterns" closing line — the new bullet goes inside the bullet list, not after the blank line.

Use this Edit call (per F-02/F-03 from the 2026-05-05 audit-fix run, addressing Phase 02 UAT gaps CR-01 + WR-02):

  old_string (must match exactly, including the leading and trailing newlines so the diff is unambiguous):
```
- **Cross-tenant data exposure is a release-blocker.** No admin "view as another tenant," no cross-tenant analytics, no aggregated competitive-analytics surface — explicit antitrust posture from the October 2025 Optimal Blue class action.

Detailed patterns and anti-patterns:
```

  new_string:
```
- **Cross-tenant data exposure is a release-blocker.** No admin "view as another tenant," no cross-tenant analytics, no aggregated competitive-analytics surface — explicit antitrust posture from the October 2025 Optimal Blue class action.
- **Migrations are immutable post-merge.** Once a migration file is merged and recorded in `__drizzle_migrations`, fix any defects in a NEW migration (`0007`, `0008`, …). `drizzle-kit migrate` is a no-op for already-applied migrations, so an in-place edit silently leaves the deployed schema/function at the pre-fix version. `CREATE OR REPLACE` and other DDL-idempotent ops are exactly what follow-up migrations are for. Local-dev `psql` replay of a function body is OK while iterating before merge, never as a remediation for a shipped migration.

Detailed patterns and anti-patterns:
```

The bullet text is FINAL per the exact-change spec from the orchestrator. Do not paraphrase, reword, re-order clauses, or split into multiple bullets. Insert verbatim.

After the edit succeeds, in your task summary, surface the managed-block note from `<managed_block_warning>` to the user — one short sentence, no action required.

Do NOT touch any other part of CLAUDE.md, do NOT modify ARCHITECTURE.md, do NOT add tests, and do NOT run `gitnexus_impact` (this is a markdown doc edit with no symbol-level blast radius — gitnexus impact analysis is a no-op for non-code files).
  </action>
  <verify>
    <automated>grep -c "Migrations are immutable post-merge" /Users/chrissaechao/IdeaProjects/lender-search/CLAUDE.md | grep -q "^1$" &amp;&amp; grep -c "drizzle-kit migrate is a no-op" /Users/chrissaechao/IdeaProjects/lender-search/CLAUDE.md | grep -q "^1$"</automated>
  </verify>
  <done>
- `grep -c "Migrations are immutable post-merge" CLAUDE.md` returns exactly `1` (bullet present, not duplicated)
- `grep -c "drizzle-kit migrate is a no-op" CLAUDE.md` returns exactly `1` (full bullet body inserted, not just the heading phrase)
- The bullet appears between the `Cross-tenant data exposure` bullet and the `Detailed patterns and anti-patterns:` closing line (verifiable by reading CLAUDE.md)
- No other lines in CLAUDE.md were modified (verifiable via `git diff CLAUDE.md` — only the one-line insertion shown)
- Final task summary mentions the GSD-managed-block caveat to the user
  </done>
</task>

</tasks>

<verification>
End-to-end check after the task completes:

1. **Bullet inserted exactly once, verbatim:**
   ```bash
   grep -c "Migrations are immutable post-merge" /Users/chrissaechao/IdeaProjects/lender-search/CLAUDE.md
   # expect: 1
   grep -c "drizzle-kit migrate is a no-op" /Users/chrissaechao/IdeaProjects/lender-search/CLAUDE.md
   # expect: 1
   grep -c "CREATE OR REPLACE" /Users/chrissaechao/IdeaProjects/lender-search/CLAUDE.md
   # expect: 1
   ```

2. **Placement is correct (bullet sits inside Conventions, not at the end of file or in another section):**
   ```bash
   awk '/^## Conventions/,/^Detailed patterns and anti-patterns:/' /Users/chrissaechao/IdeaProjects/lender-search/CLAUDE.md | grep -c "Migrations are immutable post-merge"
   # expect: 1
   ```

3. **No collateral damage to surrounding sections:**
   ```bash
   git diff --stat /Users/chrissaechao/IdeaProjects/lender-search/CLAUDE.md
   # expect: " 1 file changed, 1 insertion(+)"
   ```
</verification>

<success_criteria>
- CLAUDE.md `## Conventions` section ends with the "Migrations are immutable post-merge" bullet (immediately before the "Detailed patterns and anti-patterns:" line)
- Bullet text matches the exact-change spec verbatim (no rewording)
- `git diff` shows exactly one inserted line, zero deletions, zero changes elsewhere in the file
- All three verification greps return `1`
- Task summary includes the GSD-managed-block caveat for the user's awareness
</success_criteria>

<output>
After completion, create `.planning/quick/260505-rzx-add-migration-immutability-convention-to/260505-rzx-01-SUMMARY.md` capturing:
- The exact bullet inserted
- Confirmation grep counts (all = 1)
- The managed-block caveat surfaced to the user
- Reference to F-02 + F-03 audit findings + Phase 02 UAT gaps CR-01 + WR-02 as the source justification
</output>
