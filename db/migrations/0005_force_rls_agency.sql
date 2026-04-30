-- Phase 2 / Plan 02-05 Task 3: FORCE on lender_overlay_rule + GRANTs on agency tables.
--
-- lender_overlay_rule IS tenant-scoped (Plan 02-03 D-05); FORCE closes the
-- table-owner-bypass window. Cross-tenant overlay visibility is a release-
-- blocker (PROJECT.md Out of Scope; Pitfall 3.5).
--
-- agency_rule_version + agency_rule are NOT tenant-scoped (Plan 02-03 D-05).
-- Their policies are:
--   *_world_read (FOR SELECT TO public USING true): every authenticated tenant
--                                                    can SELECT
--   *_system_write (FOR ALL TO system_role USING/WITH CHECK true): only
--                                                    system_role writes
-- FORCE would only matter if the table owner (postgres) tried to bypass — but
-- the world_read policy permits SELECT regardless. We OMIT FORCE on the agency
-- tables to keep the policy semantics simple. Plan 02-09 pen test asserts that
-- a public INSERT on agency_rule fails (Pitfall E).
--
-- GRANT block: app_user needs DML on lender_overlay_rule (per its policy);
-- app_user needs SELECT on agency_rule_version + agency_rule (per the
-- world_read policy; GRANT is a Postgres-level prerequisite even when the
-- policy permits the operation).

ALTER TABLE "lender_overlay_rule" FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "lender_overlay_rule" TO app_user;

GRANT SELECT ON TABLE "agency_rule_version" TO app_user;
GRANT SELECT ON TABLE "agency_rule" TO app_user;
