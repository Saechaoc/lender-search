---
phase: 02-rule-schema
plan: 03
subsystem: database
tags: [drizzle, postgres, system-role, agency, lender-overlay, schema]

requires:
  - phase: 02-rule-schema/01
    provides: daterange customType, system_role pgRole declaration
  - phase: 02-rule-schema/02
    provides: program table (FK target for lender_overlay_rule.applies_to_program_id), rule_citation (FK target for primary_citation_id), ruleKind pgEnum (REUSED — single Postgres ENUM type), program-rule.ts (barrel wired up alongside)

provides:
  - db/schema/agency-rule-version.ts (system-owned; NO tenant_id; two-policy shape: world_read SELECT + system_role write; effective_period daterange NOT NULL; superseded_by self-FK for Phase 3 cascade trigger; agency_idx for cascade query path)
  - db/schema/agency-rule.ts (system-owned; reused ruleKind pgEnum; rule_body jsonb NOT NULL; field_confidence DEFAULT '{}'; primary_citation_id NOT NULL FK to rule_citation — citation discipline applies to agency rules too; (agency_rule_version_id, rule_kind) idx)
  - db/schema/lender_overlay_rule (tenant-scoped; applies_to_program_id NULLABLE FK to program — NULL means 'all programs at brokerage'; reused ruleKind enum; primary_citation_id NOT NULL FK; canonical RLS policy on tenant_id)
  - db/schema/index.ts barrel extended with all 9 modules including system-role for drizzle-kit visibility

affects: [02-05, 02-06, 02-07, 02-08, 02-09, phase 03 hand-authoring, phase 04 evaluator, phase 12 LOV brokerage UI]

tech-stack:
  added: []
  patterns: [Two-policy table pattern (world_read for SELECT + system_role for ALL) for system-owned tables, pgRole().existing() for externally-managed Postgres roles, structured DerogRule encoded as jsonb body in agency_rule with rule_kind='derog_seasoning']

key-files:
  created:
    - db/schema/agency-rule-version.ts
    - db/schema/agency-rule.ts
    - db/schema/lender-overlay-rule.ts
  modified:
    - db/schema/index.ts (extended barrel with all 9 Phase 2 modules + system-role re-export)

key-decisions:
  - "agency_rule_version + agency_rule are system-owned (NOT tenant-scoped) — no tenant_id column; cross-tenant readability via two-policy shape (world_read SELECT + system_role write); writes restricted to system_role (Plan 02-01 bootstrapped via init-db.sh)"
  - "Structured DerogRule (SC#2) lives in agency_rule rows with rule_kind='derog_seasoning' and structured rule_body — single-table query SELECT * FROM agency_rule WHERE rule_kind='derog_seasoning' AND rule_body->>'event_type'='FORECLOSURE' (partial expression idx in Plan 02-06)"
  - "agency_rule reuses the ruleKind pgEnum from program-rule.ts — Drizzle's pgEnum() with the same name produces a single Postgres ENUM type at generate time"
  - "lender_overlay_rule ships at Phase 2 EVEN though no UI populates it (D-07; Pitfall 4.1 — schema instability cascades). Phase 12 LOV-01..03 brings the brokerage-author UI later"
  - "lender_overlay_rule.applies_to_program_id is NULLABLE — NULL means 'applies to all programs at this brokerage tenant'. Useful for blanket overlays like '720+ FICO regardless of investor floor'"
  - "Self-FK on agency_rule_version.superseded_by uses Drizzle's lazy callback with `references((): AnyPgColumn => agencyRuleVersion.id)` (typed forward reference); Phase 3 cascade trigger walks this + program_version.agency_rule_version_id"

patterns-established:
  - "System-owned table pattern: NO tenant_id; two pgPolicy declarations (one for SELECT to public, one for ALL to system_role) per RESEARCH §Pattern 2; Pitfall E avoidance (separate write policy keeps the public read policy from also opening writes)"
  - "Reuse Drizzle pgEnum across tables by importing from the source file — single Postgres ENUM type, single TypeScript binding"
  - "Self-FK declaration: `references((): AnyPgColumn => tableName.id)` (typed forward reference; AnyPgColumn from drizzle-orm/pg-core)"

requirements-completed: [SCH-01, SCH-02, SCH-04, SCH-05, SCH-09, SCH-10, SCH-13]

