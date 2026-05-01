-- Phase 2 / Plan 02-06 Task 1: EXCLUDE constraints + CHECK constraints +
-- jsonb_min_numeric wrapper + min_confidence generated stored columns +
-- partial expression index for derog_seasoning lookup.
--
-- Drizzle 0.45 does not model:
--   (a) EXCLUDE USING gist constraints (Pitfall I)
--   (b) GENERATED ALWAYS AS STORED columns referencing IMMUTABLE functions
--       (Drizzle's generatedAlwaysAs() exists but the workflow + the
--       IMMUTABLE wrapper requirement makes --custom cleaner)
--   (c) Multi-value CHECK constraints with elegant column-level syntax
--   (d) CREATE EXTENSION
--   (e) Partial expression indexes on jsonb-extracted columns
--
-- All of the above land here as --custom DDL.
--
-- Order matters:
--   1. btree_gist extension FIRST (Pitfall B; required for EXCLUDE USING gist
--      with `=` operator on uuid/text columns)
--   2. jsonb_min_numeric IMMUTABLE wrapper (Pitfall C: Postgres rejects
--      subquery in GENERATED ALWAYS AS; wrapper is the standard workaround
--      since Postgres trusts the IMMUTABLE declaration)
--   3. ALTER TABLE ADD COLUMN ... GENERATED ALWAYS AS (jsonb_min_numeric(...))
--      on program_rule + agency_rule (Phase 8 confidence-sorted queue path)
--   4. EXCLUDE constraints on program_version (with WHERE state='active'
--      partial) and agency_rule_version
--   5. CHECK constraints (rule_citation source, jsonb_typeof on rule_body,
--      agency 5-value, state 5-value)
--   6. Indexes (partial expression for derog_seasoning lookup; min_confidence
--      partial for Phase 8 sort)
--
-- daterange literal convention (Pitfall A): all daterange values use the
-- half-open `[start,end)` form so adjacent ranges like `[A,B)` and `[B,C)`
-- do NOT overlap. Plan 02-08's program-version-exclude.test.ts asserts
-- adjacent ranges don't trip the EXCLUDE.

-- Step 1 — btree_gist extension (Pitfall B prereq for EXCLUDE).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Step 2 — jsonb_min_numeric IMMUTABLE wrapper (Pitfall C / D-10 fix).
-- Generated columns can use immutable functions but cannot use subqueries
-- directly. Wrapping the subquery in an IMMUTABLE function makes it
-- callable from a generation expression. RETURNS NULL ON NULL INPUT
-- avoids casting an empty `'{}'::jsonb` to '0' — Phase 8's queue WHERE
-- min_confidence < 0.85 should treat empty-body rows as missing data,
-- not low-confidence.
--
-- Resilient filter (WR-02): only consider numeric-shaped values. Without
-- this filter a stray non-numeric entry in field_confidence (e.g.
-- {"flag": true} or {"x": "high"}) would raise "invalid input syntax for
-- type numeric" inside the GENERATED ALWAYS AS STORED expression and
-- reject the entire INSERT/UPDATE. Because field_confidence shape is not
-- constrained by the rule_kind dispatch table (it's separate per-field
-- metadata the extraction pipeline writes), a Phase 7 extractor regression
-- could otherwise silently break every row write. Filtering to numeric-
-- shaped values via regex skips non-numeric entries when computing the
-- minimum; the comment header for field_confidence in Phase 7 should call
-- out the contract ("numeric per-field score, 0.0–1.0") and the wrapper
-- now degrades gracefully rather than blocking writes.
CREATE OR REPLACE FUNCTION jsonb_min_numeric(j jsonb) RETURNS numeric
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  RETURNS NULL ON NULL INPUT
AS $$
  SELECT MIN((value)::numeric)
  FROM jsonb_each_text(j)
  WHERE value ~ '^-?[0-9]+(\.[0-9]+)?$'
$$;

