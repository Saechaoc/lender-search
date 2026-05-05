---
phase: 02-rule-schema
plan: 06
subsystem: database
tags: [migration, exclude-constraint, generated-column, sql-function, btree-gist]

requires:
  - phase: 02-rule-schema/05
    provides: 0002 schema (program_version, agency_rule_version, program_rule.field_confidence, agency_rule.field_confidence — referenced by EXCLUDE / GENERATED / function); 0003 (FORCE applies before constraints)

provides:
  - db/migrations/0004_program_constraints.sql (btree_gist + jsonb_min_numeric IMMUTABLE wrapper + 2 GENERATED min_confidence STORED columns + 2 EXCLUDE USING gist + 6 CHECK constraints + 2 partial indexes)
  - db/migrations/0006_detect_loosenings.sql (detect_loosenings(uuid) SQL function with WITH overlay_rules + paired CTEs and 4 UNION ALL branches)
  - db/migrations/meta/_journal.json updated with 0004, 0006

affects: [02-07 (BLOCKING migrate applies these; introspection asserts btree_gist + pg_proc detect_loosenings + GENERATED columns + CHECKs + EXCLUDEs), 02-08 (D-20.3 EXCLUDE test, D-20.4 EXCLUDE test, D-20.5 detect_loosenings test, D-20.6 derog round-trip test, D-20.8 source CHECK test)]

tech-stack:
  added: [btree_gist Postgres extension]
  patterns: [IMMUTABLE wrapper function pattern for GENERATED columns referencing subquery aggregates (Pitfall C), partial expression index for jsonb-extracted columns, EXCLUDE USING gist with WHERE partial for state-conditional uniqueness]

key-files:
  created:
    - db/migrations/0004_program_constraints.sql
    - db/migrations/0006_detect_loosenings.sql

key-decisions:
  - "0004 ordering: btree_gist FIRST (Pitfall B), jsonb_min_numeric wrapper SECOND (Pitfall C), GENERATED columns THIRD (depend on wrapper), EXCLUDE constraints FOURTH (require btree_gist), CHECKs FIFTH, indexes LAST"
  - "EXCLUDE on program_version uses WHERE (state='active') partial — only one active version per program; allows overlapping deprecated/sunset versions for historical replay"
  - "EXCLUDE on agency_rule_version has no WHERE partial — agency_rule_version has no state column (D-16); one version per agency at a time, period"
  - "detect_loosenings is SECURITY INVOKER (default) per RESEARCH Assumption A6 — caller's RLS applies, agency_rule's world_read policy makes the JOIN work regardless of caller tenant"
  - "RETURNS NULL ON NULL INPUT on jsonb_min_numeric — empty field_confidence='{}' produces NULL min, not '0'; Phase 8 queue WHERE min_confidence < 0.85 treats empty-body rows as missing-data, not low-confidence"

patterns-established:
  - "IMMUTABLE wrapper for subquery-in-GENERATED workaround: any aggregate over a jsonb (jsonb_min, jsonb_max, jsonb_count) follows this pattern"
  - "Partial expression index on jsonb-extracted column with `WHERE rule_kind='X'` — keeps the index small + fast for the specific dimension's query path"
  - "SQL-language CTE function with multiple UNION ALL branches per D-14 dimension category — Postgres optimizer handles each branch independently"

requirements-completed: [SCH-03, SCH-04, SCH-05, SCH-09, SCH-10, SCH-13]

duration: ~6min
completed: 2026-04-30
---

# Phase 02 Plan 06: --custom Constraints + detect_loosenings Function

**2 --custom migrations (0004 + 0006) interleaved with Plan 02-05's 0002/0003/0005. Together: 5 Phase 2 migrations on top of Phase 1's 0000+0001 = 7 total. Plan 02-07 [BLOCKING] applies all 5 against fresh DB.**

## Function Signature (verbatim)

```sql
CREATE OR REPLACE FUNCTION detect_loosenings(p_program_version_id uuid)
  RETURNS TABLE (
    program_rule_id uuid,
    agency_rule_id uuid,
    dimension text,
    agency_value jsonb,
    overlay_value jsonb
  )
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
AS $$
  WITH
    overlay_rules AS (
      SELECT pr.id, pr.rule_kind, pr.rule_body, pv.agency_rule_version_id
      FROM program_rule pr
      JOIN program_version pv ON pv.id = pr.program_version_id
      WHERE pr.program_version_id = p_program_version_id
        AND pr.layer = 'INVESTOR_OVERLAY'
    ),
    ...
```

## Verification

- 0004: btree_gist + jsonb_min_numeric (IMMUTABLE/PARALLEL SAFE/RETURNS NULL ON NULL INPUT) + 2 GENERATED columns + 2 EXCLUDEs + 6 CHECKs + 2 indexes
- 0006: detect_loosenings function with 4 SELECT branches + 3 UNION ALL
- _journal.json: 0004_program_constraints + 0006_detect_loosenings entries
- No DB connection runs in this plan — Plan 02-07 [BLOCKING] applies the migrations

## Final Journal (Wave 2 closes)

| idx | tag |
|-----|-----|
| 0 | 0000_initial |
| 1 | 0001_force_rls |
| 2 | 0002_program_schema |
| 3 | 0003_force_rls_program |
| 4 | 0004_program_constraints |
| 5 | 0005_force_rls_agency |
| 6 | 0006_detect_loosenings |