duration: ~10min
completed: 2026-04-30
---

# Phase 02 Plan 03: Agency-Side Schema (agency_rule_version / agency_rule / lender_overlay_rule)

**3 tables landed: 2 system-owned (agency_rule_version + agency_rule with two-policy world_read+system_role-write) and 1 tenant-scoped (lender_overlay_rule with canonical RLS). Plan 02-02's program_rule pgEnum reused across both agency_rule and lender_overlay_rule — single Postgres ENUM type at migration generate time.**

## What Was Built

- **agency_rule_version** — system-owned versioned snapshot (no tenant_id). Columns: id, agency text NOT NULL (CHECK in Plan 02-06), version_label, source_url NULL, source_pdf_sha256 NULL, effective_period daterange NOT NULL, recorded_at timestamptz default now NOT NULL, superseded_by uuid NULL self-FK. agency_idx for cascade query. Two policies: world_read (`for: 'select', to: 'public', using: true`) + system_write (`for: 'all', to: systemRole, using/withCheck: true`).
- **agency_rule** — system-owned rule rows (no tenant_id, no layer column — AGENCY_BASE implicit). Reused `ruleKind` pgEnum from program-rule.ts. rule_body jsonb NOT NULL; field_confidence jsonb DEFAULT '{}'; primary_citation_id NOT NULL FK to rule_citation (citation discipline applies to agency rules — every hand-authored row cites the FNMA Selling Guide / FHLMC §5202.5 / HUD 4000.1 / VA Pamphlet 26-7 URL). (agency_rule_version_id, rule_kind) idx for evaluator + cascade query patterns. Same two-policy shape as agency_rule_version.
- **lender_overlay_rule** — tenant-scoped (RLS), no layer column (LENDER_OVERLAY implicit). applies_to_program_id NULLABLE FK to program (NULL = "all programs at brokerage"). Reused ruleKind. rule_body jsonb NOT NULL; field_confidence jsonb DEFAULT '{}'; primary_citation_id NOT NULL FK. lender_overlay_rule_tenant_idx + canonical pgPolicy with current_setting('app.tenant_id', true)::uuid.
- **db/schema/index.ts** — barrel extended with all 9 Phase 2 modules: tenant, canary, rule-citation, program, program-version, program-rule, agency-rule-version, agency-rule, lender-overlay-rule, system-role.

## Verification

- `pnpm typecheck` exits 0 (entire db/schema/ compiles clean)
- All acceptance-criteria greps pass for the 3 new tables
- Drizzle pgEnum reuse verified: program_rule, agency_rule, lender_overlay_rule all reference the same ruleKind pgEnum

## Cross-Plan Wiring

| From | To | Via |
|------|-----|-----|
| `agency_rule_version.superseded_by` | `agency_rule_version.id` | Self-FK; Phase 3 AGY-08 cascade trigger walks this |
| `agency_rule.agency_rule_version_id` | `agency_rule_version.id` | NOT NULL FK |
| `agency_rule.primary_citation_id` | `rule_citation.id` (Plan 02-02) | NOT NULL FK |
| `agency_rule.ruleKind` | `program_rule.ruleKind` (Plan 02-02) | Same Postgres ENUM type |
| `lender_overlay_rule.applies_to_program_id` | `program.id` (Plan 02-02) | NULLABLE FK |
| `agency_rule_version`, `agency_rule` policies | `system_role` (Plan 02-01) | `to: systemRole` clause |
| Phase 2 `agency_rule.rule_kind='derog_seasoning'` row body | `derogSeasoningSchema` Zod (Plan 02-01) | parseRuleBody dispatch |

## Notes

The structured DerogRule shape (Phase 2 SC#2 keystone) lives in `agency_rule` rows with `rule_kind='derog_seasoning'`. The Zod schema at `lib/rules/schemas/derog-seasoning.ts` validates the body shape; Plan 02-08 derog-rule-roundtrip.test.ts inserts the FNMA fixture (Plan 02-04) into agency_rule via Drizzle and asserts the round-trip preserves `post_event_LTV_caps[0].max_LTV=90` + `purposeAllowList` + `occupancyAllowList` after a SELECT by `rule_body->>'event_type'='FORECLOSURE'`.
