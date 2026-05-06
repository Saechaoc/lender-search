-- Phase 3 review BL-01: tighten rule_snapshot read access.
--
-- Migration 0015 created rule_snapshot with `rule_snapshot_world_read`
-- (FOR SELECT TO public USING true). The schema doc comment promised
-- "the WRITER scopes them to the evaluating tenant only" — but the writer
-- (lib/audit/snapshot-persistence.ts captureCurrentBundle) ran as the
-- postgres admin pool with no tenant filter on program_version /
-- lender_overlay_rule. That meant every snapshot persisted by pnpm db:seed
-- contained references to every tenant's program_version + lender_overlay
-- rows, and any tenant authenticated against the app could
--   SELECT content_jsonb FROM rule_snapshot LIMIT 1
-- to read those references. Direct violation of CLAUDE.md's
-- "cross-tenant data exposure is a release-blocker" rule.
--
-- Phase 4 plans extend content_jsonb to FULL rule rows; at that point
-- the metadata leak graduates to wholesale program-rule body
-- exfiltration via SELECT content_jsonb.
--
-- Two-part fix:
--
-- 1. lib/audit/snapshot-persistence.ts captureCurrentBundle now requires
--    a tenantId for tenant-scoped tables (program_version, program_rule,
--    lender_overlay_rule). The baseline-system snapshot from pnpm db:seed
--    captures system-owned rows only.
--
-- 2. (this migration) replace `rule_snapshot_world_read` with
--    `rule_snapshot_system_read`. Only system_role members can SELECT.
--    Phase 4 evaluator will run as system_role for evaluation_event
--    inserts already; the snapshot read happens immediately before the
--    audit insert, so no role transition is needed. When a tenant-readable
--    snapshot path is needed in Phase 5+ (e.g. a UI rendering historical
--    rule_stack to an LO), it must be wired with explicit tenant_id
--    filtering in a NEW policy — not a wholesale world-read.
--
-- Defense-in-depth posture: the policy tightening here is enforced at the
-- DB layer via FORCE ROW LEVEL SECURITY (set by migration 0015), so even
-- the table owner cannot bypass it.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'rule_snapshot_world_read'
      AND tablename = 'rule_snapshot'
  ) THEN
    DROP POLICY rule_snapshot_world_read ON rule_snapshot;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'rule_snapshot_system_read'
      AND tablename = 'rule_snapshot'
  ) THEN
    CREATE POLICY rule_snapshot_system_read ON rule_snapshot
      FOR SELECT TO system_role USING (true);
  END IF;
END $$;

-- Drop the table-level SELECT GRANT to app_user. SELECT was previously
-- granted to support the world-read policy; with the system-only policy
-- the GRANT is misleading (RLS would reject every SELECT anyway, but
-- the GRANT signals "app_user can read this table" which is incorrect).
REVOKE SELECT ON rule_snapshot FROM app_user;
