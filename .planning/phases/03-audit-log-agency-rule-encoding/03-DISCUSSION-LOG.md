# Phase 3: Audit Log + Agency Rule Encoding - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-04
**Phase:** 03-audit-log-agency-rule-encoding
**Areas discussed:** Audit log mechanics, Agency hand-authoring, Cascade with no Inngest, FHFA loan limits

---

## Audit log mechanics

### Q1: Partitioning approach

| Option | Description | Selected |
|--------|-------------|----------|
| Native declarative + pg_cron auto-create | Native PARTITION BY RANGE; SQL function + pg_cron job creates next month. 6 forward partitions seeded inline. | ✓ |
| Native declarative + manual partition migrations | Same native partitioning, no auto-create — each new partition is a new --custom migration. | |
| pg_partman extension | Battle-tested partition manager. Adds runtime extension dependency. | |

**User's choice:** Native declarative + pg_cron auto-create
**Notes:** Pure-Postgres. pg_cron may need Phase 6 migration to Supabase scheduler if managed-tier compatibility forces it (flagged in CONTEXT.md specifics).

### Q2: REVOKE scope

| Option | Description | Selected |
|--------|-------------|----------|
| REVOKE from app_user + PUBLIC + system_role | Maximalist. Only postgres superuser can mutate. Future authenticated role inherits PUBLIC. | ✓ |
| REVOKE from app_user only | Narrowest; system_role still has UPDATE/DELETE. Lesser defensibility. | |
| REVOKE from PUBLIC + GRANT INSERT to app_user only | Inverse posture; symmetric with Phase 2 agency tables. | |

**User's choice:** REVOKE from app_user + PUBLIC + system_role
**Notes:** Strongest tampering posture. Picks legal-defensibility over operational convenience.

### Q3: scenario_payload storage

| Option | Description | Selected |
|--------|-------------|----------|
| scenario_payload jsonb + scenario_hash text (Recommended) | Both. Single-row replay + dedup/integrity hash. PII trade-off accepted. | ✓ |
| scenario_hash only; payload deferred to Phase 9 saved_scenario | Hash-only; replay JOINs future saved_scenario. | |
| scenario_payload only, no hash | Simplest; loses content-addressed dedup. | |

**User's choice:** scenario_payload jsonb + scenario_hash text
**Notes:** RLS scopes per-tenant; Phase 6 layers egress redaction. Matches research §Pattern 5 verbatim.

### Q4: ruleset_snapshot_id derivation owner

| Option | Description | Selected |
|--------|-------------|----------|
| Ship lib/audit/snapshotId.ts now + golden round-trip test (Recommended) | ~30 LOC TS helper + deterministic-output test. Phase 4 imports. | ✓ |
| Ship column only; defer derivation to Phase 4 | Lighter Phase 3; defers locking the canonical hash format. | |
| Ship helper + Phase 3 backfill on hand-authored agency rows | Helper + one-shot test event written via the Phase 3 seed. | |

**User's choice:** Ship lib/audit/snapshotId.ts now + golden round-trip test
**Notes:** Mirrors Phase 1 D-11 setTenantContext-before-Phase-6 pattern. Locks the contract early.

---

## Agency hand-authoring

### Q1: Storage approach

| Option | Description | Selected |
|--------|-------------|----------|
| TypeScript fixtures + idempotent loader script (Recommended) | TS objects validated by Zod dispatch table at compile time; tsx loader. | ✓ |
| SQL --custom seed migration per agency | Hand-typed INSERTs in numbered migrations. | |
| JSON fixtures + generic loader | JSON files parsed by shared loader. | |

**User's choice:** TypeScript fixtures + idempotent loader script
**Notes:** Compile-time Zod validation against existing dispatch table is the unique benefit.

### Q2: Seed runtime

