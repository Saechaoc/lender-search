-- Phase 3 review WR-08: backfill FORCE ROW LEVEL SECURITY on tables that
-- enabled RLS via Drizzle pgPolicy() declarations but never got the
-- follow-up FORCE migration.
--
-- Tables affected:
--   - agency_rule (system-owned, world-read + system_write — declared in
--     Plan 02-03; FORCE was missed in 0005 follow-up)
--   - agency_rule_version (system-owned, same shape; FORCE was missed in
--     0005 follow-up)
--   - conforming_loan_limit_version (Phase 3, world-read + system_write;
--     0011 added the table but not FORCE)
--   - conforming_loan_limit_county (same)
--
-- Why it matters: ENABLE ROW LEVEL SECURITY does not enforce policies on
-- the table OWNER (postgres) — only FORCE ROW LEVEL SECURITY closes the
-- owner-bypass loophole. Without FORCE, a query against agency_rule
-- through a postgres-owned connection (the migration role, the loader,
-- pen-test fixtures) silently returns rows that wouldn't have been
-- visible under the policy. The existing FORCE coverage on the rest of
-- the application schema (tenant, program, program_version, program_rule,
-- rule_citation, lender_overlay_rule, evaluation_event, cascade_review_queue,
-- rule_snapshot) made this gap easy to miss until the WR-08 CI assertion
-- caught it.
--
-- The CI assertion is in tests/schema/rls-force-everywhere.test.ts. It
-- queries pg_class for `relrowsecurity AND NOT relforcerowsecurity` and
-- fails when any application table is in that state.

ALTER TABLE agency_rule_version FORCE ROW LEVEL SECURITY;
ALTER TABLE agency_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE conforming_loan_limit_version FORCE ROW LEVEL SECURITY;
ALTER TABLE conforming_loan_limit_county FORCE ROW LEVEL SECURITY;
