---
phase: 02-rule-schema
plan: 02
subsystem: database
tags: [drizzle, postgres, schema, rls, citation, bitemporal]

requires:
  - phase: 02-rule-schema/01
    provides: daterange customType, system_role pgRole, lib/rules/schemas/ Zod dispatch (rule_kind values that program_rule pgEnum mirrors)

provides:
  - db/schema/rule-citation.ts (page+bbox+excerpt with secondary_for_rule_id back-pointer for D-02 multi-citation case; tenant-scoped + RLS)
  - db/schema/program.ts (parent table for indexed lender programs; tenant-scoped + RLS)
  - db/schema/program-version.ts (bitemporal effective_period daterange + state + source_document_fingerprint NOT NULL + agency_rule_version_id FK + SCH-11 allow/deny arrays + SCH-12 geo scaffolding; tenant-scoped + RLS + tenant_idx + agency_rule_version_idx)
  - db/schema/program-rule.ts (SCH-01 + SCH-13 keystone — layer pgEnum constrained to ('INVESTOR_OVERLAY','PRODUCT_FEATURE') per D-05; rule_kind pgEnum 17 values matching lib/rules/schemas/index.ts ruleKinds verbatim; rule_body jsonb NOT NULL; field_confidence DEFAULT '{}'; primary_citation_id NOT NULL FK to rule_citation; extraction_run_id nullable plain column for SCH-14; composite (program_version_id, layer, rule_kind) idx for Phase 4 evaluator)

affects: [02-03, 02-05, 02-06, 02-07, 02-08, 02-09, phase 04 evaluator, phase 07 extraction, phase 08 AM commit, phase 12 LOV]

tech-stack:
  added: []
  patterns: [Drizzle pgEnum reuse across tables (single Postgres ENUM type), NodeNext .js extensions on FK lazy callbacks, composite multi-column index for evaluator hot path]

key-files:
  created:
    - db/schema/rule-citation.ts
    - db/schema/program.ts
    - db/schema/program-version.ts
    - db/schema/program-rule.ts

key-decisions:
  - "rule_citation is tenant-scoped (D-03) — citation rows belong to the tenant that uploaded the source document. Hand-authored agency citations (Phase 3) land under a system tenant once that's wired"
  - "primary_citation_id NOT NULL FK is the structural enforcement of SCH-13 (citation discipline release-blocker per Pitfall 2.8); insert order is citation-then-rule per Pitfall F"
  - "program_rule.layer enum has EXACTLY 2 values (INVESTOR_OVERLAY + PRODUCT_FEATURE) — AGENCY_BASE lives in agency_rule (no layer column there); LENDER_OVERLAY lives in lender_overlay_rule (no layer column there). Anti-Pattern 1 avoided"
  - "rule_kind pgEnum mirrors lib/rules/schemas/index.ts ruleKinds tuple verbatim in same order — adding a kind requires Drizzle migration AND matching Zod schema in the same PR"
  - "Composite (program_version_id, layer, rule_kind) idx ships at Phase 2 to support Phase 4 evaluator's rule-stack assembly query path"

patterns-established:
  - "Tenant-scoped schema files follow Phase 1 D-06 pattern: tenant_id NOT NULL FK + tenant_idx + canonical pgPolicy with current_setting('app.tenant_id', true)::uuid"
  - "Bitemporal table pattern: effective_period daterange + state text + recorded_at timestamptz; EXCLUDE constraint declared via --custom migration (Drizzle 0.45 doesn't model EXCLUDE natively)"
  - "Per-row jsonb body + field_confidence sibling jsonb + STORED min_confidence (computed via IMMUTABLE wrapper in Plan 02-06) — write boundary validates body via Zod dispatch table"

requirements-completed: [SCH-01, SCH-02, SCH-09, SCH-10, SCH-11, SCH-12, SCH-13, SCH-14]

duration: ~12min
completed: 2026-04-30
---

# Phase 02 Plan 02: Tenant-Scoped Phase 2 Schema (program / program_version / program_rule / rule_citation)

**4 tenant-scoped tables landed at full D-15 / D-01 / D-05 / D-09 / D-10 / SCH-09 / SCH-11 / SCH-12 / SCH-13 / SCH-14 fidelity. Drizzle pgPolicy + pgEnum declarations ship in TS; FORCE RLS + EXCLUDE + jsonb_typeof CHECKs + min_confidence STORED column land in Plan 02-06 --custom migrations.**

## What Was Built

- **rule_citation** — page + bbox + excerpt with NULL-safe source pointers (source_pdf_sha256 nullable for hand-authored agency citations; source_url nullable for extracted-with-PDF-only). Optional `secondary_for_rule_id` back-pointer for D-02 multi-citation case. Tenant-scoped + RLS policy.
- **program** — small parent table (id + tenant_id + lender + channel + name + timestamps). Tenant-scoped + RLS.
- **program_version** — bitemporal version body (effective_period daterange NOT NULL; state text NOT NULL — CHECK in Plan 02-06; source_document_fingerprint text NOT NULL; agency_rule_version_id FK + agency_rule_version_idx for Phase 3 cascade trigger query path). Full SCH-11 allow/deny arrays (eligible_/ineligible_ × loan_purposes / property_types / occupancies / doc_types). Full SCH-12 scaffolding (eligible_states/ineligible_states text[]; geo_county_overlay jsonb).
- **program_rule** — SCH-01 + SCH-13 keystone. layer enum strictly ('INVESTOR_OVERLAY','PRODUCT_FEATURE'); rule_kind enum mirrors lib/rules/schemas/index.ts ruleKinds verbatim; rule_body jsonb NOT NULL; field_confidence jsonb DEFAULT '{}'; primary_citation_id NOT NULL FK; extraction_run_id nullable plain column (Phase 7 adds FK); composite (program_version_id, layer, rule_kind) idx.

## Verification

- `pnpm typecheck` exits 0 (after Plan 02-03 lands agency_rule_version, the program-version.ts FK reference resolves)
- All acceptance-criteria file-existence + content greps pass
- Drizzle pgEnum reuse verified: program_rule.ruleKind exports the enum that agency_rule.ts and lender_overlay_rule.ts import (Plan 02-03)

## Cross-Plan Wiring

| From | To | Via |
|------|-----|-----|
| `program_rule.primary_citation_id` | `rule_citation.id` | NOT NULL FK (D-01 / SCH-13) |
| `program_rule.ruleKind` pgEnum | `lib/rules/schemas/index.ts` ruleKinds | Same 17 D-09 values; adding a kind requires both files |
| `program_version.agency_rule_version_id` | `agency_rule_version.id` (Plan 02-03) | NOT NULL FK; Phase 3 cascade trigger seam |
| `program_version.effective_period` | `daterange` customType (Plan 02-01) | Drizzle wrapper |

## Notes

Typecheck passes only when Plan 02-03 also lands (program_version.ts imports `agencyRuleVersion` from agency-rule-version.js, which Plan 02-03 creates). Wave 1 plans 02-02 + 02-03 + 02-04 sequentially executed inline due to db/schema/index.ts overlap between 02-02 and 02-03 — verified at the post-Plan-02-03 typecheck step.
