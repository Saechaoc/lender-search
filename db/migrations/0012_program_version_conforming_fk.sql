-- Phase 3 / Plan 03-01 Task 4: program_version conforming FK column (AGY-09 / D-22).
--
-- Per CONTEXT D-22: program_version.conforming_loan_limit_version_id uuid NULL
--   REFERENCES conforming_loan_limit_version(id). Conforming/conventional programs
--   set the FK; non-QM/DSCR/jumbo leave NULL. Phase 4 evaluator dereferences
--   when non-null + scenario hits county-level loan-amount check.
-- Per Pitfall PG-8: in-place edit of a recorded migration does NOT re-apply.
--   This file is the canonical add-column migration; future schema deltas
--   ship as 0013, 0014, etc.
--
-- The 0007 auto-migration may have already emitted ALTER TABLE program_version
-- ADD COLUMN. If so, this migration is a no-op via IF NOT EXISTS (Postgres 16
-- doesn't support that for ADD COLUMN — guard with conditional DO block instead).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'program_version'
      AND column_name = 'conforming_loan_limit_version_id'
  ) THEN
    ALTER TABLE program_version
      ADD COLUMN conforming_loan_limit_version_id uuid
      REFERENCES conforming_loan_limit_version(id);
  END IF;
END
$$;
