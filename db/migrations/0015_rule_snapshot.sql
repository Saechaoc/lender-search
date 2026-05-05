-- Phase 3 / Plan 03-01 Task 08 / Delta 5 (REVIEWS.md A3a + iter-2 A3a fix).
--
-- iter-2 fix: do NOT add a new snapshot_id uuid column to evaluation_event
--   (would duplicate Phase 2's pre-existing ruleset_snapshot_id text column
--   with no invariant tying them together — Codex flagged in iter-2). Instead,
--   add an FK from the existing ruleset_snapshot_id → rule_snapshot.sha256_hash.
-- iter-2 fix: content_jsonb stores FULL canonical bundle (every relevant rule
--   row), not a list of refs / IDs. Phase 4 evaluator can re-evaluate from this
--   jsonb alone, even if live tables have been updated since the snapshot.
--
-- Bundle shape (sorted by id ASC for canonical-JSON stability):
--   { schema_version, agency_rule_versions[], agency_rules[],
--     program_versions[], program_rules[], lender_overlay_rules[] }

CREATE TABLE IF NOT EXISTS rule_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256_hash text NOT NULL UNIQUE,
  content_jsonb jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rule_snapshot ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'rule_snapshot_world_read' AND tablename = 'rule_snapshot') THEN
    CREATE POLICY rule_snapshot_world_read ON rule_snapshot FOR SELECT TO public USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'rule_snapshot_system_write' AND tablename = 'rule_snapshot') THEN
    CREATE POLICY rule_snapshot_system_write ON rule_snapshot FOR ALL TO system_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE rule_snapshot FORCE ROW LEVEL SECURITY;

GRANT SELECT ON rule_snapshot TO app_user;
GRANT SELECT, INSERT ON rule_snapshot TO system_role;

-- iter-2 A3a fix: FK from existing Phase 2 ruleset_snapshot_id text column
-- to rule_snapshot.sha256_hash. DO NOT ADD A NEW snapshot_id COLUMN.
-- DEFERRABLE so persistSnapshot + INSERT evaluation_event can execute in
-- the same transaction (write order: persistSnapshot then INSERT event).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'evaluation_event_ruleset_snapshot_fkey'
      AND conrelid = 'public.evaluation_event'::regclass
  ) THEN
    ALTER TABLE evaluation_event
      ADD CONSTRAINT evaluation_event_ruleset_snapshot_fkey
      FOREIGN KEY (ruleset_snapshot_id) REFERENCES rule_snapshot(sha256_hash)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;
