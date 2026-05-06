-- Phase 3 / Plan 03-01 Task 4: evaluation_event partitioned by month (AUD-01..03 / D-01, D-02).
--
-- Per CONTEXT D-01: PARTITION BY RANGE (evaluated_at), one partition per month.
-- Per CONTEXT D-02: REVOKE UPDATE,DELETE FROM PUBLIC, app_user, system_role
--   (maximalist; only postgres superuser can mutate).
-- Per Pitfall PG-1: RLS + FORCE on parent ONLY (RLS does NOT auto-propagate
--   to child partitions in Postgres 16). All INSERT/SELECT routes via parent.
-- Per Pitfall PG-2: REVOKE applied at parent + defense-in-depth REVOKE inside
--   create_next_evaluation_event_partition() for each new child.
-- Per Open Question 3: 6 forward partitions inline (May-Oct 2026) — self-
--   documenting in code review diff.
-- Per Task 08 Delta 3 (REVIEWS.md B7b): each child also gets RLS+FORCE+policy
--   so direct child-partition access is governed by the same RLS contract as
--   the parent (Postgres 16 does not auto-propagate parent-table RLS to
--   children — RLS evaluation routes via the table the query addressed).
--
-- Why --custom: Drizzle 0.45 does not model PARTITION BY RANGE, REVOKE,
-- or composite PK on partitioned tables. The 0007 auto-migration emitted a
-- non-partitioned form; this migration DROPs that form and recreates partitioned.
-- Both migrations land in the journal; on a fresh CI DB, 0007 runs CREATE
-- (the non-partitioned form), then 0008 DROPs and recreates partitioned.
-- This sequence is safe because 0007's evaluation_event is empty when 0008 runs.

DROP TABLE IF EXISTS evaluation_event CASCADE;

CREATE TABLE evaluation_event (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  user_id uuid NOT NULL,
  scenario_hash text NOT NULL,
  scenario_payload jsonb NOT NULL,
  ruleset_snapshot_id text NOT NULL,
  program_version_id uuid NOT NULL REFERENCES program_version(id),
  decision text NOT NULL CHECK (decision IN ('eligible','near_miss','ineligible')),
  deciding_rule_id uuid NULL,
  deciding_rule_layer text NULL,
  rule_stack jsonb NOT NULL,
  near_miss_delta jsonb NULL,
  evaluator_version text NOT NULL CHECK (length(evaluator_version) > 0),
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, evaluated_at)
) PARTITION BY RANGE (evaluated_at);

-- RLS + FORCE on parent (Pitfall PG-1).
ALTER TABLE evaluation_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_event FORCE ROW LEVEL SECURITY;

CREATE POLICY evaluation_event_tenant_isolation ON evaluation_event
  FOR ALL TO public
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX evaluation_event_tenant_evaluated_idx
  ON evaluation_event (tenant_id, evaluated_at DESC);

-- D-02 maximalist REVOKE on parent.
REVOKE UPDATE, DELETE ON evaluation_event FROM PUBLIC;
REVOKE UPDATE, DELETE ON evaluation_event FROM app_user;
REVOKE UPDATE, DELETE ON evaluation_event FROM system_role;
GRANT SELECT, INSERT ON evaluation_event TO app_user;
GRANT SELECT, INSERT ON evaluation_event TO system_role;

-- 6 forward partitions (May-Oct 2026; covers Phase 3 close + 5 ahead).
CREATE TABLE evaluation_event_y2026m05 PARTITION OF evaluation_event
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE evaluation_event_y2026m06 PARTITION OF evaluation_event
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE evaluation_event_y2026m07 PARTITION OF evaluation_event
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE evaluation_event_y2026m08 PARTITION OF evaluation_event
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE evaluation_event_y2026m09 PARTITION OF evaluation_event
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE evaluation_event_y2026m10 PARTITION OF evaluation_event
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

-- Task 08 Delta 3 / REVIEWS.md B7b option (b): each inline-seeded child
-- partition gets RLS+FORCE+policy+REVOKE+GRANT. Direct child access (e.g.
-- SELECT FROM evaluation_event_y2026m05) bypasses the parent's RLS policy
-- in PostgreSQL 16 — child partitions need their own policies.
DO $$
DECLARE
  partition_name text;
BEGIN
  FOR partition_name IN
    SELECT unnest(ARRAY[
      'evaluation_event_y2026m05',
      'evaluation_event_y2026m06',
      'evaluation_event_y2026m07',
      'evaluation_event_y2026m08',
      'evaluation_event_y2026m09',
      'evaluation_event_y2026m10'
    ])
  LOOP
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
  END LOOP;
END;
$$;

-- create_next_evaluation_event_partition() — idempotent monthly partition creator.
-- Pitfall PG-2 defense-in-depth: explicit REVOKE on every new child partition.
-- Task 08 Delta 3: also ENABLE+FORCE RLS and apply tenant_isolation policy
--   so RLS is uniform across every present and future child.
CREATE OR REPLACE FUNCTION create_next_evaluation_event_partition()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY INVOKER
AS $$
DECLARE
  next_month_start date := date_trunc('month', now() + interval '1 month')::date;
  next_month_end   date := date_trunc('month', now() + interval '2 month')::date;
  partition_name   text := format('evaluation_event_y%sm%s',
                                   to_char(next_month_start, 'YYYY'),
                                   to_char(next_month_start, 'MM'));
BEGIN
  IF to_regclass(partition_name) IS NOT NULL THEN
    RETURN;
  END IF;
  EXECUTE format(
    'CREATE TABLE %I PARTITION OF evaluation_event FOR VALUES FROM (%L) TO (%L)',
    partition_name, next_month_start, next_month_end
  );
  -- Task 08 Delta 3: RLS+FORCE+policy on every new child (B7b option b).
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', partition_name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', partition_name);
  EXECUTE format(
    'CREATE POLICY %I_tenant_isolation ON %I FOR ALL TO public ' ||
    'USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) ' ||
    'WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
    partition_name, partition_name
  );
  -- Pitfall PG-2 defense-in-depth.
  EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM PUBLIC, app_user, system_role', partition_name);
  EXECUTE format('GRANT SELECT, INSERT ON %I TO app_user, system_role', partition_name);
END;
$$;