-- Step 3 — min_confidence generated stored columns (D-10).
-- field_confidence already exists (Plan 02-05's auto-generated 0002 declared
-- the column). The GENERATED column references the wrapper function so
-- Postgres trusts the expression as immutable.
ALTER TABLE "program_rule"
  ADD COLUMN "min_confidence" numeric
  GENERATED ALWAYS AS (jsonb_min_numeric("field_confidence")) STORED;

ALTER TABLE "agency_rule"
  ADD COLUMN "min_confidence" numeric
  GENERATED ALWAYS AS (jsonb_min_numeric("field_confidence")) STORED;

-- Step 4 — EXCLUDE USING gist constraints (D-15 / D-16 / SC#3).
-- program_version: only ONE active version per program at a time.
-- Adjacent ranges `[a,b)` `[b,c)` do NOT overlap (Pitfall A) so back-to-back
-- versions ship cleanly.
ALTER TABLE "program_version"
  ADD CONSTRAINT "program_version_no_overlap_active"
  EXCLUDE USING gist ("program_id" WITH =, "effective_period" WITH &&)
  WHERE (state = 'active');

-- agency_rule_version: only ONE version per agency at a time. No state
-- column on agency_rule_version (D-16) — no WHERE partial needed.
ALTER TABLE "agency_rule_version"
  ADD CONSTRAINT "agency_rule_version_no_overlap"
  EXCLUDE USING gist ("agency" WITH =, "effective_period" WITH &&);

-- Step 5 — CHECK constraints.

-- D-03 / D-20.8: rule_citation must have at least one source pointer.
ALTER TABLE "rule_citation"
  ADD CONSTRAINT "rule_citation_has_source"
  CHECK ("source_pdf_sha256" IS NOT NULL OR "source_url" IS NOT NULL);

-- D-08: rule_body must be a jsonb object (not array, not scalar).
ALTER TABLE "program_rule"
  ADD CONSTRAINT "program_rule_body_is_object"
  CHECK (jsonb_typeof("rule_body") = 'object');

ALTER TABLE "agency_rule"
  ADD CONSTRAINT "agency_rule_body_is_object"
  CHECK (jsonb_typeof("rule_body") = 'object');

ALTER TABLE "lender_overlay_rule"
  ADD CONSTRAINT "lender_overlay_rule_body_is_object"
  CHECK (jsonb_typeof("rule_body") = 'object');

-- D-16: agency_rule_version.agency must be one of the 5 supported agencies.
ALTER TABLE "agency_rule_version"
  ADD CONSTRAINT "agency_rule_version_agency_check"
  CHECK ("agency" IN ('FNMA', 'FHLMC', 'FHA', 'VA', 'USDA'));

-- D-15: program_version.state must be one of the 5 lifecycle states.
-- Phase 8 (PRG-01..04) enforces transition rules; Phase 2 ensures only
-- valid state values land.
ALTER TABLE "program_version"
  ADD CONSTRAINT "program_version_state_check"
  CHECK ("state" IN ('draft', 'in_review', 'active', 'deprecated', 'sunset'));

-- Step 6 — Indexes.

-- Open Question Q5: support SC#2's `WHERE rule_kind='derog_seasoning' AND
-- rule_body->>'event_type'='FORECLOSURE'` query path with a partial
-- expression index. Phase 3 fills agency_rule with ~50 rows; Phase 4
-- evaluator hot-path will hit this index.
CREATE INDEX "agency_rule_derog_event_idx"
  ON "agency_rule" ("rule_kind", ("rule_body"->>'event_type'))
  WHERE "rule_kind" = 'derog_seasoning';

-- Phase 8 confidence-sorted queue: index min_confidence WHERE NOT NULL
-- (rows with empty field_confidence have NULL min_confidence; partial
-- index keeps the index small for the AM review queue's ORDER BY).
CREATE INDEX "program_rule_min_confidence_idx"
  ON "program_rule" ("min_confidence")
  WHERE "min_confidence" IS NOT NULL;
