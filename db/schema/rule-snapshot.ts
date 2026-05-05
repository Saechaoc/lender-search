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
 * historical replay (SC#1 violation).
 *
 * Bundle shape (sorted by id ASC for canonical-JSON stability so the sha256
 * is deterministic across processes / DB orderings):
 *   {
 *     "schema_version": 1,
 *     "agency_rule_versions": [<full agency_rule_version row>, ...],
 *     "agency_rules":         [<full agency_rule row>, ...],
 *     "program_versions":     [<full program_version row scoped to tenant>, ...],
 *     "program_rules":        [<full program_rule row>, ...],
 *     "lender_overlay_rules": [<full lender_overlay_rule row>, ...]
 *   }
 *
 * Two-policy shape (mirrors agency_rule_version):
 *   - rule_snapshot_world_read (FOR SELECT TO public USING true)
 *   - rule_snapshot_system_write (FOR ALL TO system_role USING/WITH CHECK true)
 *
 * Cross-tenant exposure: the bundle CAN contain tenant-scoped rows
 * (program_version, program_rule) but the WRITER scopes them to the
 * evaluating tenant only. World-read is therefore safe — any tenant can
 * read any snapshot, but the snapshot itself never crosses tenant boundaries.
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
    pgPolicy('rule_snapshot_world_read', {
      as: 'permissive',
      for: 'select',
      to: 'public',
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
