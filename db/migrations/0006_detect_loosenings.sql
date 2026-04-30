-- Phase 2 / Plan 02-06 Task 2: detect_loosenings(uuid) SQL function (D-12).
--
-- Per CONTEXT D-12 / SCH-03 + Phase 2 SC#4: detects when an INVESTOR_OVERLAY
-- rule loosens a corresponding AGENCY_BASE rule. Returns rows for each
-- detected loosening (overlay more permissive than agency).
--
-- Per CONTEXT D-13: NO BEFORE INSERT/UPDATE trigger. SCH-03 says "surfaces
-- them as data-quality errors during AM review" — meaning AM-time UX, not
-- write-time hard rejection. A trigger would block legitimate extraction-
-- draft rows that may temporarily contain detected loosenings before AM
-- review. Phase 8 AM commit transaction calls this function pre-commit and
-- blocks commit if the result is non-empty (deferred wiring).
--
-- SECURITY INVOKER (default): function runs with caller's permissions, so
-- RLS policies on program_rule still apply — Phase 8's AM commit transaction
-- only sees rules in the AM's tenant context. agency_rule has the world-read
-- policy so the JOIN works regardless of caller tenant.
--
-- Per CONTEXT D-14, the comparison rules per dimension:
--   - ltv_max / cltv_max / hcltv_max / dti_max: overlay must be <= agency
--   - fico_min / reserves_min: overlay must be >= agency
--   - derog_seasoning.base_waiting_months and
--     extenuating_circumstances_waiting_months: overlay must be >= agency
--   - Allow-list arrays (occupancy/purpose/property_type/doc_type): overlay
--     must be a subset of agency
--   - Other rule_kinds: skipped at Phase 2 (function returns rows for the
--     comparable kinds only); Phase 8 may extend
--
-- Plan 02-08 D-20.5 test asserts:
--   - INSERT a fixture overlay loosening ltv_max above agency -> function
--     returns 1 row
--   - INSERT a restrictive overlay -> function returns 0 rows

CREATE OR REPLACE FUNCTION detect_loosenings(p_program_version_id uuid)
  RETURNS TABLE (
    program_rule_id uuid,
    agency_rule_id uuid,
    dimension text,
    agency_value jsonb,
    overlay_value jsonb
  )
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
AS $$
  WITH
    overlay_rules AS (
      SELECT pr.id, pr.rule_kind, pr.rule_body, pv.agency_rule_version_id
      FROM program_rule pr
      JOIN program_version pv ON pv.id = pr.program_version_id
      WHERE pr.program_version_id = p_program_version_id
        AND pr.layer = 'INVESTOR_OVERLAY'
    ),
    paired AS (
      SELECT
        ovr.id AS overlay_id,
        ar.id AS agency_id,
        ovr.rule_kind,
        ovr.rule_body AS overlay_body,
        ar.rule_body AS agency_body
      FROM overlay_rules ovr
      JOIN agency_rule ar
        ON ar.agency_rule_version_id = ovr.agency_rule_version_id
        AND ar.rule_kind = ovr.rule_kind
    )
  -- Numeric <= comparisons (overlay must be <= agency to count as restricting;
  -- overlay > agency means the overlay loosens — flag as loosening).
  SELECT
    p.overlay_id, p.agency_id, p.rule_kind::text,
    p.agency_body, p.overlay_body
  FROM paired p
  WHERE p.rule_kind IN ('ltv_max', 'cltv_max', 'hcltv_max', 'dti_max')
    AND (p.overlay_body->>'value')::numeric > (p.agency_body->>'value')::numeric

  UNION ALL

  -- Numeric >= comparisons (overlay must be >= agency; overlay < agency
  -- means overlay loosens by lowering the floor).
  SELECT
    p.overlay_id, p.agency_id, p.rule_kind::text,
    p.agency_body, p.overlay_body
  FROM paired p
  WHERE p.rule_kind IN ('fico_min', 'reserves_min')
    AND (p.overlay_body->>'value')::numeric < (p.agency_body->>'value')::numeric

  UNION ALL

  -- derog_seasoning: overlay's base_waiting_months and
  -- extenuating_circumstances_waiting_months must be >= agency.
  SELECT
    p.overlay_id, p.agency_id, p.rule_kind::text,
    p.agency_body, p.overlay_body
  FROM paired p
  WHERE p.rule_kind = 'derog_seasoning'
    AND (
      COALESCE((p.overlay_body->>'base_waiting_months')::int, 0) <
        COALESCE((p.agency_body->>'base_waiting_months')::int, 0)
      OR COALESCE((p.overlay_body->>'extenuating_circumstances_waiting_months')::int, 0) <
        COALESCE((p.agency_body->>'extenuating_circumstances_waiting_months')::int, 0)
    )

  UNION ALL

  -- Allow-list: overlay's "values" array must be a SUBSET of agency's
  -- (overlay adding values is loosening). `agency_body->'values' @>
  -- overlay_body->'values'` returns true if agency contains overlay (i.e.,
  -- overlay is a subset). NOT (...) flags loosening (overlay has values
  -- agency doesn't have).
  SELECT
    p.overlay_id, p.agency_id, p.rule_kind::text,
    p.agency_body, p.overlay_body
  FROM paired p
  WHERE p.rule_kind IN ('occupancy_allow', 'purpose_allow', 'property_type_allow', 'doc_type_allow')
    AND NOT ((p.agency_body->'values') @> (p.overlay_body->'values'));
$$;
