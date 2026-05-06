-- Phase 3 review BL-03: extend rule_citation.citation_hash to cover the
-- FULL citation identity, not just (source_url, page_number, excerpt).
--
-- Why: migration 0014's hash function was
--   md5(coalesce(source_url, '') || '|' || coalesce(page_number::text, '') || '|' || coalesce(excerpt, ''))
-- which is missing two fields that the citation schema doc comment
-- (db/schema/rule-citation.ts:11-37) explicitly says distinguish citations:
--   - bbox jsonb: the page-level bounding box (Phase 7 extraction; allows
--     two citations at the same page on the same URL but different regions
--     to coexist)
--   - source_pdf_sha256: the PDF fingerprint (allows two citations of the
--     same logical URL but different document revisions to coexist)
--
-- Concretely: a future fixture that cites the same Selling Guide URL twice
-- with different page bboxes (or the same logical URL but two different
-- PDF revisions during a wait-period rotation) would silently collide on
-- the partial unique index. The seed loader's
--   ON CONFLICT (tenant_id, citation_hash) WHERE source_url IS NOT NULL
--   DO UPDATE SET excerpt = EXCLUDED.excerpt
-- clause would then overwrite the wrong row's excerpt with the new one.
--
-- The Phase 3 fix: rebuild the GENERATED STORED column expression to
-- include bbox::text + source_pdf_sha256 so each fully-distinct citation
-- gets a distinct hash. The partial unique index on (tenant_id,
-- citation_hash) WHERE source_url IS NOT NULL is unchanged at the index
-- level — the underlying hash now correctly reflects citation identity.
--
-- Companion fix in lib/agency-seeds/fhlmc/derog-seasoning.ts: split the
-- two BK13 rows onto distinct URL anchors (#BK_CHAPTER_13_DISCHARGED and
-- #BK_CHAPTER_13_DISMISSED) so the source_url alone disambiguates them
-- even when page_number/bbox/source_pdf_sha256 are NULL. That removes the
-- specific FHLMC collision the review flagged AND adds defense-in-depth
-- via this new hash for any future fixture.
--
-- Migration mechanics: GENERATED STORED columns can't have their
-- generation expression altered in place — DROP the column (which cascades
-- to the partial unique index that depends on it) and re-add. The IF
-- EXISTS guards make the migration idempotent against partial replays.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'rule_citation'
      AND column_name = 'citation_hash'
  ) THEN
    -- DROP CASCADE removes the partial unique index that depends on the column.
    ALTER TABLE rule_citation
      DROP COLUMN citation_hash CASCADE;
  END IF;
END $$;

ALTER TABLE rule_citation
  ADD COLUMN citation_hash text GENERATED ALWAYS AS (
    md5(
      coalesce(source_url, '') || '|' ||
      coalesce(page_number::text, '') || '|' ||
      coalesce(bbox::text, '') || '|' ||
      coalesce(source_pdf_sha256, '') || '|' ||
      coalesce(excerpt, '')
    )
  ) STORED;

CREATE UNIQUE INDEX rule_citation_unique_idx
  ON rule_citation (tenant_id, citation_hash)
  WHERE source_url IS NOT NULL;
