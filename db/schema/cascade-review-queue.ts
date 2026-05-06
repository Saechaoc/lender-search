/**
 * cascade_review_queue — Phase 3 trigger fan-out target (D-14..D-19, AGY-08).
 *
 * Tenant-scoped + RLS + FORCE per D-15. TWO POLICIES:
 *   1. cascade_review_queue_tenant_isolation (FOR ALL TO public)
 *      - tenant_id = current_setting('app.tenant_id', true)::uuid
 *   2. cascade_review_queue_system_write (FOR ALL TO system_role)
 *      - using: true / withCheck: true
 *
 * Why both: the enqueue_agency_cascade() trigger inserts cross-tenant from
 * a row-level trigger context. The trigger runs as the inserting role
 * (postgres for migrations / system_role members for cascade-aware writers).
 * Both are members of system_role, so writes pass the system_write policy
 * regardless of GUC state. Tenant reads from the AM UI (Phase 8) pass the
 * tenant_isolation policy. Pattern P6.
 *
 * Phase 6 Inngest worker reads via SELECT ... FOR UPDATE SKIP LOCKED.
 * Phase 8 AM UI filters status IN ('pending','claimed') for the inbox.
 */
import { check, index, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { systemRole } from './system-role.js';
import { tenant } from './tenant.js';
import { programVersion } from './program-version.js';
import { agencyRuleVersion } from './agency-rule-version.js';

export const cascadeReviewQueue = pgTable(
  'cascade_review_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
    programVersionId: uuid('program_version_id').notNull().references(() => programVersion.id),
    priorAgencyRuleVersionId: uuid('prior_agency_rule_version_id').notNull().references(() => agencyRuleVersion.id),
    newAgencyRuleVersionId: uuid('new_agency_rule_version_id').notNull().references(() => agencyRuleVersion.id),
    status: text('status').notNull().default('pending'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    claimedBy: text('claimed_by'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('cascade_review_queue_tenant_status_created_idx').on(t.tenantId, t.status, t.createdAt),
    index('cascade_review_queue_pending_idx').on(t.status, t.createdAt),
    check('cascade_review_queue_status_check', sql`${t.status} IN ('pending','claimed','completed','dismissed')`),
    pgPolicy('cascade_review_queue_tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: 'public',
      using: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
      withCheck: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
    }),
    pgPolicy('cascade_review_queue_system_write', {
      as: 'permissive',
      for: 'all',
      to: systemRole,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);

export type CascadeReviewQueue = typeof cascadeReviewQueue.$inferSelect;
export type NewCascadeReviewQueue = typeof cascadeReviewQueue.$inferInsert;
