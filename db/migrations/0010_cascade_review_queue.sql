-- Phase 3 / Plan 03-01 Task 4: cascade_review_queue FORCE RLS + GRANTs +
--   enqueue_agency_cascade() trigger (AGY-08 / D-14..D-18).
--
-- Per CONTEXT D-15: tenant-scoped + RLS + FORCE; two-policy shape (tenant_isolation
--   + system_write). FORCE closes the table-owner bypass even though postgres
--   is a system_role member (the trigger insert path).
-- Per CONTEXT D-16: trigger reads NEW.agency, finds prior version via
--   superseded_by = NEW.id, INSERTs one row per affected program_version.
-- Per Pitfall PG-4: initial INSERT (no prior version) yields zero rows; the
--   WHERE clause naturally short-circuits.
-- Per Pitfall PG-9: JOIN program_version ONLY (not agency_rule) — each
--   program_version produces exactly one queue row regardless of rule count.
-- Per Pattern P6: SECURITY INVOKER; system_write policy lets system_role
--   members INSERT cross-tenant under role membership.
--
-- The 0007 auto-migration created the cascade_review_queue table with
-- pgPolicy declarations; this migration adds FORCE + DML GRANTs + the
-- trigger function + CREATE TRIGGER.

ALTER TABLE cascade_review_queue FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE cascade_review_queue TO app_user;

CREATE OR REPLACE FUNCTION enqueue_agency_cascade()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
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

CREATE TRIGGER agency_rule_version_cascade
  AFTER INSERT ON agency_rule_version
  FOR EACH ROW
  EXECUTE FUNCTION enqueue_agency_cascade();
