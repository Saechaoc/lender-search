---
phase: 02-rule-schema
plan: 05
subsystem: database
tags: [drizzle-kit, migration, force-rls, postgres]

requires:
  - phase: 02-rule-schema/02
    provides: program-side TS schema files (drizzle-kit reads these)
  - phase: 02-rule-schema/03
    provides: agency-side TS schema files + system_role pgRole declaration

provides:
  - db/migrations/0002_program_schema.sql (drizzle-kit generated; single file covers all 7 new tables + 2 enums + ENABLE RLS + 9 policies + indexes)
  - db/migrations/0003_force_rls_program.sql (--custom; FORCE RLS on 4 program-side tables + 4 GRANTs to app_user)
  - db/migrations/0005_force_rls_agency.sql (--custom; FORCE on lender_overlay_rule + GRANTs DML on lender_overlay + GRANTs SELECT on agency tables to app_user)
  - db/migrations/meta/_journal.json updated with entries 0002, 0003, 0005

affects: [02-06 (lands 0004 + 0006 between/after these), 02-07 (BLOCKING migrate applies these), 02-08 (constraint tests exercise output), 02-09 (pen tests rely on FORCE)]

tech-stack:
  added: []
  patterns: [drizzle-kit generate single-file output for all schema modules in barrel, --custom hand-author for FORCE/EXCLUDE/functions/extensions, post-migrate GRANTs to app_user mirroring Plan 01-05 §Step 6]

key-files:
  created:
    - db/migrations/0002_program_schema.sql
    - db/migrations/0003_force_rls_program.sql
    - db/migrations/0005_force_rls_agency.sql
  modified:
    - db/migrations/meta/_journal.json

key-decisions:
  - "Approach A locked: single 0002_program_schema.sql covers all 7 new tables (drizzle-kit emits 9 tables in one diff including the existing tenant + canary). --custom files renumbered 0003 (force_rls_program), 0005 (force_rls_agency)"
  - "agency_rule + agency_rule_version intentionally NOT FORCEd: their world_read policy permits SELECT regardless of caller; Pitfall E avoided by separate world_read SELECT + system_write ALL policies"
  - "Drizzle-emitted policies use `to public` for tenant_isolation policies and `to \"system_role\"` for agency *_system_write policies — verified Drizzle's pgPolicy({to: pgRole().existing()}) correctly emits the role-bound TO clause (RESEARCH Assumption A2 validated)"

patterns-established:
  - "drizzle-kit generate workflow: single run emits one file per schema-change pass, journal tracks entries by index"
  - "post-migrate GRANT pattern: every new table needs explicit DML/SELECT GRANTs to app_user because table owner is postgres (init-db.sh ALTER DEFAULT PRIVILEGES covers FUTURE tables, not those created during the migrate)"

requirements-completed: [SCH-01, SCH-09, SCH-10, SCH-13, SCH-14]

duration: ~6min
completed: 2026-04-30
---

# Phase 02 Plan 05: drizzle-kit Migrations (0002 + 0003 + 0005)

**3 of 5 Phase 2 migrations staged. Single 0002 (Approach A) + 2 --custom FORCE/GRANT files. Plan 02-06 interleaves 0004 (constraints) and 0006 (detect_loosenings); Plan 02-07 [BLOCKING] applies all 5.**

## Verification

- All 7 tables in 0002: `CREATE TABLE` for program/program_version/program_rule/rule_citation/agency_rule_version/agency_rule/lender_overlay_rule
- 9 policies in 0002: 5 tenant_isolation (canonical Phase 1 pattern) + 2 agency_rule_version (world_read + system_write) + 2 agency_rule (world_read + system_write)
- 2 enums: program_rule_layer (2 values), rule_kind (17 values matching D-09)
- 0003: 4 FORCE statements (program/program_version/program_rule/rule_citation) + 4 GRANT DML
- 0005: 1 FORCE (lender_overlay_rule only) + 1 GRANT DML + 2 GRANT SELECT (agency tables)
- _journal.json lists entries 0000, 0001, 0002, 0003 (this plan); 0004 lands via Plan 02-06 Task 1, then 0005 (this plan), then 0006 (Plan 02-06 Task 2)

## Final Journal Order (after Plan 02-06 closes Wave 2)

```
0000_initial          (Phase 1)
0001_force_rls        (Phase 1)
0002_program_schema   (Plan 02-05 Task 1)
0003_force_rls_program (Plan 02-05 Task 2)
0004_program_constraints (Plan 02-06 Task 1)
0005_force_rls_agency (Plan 02-05 Task 3)
0006_detect_loosenings (Plan 02-06 Task 2)
```
