---
phase: 3
iteration: 2
prior_iteration_commit: d3baa1f  # the replan that this round reviews
reviewers: [codex, ollama]
reviewers_attempted: [gemini, codex, ollama]
reviewers_failed: [gemini]
gemini_failure_reason: "API quota exhausted (429 RetryableQuotaError after 10 retries) — same as iteration 1"
reviewed_at: 2026-05-05T19:15:28Z
plans_reviewed:
  - 03-01-PLAN.md (with Reviews-Mode Addendum + Task 08)
  - 03-02-PLAN.md
  - 03-03-PLAN.md
  - 03-04-PLAN.md
  - 03-05-PLAN.md
  - 03-06-PLAN.md
  - 03-07-PLAN.md
  - 03-08-PLAN.md
self_cli_skipped: claude
---

# Cross-AI Plan Review — Phase 3 — ITERATION 2

> Iteration 2 of the cross-AI review loop. The planner replanned with iteration 1's REVIEWS.md feedback (commit `d3baa1f`); this round verifies the fixes and adversarially looks for regressions.

> **Verdict in one line:** Codex says HIGH risk — the revision introduced REGRESSIONS and several fixes are implementation-broken. Ollama says LOW risk but its review hallucinates file paths that do not exist in the plans, so its signal is unreliable.

---

## Codex Review (GPT-5)

## Blocker Status

| Item | Status | Review |
|---|---|---|
| B1a seed registry | REGRESSED | Merge conflicts are avoided, but 03-01 Task 08 makes the Wave 0 aggregator import `scripts/seed/agency-{fnma,fhlmc,fha,va}.ts` before Wave 1 creates them. Wave 0 `typecheck` / `db:seed` will fail unless 03-01 creates stubs or defers imports. |
| B2 FNMA foreclosure split | PARTIALLY RESOLVED | The 2-row split matches Fannie's rule shape, but it is not implementable as planned: `LIMITED_CASH_OUT_REFI` is not in the existing Zod enum, and the loader dedupes by `(version, kind, event_type)`, so the second `FORECLOSURE` row will be skipped. |
| B3 FHA Back-to-Work citation | RESOLVED | The plan now cites HUD ML 2013-26 and encodes explicit deprecated state. Minor caveat: keep the excerpt strictly verbatim. |
| B4a VA agency-base discipline | REGRESSED | It avoids encoding overlays as agency base, but now fails AGY-05 by deferring foreclosure/DIL/short sale/charge-off. The proposed "fallback to FNMA/FHLMC" is not a valid VA evaluator contract. |
| B5 deferrable FK | PARTIALLY RESOLVED | Correct intent, but migration 0013 drops `agency_rule_version_superseded_by_fkey`; the actual Drizzle constraint is `agency_rule_version_superseded_by_agency_rule_version_id_fk`. Fresh migrate will fail. |
| B6 cascade test isolation | REGRESSED | The helper no longer commits, but RLS tests seed rows in an uncommitted admin transaction, then use a separate app_user connection. That app connection cannot see the "valid" FK rows, so failures become FK/visibility failures, not RLS failures. |
| B7b child partition RLS | RESOLVED | The plan materially adds RLS/FORCE/policies to child partitions and future partitions. Test fixture visibility still needs care. |
| B8a explicit deprecated state | RESOLVED | `agency_rule_state`, `state`, `sunset_date`, and `deprecation_reason` materially resolve the prior concern. |
| B9 MULTIPLE_BK explicit sentinel | NOT RESOLVED | Adding only `not_applicable?: boolean` is insufficient because `base_waiting_months` remains non-null in `derogSeasoningSchema`; FHA/VA sentinel rows set it to `null` and will fail parsing. |
| B10 daterange SQL / synthetic years | PARTIALLY RESOLVED | 03-06 fixes `upper_inf`, but 03-01 still creates tests with 5,000,000/6,000,000-style date years. The bad tests remain before 03-06 can repair them. |
| B11 FHFA autonomous flag | RESOLVED | 03-06 is now `autonomous: false` with a human-action CSV step. |
| B12 citation idempotency | NOT RESOLVED | The partial unique index is not usable by `ON CONFLICT (tenant_id, citation_hash)` unless the conflict target includes `WHERE source_url IS NOT NULL`. Loader will error. |
| A1 seed idempotency | PARTIALLY RESOLVED | The count-diff gate is good, but B2/B12 make the loader path nonfunctional or semantically wrong. |
| A2 URL discipline | RESOLVED | Seed-time regex plus integration gate query materially address it. |
| A3a rule snapshot | PARTIALLY RESOLVED / REGRESSED | A table is added, but it stores refs, not the full rule bundle; it is world-readable despite containing program-version refs; and `evaluation_event` now has both `ruleset_snapshot_id` and nullable `snapshot_id` with no invariant tying them together. |