| Option | Description | Selected |
|--------|-------------|----------|
| pnpm db:seed + CI step + global-setup chain (Recommended) | Seed runs after migrate in CI + tests/rls + tests/schema. | ✓ |
| --custom migration calls the seed loader inline | TS↔SQL synchronization fragile. | |
| Manual/optional only — tests use local fixtures, seed is for prod | Risks Phase 8 commit pre-checks failing locally. | |

**User's choice:** pnpm db:seed + CI step + global-setup chain
**Notes:** Single source of truth; loader gets test coverage.

### Q3: Citation shape

| Option | Description | Selected |
|--------|-------------|----------|
| URL + section anchor + excerpt for all four; bbox/page NULL (Recommended) | Hand-authored = URL; extracted (Phase 7) = PDF+bbox. Clean separation. | ✓ |
| PDF (sha256+page+bbox) + excerpt for the PDFs; URL-only for HTML guides | Mix posture; archived PDFs for HUD/VA. | |
| URL + section + excerpt + sha256 of the excerpt | Maximalist; new excerpt_sha256 column. | |

**User's choice:** URL + section anchor + excerpt for all four; bbox/page NULL
**Notes:** Phase 2 D-03 CHECK already accepts URL-only path.

### Q4: Test posture

| Option | Description | Selected |
|--------|-------------|----------|
| Per-rule structural assertions + golden replay (Recommended) | One test per SC#3 line + per-agency snapshot hash. | ✓ |
| Snapshot tests only | Doesn't directly assert SC#3 line items. | |
| SC#3 acceptance scenarios only | Requires Phase 4 evaluator that doesn't exist. | |

**User's choice:** Per-rule structural assertions + golden replay
**Notes:** Combines line-item assertions with regression-detection snapshot.

### Q5: PR chunking

| Option | Description | Selected |
|--------|-------------|----------|
| One PR per agency (4) + audit log + cascade + FHFA (Recommended) | Each agency PR cohesive; audit log lands first. | ✓ |
| One mega-PR for all hand-authoring + separate PRs for audit/cascade/FHFA | Big diff; defensible solo-dev. | |
| One PR per success criterion | SC#3 still bundles full FNMA matrix. | |

**User's choice:** One PR per agency (4 PRs) + audit log + cascade + FHFA separately
**Notes:** Maps to plan waves; reviewable chunks.

### Q6: agency_rule_version effective_period bracket

| Option | Description | Selected |
|--------|-------------|----------|
| Open-ended `[2026-01-01,infinity)` (Recommended) | Future updates close upper bound + insert new. | ✓ |
| Closed window `[2026-01-01,2026-12-31)` | Defeats bitemporal versioning. | |
| Source-document-effective bracket | Heavier research lift per agency. | |

**User's choice:** Open-ended `[2026-01-01,infinity)`
**Notes:** Postgres daterange supports `infinity` literal.

### Q7: Per-agency scope

| Option | Description | Selected |
|--------|-------------|----------|
| Full derog parity FNMA/FHLMC/FHA/VA + USDA stub (Recommended) | All four agencies get full event-type rows; USDA = version row only. | ✓ |
| FNMA full + FHA full + FHLMC/VA minimum-viable + USDA stub | Cuts hand-authoring ~40%. | |
| FNMA full + FHA full only; FHLMC/VA/USDA stubs | Risks Phase 4/5 rework. | |

**User's choice:** Full derog parity FNMA/FHLMC/FHA/VA + USDA stub
**Notes:** Phase 5 golden set will need this depth.

### Q8: USDA stub content

| Option | Description | Selected |
|--------|-------------|----------|
| agency_rule_version row only, zero agency_rule rows (Recommended) | Stub by version registry only; Phase 12 hand-authors rules. | ✓ |
| One placeholder agency_rule with TODO marker | Risk of placeholder leaking into evaluator. | |
| Skip USDA entirely | Violates AGY-01. | |

**User's choice:** agency_rule_version row only, zero agency_rule rows
**Notes:** Cleanest; satisfies AGY-01 without false data.

