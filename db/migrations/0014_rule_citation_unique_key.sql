-- Phase 3 / Plan 03-01 Task 08 / Delta 4 (REVIEWS.md B12 + iter-2 B12 fix).
--
-- Why: the original loader inserts rule_citation BEFORE conditionally inserting
-- agency_rule. Re-running pnpm db:seed creates orphan duplicate citations even
-- when rule counts stay stable. B12 requires a stable triple
-- (source_url, page_number, excerpt) to dedupe.
--
-- The Phase 3 hand-authored agency loader path always sets source_url (it
-- cites the FNMA Selling Guide / HUD ML / VA Pamphlet URL), so a partial
-- index keyed on source_url IS NOT NULL is sufficient. Loader's ON CONFLICT
-- predicate must match the partial index predicate (Postgres requires
-- conflict_target predicate to match partial index predicate exactly).

ALTER TABLE rule_citation
  ADD COLUMN IF NOT EXISTS citation_hash text GENERATED ALWAYS AS (
    md5(coalesce(source_url, '') || '|' || coalesce(page_number::text, '') || '|' || coalesce(excerpt, ''))
  ) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS rule_citation_unique_idx
  ON rule_citation (tenant_id, citation_hash)
  WHERE source_url IS NOT NULL;