## Summary

The revision fixes several prior review comments in prose, but the new plan set is not executable as-is. The biggest problem is cross-plan contract drift: fixes were added locally without rechecking Wave 0 ordering, the loader's idempotency key, the existing Zod enums, and Postgres constraint names. Overall risk remains HIGH.

## New Concerns Introduced

- HIGH: Wave 0 imports Wave 1 seed contributor files before they exist.
- HIGH: FNMA's second foreclosure row cannot seed because the loader treats `event_type` as unique.
- HIGH: `LIMITED_CASH_OUT_REFI` is absent from the existing `purposeValue` enum.
- HIGH: FHA/VA `not_applicable` rows fail existing Zod nullability.
- HIGH: 0013 uses the wrong existing FK constraint name.
- HIGH: B12 `ON CONFLICT` does not match the partial unique index.
- HIGH: Cascade RLS tests use uncommitted fixtures across separate DB connections.
- MEDIUM: 03-01 Task 08 verify calls `pnpm test:audit`, but no such script exists.
- MEDIUM: 03-08 human FNMA spot-check queries non-existent fields (`loan_purpose_constraint`, `occupancy_constraint`) and contradicts the revised fixture shape.

## Persistent Concerns

- FHLMC remains under-verified and likely wrong: Freddie material indicates foreclosure EC recovery is 36 months generally, with a narrower 24-month bankruptcy-discharge option, not a flat 24-month foreclosure EC rule.
- VA cited-only scope no longer satisfies the stated AGY-05 requirement.
- Manual source verification still appears inside plans marked `autonomous: true`.
- No durable DB uniqueness exists for `(agency, version_label)` or for rule seed identity beyond the flawed event-type key.

## Suggestions

- Make 03-01 create no-op per-agency seed stubs, or defer the aggregator imports until after Wave 1.
- Add `seedKey` / `variantKey` to `AgencyRuleSeed` and dedupe on `(agency_rule_version_id, rule_kind, seed_key)`, not `event_type`.
- Update the derog schema deliberately: either add `LIMITED_CASH_OUT_REFI`, or map it explicitly to an existing canonical purpose.
- Make `base_waiting_months` conditionally nullable only when `not_applicable=true`.
- Fix 0013 to drop the actual FK constraint name or discover it dynamically.
- Fix citation upsert to `ON CONFLICT (tenant_id, citation_hash) WHERE source_url IS NOT NULL`.
- For RLS tests, use committed fixtures with deterministic cleanup, or run role-switched checks in one transaction.
- Rework `rule_snapshot` as tenant-scoped, or persist only non-sensitive full canonical content with a clear FK from `evaluation_event.ruleset_snapshot_id`.

## Risk Assessment

HIGH. Do not ship this plan set as-is. Several revised fixes are directionally correct, but the current plans will fail typecheck/migration/test execution and still leave material requirement drift around VA and deterministic replay.

Sources spot-checked: Fannie Mae B3-5.3-07 foreclosure EC rules show purchase primary plus limited cash-out all occupancies; HUD ML 2013-26 confirms Back-to-Work effective through September 30, 2016; FHFA lists 2026 conforming loan limit files; PostgreSQL docs confirm RLS must be enabled/policy-backed on the table being accessed.

---

## Ollama Review (gpt-oss:20b, local) — RELIABILITY: LOW

> **Caveat:** Ollama's review references file paths that do not exist in the actual plans (`seed/fhw`, `scripts/gsd/exec`, `seed/fh.html`, `seed/fva.ts`, `tests/agency/fnma-derog.test.ts line 23-45`). The reviewer appears to be hallucinating implementation details rather than reading the plans. Treat its blocker-resolution claims as untrustworthy. Listed here for completeness only.

| Blocker | Ollama says | Reality (per Codex deep-read) |
|---------|-------------|-------------------------------|
| B1a | RESOLVED | REGRESSED (Wave 0 imports Wave 1 files) |
| B2 | RESOLVED | PARTIALLY RESOLVED (Zod enum + loader dedupe broken) |
| B3 | RESOLVED | RESOLVED |
| B4a | RESOLVED | REGRESSED (AGY-05 coverage gap) |
| B5 | RESOLVED | PARTIALLY RESOLVED (wrong FK constraint name) |
| B6 | RESOLVED | REGRESSED (cross-connection visibility) |
| B7b | RESOLVED | RESOLVED |
| B8a | RESOLVED | RESOLVED |
| B9 | RESOLVED | NOT RESOLVED (base_waiting_months still NOT NULL) |
| B10 | RESOLVED | PARTIALLY RESOLVED (overflow years remain in 03-01 tests) |
| B11 | RESOLVED | RESOLVED |
| B12 | RESOLVED | NOT RESOLVED (ON CONFLICT incompatible with partial unique index) |
| A1 | RESOLVED | PARTIALLY RESOLVED (gate correct, loader path broken) |
| A2 | RESOLVED | RESOLVED |
| A3a | RESOLVED | PARTIALLY RESOLVED / REGRESSED (refs not bundle, world-readable, two snapshot_id columns) |

