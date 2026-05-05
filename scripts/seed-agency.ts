/**
 * scripts/seed-agency.ts — idempotent agency-rule + FHFA loan-limit loader.
 *
 * Per CONTEXT D-05: connects via DATABASE_MIGRATION_URL (postgres superuser
 *   with system_role GRANT). Wired into:
 *   - .github/workflows/ci.yml (after pnpm drizzle-kit migrate)
 *   - tests/rls/global-setup.ts (after migrate, before tenant seeds)
 *   - tests/schema/setup.ts (after migrate)
 *   - production deploy step (Phase 6+ wires Vercel/Supabase invocation)
 *
 * Per CONTEXT D-05/D-06: idempotency keyed on (agency, version_label, rule_kind,
 *   seedKey ?? event_type) via INSERT ... WHERE NOT EXISTS for the agency_rule
 *   body. Get-or-create on agency_rule_version keyed on (agency, version_label).
 *
 * Per Pitfall PG-3: recorded_at timestamps are ISO strings everywhere downstream
 *   (snapshotId.ts contract). The loader doesn't compute snapshotIds; it only
 *   writes rows.
 *
 * Wave 0 ships the skeleton with empty seeds; Wave 1 plans (03-02..03-05)
 *   import per-agency seed arrays and pass them to seedAgencyVersionAndRules().
 *
 * Task 08 Delta 7 / REVIEWS.md B2: the dedupe predicate uses
 *   `coalesce(rule_body->>'_seed_key', rule_body->>'event_type')` so multi-row
 *   splits (FNMA's FORECLOSURE PURCHASE-vs-LCOR) don't collide.
 *
 * Task 08 Delta 2 / REVIEWS.md B8a: SeedAgencyVersionInput accepts state /
 *   sunsetDate / deprecationReason; the agency_rule_version INSERT threads
 *   these into the row. Defaults: state='ACTIVE', sunsetDate=null,
 *   deprecationReason=null.
 *
 * Loader defense-in-depth (A2): citation URLs are validated against
 *   /^https?:\/\// before INSERT.
 */
import { config as loadDotenv } from 'dotenv';
import { Pool, type PoolClient } from 'pg';
import { parseRuleBody, type RuleKind } from '../lib/rules/schemas/index.js';
import type { AgencyRuleSeed } from '../lib/agency-seeds/types.js';

loadDotenv({ path: '.env.local' });
loadDotenv({ path: '.env' });

const MIGRATION_DB_URL =
  process.env.DATABASE_MIGRATION_URL ??
  process.env.DATABASE_URL?.replace('app_user:app_user_password', 'postgres:postgres') ??
  '';

if (!MIGRATION_DB_URL) {
  throw new Error('seed-agency: DATABASE_MIGRATION_URL or DATABASE_URL must be set.');
}

export const pool = new Pool({ connectionString: MIGRATION_DB_URL, max: 3 });

/**
 * Get-or-create the kind='SYSTEM' tenant idempotently. Mirrors the pattern in
 * tests/_shared/agency-fixture.ts::ensureSystemTenant.
 */
async function ensureSystemTenant(client: PoolClient): Promise<string> {
  const lookup = await client.query<{ id: string }>(
    `SELECT id::text FROM tenant WHERE kind = 'SYSTEM' LIMIT 1`,
  );
  if (lookup.rows[0]) return lookup.rows[0].id;
  const created = await client.query<{ id: string }>(
    `INSERT INTO tenant (id, kind, name)
     VALUES (gen_random_uuid(), 'SYSTEM', 'Agency Hand-Authoring System Tenant')
     RETURNING id::text`,
  );
  return created.rows[0]!.id;
}

export interface SeedAgencyVersionInput {
  agency: 'FNMA' | 'FHLMC' | 'FHA' | 'VA' | 'USDA';
  versionLabel: string;
  effectivePeriod: string;
  /** Per Task 08 Delta 2 / REVIEWS.md B8a — defaults to 'ACTIVE'. */
  state?: 'ACTIVE' | 'DEPRECATED' | 'RETIRED';
  /** Per Task 08 Delta 2 — ISO date string when state='DEPRECATED'. */
  sunsetDate?: string | null;
  /** Per Task 08 Delta 2 — free-text reason citing source ML/etc. */
  deprecationReason?: string | null;
  sourceUrl: string;
  seeds: AgencyRuleSeed[];
}

const URL_GATE = /^https?:\/\//;

