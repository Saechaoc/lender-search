BEGIN;
DO $$
DECLARE
  new_arv_id uuid := gen_random_uuid();
  prior_id uuid;
BEGIN
  SELECT id INTO prior_id FROM agency_rule_version
  WHERE agency='FNMA' AND version_label='FNMA-SEL-2026-04';

  UPDATE agency_rule_version
    SET superseded_by = new_arv_id,
        effective_period = daterange(lower(effective_period), '2027-01-01'::date, '[)')
  WHERE id = prior_id;

  INSERT INTO agency_rule_version (id, agency, version_label, effective_period)
  VALUES (new_arv_id, 'FNMA', 'FNMA-MANUAL-PROBE-' || new_arv_id::text, '[2027-01-01,infinity)'::daterange);

  RAISE NOTICE 'Two-step UPDATE-before-INSERT succeeded with DEFERRABLE FK';
END $$;

SELECT count(*) AS cascade_queue_rows FROM cascade_review_queue;
ROLLBACK;