### Q9: version_label naming

| Option | Description | Selected |
|--------|-------------|----------|
| Agency-document-id format (FNMA-SEL-2026-04, ...) (Recommended) | Self-documenting; matches each agency's publication identifier. | ✓ |
| Sequential v1/v2/v3 per agency | Loses traceability. | |
| ISO date format | Redundant with effective_period. | |

**User's choice:** Agency-document-id format
**Notes:** Phase 7 cascade poller writes the same shape.

---

## Cascade with no Inngest

### Q1: Trigger strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Postgres trigger writes rows to cascade_review_queue table (Recommended) | Pure-Postgres; testable; survives Phase 6 swap. | ✓ |
| Postgres trigger calls pg_notify | Fire-and-forget; events lost if no listener. | |
| Defer trigger entirely until Phase 6 | Violates Phase 3 SC#5. | |

**User's choice:** Postgres trigger writes rows to cascade_review_queue table
**Notes:** Phase 6 Inngest worker reads from the table without schema churn.

### Q2: Queue tenant scoping

| Option | Description | Selected |
|--------|-------------|----------|
| Tenant-scoped + RLS + FORCE; trigger writes tenant_id from program_version (Recommended) | Per-tenant AM queue isolation; matches Phase 2 D-19. | ✓ |
| System-owned + per-row tenant_id but no RLS | Loses RLS-as-perimeter. | |
| Tenant-scoped + FORCE + SECURITY DEFINER trigger | Strongest but DEFINER audit risk. | |

**User's choice:** Tenant-scoped + RLS + FORCE; trigger writes tenant_id from program_version
**Notes:** Two-policy shape (tenant_isolation + system_write) lets trigger insert across tenants while AM reads stay scoped.

### Q3: Affected program_version resolution

| Option | Description | Selected |
|--------|-------------|----------|
| Two-step: caller UPDATEs prior.superseded_by=NEW.id BEFORE insert; trigger JOINs (Recommended) | Explicit successor-marking; matches research §Cascade Trigger. | ✓ |
| Trigger derives prior version via daterange logic | Adds complexity to hot trigger path. | |
| Trigger receives prior_id via session GUC | New GUC contract; less discoverable. | |

**User's choice:** Two-step (UPDATE prior + INSERT new); trigger JOINs program_version on prior.id
**Notes:** Convention extends to Phase 7+ poller and any hand-authored update.

### Q4: Cron poller scope

| Option | Description | Selected |
|--------|-------------|----------|
| Stub the handler shape only at lib/cascade/poll.ts + integration test of trigger path (Recommended) | Typed signature; integration test simulates new-version insert. | ✓ |
| Full poller with HTTP fetch + sha256-diff + standalone CLI | Scope creep; Phase 6 swap may force rewrite. | |
| Stub interface + agency_publication_source table for URLs/sha256 cache | Adds table with no Phase 3 writers. | |

**User's choice:** Stub the handler shape only + integration test of trigger path
**Notes:** Satisfies Phase 3 SC#5 ("verified via integration test"). Phase 6 lands real HTTP fetch.

### Q5: Queue column shape

| Option | Description | Selected |
|--------|-------------|----------|
| Full row + status enum + claimed_at/_by + completed_at (Recommended) | SKIP LOCKED-ready; AM UI inbox + history filterable. | ✓ |
| Minimal: ids + created_at only | Schema churn at Phase 6. | |
| Full row + retention column (purge_at) | Over-design at Phase 3. | |

**User's choice:** Full row schema with status enum
**Notes:** Phase 6 worker uses `UPDATE ... WHERE status='pending'` with SKIP LOCKED.

### Q6: Retention

| Option | Description | Selected |
|--------|-------------|----------|
| Keep forever; Phase 13+ revisits (Recommended) | Low volume at Phase 1 scale. | ✓ |
| Delete completed rows after 90 days | Loses cascade audit trail. | |
| Archive completed rows to cold partition after 30 days | Operational complexity for low-volume table. | |