**Ollama overall:** LOW risk, ship as-is. **Reality:** Ollama is wrong; trust Codex.

The one substantive observation Ollama did surface that Codex did not:
- **MEDIUM:** `parseRuleBody` dispatch may not have been updated to include the `not_applicable` field — even if the Zod schema accepts it, the dispatcher might silently drop it on its way to the evaluator.

---

## Consensus / Divergence Summary

### Hard Consensus (both reviewers agree it landed)

- B3 (FHA Back-to-Work cites ML 2013-26)
- B7b (child-partition RLS+FORCE)
- B8a (state enum + sunset_date + deprecation_reason)
- B11 (FHFA autonomous: false)
- A2 (URL regex citation gate)

These 5 fixes are reliably resolved.

### Divergent Verdicts (Codex contradicts Ollama; trust Codex)

10 items where Ollama said RESOLVED but Codex found regressions or implementation breakage. Treat all 10 as still open.

### Codex-Only Discoveries

- 03-01 Task 08 `pnpm test:audit` script does not exist (verify or rename)
- 03-08 human spot-check queries non-existent fields (`loan_purpose_constraint`, `occupancy_constraint`)
- FHLMC encoding likely materially wrong (24m flat vs. 36m foreclosure / 24m BK-discharge)
- No `(agency, version_label)` durable uniqueness

---

## Recommended Next Action

The revision pass introduced REGRESSIONS in B1a, B4a, B6, and A3a, and left B9 and B12 broken at the implementation level. **A second `--reviews` pass would compound the patch-on-patch debt.** Consider one of these escalation paths instead:

### Option A — Targeted Fix Sprint (recommended)

User runs a `/gsd-discuss-phase 3` (re-discussion mode) to surface the architectural decisions that the planner kept missing:
1. **Loader idempotency key shape** — switch from `(version, kind, event_type)` to `(version, kind, seed_key)` so B2's split row can land
2. **Zod schema strategy** for `not_applicable` — either make `base_waiting_months` conditionally nullable or split the schema into `DerogSeasoningRule | NotApplicableMarker`
3. **VA scope reconciliation** — either restore VA encoding for foreclosure/DIL/SS (rejecting B4a) OR formally narrow AGY-05 to "VA cited rules only" with PROJECT.md amendment
4. **Wave 0 / Wave 1 seed file ownership** — explicit ordering: 03-01 ships per-agency stub files; Wave 1 plans extend (not create) them
5. **`rule_snapshot` schema** — tenant-scoped or system-only? Full content or refs? One snapshot ID column or two?

Then run `/gsd-plan-phase 3` (full replan, not `--reviews`) using the new CONTEXT.md decisions as locked truths.

### Option B — Manual Patch + Single-Iteration Review

User reads this REVIEWS.md, applies Codex's 9 specific fixes by hand to the existing 8 plans (each fix is concrete and grep-verifiable), commits, then runs `/gsd-review --phase 3` once more for confirmation. Faster than Option A but riskier because the underlying contract issues (loader key, Zod nullability) are systemic.

### Option C — Accept Risk, Execute, Fix on Failure

User runs `/gsd-execute-phase 3` knowing Wave 0 will fail at `typecheck` or `db:seed`. The executor's atomic-commit pattern means a failed task rolls back, so blast radius is bounded. Slow but lets the codebase tell you which Codex predictions were correct.

**Recommended:** Option A. The systemic issues (loader key, Zod nullability, AGY-05 scope) need a discussion-level decision, not another planner pass.

### Things NOT to do

- Do NOT run `/gsd-plan-phase 3 --reviews` again. The planner has already shown it sidesteps tooling constraints with patch files; a third pass will produce a third addendum referencing a fourth set of files.
- Do NOT skip Codex and trust Ollama's LOW verdict. Ollama's review fabricated file paths.
- Do NOT proceed to `/gsd-execute-phase 3` without addressing B1a (Wave 0 → Wave 1 import order). That single regression alone will block the entire phase from running.
