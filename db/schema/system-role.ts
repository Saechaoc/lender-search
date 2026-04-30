/**
 * system_role — Postgres role for agency-rule cross-tenant reads + agency
 * authoring. Created by scripts/init-db.sh (Phase 2 Plan 02-01 appends it
 * alongside app_user) with NOLOGIN NOBYPASSRLS NOSUPERUSER — GRANTed to the
 * migration role (postgres) so Phase 3 hand-authored agency rules can be
 * INSERTed via the system_role policy on agency_rule + agency_rule_version.
 *
 * `.existing()` tells drizzle-kit "do not manage this role" — it's defined
 * outside the schema (in init-db.sh / production env). Migrations reference
 * the role by name only. Without `.existing()`, drizzle-kit would emit
 * CREATE ROLE statements that conflict with the init-db.sh bootstrap
 * (Pitfall D).
 *
 * Consumers:
 *   - db/schema/agency-rule-version.ts (Plan 02-03): system_role write policy
 *   - db/schema/agency-rule.ts (Plan 02-03): system_role write policy
 *
 * Reference: orm.drizzle.team/docs/rls
 */
import { pgRole } from 'drizzle-orm/pg-core';

export const systemRole = pgRole('system_role').existing();
