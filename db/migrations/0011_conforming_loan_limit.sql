-- Phase 3 / Plan 03-01 Task 4: FHFA conforming loan limit EXCLUDE + GRANTs (AGY-09 / D-20).
--
-- Per CONTEXT D-20: EXCLUDE on (year WITH =, effective_period WITH &&) on
--   conforming_loan_limit_version. btree_gist already enabled by 0004 (Phase 2);
--   no need to re-enable.
-- Per RESEARCH §FHFA Conforming Loan Limits: world_read SELECT; system_role
--   write. The 0007 auto-migration declared the policies; this migration adds
--   the EXCLUDE constraint + app_user SELECT GRANT (Pattern from
--   0005_force_rls_agency.sql:27-28).

ALTER TABLE conforming_loan_limit_version
  ADD CONSTRAINT conforming_loan_limit_version_no_overlap
  EXCLUDE USING gist (year WITH =, effective_period WITH &&);

GRANT SELECT ON TABLE conforming_loan_limit_version TO app_user;
GRANT SELECT ON TABLE conforming_loan_limit_county TO app_user;
