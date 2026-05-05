-- Phase 3 / Plan 03-01 Task 08 / Deltas 1+2 (REVIEWS.md B5 + B8a + iter-2 fixes).
--
-- Delta 1 (B5): make agency_rule_version.superseded_by FK DEFERRABLE INITIALLY
--   DEFERRED so the cascade two-step convention (UPDATE prior.superseded_by =
--   new_id BEFORE INSERT new_id) is transactionally safe — the FK defers until
--   COMMIT.
-- Delta 2 (B8a): add agency_rule_state enum + state / sunset_date /
--   deprecation_reason columns. Phase 3 SC#4 wants DEPRECATED as a
--   first-class queryable state instead of inferring from version_label.

-- ============================================================================
-- Delta 1 — DEFERRABLE FK on agency_rule_version.superseded_by
-- ============================================================================
-- iter-2 B5 fix: use DO $$ block with structural pg_constraint query to find
-- the existing FK by column rather than guessed constraint name. Phase 2
-- migration 0002 created it as the auto-generated Drizzle name; the structural
-- query is robust to future Drizzle naming changes.

DO $$
DECLARE
  cn text;
BEGIN
  SELECT conname INTO cn
  FROM pg_constraint
  WHERE conrelid = 'public.agency_rule_version'::regclass
    AND contype = 'f'
    AND confrelid = 'public.agency_rule_version'::regclass
    AND array_position(conkey, (
      SELECT attnum FROM pg_attribute
      WHERE attrelid = 'public.agency_rule_version'::regclass
        AND attname = 'superseded_by'
    )) IS NOT NULL;

  IF cn IS NOT NULL THEN
    EXECUTE format('ALTER TABLE agency_rule_version DROP CONSTRAINT %I', cn);
  END IF;
END $$;

ALTER TABLE agency_rule_version
  ADD CONSTRAINT agency_rule_version_superseded_by_fkey
  FOREIGN KEY (superseded_by) REFERENCES agency_rule_version(id)
  DEFERRABLE INITIALLY DEFERRED;

-- ============================================================================
-- Delta 2 — agency_rule_state enum + state/sunset_date/deprecation_reason cols
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agency_rule_state') THEN
    CREATE TYPE agency_rule_state AS ENUM ('ACTIVE', 'DEPRECATED', 'RETIRED');
  END IF;
END $$;

ALTER TABLE agency_rule_version
  ADD COLUMN IF NOT EXISTS state agency_rule_state NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS sunset_date date NULL,
  ADD COLUMN IF NOT EXISTS deprecation_reason text NULL;
