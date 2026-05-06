/**
 * rule_snapshot — system-owned content-addressed RuleSnapshot bundle store
 * (Phase 3 / Plan 03-01 Task 08 Delta 5 / REVIEWS.md A3a).
 *
 * Materialized RuleSnapshot bundle behind a sha256_hash matching
 * `lib/audit/snapshotId.ts` output. `evaluation_event.ruleset_snapshot_id`
 * has a DEFERRABLE FK on `rule_snapshot.sha256_hash` so the writer path
 * (persistSnapshot → INSERT evaluation_event) executes in a single
 * transaction with snapshot-first ordering.
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
 * Two-policy shape:
 *   - rule_snapshot_system_read (FOR SELECT TO system_role USING true)
 *     Plan 03 review BL-01: previously rule_snapshot_world_read.
 *     Tightened to system_role-only because content_jsonb can carry
 *     tenant-scoped row IDs and (Phase 4+) full rule bodies. World-read
 *     would be cross-tenant exfiltration via `SELECT content_jsonb`.
 *   - rule_snapshot_system_write (FOR ALL TO system_role USING/WITH CHECK true)
 *     Phase 4 evaluator runs as system_role for evaluation_event inserts;
 *     the snapshot read sits in the same role. When tenant-readable
 *     snapshots are wired (Phase 5+), they need an explicit tenant_id
 *     column on rule_snapshot AND a per-tenant policy — never wholesale
 *     world-read.
 *
 * Migration 0018 makes the policy change at the DDL level.
 */
import { jsonb, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { systemRole } from './system-role.js';

export const ruleSnapshot = pgTable(
  'rule_snapshot',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sha256Hash: text('sha256_hash').notNull(),
    contentJsonb: jsonb('content_jsonb').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('rule_snapshot_sha256_hash_unique').on(t.sha256Hash),
    // Plan 03 review BL-01: system_role-only read instead of world-read.
    // Tenant-readable snapshots (Phase 5+) need an explicit tenant_id column
    // and a per-tenant policy, not wholesale public access.
    pgPolicy('rule_snapshot_system_read', {
      as: 'permissive',
      for: 'select',
      to: systemRole,
      using: sql`true`,
    }),
    pgPolicy('rule_snapshot_system_write', {
      as: 'permissive',
      for: 'all',
      to: systemRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);

export type RuleSnapshot = typeof ruleSnapshot.$inferSelect;
export type NewRuleSnapshot = typeof ruleSnapshot.$inferInsert;
