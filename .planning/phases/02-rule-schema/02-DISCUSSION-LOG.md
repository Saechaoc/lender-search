# Phase 2: Rule Schema - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents. Decisions are captured in `02-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-30
**Phase:** 02-rule-schema
**Mode:** Claude-recommended (user said "go with all of your recommendations" after gray-area presentation; Claude picked the recommended option for every area)
**Areas discussed:** Citation FK enforcement, Layer storage shape, rule_body validation strictness, Loosening rejection enforcement

---

## Citation FK enforcement (SCH-13)

| Option | Description | Selected |
|--------|-------------|----------|
| NOT NULL FK to citation row (1:1 mandatory primary) | `program_rule.primary_citation_id NOT NULL REFERENCES rule_citation(id)`; insert order is citation-then-rule within a single transaction; standard FK constraint, no triggers | ✓ |
| BEFORE INSERT/UPDATE trigger | Trigger checks for ≥1 `rule_citation` row before allowing insert | |
| DEFERRABLE constraint with citation-first ordering | Constraint check fires at COMMIT; insert order flexible inside the transaction | |
| Application-layer enforcement via shared insert helper | TS helper always co-inserts both rows; no DB-level guarantee | |

**Rationale for choice:** Standard FK is the simplest mechanism that makes "rule without citation" structurally impossible. bbox/textSpan substantive validation belongs in Phase 7 extraction (`Conventions §`). Triggers add complexity for marginal ergonomics; deferrable constraints are useful when insert order must be flexible across batch operations, but Phase 7's extraction pipeline already writes citation-then-rule per row in a single transaction, so the simpler NOT NULL FK suffices. Multi-page citations (1:N) live as additional `rule_citation` rows with optional `secondary_for_rule_id` back-pointer.

---

## Layer storage shape

| Option | Description | Selected |
|--------|-------------|----------|
| 3-table split (per ARCHITECTURE.md sketch) | `agency_rule` (system, AGENCY_BASE) + `program_rule` (tenant, INVESTOR_OVERLAY/PRODUCT_FEATURE) + `lender_overlay_rule` (tenant, LENDER_OVERLAY, cross-program cardinality) | ✓ |
| Single `program_rule` with 4-layer enum | All four layers in one table; AGENCY_BASE rows have NULL `tenant_id` | |
| Per-layer split (4 separate tables) | One table per layer; UNION at evaluator | |
| Defer `lender_overlay_rule` to Phase 12 | Phase 2 ships only `agency_rule` + `program_rule`; brokerage overlay table added when UI lands | |

**Rationale for choice:** PRD §Architecture explicitly sketches the 3-table split. `LENDER_OVERLAY`'s cross-program cardinality (one overlay applies to all programs at the brokerage tenant) makes a separate table the right shape — putting it in `program_rule` would force copying the overlay across every program_version row (Anti-Pattern 1: embedding). Single `program_rule` with NULL tenant_id for AGENCY_BASE conflates system-owned and tenant-owned data and forecloses the `system_role` cross-tenant policy pattern. Per-layer split fragments rule-stack assembly. Deferring `lender_overlay_rule` to Phase 12 means a schema change after Phase 4 evaluator hardens — Pitfall 4.1 is exactly this kind of cascading rework.

---

## rule_body validation strictness

| Option | Description | Selected |
|--------|-------------|----------|
| Open jsonb + Zod-only at app layer | DB stores any jsonb; validation runs in TS at every write boundary | |
| Per-kind CHECK constraints (`jsonb_path_exists`) | DB enforces shape per `rule_kind` via CHECK constraints | |
| Polymorphic per-kind sub-tables | One table per `rule_kind` (`program_rule_ltv`, `program_rule_fico`, etc.); evaluator UNIONs | |
| Hybrid: Drizzle discriminated union + per-kind Zod schemas + light DB sanity checks | jsonb body + `rule_kind` enum + Zod schemas at `lib/rules/schemas/<kind>.ts`; DB checks NOT NULL + `jsonb_typeof = 'object'` + `rule_kind IN (enum)` | ✓ |

