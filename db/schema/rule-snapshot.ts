/**
 * rule_snapshot — per-tenant content-addressed RuleSnapshot bundle store
 * (Phase 3 / Plan 03-01 Task 08 Delta 5 / REVIEWS.md A3a; tenant scoping
 * applied by quick task 260506-al0 / migration 0022).
 *
 * Materialized RuleSnapshot bundle behind a composite (tenant_id, sha256_hash)
 * UNIQUE matching `lib/audit/snapshotId.ts` output (which mixes tenantId
 * into the canonical hash input). Phase 4 evaluator's
 * `evaluation_event.ruleset_snapshot_id` will be re-FK'd as composite
 * `(tenant_id, ruleset_snapshot_id) -> rule_snapshot (tenant_id, sha256_hash)`
 * so the writer path (persistSnapshot → INSERT evaluation_event) executes
 * in a single transaction with snapshot-first ordering. The single-column
 * FK shipped in 0015 was dropped by 0022 because sha256_hash is no longer
 * unique standalone.
 *
 * Why content_jsonb stores the full bundle (not a ref list): per iter-2 A3a
 * fix, Phase 4 evaluator must be able to re-evaluate from
 * `rule_snapshot.content_jsonb` ALONE — even if the live tables have been
 * updated since the snapshot (rule rotated, version superseded, tenant
 * deleted). A ref list would re-resolve through the live tables and
 * produce a different decision for the same `evaluation_event` on
 * historical replay (SC#1 violation). Plan 03 review BL-02 implementation:
 * lib/audit/snapshot-persistence.ts now actually emits the full per-rule
 * arrays.
 *
 * Bundle shape (sorted by id ASC for canonical-JSON stability so the sha256
 * is deterministic across processes / DB orderings):
 *   {
 *     "schema_version": 2,
 *     "agency_rule_versions": [<full agency_rule_version row>, ...],
 *     "agency_rules":         [<full agency_rule row>, ...],
 *     "program_versions":     [<full program_version row scoped to tenant>, ...],
 *     "program_rules":        [<full program_rule row>, ...],
 *     "lender_overlay_rules": [<full lender_overlay_rule row>, ...]
 *   }
 *
 * One-policy shape: `rule_snapshot_tenant_isolation` (FOR ALL TO public;
 *   tenant_id = current_setting('app.tenant_id', true)::uuid). This is the
 *   same shape program_version / evaluation_event / lender_overlay_rule
 *   use. The previous role-gated policies (system_read + system_write)
 *   shipped in 0015/0019; 0022 (quick task 260506-al0) replaces them with
 *   a per-tenant policy after promoting rule_snapshot to a tenant-scoped
 *   table. CLAUDE.md "tenant filtering at the database, never the
 *   application" — Phase 4 evaluator connects as app_user with
 *   `app.tenant_id` set, NOT as system_role.
 *
 * Migration 0022 is the source of truth for the column + policy shape.
 */
import { jsonb, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenant } from './tenant.js';

export const ruleSnapshot = pgTable(
  'rule_snapshot',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // 260506-al0 / Option B: rule_snapshot is now tenant-scoped. tenant_id
    // is NOT NULL with ON DELETE RESTRICT — audit / replay evidence does
    // not cascade on tenant deletion (compliance soft-delete posture lives
    // above the schema layer in a separate retention workflow).
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'restrict' }),
    sha256Hash: text('sha256_hash').notNull(),
    contentJsonb: jsonb('content_jsonb').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Composite UNIQUE replaces the old single-column UNIQUE on sha256_hash.
    // ON CONFLICT (tenant_id, sha256_hash) is the persistSnapshot target.
    uniqueIndex('rule_snapshot_tenant_hash_unique').on(t.tenantId, t.sha256Hash),
    // Option B (260506-al0): tenant_isolation policy mirrors
    // program_version / evaluation_event / lender_overlay_rule. The
    // role-gated policies (rule_snapshot_system_read +
    // rule_snapshot_system_write) from 0015/0019 are dropped by migration
    // 0022.
    pgPolicy('rule_snapshot_tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: 'public',
      using: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
      withCheck: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
    }),
  ],
);

export type RuleSnapshot = typeof ruleSnapshot.$inferSelect;
export type NewRuleSnapshot = typeof ruleSnapshot.$inferInsert;
