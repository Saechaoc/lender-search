-- Phase 1 / TNT-01: Force RLS on every tenant-scoped table.
--
-- Drizzle 0.45's schema API does not model FORCE ROW LEVEL SECURITY (RESEARCH
-- §Pattern 2 / Pitfall 2). FORCE makes the table owner (the migration role,
-- typically the `postgres` superuser locally) subject to RLS policies. Without
-- FORCE, the owner bypasses RLS silently — pen tests passing as a non-owner
-- catch nothing while admin scripts running as the owner exfiltrate data.
--
-- This file is INTENTIONALLY a separate migration from 0000_initial.sql.
-- drizzle-kit may regenerate 0000_initial.sql on the next schema change;
-- hand-edits to that file would be silently overwritten. The --custom
-- migration mechanism (this file) is append-only and survives regeneration.
--
-- After this migration applies, `pg_class.relforcerowsecurity` returns `t`
-- for both tables. The pen-test setup file (Plan 06 tests/rls/setup.ts)
-- asserts this in beforeAll and aborts the suite if false.

ALTER TABLE "tenant" FORCE ROW LEVEL SECURITY;
ALTER TABLE "_rls_canary" FORCE ROW LEVEL SECURITY;