**Rationale for choice:** Per-kind CHECK constraints with `jsonb_path_exists` churn with every kind shape change and are clunky to migrate (each shape rev = a CHECK migration). Polymorphic per-kind sub-tables explode cardinality (10+ kinds at Phase 2) and forecloses kind extensions (every new kind = new table + evaluator UNION update). Open jsonb violates the "release-blocker" discipline implied by SCH-13's analog for body shape (a hallucinated rule_kind body could land if extraction bugs). The hybrid balances rigor with maintainability — per-kind validation lives in shared TS Zod schemas consumed by Phase 7 extraction validator (write path), Phase 8 AM commit (final validation), and Phase 4 evaluator (read path). Adding a new `rule_kind` is a 2-file change: enum migration + Zod schema in same PR.

Per-field confidence (SCH-10): sibling `field_confidence jsonb` column with a STORED generated `min_confidence numeric` for queue-sort path (mirrors ARCHITECTURE.md §Pattern 4 — Phase 7 staging table reuses the shape).

---

## Loosening rejection enforcement (SCH-03 + Phase 2 SC#4)

| Option | Description | Selected |
|--------|-------------|----------|
| BEFORE INSERT/UPDATE trigger that REJECTS | Hard fail at write time on detected loosening | |
| SQL function `detect_loosenings()` returning violations | Function callable from tests now; Phase 8 AM commit transaction wires it as a pre-commit gate | ✓ |
| TS validator only (defer hard rejection to Phase 8 AM) | No DB-level mechanism; pure application validation | |
| DB CHECK referencing related AGENCY_BASE via subquery | Postgres CHECK constraints can't reference other tables — not viable | |

**Rationale for choice:** SCH-03 says "surfaces them as data-quality errors during AM review" — meaning AM-time UX surfacing, not write-time hard rejection. A BEFORE trigger would block legitimate extraction-draft rows (which may temporarily contain detected loosenings before AM review). The SQL function is composable: Phase 2 tests assert detection works on a constructed loosening; Phase 8 AM commit transaction calls it pre-commit and blocks if non-empty. Phase 4 evaluator can also call it for diagnostic surfacing if needed. DB CHECK with subquery isn't supported in Postgres (CHECK constraints are limited to the row's own columns). TS-only validation lacks structural enforcement.

Comparison rules baked into the function (D-14 in CONTEXT.md): max-LTV/DTI overlays must be ≤ agency; min-FICO/reserves overlays must be ≥ agency; derog seasoning waiting months must be ≥ agency; allow-list arrays must be subsets of agency.

---

## Claude's Discretion

User said "go with all of your recommendations" — Claude exercised discretion across all four gray areas plus ancillary decisions:

- Exact column-name conventions on new tables (snake_case mirroring Phase 1)
- Whether `derog_rule` is a separate table or rows in `agency_rule` with `rule_kind = 'derog_seasoning'` — leaning toward rows in `agency_rule` to keep table count down (structured derog body in jsonb with shared Zod schema)
- Index design beyond mandatory `tenant_id` indexes — pick what supports rule-stack assembly + cascade-trigger query patterns
- Drizzle column type choices where multiple options work (`text` vs `varchar`, `numeric` precision, etc.)
- Whether to ship a single seed `agency_rule_version` + `agency_rule` row to demonstrate Phase 2 SC#2 in tests OR rely on test fixtures only — pick whichever minimizes Phase 3 hand-authoring rework
- Whether `system_role` is a Postgres role or a sentinel zero-uuid `tenant_id` for agency-table cross-tenant readability — pick whichever is cleanest with Drizzle 0.45's `pgPolicy()` modeling

---

## Deferred Ideas

(See `02-CONTEXT.md` `<deferred>` section for the full list.)

- Hand-authored FNMA/FHLMC/FHA/VA agency content → Phase 3
- Append-only `evaluation_event` audit log → Phase 3
- Daily agency-source poll + cascade trigger fan-out → Phase 3
- Pure-TS evaluator → Phase 4
- Library-vs-custom evaluator spike → Phase 4
- `pgvector` embedding on `rule_citation` → Phase 7
- `staging.*` schema + extraction pipeline → Phase 7
- AM commit transaction wiring of `detect_loosenings()` → Phase 8
- AM three-pane UI + lifecycle-state transition enforcement → Phase 8
- License gate on `program_version` commit → Phase 8
- Brokerage `LENDER_OVERLAY` author UI → Phase 12
- 2026 FHFA conforming loan limits + high-balance overlay → Phase 3
- Live-pricing tables → Phase 13
- Per-MI-provider overlay matching → Phase 13
- Saved-scenario re-evaluation alerting → Phase 14
