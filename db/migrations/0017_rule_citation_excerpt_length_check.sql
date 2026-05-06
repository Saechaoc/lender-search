-- Phase 3 review WR-02: enforce rule_citation.excerpt ≤ 500 chars at the DB layer.
--
-- Why: Phase 2 docs implied the cap but no constraint was actually in place.
-- The schema doc comment in db/schema/rule-citation.ts:22-23 promises
-- citations carry "the cited textSpan", and the Phase 2 plan asserts ≤500
-- chars per Focus Area #10 of the Phase 3 review prompt — but
-- db/schema/rule-citation.ts:65 declared the column as unbounded `text` and
-- no migration referenced length(excerpt). The longest current seeded excerpt
-- is 444 chars (FHA BK7), so the ≤500 ceiling holds for every row in the
-- current dataset; this migration adds the structural guarantee that any
-- future seed exceeding it is rejected at INSERT time rather than silently
-- accepted and only failing during a downstream UI render.
--
-- The CHECK is NOT VALID first then VALIDATE in two steps so a long-running
-- FULL TABLE SCAN does not block writes on tables with existing rows. The
-- VALIDATE is fast on the current empty/small dataset; on production-shaped
-- tables a future maintainer can defer the VALIDATE separately.
--
-- companion: rule_citation_excerpt is now also Zod-validated at load time
-- via lib/agency-seeds/types.ts (agencyRuleSeedCitationSchema).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rule_citation_excerpt_length_check'
      AND conrelid = 'public.rule_citation'::regclass
  ) THEN
    ALTER TABLE rule_citation
      ADD CONSTRAINT rule_citation_excerpt_length_check
      CHECK (length(excerpt) <= 500) NOT VALID;
    ALTER TABLE rule_citation
      VALIDATE CONSTRAINT rule_citation_excerpt_length_check;
  END IF;
END $$;
