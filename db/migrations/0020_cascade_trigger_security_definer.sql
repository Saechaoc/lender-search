-- Phase 3 review WR-07: enqueue_agency_cascade trigger now runs SECURITY DEFINER
-- under the postgres owner so RLS WITH CHECK on cascade_review_queue cannot
-- silently drop fan-out rows for tenants other than the GUC-set tenant.
--
-- Why: migration 0010 declared the trigger as SECURITY INVOKER. When an
-- app_user-role connection inserts into agency_rule_version, the AFTER
-- INSERT trigger fires under app_user's privileges. The trigger then INSERTs
-- one cascade_review_queue row per affected program_version, with
-- tenant_id = pv.tenant_id. But cascade_review_queue's tenant_isolation
-- policy WITH CHECK is `tenant_id = current_setting('app.tenant_id', true)::uuid`
-- — so the trigger can only insert rows whose tenant_id equals the currently
-- set GUC. Cross-tenant fan-out succeeds for the matching tenant and SILENTLY
-- FAILS RLS WITH CHECK for every other.
--
-- Today this works because every agency_rule_version writer connects as
-- postgres (a system_role member) — postgres + system_role bypasses
-- WITH CHECK via the cascade_review_queue_system_write policy. But there is
-- no enforcement that future writers (Phase 6 Inngest worker) use a
-- system_role connection. SECURITY DEFINER + ALTER FUNCTION OWNER TO postgres
-- pins the trigger to postgres regardless of the inserter, so the cascade
-- fan-out works under any caller role.
--
-- CREATE OR REPLACE FUNCTION is migration-immutability-safe per the project
-- convention in CLAUDE.md (`### Conventions` — fix in NEW migration via
-- CREATE OR REPLACE, never edit shipped migrations in-place).

CREATE OR REPLACE FUNCTION enqueue_agency_cascade()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  -- Pinning search_path defends against the SECURITY DEFINER footgun where
  -- a malicious caller-set search_path could shadow the public.* tables the
  -- function references. We list pg_catalog last so built-in operators
  -- still resolve.
  SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Two-step convention (D-16): caller already set prior.superseded_by = NEW.id
  -- BEFORE inserting NEW. Find prior; INSERT one queue row per affected pv.
  -- Initial insert (no prior) yields zero rows; INSERT INTO ... SELECT inserts
  -- zero rows. Pitfall PG-4 natural short-circuit.
  INSERT INTO cascade_review_queue (
    tenant_id, program_version_id,
    prior_agency_rule_version_id, new_agency_rule_version_id,
    status, created_at
  )
  SELECT pv.tenant_id, pv.id, prior.id, NEW.id, 'pending', now()
  FROM agency_rule_version prior
  JOIN program_version pv ON pv.agency_rule_version_id = prior.id
  WHERE prior.agency = NEW.agency
    AND prior.superseded_by = NEW.id;

  RETURN NEW;
END;
$$;

-- Pin the function owner to postgres so SECURITY DEFINER actually elevates
-- to a system_role member (postgres carries system_role membership and is
-- the table owner, both of which bypass RLS WITH CHECK on cascade_review_queue
-- via the cascade_review_queue_system_write policy).
ALTER FUNCTION enqueue_agency_cascade() OWNER TO postgres;
