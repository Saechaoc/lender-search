# Deferred Items — quick task 260505-wp8

Out-of-scope discoveries during execution. Per SCOPE BOUNDARY rule, only fixed
issues directly caused by the current task's changes; everything below
pre-existed before commit 0623f86 and is logged here for follow-up.

## Pre-existing test failures (NOT caused by 260505-wp8)

### 1. `tests/agency/fhlmc-derog.test.ts` — FHLMC derog golden snapshot hash mismatch

- **Status:** Reproducible failure on every run.
- **Verified pre-existing:** Failed on commit `b2771ef` (the immediate parent of
  this task's commits) before any of my changes were applied.
- **Symptom:**
  ```
  AssertionError: expected '64a87b54b4fe810d4f325a17fb3a9afc7e2adb0f68cc7a61d7875c9b1a82fd98'
  to be 'e69f8f8cecbe18b699a194ca8286a87638bb6fa5f8b7ab020f9dc91134febb2e'
  ```
- **Likely cause:** `lib/agency-seeds/fhlmc/derog-seasoning.ts` (or its inputs)
  changed since commit `a38c440` (which locked the golden hash) but the
  expected hash on line 135 of the test was not updated to match. The test's
  own comment at lines 133-134 explicitly anticipates this flow: "to
  lib/agency-seeds/fhlmc/derog-seasoning.ts has changed the bundle — re-run,
  inspect the diff, and bump the hash deliberately."
- **Recommended next step:** A separate quick task should diff the FHLMC seed
  bundle, confirm the change is intentional, and bump the golden hash to
  `64a87b54b4fe810d4f325a17fb3a9afc7e2adb0f68cc7a61d7875c9b1a82fd98`.

### 2. `tests/schema/superseded-by-deferrable.test.ts` — flaky EXCLUDE conflict

- **Status:** Intermittent. Seen on baseline `b2771ef` and after my commits.
  Sometimes only runs in the same suite as the FHLMC failure; other times the
  suite passes 200/200 (observed in earlier runs during this task).
- **Symptom:**
  ```
  conflicting key value violates exclusion constraint "agency_rule_version_no_overlap"
  Key (agency, effective_period)=(FNMA, [1722-01-01,1723-01-01)) conflicts with
  existing key (agency, effective_period)=(FNMA, [1722-07-02,1722-07-03)).
  ```
- **Likely cause:** Lines 48-49 of the test pick a random year `1800 + random*100`
  and a single-day daterange (`[Y-07-02, Y-07-03)`); a separate test in the
  same suite (or a previous run of the same test) inserted FNMA rows in
  overlapping ranges. STATE.md decisions log already documents this as a
  "concurrent-fork race documented in 03-04 + 03-06 SUMMARYs ... known
  transient flake."
- **Recommended next step:** Replace the random-year fixture with a globally
  unique daterange per test invocation (e.g., use `gen_random_uuid()`-derived
  hash to compute a unique year per fork) — out of scope for 260505-wp8.

## What I did NOT defer

The two failures above are the only out-of-scope discoveries. All goals of
260505-wp8 itself (P2.b time-bomb fix; CLAUDE.md migration-immutability honored;
0008/0009 byte-equal) are met and verified.