export async function seedAgencyVersionAndRules(input: SeedAgencyVersionInput): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const systemTenantId = await ensureSystemTenant(client);
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [systemTenantId]);

    // Get-or-create agency_rule_version idempotently keyed on (agency, version_label).
    // Task 08 Delta 2: when row already exists, leave its state/sunset/reason fields
    // alone (a hand-authored loader re-run should not flip a previously-deprecated
    // ARV back to ACTIVE).
    let arvId: string;
    const existing = await client.query<{ id: string }>(
      `SELECT id::text FROM agency_rule_version
       WHERE agency = $1 AND version_label = $2 LIMIT 1`,
      [input.agency, input.versionLabel],
    );
    if (existing.rows[0]) {
      arvId = existing.rows[0].id;
    } else {
      // Task 08 Delta 2 (REVIEWS.md B8a): thread state / sunset_date /
      // deprecation_reason into the INSERT. Defaults are 'ACTIVE' / null / null
      // when callers omit them. Migration 0013 added the columns; this INSERT
      // is now safe.
      const created = await client.query<{ id: string }>(
        `INSERT INTO agency_rule_version (agency, version_label, source_url, effective_period, state, sunset_date, deprecation_reason)
         VALUES ($1, $2, $3, $4::daterange, $5::agency_rule_state, $6::date, $7)
         RETURNING id::text`,
        [
          input.agency,
          input.versionLabel,
          input.sourceUrl,
          input.effectivePeriod,
          input.state ?? 'ACTIVE',
          input.sunsetDate ?? null,
          input.deprecationReason ?? null,
        ],
      );
      arvId = created.rows[0]!.id;
    }

    // Per-rule INSERT with idempotency via WHERE NOT EXISTS keyed on
    // (agency_rule_version_id, rule_kind, coalesce(rule_body->>'_seed_key', rule_body->>'event_type')).
    // Task 08 Delta 7: the seedKey discriminator is threaded into the rule_body
    // jsonb under the reserved `_seed_key` field so dedupe survives across runs
    // even when 2+ rows share an event_type (FNMA FORECLOSURE B2 split).
    for (const seed of input.seeds) {
      // A2 defense-in-depth: reject non-https?:// citation URLs at load time.
      if (!URL_GATE.test(seed.citation.sourceUrl)) {
        throw new Error(`Citation URL violates ^https?:// gate: ${seed.citation.sourceUrl}`);
      }

      // Defense-in-depth: Zod validate every seed at load time even though
      // fixtures already validate at compile time (Pattern P3).
      parseRuleBody(seed.ruleKind as RuleKind, seed.ruleBody);

      // Citation row (URL-only per D-07).
      //
      // Task 08 Delta 4 (REVIEWS.md B12): use ON CONFLICT (tenant_id,
      // citation_hash) WHERE source_url IS NOT NULL so re-running pnpm
      // db:seed reuses existing citation rows instead of creating orphan
      // duplicates. The DO UPDATE clause is a no-op trick to make
      // ON CONFLICT also return id (DO NOTHING returns zero rows when the
      // row already exists). The WHERE clause is REQUIRED — Postgres
      // demands the conflict_target predicate match the partial unique
      // index predicate exactly, otherwise it raises:
      // `there is no unique or exclusion constraint matching the
      // ON CONFLICT specification`.
      const cit = await client.query<{ id: string }>(
        `INSERT INTO rule_citation (tenant_id, source_url, excerpt)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, citation_hash) WHERE source_url IS NOT NULL
         DO UPDATE SET excerpt = EXCLUDED.excerpt
         RETURNING id::text`,
        [systemTenantId, seed.citation.sourceUrl, seed.citation.excerpt],
      );
      const citationId = cit.rows[0]!.id;

      // seedKey discriminator: prefer explicit seedKey, fall back to event_type.
      const eventType = (seed.ruleBody as { event_type?: string })?.event_type ?? null;
      const dedupeKey = seed.seedKey ?? eventType ?? '';

      await client.query(
        `INSERT INTO agency_rule (
           agency_rule_version_id, rule_kind, rule_body, primary_citation_id
         )
         SELECT $1, $2, jsonb_set($3::jsonb, '{_seed_key}', to_jsonb($5::text)), $4
         WHERE NOT EXISTS (
           SELECT 1 FROM agency_rule
           WHERE agency_rule_version_id = $1
             AND rule_kind = $2
             AND COALESCE(rule_body->>'_seed_key', rule_body->>'event_type', '') = COALESCE($5::text, '')
         )`,
        [arvId, seed.ruleKind, JSON.stringify(seed.ruleBody), citationId, dedupeKey],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* swallow */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * FHFA loader skeleton — Plan 03-07 wires the real CSV parse + per-row Zod
 * + batch INSERT path. Wave 0 ships the no-op so `pnpm db:seed` succeeds.
 */
export async function seedFhfaYear(_year: number, _csvPath: string): Promise<void> {
  // Plan 03-07 implements: read CSV via csv-parse, Zod-validate each row,
  // two-step daterange close on prior version, batch INSERT into
  // conforming_loan_limit_county.
  return;
}
