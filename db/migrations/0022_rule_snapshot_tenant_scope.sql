-- Migration 0022 — rule_snapshot per-tenant scope (Option B), closing P1
-- cross-tenant rule_snapshot leak from quick task 260506-al0.
--
-- Per CLAUDE.md "migration-immutability convention": 0015 (rule_snapshot
-- creation, world_read policy) and 0019 (system_role-only read tightening)
-- ship as-is. They are recorded in __drizzle_migrations; in-place edits
-- would silently leave deployed databases at the pre-fix shape. This
-- migration is the forward-only fix.
--
-- Why Option B (per-tenant scope) instead of keeping 0019's role-gated
-- approach:
--   1. Phase 4 evaluator's audit-replay path would otherwise need a role
--      transition to system_role just to read its own snapshot. The rest
--      of the evaluator runs as app_user under the standard `app.tenant_id`
--      GUC. Mixing role contexts inside a single request adds drift risk
--      with zero security benefit — the data is tenant-scoped anyway.
--   2. Any future tenant-readable surface (Phase 5+ UI rendering historical
--      rule_stack to an LO) under 0019's posture would need a brand-new
--      tenant-keyed policy added on top. Option B installs that policy
--      now, once, with the same shape program_version / evaluation_event /
--      lender_overlay_rule already use.
--   3. CLAUDE.md mandates: "Tenant filtering at the database, never the
--      application." Option B realizes that for rule_snapshot — every other
--      tenant-scoped table already does, and rule_snapshot is the outlier.
--
-- Phase 4 deferral (must be re-added in Phase 4's first migration):
--   a. The composite FK from evaluation_event to rule_snapshot must be
--      re-added as `(tenant_id, ruleset_snapshot_id) -> rule_snapshot
--      (tenant_id, sha256_hash)` against the new composite UNIQUE this
--      migration installs. The single-column FK is dropped here because
--      rule_snapshot.sha256_hash is no longer unique standalone.
--   b. The Phase 4 evaluator MUST connect as `app_user` with
--      `app.tenant_id` set (NOT as system_role). The role-transition path
--      implied by 0019's header is explicitly rejected — the per-tenant
--      tenant_isolation policy is the wall, not a role switch.
--
-- ON DELETE RESTRICT on tenant_id is intentional. Audit / replay evidence
-- does not cascade on tenant deletion — compliance posture for soft-deletes
-- of audit lives above the schema layer (a separate retention workflow),
-- not inside this constraint.

BEGIN;

-- 1. Drop the existing single-column FK from evaluation_event FIRST. The
--    single-column FK target won't survive the unique swap. Phase 4's
--    migration re-adds it as composite (per the deferred-items.md note).
--
--    Why FIRST (before the DELETE in step 2): the FK is DEFERRABLE
--    INITIALLY DEFERRED (per 0015). Running DELETE FROM rule_snapshot
--    while the FK is still in place queues a deferred-trigger check that
--    blocks any subsequent ALTER TABLE on evaluation_event inside the
--    same transaction with "cannot ALTER TABLE because it has pending
--    trigger events". Dropping the FK first keeps the same end-state
--    (no FK after this migration) without tripping the trigger queue.
ALTER TABLE evaluation_event
  DROP CONSTRAINT IF EXISTS evaluation_event_ruleset_snapshot_fkey;

-- 2. Delete orphan baseline rows. No-op on fresh DBs; on dev DBs that ran
--    the previous seed write, those rows have no real owner because
--    tenant_id becomes NOT NULL below. Must run before step 5 (ADD
--    COLUMN tenant_id NOT NULL) so the new column doesn't try to
--    NOT-NULL-violate against existing rows.
DELETE FROM rule_snapshot;

-- 3. Drop the role-gated policies (the outer wall 0019 installed). They
--    are being replaced by tenant_isolation.
DROP POLICY IF EXISTS rule_snapshot_system_read ON rule_snapshot;
DROP POLICY IF EXISTS rule_snapshot_system_write ON rule_snapshot;

-- 4. Drop the existing UNIQUE on sha256_hash. Drizzle auto-generates a
--    name like `rule_snapshot_sha256_hash_unique` (uniqueIndex form) or
--    `rule_snapshot_sha256_hash_key` (UNIQUE constraint form). Discover
--    it dynamically inside a DO block — DO NOT hardcode.
--
--    Order matters: drop the CONSTRAINT form FIRST. A UNIQUE CONSTRAINT
--    in Postgres always has a backing UNIQUE INDEX with the same name —
--    DROP CONSTRAINT cascades the index drop, but DROP INDEX on a
--    constraint-backed index errors with "cannot drop index … because
--    constraint … requires it". Doing constraint-first means the
--    subsequent pg_indexes lookup only fires when the schema actually
--    used the bare uniqueIndex(...) form (no constraint shadow).
DO $$
DECLARE
  idx_name text;
  con_name text;
BEGIN
  -- Drop a unique CONSTRAINT form first (cascades the backing index drop).
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'public.rule_snapshot'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) ILIKE '%(sha256_hash)%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE rule_snapshot DROP CONSTRAINT IF EXISTS %I', con_name);
  END IF;

  -- Then drop a bare unique INDEX form (Drizzle uniqueIndex(...).on(t.sha256Hash)
  -- emits this if no constraint shadow exists).
  SELECT indexname INTO idx_name
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'rule_snapshot'
    AND indexdef ILIKE '%UNIQUE%'
    AND indexdef ILIKE '%sha256_hash%'
    AND indexdef NOT ILIKE '%tenant_id%';
  IF idx_name IS NOT NULL THEN
    EXECUTE format('DROP INDEX IF EXISTS public.%I', idx_name);
  END IF;
END $$;

-- 5. Add tenant_id NOT NULL with FK. This MUST come after step 1 so no
--    orphan rows violate NOT NULL.
ALTER TABLE rule_snapshot
  ADD COLUMN tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT;

-- 6. Add the composite UNIQUE. This is the new ON CONFLICT target for
--    persistSnapshot.
ALTER TABLE rule_snapshot
  ADD CONSTRAINT rule_snapshot_tenant_hash_unique UNIQUE (tenant_id, sha256_hash);

-- 7. Create tenant_isolation policy. Mirrors the program_version /
--    evaluation_event / lender_overlay_rule policy shape verbatim.
CREATE POLICY rule_snapshot_tenant_isolation ON rule_snapshot
  FOR ALL TO public
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- 8. Re-grant SELECT, INSERT to app_user. 0019 revoked SELECT; with the
--    per-tenant policy as the wall, app_user gets back the standard
--    read+write surface. The policy still gates rows.
GRANT SELECT, INSERT ON rule_snapshot TO app_user;

-- 9. Idempotently re-grant to system_role (already granted in 0015;
--    re-stating is defensive and matches the convention used in
--    evaluation_event's GRANT block).
GRANT SELECT, INSERT ON rule_snapshot TO system_role;

-- 10. Reassert FORCE RLS (already on per 0015 — defensive; mirrors 0021's
--     WR-08 backfill posture).
ALTER TABLE rule_snapshot FORCE ROW LEVEL SECURITY;

COMMIT;
