#!/usr/bin/env bash
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  -- Phase 1 uses gen_random_uuid() built into Postgres 13+. pgcrypto NOT required.
  CREATE ROLE app_user LOGIN PASSWORD 'app_user_password' NOBYPASSRLS NOSUPERUSER;
  GRANT CONNECT ON DATABASE lender_search_dev TO app_user;
  GRANT USAGE ON SCHEMA public TO app_user;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;
EOSQL

# Phase 2 Plan 02-01: system_role for agency-table writes.
# Phase 3 hand-authoring will INSERT into agency_rule_version + agency_rule
# under the system_role policy. NOLOGIN because system_role is a group role
# GRANTed to postgres (the migration runner). NOBYPASSRLS NOSUPERUSER mirrors
# app_user's posture so policies are meaningful.
#
# DO \$\$ ... \$\$ wrapper is required because Postgres has no
# `CREATE ROLE IF NOT EXISTS` syntax — the bash-escape `\$\$` makes the
# literal `\$\$` reach psql intact (heredoc would otherwise interpolate).
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'system_role') THEN
      CREATE ROLE system_role NOLOGIN NOBYPASSRLS NOSUPERUSER;
    END IF;
  END
  \$\$;
  GRANT system_role TO "$POSTGRES_USER";
  GRANT CONNECT ON DATABASE lender_search_dev TO system_role;
  GRANT USAGE ON SCHEMA public TO system_role;
EOSQL
