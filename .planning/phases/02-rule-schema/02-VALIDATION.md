---
phase: 2
slug: rule-schema
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-30
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Phase 2's verification surface is the schema-constraint suite + extended pen-test suite. Every uncovered citation FK, EXCLUDE constraint failure, or `detect_loosenings()` regression is a release-blocker (Phase 2 is the schema keystone — Pitfall 4.1).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.x (`pool: 'forks'` for Postgres connection isolation, inherited from Phase 1) |
| **Config file** | `vitest.config.ts` (Phase 1 default) + `vitest.schema.config.ts` (Phase 2 adds for `tests/schema/` glob, D-21) |
| **Quick run command** | `pnpm test:rls --run --bail=1 && pnpm test:schema --run --bail=1` |
| **Full suite command** | `pnpm test:rls --run && pnpm test:schema --run` |
| **Estimated runtime** | ~12 seconds (5 new tables × cross-tenant matrix + 8 schema-constraint cases + reused Phase 1 canary) |

Driver split (carries forward from Phase 1):
- App / migrations: postgres-js (`postgres@3.4.x`) with `prepare: false`
- Pen tests + schema-constraint tests: node-postgres (`pg@8.20.x`) for transaction-scoped GUC + `system_role` SET ROLE control

New for Phase 2:
- `system_role` Postgres role created in `scripts/init-db.sh` alongside `app_user` (per RESEARCH §"system_role pattern")
- `btree_gist` extension installed at the head of `0004_program_constraints.sql` (required for `EXCLUDE USING gist (program_id WITH =, ...)`)
- `db/schema/_types/daterange.ts` Drizzle `customType` wrapper (Drizzle 0.45 has no native daterange; issue #2647)

---

## Sampling Rate

- **After every task commit:** Run `pnpm test:rls --run --bail=1 && pnpm test:schema --run --bail=1` (locally and in pre-commit if installed)
- **After every plan wave:** Run full suite (`pnpm test:rls --run && pnpm test:schema --run`)
- **Before `/gsd-verify-work`:** Full suite green AND `pnpm drizzle-kit migrate` runs cleanly from a fresh DB AND `psql` introspection confirms `relforcerowsecurity = t` on every new tenant-scoped table
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

> Filled out by the planner during Phase 2 PLAN.md generation. Every task that adds DDL or constraint surface MUST have an automated command. Tasks that only edit Zod schemas at `lib/rules/schemas/` carry grep-verifiable acceptance criteria for the schema's exported type and a unit test asserting the schema parses a known-good payload.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `db/schema/_types/daterange.ts` — Drizzle `customType` wrapper for Postgres `daterange`
- [ ] `vitest.schema.config.ts` — config for `tests/schema/` glob (D-21)
- [ ] `package.json` — add `"test:schema": "vitest run --config vitest.schema.config.ts"`
- [ ] `scripts/init-db.sh` — append `CREATE ROLE system_role NOLOGIN; GRANT SELECT ON ALL TABLES IN SCHEMA public TO system_role;` (system_role pattern per RESEARCH §5)
- [ ] `lib/rules/schemas/` — directory + Zod schemas for the 17 `rule_kind` values (D-09)

*If existing infrastructure covers the rest: rely on Phase 1's `vitest.config.ts` for `tests/rls/` and `tests/env-boot/`.*

---

## Phase 2 Validation Dimensions (Nyquist)

| Dimension | What it verifies | Coverage source |
|-----------|------------------|-----------------|
| **D1: Structural integrity** | Every new migration applies cleanly from a fresh DB; `drizzle-kit migrate` exits 0 | Wave 0 / globalSetup runs migrate; CI step asserts exit code |
| **D2: Constraint correctness** | NOT NULL `primary_citation_id`, `EXCLUDE USING gist` on program_version + agency_rule_version, `rule_citation` source CHECK, `rule_body` jsonb_typeof CHECK | `tests/schema/` cases (D-20 #1–#4, #8) |
| **D3: Function correctness** | `detect_loosenings(program_version_id)` returns expected violation rows for constructed loosenings; returns empty for restrictive overlays | `tests/schema/` case (D-20 #5) |
| **D4: RLS extension correctness** | Every new tenant-scoped table fails closed cross-tenant on SELECT/INSERT/UPDATE/DELETE under app_user | `tests/rls/` extension (D-19); cross-tenant matrix mirrors Phase 1 D-03 |
| **D5: System-role correctness** | `agency_rule` and `agency_rule_version` are readable across tenants only via `system_role`; app_user cannot SELECT agency rows for tenants other than the GUC | `tests/schema/` case (D-20 #7) |
| **D6: DerogRule round-trip** | Insert FNMA post-foreclosure 3-to-7-year derog seasoning rule via Drizzle; query by `event_type='FORECLOSURE'`; assert structured `post_event_LTV_caps[]` returns with `max_LTV: 90`, `purposeAllowList`, `occupancyAllowList`, time bounds | `tests/schema/` case (D-20 #6); satisfies Phase 2 SC#2 |
| **D7: Schema-as-code consistency** | Drizzle schema TS types match generated SQL; pgPolicy declarations land in migration output; `drizzle-kit generate` is deterministic | CI step: `pnpm drizzle-kit generate --custom=false && git diff --exit-code db/migrations/` |
| **D8: Validation coverage** | Every Zod schema at `lib/rules/schemas/<kind>.ts` parses ≥1 known-good payload and rejects ≥1 known-bad payload | Per-schema unit tests at `lib/rules/schemas/__tests__/` |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `psql` introspection of `pg_class.relforcerowsecurity = 't'` on new tenant-scoped tables | TNT-01 carry-forward | Drizzle does not model FORCE; introspection is the canonical proof | After migrate, run `psql -c "SELECT relname, relforcerowsecurity FROM pg_class WHERE relname IN ('program','program_version','program_rule','lender_overlay_rule','rule_citation') AND relforcerowsecurity = 't'"` and assert 5 rows |
| `psql` introspection of `system_role` policy on `agency_rule` | RESEARCH §5 | Drizzle pgPolicy `to: pgRole` syntax is new; introspection confirms policy lands | `psql -c "\d agency_rule"` shows policy `to system_role` |

*All other Phase 2 behaviors have automated verification via `tests/schema/` and `tests/rls/`.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (`daterange` customType, `system_role` role bootstrap, `vitest.schema.config.ts`, `lib/rules/schemas/` directory)
- [ ] No watch-mode flags (Vitest `--run` only — Phase 1 carry-forward)
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