**User's choice:** Keep forever; revisit Phase 13+
**Notes:** Matches audit-log keep-forever posture.

---

## FHFA loan limits

### Q1: Table shape

| Option | Description | Selected |
|--------|-------------|----------|
| Two-table split: conforming_loan_limit_version + conforming_loan_limit_county (Recommended) | Mirrors agency_rule_version + agency_rule pattern. | ✓ |
| Single denormalized table | Loses bitemporal pattern. | |
| Limits stored as agency_rule rows under FHFA agency | Overloads agency_rule.rule_body. | |

**User's choice:** Two-table split
**Notes:** ~3,200 counties × 4 unit-tiers × (baseline,high-balance) = 25,600 rows per year.

### Q2: Data sourcing

| Option | Description | Selected |
|--------|-------------|----------|
| Commit FHFA CSV to repo + TS loader parses + INSERTs (Recommended) | Source-of-truth in git; per-row Zod validation possible. | ✓ |
| Hand-typed TS fixture | Error-prone for 3,200 counties. | |
| Live fetch from FHFA at seed time | Network dependency; CI flakiness. | |

**User's choice:** Commit FHFA CSV to repo + TS loader
**Notes:** Annual update = download new CSV + commit + re-run.

### Q3: program_version FK shape

| Option | Description | Selected |
|--------|-------------|----------|
| Optional FK on program_version (conforming_loan_limit_version_id NULL) (Recommended) | Conforming programs set; non-QM/jumbo leave NULL. | ✓ |
| Lookup at evaluation time by year only — no FK | Loses replay determinism. | |
| FK on program_rule | Redundancy + drift risk. | |

**User's choice:** Optional FK on program_version
**Notes:** One-column delta to existing Phase 2 program_version table.

### Q4: Annual update path

| Option | Description | Selected |
|--------|-------------|----------|
| Annual update is a manual seed run — same loader, new CSV, two-step daterange close (Recommended) | Documented in lib/agency-seeds/fhfa/README.md. | ✓ |
| Plug FHFA into the agency cascade poller | Overloads cascade trigger; Phase 3 scope creep. | |
| Hardcode the annual rotation in CI (Nov reminder) | Not testable; relies on human ops. | |

**User's choice:** Manual seed run with two-step daterange close
**Notes:** No automation at Phase 3; FHFA-as-cascade-poller-source is Phase 6+ scope.

---

## Claude's Discretion

Captured in CONTEXT.md `<decisions>` §"Claude's Discretion":
- pg_cron job naming + schedule cadence
- evaluator_version text source format on evaluation_event
- snapshot_id encoding (hex vs base64url)
- cascade_review_queue index strategy beyond mandatory tenant_id+status+created_at
- Whether the 6 forward partitions land as inline SQL or repeated function calls
- Whether to refactor SYSTEM-tenant + agency-fixture-bootstrap helpers (02-CONCERNS.md WR-05)
- FHFA CSV parser dep choice (csv-parse vs hand-rolled)

## Deferred Ideas

Captured in CONTEXT.md `<deferred>` section. 18 items spanning Phases 4–14+ including: Vercel Cron + Inngest worker (Phase 6), real HTTP scraping (Phase 7), saved-scenario alerting (Phase 14 v3), evaluation_event cold-archive (Phase 13+), USDA full encoding (Phase 12), HFA/CES/HELOC/construction programs (Phase 12), LENDER_OVERLAY UI (Phase 12), pricing tables (Phase 13), Phase 8 AM commit detect_loosenings call site, lib/eval/ evaluator (Phase 4), library-vs-custom spike (Phase 4), 200-scenario golden set (Phase 5), Reducto extraction (Phase 7), agency_publication_source caching table (Phase 6 alongside real poller).
