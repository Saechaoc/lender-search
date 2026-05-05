-- Phase 2 / Plan 02-05 Task 2: FORCE RLS on the four new program-side tenant-scoped tables.
--
-- Drizzle 0.45's schema API does not model FORCE ROW LEVEL SECURITY (Plan 01-05
-- / Pitfall 2). FORCE makes the table owner (the migration role, typically
-- the `postgres` superuser locally) subject to RLS policies. Without FORCE,
-- the owner bypasses RLS silently — pen tests passing as a non-owner catch
-- nothing while admin scripts running as the owner exfiltrate data.
--
-- This file is INTENTIONALLY a separate migration from 0002. drizzle-kit
-- may regenerate 0002 on the next schema change; hand-edits to that file
-- would be silently overwritten. The --custom mechanism (this file) is
-- append-only and survives regeneration.
--
-- After this migration applies, `pg_class.relforcerowsecurity` returns `t`
-- for all 4 tables. Plan 02-07's introspection step asserts this; Plan 02-09
-- pen tests rely on FORCE being on so even superuser table-owner cannot
-- bypass policy.
--
-- The GRANT block is required because drizzle-kit migrate creates tables
-- owned by postgres; app_user (NOBYPASSRLS NOSUPERUSER) needs explicit DML
-- rights (Plan 01-05 §Step 6 pattern). init-db.sh's ALTER DEFAULT PRIVILEGES
-- covers FUTURE tables but not those created during the migrate run.

ALTER TABLE "program" FORCE ROW LEVEL SECURITY;
ALTER TABLE "program_version" FORCE ROW LEVEL SECURITY;
ALTER TABLE "program_rule" FORCE ROW LEVEL SECURITY;
ALTER TABLE "rule_citation" FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "program" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "program_version" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "program_rule" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "rule_citation" TO app_user;
