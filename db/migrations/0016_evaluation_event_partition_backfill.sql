-- Quick task 260505-wp8: evaluation_event partition coverage backfill (P2.b code review fix).
--
-- Why this migration exists:
--   - 0008 inline-creates partitions only for May-Oct 2026 (lines 64-75).
--   - create_next_evaluation_event_partition() (0008 lines 116-148) creates ONLY the
--     next month — so on a fresh install after Oct 31, 2026 the very next
--     `INSERT INTO evaluation_event ... DEFAULT now()` fails with
--     `no partition of relation "evaluation_event" found for row`.
--   - Local Docker has no pg_cron extension; 0009 wraps cron.schedule in a DO block
--     that swallows undefined_file/feature_not_supported, so partitions never
--     auto-create on local dev once the inline window expires.
--   - Even with pg_cron live, a migration applied mid-month leaves the rest of the
--     migration month unprotected (cron only fires `0 2 1 * *` — first of the month
--     at 02:00 UTC).
--
-- Why a NEW migration and not an edit of 0008:
--   CLAUDE.md migration-immutability convention (commit 323a98c, 2026-05-06):
--   "Migrations are immutable post-merge. Once a migration file is merged and
--    recorded in __drizzle_migrations, fix any defects in a NEW migration." Editing
--   0008 in place is a no-op for any environment that has already applied it; the
--   only way to ship a fix to deployed databases is a new migration that
--   CREATE-OR-REPLACEs the function and CREATE TABLE IF NOT EXISTS-es the partitions.
--
-- Idempotency contract:
--   - Partition creation uses CREATE TABLE IF NOT EXISTS, so overlap with 0008's
--     existing May-Oct 2026 inline set is harmless.
--   - Per-partition RLS+FORCE+policy+REVOKE+GRANT setup is gated behind a
--     pg_policies existence check (the policy CREATE is the only DDL that errors
--     on replay; ENABLE/FORCE RLS is naturally idempotent at the SQL level).
--   - create_next_evaluation_event_partition() body uses CREATE OR REPLACE FUNCTION
--     and an internal `IF to_regclass(...) IS NULL THEN ... END IF` guard per month,
--     so calling it twice in a row is a no-op on the second call.
--   - Section C invokes the (newly replaced) function once at migrate time so its
--     two-month coverage is exercised through the canonical code path.
--
-- Mirrors 0008's child-partition treatment verbatim (Pitfall PG-1: RLS does not
-- auto-propagate to children in PG16; Pitfall PG-2: defense-in-depth REVOKE).

-- ============================================================================
-- SECTION A: Backfill current calendar month + 6 forward partitions.
-- 7 partitions total (i=0..6 inclusive). Using CREATE TABLE IF NOT EXISTS
-- means May-Oct 2026 (already created by 0008) are preserved untouched on
-- environments where 0008 ran first; on a fresh DB after Oct 2026 this
-- block creates the current month directly.
-- ============================================================================

DO $$
DECLARE
  current_month_start date := date_trunc('month', now())::date;
  start_date date;
  end_date date;
  partition_name text;
  i int;
BEGIN
  FOR i IN 0..6 LOOP
    start_date := (current_month_start + (i || ' month')::interval)::date;
    end_date   := (current_month_start + ((i + 1) || ' month')::interval)::date;
    partition_name := format('evaluation_event_y%sm%s',
                             to_char(start_date, 'YYYY'),
                             to_char(start_date, 'MM'));

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF evaluation_event FOR VALUES FROM (%L) TO (%L)',
      partition_name, start_date, end_date
    );

    -- Apply RLS+FORCE+policy+REVOKE+GRANT only if the policy is not already
    -- present (idempotency guard — policy CREATE is the one DDL that would
    -- error on replay; ENABLE/FORCE RLS and REVOKE/GRANT are no-ops when
    -- already in the desired state).
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = partition_name
        AND policyname = partition_name || '_tenant_isolation'
    ) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', partition_name);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', partition_name);
      EXECUTE format(
        'CREATE POLICY %I_tenant_isolation ON %I FOR ALL TO public ' ||
        'USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) ' ||
        'WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
        partition_name, partition_name
      );
      EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM PUBLIC', partition_name);
      EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM app_user', partition_name);
      EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM system_role', partition_name);
      EXECUTE format('GRANT SELECT, INSERT ON %I TO app_user', partition_name);
      EXECUTE format('GRANT SELECT, INSERT ON %I TO system_role', partition_name);
    END IF;
  END LOOP;
END;
$$;

-- ============================================================================
-- SECTION B: CREATE OR REPLACE create_next_evaluation_event_partition().
--
-- Same signature as 0008 (RETURNS void, LANGUAGE plpgsql, SECURITY INVOKER) so
-- 0009's pg_cron schedule and any future call sites remain wired.
--
-- New behavior: ensures BOTH current month AND next month exist (was: next only).
-- Rationale (P2.b): a migration applied mid-month must not leave the rest of
-- the current month unprotected; cron fires `0 2 1 * *`, so the inline call at
-- the bottom of this migration is the only thing that protects mid-month
-- migrate runs.
--
-- Idempotency: each iteration's `IF to_regclass(...) IS NULL THEN ... END IF`
-- guard preserves the original early-return semantics per partition. Calling
-- the function twice in succession is a no-op on the second call because both
-- to_regclass checks pass.
-- ============================================================================

CREATE OR REPLACE FUNCTION create_next_evaluation_event_partition()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY INVOKER
AS $$
DECLARE
  target_starts date[] := ARRAY[
    date_trunc('month', now())::date,
    date_trunc('month', now() + interval '1 month')::date
  ];
  target_start date;
  target_end date;
  partition_name text;
BEGIN
  FOREACH target_start IN ARRAY target_starts LOOP
    target_end := (target_start + interval '1 month')::date;
    partition_name := format('evaluation_event_y%sm%s',
                             to_char(target_start, 'YYYY'),
                             to_char(target_start, 'MM'));

    IF to_regclass(partition_name) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF evaluation_event FOR VALUES FROM (%L) TO (%L)',
        partition_name, target_start, target_end
      );
      -- Mirror 0008 child-partition setup verbatim (Pitfall PG-1, PG-2).
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', partition_name);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', partition_name);
      EXECUTE format(
        'CREATE POLICY %I_tenant_isolation ON %I FOR ALL TO public ' ||
        'USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) ' ||
        'WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
        partition_name, partition_name
      );
      EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM PUBLIC', partition_name);
      EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM app_user', partition_name);
      EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM system_role', partition_name);
      EXECUTE format('GRANT SELECT, INSERT ON %I TO app_user', partition_name);
      EXECUTE format('GRANT SELECT, INSERT ON %I TO system_role', partition_name);
    END IF;
  END LOOP;
END;
$$;

-- ============================================================================
-- SECTION C: Backfill invocation through the canonical code path.
--
-- The Section A loop already created current and next months under normal
-- conditions, so this is a structural no-op (both to_regclass checks pass).
-- The value of running it is to self-test the new function body during the
-- migrate transaction — if the refactor regresses, migrate fails loudly here
-- rather than silently three months later when cron next fires.
-- ============================================================================

SELECT create_next_evaluation_event_partition();
