/**
 * evaluation_event — append-only audit log (AUD-01..04).
 *
 * Per CONTEXT D-01: PARTITION BY RANGE (evaluated_at), one partition per
 *   calendar month. Drizzle 0.45 doesn't model partitioning — the parent
 *   table + 6 forward partitions + create_next_evaluation_event_partition()
 *   ship via --custom migration 0008_evaluation_event_partitioned.sql.
 * Per CONTEXT D-02: REVOKE UPDATE,DELETE FROM PUBLIC, app_user, system_role.
 *   Only postgres superuser can mutate (administrative recovery only).
 * Per CONTEXT D-03: scenario_payload jsonb NOT NULL + scenario_hash text NOT NULL.
 * Per Pitfall PG-1: RLS + FORCE on parent ONLY; policies route via parent.
 *   NEVER address child partitions directly in application code.
 * Per Pitfall PG-2: REVOKE applied via parent + defense-in-depth REVOKE
 *   inside create_next_evaluation_event_partition() for each new child.
 *
 * Phase 4 evaluator is the first writer (single INSERT per evaluation).
 * Phase 5 golden-set replay re-evaluates against historical snapshot_id.
 *
 * Composite PK (id, evaluated_at) — Postgres requires the partition key
 * column in the PK on partitioned tables.
 *
 * Per Task 08 Delta 5 / REVIEWS.md A3a: ruleset_snapshot_id is FK'd to
 * rule_snapshot.sha256_hash via DEFERRABLE INITIALLY DEFERRED in
 * --custom migration 0015. Drizzle 0.45 cannot model DEFERRABLE FK; the
 * migration is the source of truth.
 */
import { check, index, jsonb, pgPolicy, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenant } from './tenant.js';
import { programVersion } from './program-version.js';

export const evaluationEvent = pgTable(
  'evaluation_event',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
    userId: uuid('user_id').notNull(),
    scenarioHash: text('scenario_hash').notNull(),
    scenarioPayload: jsonb('scenario_payload').notNull(),
    rulesetSnapshotId: text('ruleset_snapshot_id').notNull(),
    programVersionId: uuid('program_version_id').notNull().references(() => programVersion.id),
    decision: text('decision').notNull(),
    decidingRuleId: uuid('deciding_rule_id'),
    decidingRuleLayer: text('deciding_rule_layer'),
    ruleStack: jsonb('rule_stack').notNull(),
    nearMissDelta: jsonb('near_miss_delta'),
    evaluatorVersion: text('evaluator_version').notNull(),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.evaluatedAt] }),
    index('evaluation_event_tenant_evaluated_idx').on(t.tenantId, t.evaluatedAt),
    check('evaluation_event_decision_check', sql`${t.decision} IN ('eligible','near_miss','ineligible')`),
    pgPolicy('evaluation_event_tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: 'public',
      using: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
      withCheck: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
    }),
  ],
);

export type EvaluationEvent = typeof evaluationEvent.$inferSelect;
export type NewEvaluationEvent = typeof evaluationEvent.$inferInsert;
