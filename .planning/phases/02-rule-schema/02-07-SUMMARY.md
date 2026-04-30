---
phase: 02-rule-schema
plan: 07
subsystem: database
tags: [migration, blocking, introspection, drizzle-kit]

requires:
  - phase: 02-rule-schema/05
    provides: 0002 + 0003 + 0005 migrations
  - phase: 02-rule-schema/06
    provides: 0004 + 0006 migrations

provides:
  - applied schema state in lender_search_dev: 7 migrations (0000-0006) recorded in drizzle.__drizzle_migrations
  - introspection-verified structural state: FORCE RLS on 5 tenant-scoped tables, btree_gist installed, jsonb_min_numeric IMMUTABLE wrapper present, 2 GENERATED min_confidence STORED columns, 2 EXCLUDE USING gist constraints, 6 CHECK constraints, system_role role exists, app_user has DML on tenant-scoped tables + agency tables
  - 0006_detect_loosenings.sql operator-precedence bug FIXED (parentheses around `(agency_body->'values') @> (overlay_body->'values')`; original DDL parsed as `((agency_body->'values' @> overlay_body) -> 'values')` which gives boolean → text type error)

affects: [02-08 (constraint tests run against this DB state), 02-09 (pen tests run against this DB state)]

tech-stack:
  added: []
  patterns: [psql-direct migration application as fallback when drizzle-kit migrate stdout/spinner-buffer hangs; manual __drizzle_migrations population followed by drizzle-kit migrate confirmation as the journal-sync gate]

key-decisions:
  - "drizzle-kit migrate hung locally with the spinner stuck — bypassed by applying each migration via `docker compose exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 < <file>`. After all 7 applied (with 0006 fix), populated drizzle.__drizzle_migrations manually with sha256 hashes from each migration file. Subsequent `pnpm db:migrate` no-ops in <1s, confirming the journal is in sync"
  - "0006_detect_loosenings.sql operator-precedence fix: `agency_body->'values' @> overlay_body->'values'` parses as `((agency_body->'values' @> overlay_body) -> 'values')` because `->` binds tighter than `@>`. Wrapping each side in parentheses (`(agency_body->'values') @> (overlay_body->'values')`) restores the intended jsonb-containment semantics"

requirements-completed: [SCH-01, SCH-03, SCH-09, SCH-10, SCH-13, SCH-14]

duration: ~4min
completed: 2026-04-30
---

# Phase 02 Plan 07: [BLOCKING] Migrate + Introspection Gate

**5 Phase 2 migrations + 2 Phase 1 migrations applied to lender_search_dev. Introspection confirms FORCE RLS / extensions / functions / GENERATED columns / EXCLUDE / CHECK / system_role all present. drizzle.__drizzle_migrations populated with 7 entries; drizzle-kit migrate is a no-op going forward. Plans 02-08 + 02-09 run against this verified DB state.**

## Introspection Output (verbatim)

```
$ relforcerowsecurity on tenant-scoped tables:
 program             | t
 program_rule        | t
 program_version     | t
 rule_citation       | t
 lender_overlay_rule | t

$ detect_loosenings function:
 detect_loosenings (1 row)

$ btree_gist extension:
 btree_gist (1 row)

$ min_confidence GENERATED columns:
 agency_rule  | min_confidence | s
 program_rule | min_confidence | s

$ EXCLUDE constraints:
 agency_rule_version_no_overlap
 program_version_no_overlap_active

$ CHECK constraints (count): 6

$ system_role role: present

$ app_user grants on agency tables: DML present
```

## Deviations

1. **drizzle-kit migrate stdout hang** — drizzle-kit 0.31.10 entered a stuck spinner state on the first `pnpm db:migrate` invocation against the fresh db:reset state. Bypass: applied each migration via `docker compose exec -T postgres psql -v ON_ERROR_STOP=1 < <file>`. Discovered the 0006 operator-precedence bug in the process (which would have caused the hang to surface as an error if drizzle-kit had been progressing).

2. **0006 operator-precedence fix** — the verbatim DDL from RESEARCH §Pattern 5's allow-list branch (`agency_body->'values' @> overlay_body->'values`) parses incorrectly. Postgres `->` binds tighter than `@>`, producing `((agency_body->'values' @> overlay_body) -> 'values')` (boolean → text — invalid). Fix: wrap each side in parentheses. Migration applied cleanly after fix.

3. **Manual __drizzle_migrations population** — since drizzle-kit didn't record the migrations during the bypass, populated the journal table manually with sha256 hashes computed from each migration file. Subsequent `pnpm db:migrate` no-ops in <1s (confirms the journal is in sync). Future PRs can run drizzle-kit migrate normally.

## Files Touched

- `db/migrations/0006_detect_loosenings.sql` — operator-precedence parentheses fix
- `drizzle.__drizzle_migrations` table — populated with 7 entries
