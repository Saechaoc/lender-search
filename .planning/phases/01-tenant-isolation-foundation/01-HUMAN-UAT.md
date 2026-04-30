---
status: testing
phase: 01-tenant-isolation-foundation
source: [01-VERIFICATION.md]
started: 2026-04-30T15:10:00Z
updated: 2026-04-30T15:45:00Z
---

## Current Test

number: 2
name: Demonstrate CI catches a deliberate regression
expected: |
  Mutate `expect(rows).toHaveLength(0)` → `1` in `tests/rls/cross-tenant-select.test.ts`, push, see CI red on `pnpm test:rls`, revert, see CI green again.
awaiting: user response

## Tests

### 1. Push branch + observe GitHub Actions CI run green
expected: All 11 steps in `.github/workflows/ci.yml` pass — checkout → pnpm + Node setup → install → provision app_user → typecheck → lint → lint:fixture → migrate + GRANT → FORCE RLS gate → `pnpm test:rls` (27/27 expected). Local smoke replicates the workflow exactly and runs in 657ms; remote run on real GitHub Actions infrastructure is the missing observation.
result: pass
verified: 2026-04-30T15:50:00Z (after fixes e98f115 + d2b6eb6)
prior_attempts:
  - timestamp: 2026-04-30T15:25:00Z
    result: issue (blocker)
    reason: "pnpm/action-setup@v4 errored — duplicate version sources in workflow + package.json"
    fix_commit: e98f115
  - timestamp: 2026-04-30T15:35:00Z
    result: issue (blocker, surfaced in next CI step)
    reason: "FORCE RLS gate grep mismatched boolean rendering — `||` cast bool to `true`/`false` while grep matched `t`/`f`"
    fix_commit: d2b6eb6
how-to-test: `git push` (already done — both fixes on origin/main). Watch the Actions tab.

### 2. Demonstrate CI catches a deliberate regression
expected: Temporarily mutate `expect(rows).toHaveLength(0)` → `1` in `tests/rls/cross-tenant-select.test.ts`, push, confirm CI turns red on `pnpm test:rls`, revert the mutation, confirm CI turns green again. This proves the merge gate actually blocks bad commits — not just that the workflow runs.
result: [pending]
prior_attempts:
  - timestamp: 2026-04-30T15:30:00Z
    result: blocked (prior-test)
    reason: "Test 1 install step failed; couldn't reach test step"
how-to-test: One-off branch with the mutation; push; observe red CI; revert + push; observe green.

### 3. Configure branch protection on `main` to require CI / verify
expected: Repo settings → Branches → Branch protection rules → `main` → "Require status checks to pass before merging" includes the `CI / verify` (or whatever the workflow's job name resolves to) check. Without this, CI runs but does not block merge — a maintainer could land a red PR.
result: skipped
reason: "User reported: 'We don't need this since its just me working on the project I won't merge anything that doesn't pass'. Solo-dev self-discipline accepted in lieu of branch protection rule. Reconsider if/when contributors are added (note in PROJECT.md milestone review)."
how-to-test: GitHub repo-admin operation outside the codebase. Settings → Branches → add rule → require status check.

## Summary

total: 3
passed: 1
issues: 0
pending: 1
skipped: 1
blocked: 0
notes: "Test 1 confirmed pass on real GitHub Actions after fixes e98f115 + d2b6eb6."

## Gaps

- truth: "GitHub Actions CI workflow installs pnpm and completes the install step"
  status: fix_landed_local
  reason: "User reported: pnpm/action-setup@v4 errored — `Multiple versions of pnpm specified: version 9 in the GitHub Action config with the key 'version' AND version pnpm@9.15.0 in the package.json with the key 'packageManager'`. action-setup@v4 treats this as a fatal config conflict and exits before install."
  severity: blocker
  test: 1
  artifacts:
    - .github/workflows/ci.yml
    - package.json
  missing: []  # nothing missing — config conflict between two redundant version sources
  root_cause: "Plan 01-08's CI workflow specified `pnpm/action-setup@v4` with `with: version: 9` AND Plan 01-01 set `packageManager: 'pnpm@9.15.0'` in package.json. action-setup@v4 rejects the duplicate per ERR_PNPM_BAD_PM_VERSION."
  fix:
    commit: e98f115
    message: "fix(ci): remove duplicate pnpm version from action-setup"
    change: "Removed `with: version: 9` block from .github/workflows/ci.yml so action-setup honors `packageManager` from package.json (Corepack canonical source)."
    verified_local: true  # fix is the smaller diff; package.json is the local-dev source of truth
    verified_remote: pending  # user must push and re-observe CI
  reverify_steps:
    - "Push commit e98f115 to remote"
    - "Watch GitHub Actions tab for CI run on push to main (or open a PR for the pull_request trigger)"
    - "Confirm pnpm install step passes"
    - "Confirm all 11 workflow steps pass and 27/27 tests green"
    - "Then re-run /gsd-verify-work 1 — Tests 1+2 will be re-presented for fresh observation"

---

*Persisted from 01-VERIFICATION.md `human_needed` status. These items remain pending until the user runs `/gsd-verify-work 1` and confirms each. Phase 1 advances under `--auto` orchestration with these items tracked for follow-up.*
