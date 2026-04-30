---
status: testing
phase: 01-tenant-isolation-foundation
source: [01-VERIFICATION.md]
started: 2026-04-30T15:10:00Z
updated: 2026-04-30T15:25:00Z
---

## Current Test

number: 2
name: Demonstrate CI catches a deliberate regression
expected: |
  Temporarily mutate `expect(rows).toHaveLength(0)` → `1` in `tests/rls/cross-tenant-select.test.ts`, push, confirm CI turns red on `pnpm test:rls`, revert, confirm green again.
awaiting: user response (likely blocked by Test 1 failure — CI cannot pass any step)

## Tests

### 1. Push branch + observe GitHub Actions CI run green
expected: All 11 steps in `.github/workflows/ci.yml` pass — checkout → pnpm + Node setup → install → provision app_user → typecheck → lint → lint:fixture → migrate + GRANT → FORCE RLS gate → `pnpm test:rls` (27/27 expected). Local smoke replicates the workflow exactly and runs in 657ms; remote run on real GitHub Actions infrastructure is the missing observation.
result: issue
reported: "Error: Multiple versions of pnpm specified: version 9 in the GitHub Action config with the key 'version' AND version pnpm@9.15.0 in the package.json with the key 'packageManager'. Remove one of these versions. (pnpm/action-setup@v4 errored at install step before any tests could run.)"
severity: blocker
how-to-test: `git push` (or open a PR) and watch the Actions tab. The workflow runs on `pull_request` and `push to main`.

### 2. Demonstrate CI catches a deliberate regression
expected: Temporarily mutate `expect(rows).toHaveLength(0)` → `1` in `tests/rls/cross-tenant-select.test.ts`, push, confirm CI turns red on `pnpm test:rls`, revert the mutation, confirm CI turns green again. This proves the merge gate actually blocks bad commits — not just that the workflow runs.
result: [pending]
how-to-test: One-off branch with the mutation; push; observe red CI; revert + push; observe green.

### 3. Configure branch protection on `main` to require CI / verify
expected: Repo settings → Branches → Branch protection rules → `main` → "Require status checks to pass before merging" includes the `CI / verify` (or whatever the workflow's job name resolves to) check. Without this, CI runs but does not block merge — a maintainer could land a red PR.
result: [pending]
how-to-test: GitHub repo-admin operation outside the codebase. Settings → Branches → add rule → require status check.

## Summary

total: 3
passed: 0
issues: 1
pending: 2
skipped: 0
blocked: 0

## Gaps

- truth: "GitHub Actions CI workflow installs pnpm and completes the install step"
  status: failed
  reason: "User reported: pnpm/action-setup@v4 errored — `Multiple versions of pnpm specified: version 9 in the GitHub Action config with the key 'version' AND version pnpm@9.15.0 in the package.json with the key 'packageManager'`. action-setup@v4 treats this as a fatal config conflict and exits before install. Result: every CI run fails at the pnpm install step; the merge gate is non-functional on real infrastructure even though local pnpm install succeeds."
  severity: blocker
  test: 1
  artifacts:
    - .github/workflows/ci.yml
    - package.json
  missing: []  # nothing missing — config conflict between two redundant version sources
  root_cause_hypothesis: "Plan 01-08's CI workflow specifies `pnpm/action-setup@v4` with `with: version: 9` AND Plan 01-01 set `packageManager: 'pnpm@9.15.0'` in package.json. action-setup@v4 rejects the duplicate. Fix: remove the `with: version: ...` from the workflow so action-setup honors `packageManager` (the canonical source per Corepack convention), OR remove `packageManager` from package.json (worse — it's the local-dev source of truth). Recommend the former."

---

*Persisted from 01-VERIFICATION.md `human_needed` status. These items remain pending until the user runs `/gsd-verify-work 1` and confirms each. Phase 1 advances under `--auto` orchestration with these items tracked for follow-up.*
