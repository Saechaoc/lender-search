-- Phase 3 / Plan 03-01 Task 4: pg_cron monthly schedule (D-01).
--
-- Per Pitfall PG-5: pg_cron is in Supabase managed Postgres but NOT in
-- docker-postgres-16-alpine. Wrap CREATE EXTENSION + cron.schedule in a
-- DO block so local CI doesn't fail. The function exists unconditionally
-- (created in 0008); pg_cron just schedules it.

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule(
    'create_next_evaluation_event_partition',
    '0 2 1 * *',
    $cron$ SELECT create_next_evaluation_event_partition() $cron$
  );
EXCEPTION
  WHEN undefined_file OR feature_not_supported OR insufficient_privilege THEN
    RAISE NOTICE 'pg_cron unavailable in this environment; partition cron not scheduled. Phase 6 wires Supabase managed scheduler.';
END
$$;
