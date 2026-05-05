/**
 * rule_citation — citation discipline as schema constraint (SCH-13 / D-01).
 *
 * Tenant-scoped table (RLS-policed). Every program_rule row carries a
 * NOT NULL FK to rule_citation(id) via primary_citation_id; this is the
 * structural enforcement of "no rule without citation" per Pitfall 2.8 +
 * PROJECT.md §Conventions ("a program_rule row cannot persist without a
 * corresponding rule_citation row pointing at a source document page +
 * bbox + textSpan").
 *
 * Schema scope per CONTEXT D-03:
 *   - source_pdf_sha256 text NULL: nullable so hand-authored agency rules
 *     citing only a Selling Guide URL can persist
 *   - source_url text NULL: nullable so extracted rules with only a PDF
 *     hash can persist
 *   - The source CHECK (source_pdf_sha256 IS NOT NULL OR source_url IS NOT NULL)
 *     lands in Plan 02-06's --custom migration; ensures every citation has
 *     at least one source pointer (D-03 / D-20.8 test)
 *   - bbox jsonb NULL: {x,y,w,h} per Phase 7 extraction; nullable for
 *     hand-authored rules without a specific page region
 *   - page_number int NULL: nullable for the same reason as bbox
 *   - excerpt text NOT NULL: the cited textSpan; structural guarantee that
 *     citations carry the actual quoted text (Phase 7 substantive bbox
 *     validation per D-04 lands at extraction time, not Phase 2)
 *   - secondary_for_rule_id uuid NULL: optional back-pointer for D-02's
 *     multi-page / multi-citation case (one rule cites multiple PDF pages
 *     or one rule cites both a PDF and a Selling Guide URL); primary FK
 *     stays NOT NULL
 *
 * Tenant scope: this table is tenant-scoped because AM uploads belong to a
 * tenant. Hand-authored agency citations (Phase 3) land under a system
 * tenant once that's wired; this plan ships the structural shape.
 *
 * Insert order (Pitfall F): rule_citation row MUST exist before program_rule
 * INSERTs that reference it. Server actions / extraction pipeline emit
 * `INSERT rule_citation RETURNING id` first, then INSERT program_rule with
 * primary_citation_id = $1 inside a single transaction.
 *
 * Per Phase 3 / Plan 03-01 Task 08 Delta 4 (REVIEWS.md B12): a GENERATED
 * STORED column `citation_hash` (md5 of source_url|page_number|excerpt) plus
 * a partial unique index `rule_citation_unique_idx` on
 * `(tenant_id, citation_hash) WHERE source_url IS NOT NULL` lands via
 * --custom migration 0014. The agency seed loader's INSERT path uses
 * `ON CONFLICT (tenant_id, citation_hash) WHERE source_url IS NOT NULL
 * DO UPDATE SET excerpt = EXCLUDED.excerpt RETURNING id` so re-running
 * `pnpm db:seed` reuses existing citation rows instead of creating
 * orphan duplicates. Drizzle 0.45 cannot model GENERATED STORED columns
 * cleanly; the migration is the source of truth for the unique-key shape.
 */
import { index, integer, jsonb, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenant } from './tenant.js';

export const ruleCitation = pgTable(
  'rule_citation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    sourcePdfSha256: text('source_pdf_sha256'),
    sourceUrl: text('source_url'),
    pageNumber: integer('page_number'),
    bbox: jsonb('bbox'),
    excerpt: text('excerpt').notNull(),
    secondaryForRuleId: uuid('secondary_for_rule_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('rule_citation_tenant_idx').on(t.tenantId),
    pgPolicy('rule_citation_tenant_isolation', {
      as: 'permissive',
      for: 'all',
      to: 'public',
      using: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
      withCheck: sql`${t.tenantId} = current_setting('app.tenant_id', true)::uuid`,
    }),
  ],
);

export type RuleCitation = typeof ruleCitation.$inferSelect;
export type NewRuleCitation = typeof ruleCitation.$inferInsert;
