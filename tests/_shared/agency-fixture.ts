/**
 * tests/_shared/agency-fixture.ts — shared agency_rule_version bootstrap.
 *
 * Phase 2 / WR-05: extracted from the duplicated logic in
 * tests/rls/seedTwoTenants.ts (seedSharedAgency) and
 * tests/schema/fixtures/seed.ts (seedAgencyDerogRule). Both files implement
 * the same sequence:
 *   1. Look up or create the kind='SYSTEM' tenant under the postgres
 *      adminPool (Pitfall G: agency tables are system-owned and only the
 *      postgres role can write to them).
 *   2. set_config('app.tenant_id', system_tenant_id, true) so RLS WITH CHECK
 *      passes when inserting into rule_citation under that tenant.
 *   3. INSERT a rule_citation for the agency.
 *   4. INSERT an agency_rule_version with a randomized non-overlapping
 *      daterange so the agency_rule_version_no_overlap EXCLUDE constraint
 *      (migration 0004) doesn't fire across multiple seeds in a single
 *      test run.
 *
 * The duplicated implementations had drifted in minor ways (citation excerpt
 * text, version_label format) — this module standardizes them. Callers
 * layer on the rule_kind-specific INSERT (agency_rule for the schema
 * fixture; the RLS fixture only needs the ARV + citation IDs).
 *
 * The transaction commits before returning so subsequent tenant seeds see
 * the row. This preserves the previous COMMIT-before-return semantics in
 * both files; the SYSTEM tenant accumulates leftover rows across CI runs,
 * but the randomized daterange protects the EXCLUDE constraint from
 * tripping across runs (the explicit cross-run cleanup is owned by
 * deleteAllTenants / truncateAllTables, not by the seed helpers).
 */
import type { Pool, PoolClient } from 'pg';

export interface AgencyFixtureSeed {
  systemTenantId: string;
  agencyRuleVersionId: string;
  citationId: string;
}

export interface SeedAgencyVersionOptions {
  agency?: 'FNMA' | 'FHLMC' | 'FHA' | 'VA' | 'USDA';
  citationSourceUrl?: string;
  citationExcerpt?: string;
  versionSourceUrl?: string;
}

const DEFAULT_AGENCY = 'FNMA' as const;
const DEFAULT_CITATION_URL = 'https://selling-guide.fanniemae.com/B3-5.3-07';
const DEFAULT_CITATION_EXCERPT = 'shared agency citation fixture';
const DEFAULT_VERSION_SOURCE = 'https://selling-guide.fanniemae.com/2026-04';

/**
 * Get-or-create the kind='SYSTEM' tenant. Used inside an existing
 * transaction (caller is responsible for BEGIN/COMMIT). `client` is a
 * pg.PoolClient from adminPool with the GUC unset.
 */
async function ensureSystemTenant(client: PoolClient): Promise<string> {
  const lookup = await client.query<{ id: string }>(
    `SELECT id::text FROM tenant WHERE kind = 'SYSTEM' LIMIT 1`,
  );
  if (lookup.rows[0]) {
    return lookup.rows[0].id;
  }
  const created = await client.query<{ id: string }>(
    `INSERT INTO tenant (id, kind, name)
     VALUES (gen_random_uuid(), 'SYSTEM', 'Agency Hand-Authoring System Tenant')
     RETURNING id::text`,
  );
  return created.rows[0]!.id;
}

/**
 * Generate a randomized non-overlapping daterange so the
 * agency_rule_version_no_overlap EXCLUDE doesn't fire across multiple
 * seeds in a single test run.
 *
 * Phase 3 / Plan 03-02 [Rule 1 - Bug] regression fix: Wave 1 plans seed
 * real agency_rule_version rows with `effective_period =
 * '[2026-01-01,infinity)'`. Postgres daterange `&&` operator says any
 * future-year range overlaps with `infinity`, so the fixture's prior
 * `2100..102100` window collided with FNMA-SEL-2026-04 + USDA-SFH and
 * any other Wave 1 ARV. The fix is to anchor the fixture range to
 * pre-2026 historical years (year 1000 .. 2024 with a 1-year span);
 * this keeps the fixture's random ranges non-overlapping among
 * themselves AND below every real Wave 1 row's start date. Plan 01's
 * comment that "the SYSTEM tenant accumulates leftover rows across CI
 * runs" still holds — the historical window is 1024 years wide, and
 * with 1-year spans the birthday-paradox collision risk for typical
 * CI runs (≤ 1k seeds) stays well under 1%.
 */
function makeRandomEffectivePeriod(): string {
  // Phase 3 / Plan 03-02 [Rule 1 - Bug] regression fix: anchor the random
  // range pre-2026 (Wave 1 plans seed real `[2026-01-01,infinity)` rows;
  // anything ≥ 2026-01-01 collides with `infinity` per Postgres
  // `daterange &&` semantics).
  //
  // Use day-level granularity inside a 1024-year pre-2026 window. Each ARV
  // gets a 1-day range so the collision space is 1024*365 ≈ 374K unique
  // slots — wide enough for parallel sibling-worktree CI runs without
  // birthday-paradox collisions. The helper's window stays disjoint from:
  //   - Plan 03-02 superseded-by-deferrable test's [1700..1750)
  //   - Plan 03-02 agency-rule-version-exclude test's [1500..1750) and [1800..1900)
  //   - Plan 03-02 agency-rule-state test's [1900..1950)
  // (those tests use full-year ranges; the day-level fixture only collides
  //  if the test happens to pick the same exact day, which is rare and
  //  the test rolls back anyway).
  const startYear = 1000 + Math.floor(Math.random() * 1000); // [1000..1999]
  const dayOfYear = 1 + Math.floor(Math.random() * 364);     // [1..364]
  // Build YYYY-MM-DD by walking from Jan 1 of startYear forward dayOfYear days.
  // Use UTC Date to avoid TZ wrap. Use ISO substring extraction.
  const start = new Date(Date.UTC(startYear, 0, 1));
  start.setUTCDate(start.getUTCDate() + dayOfYear);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const startIso = start.toISOString().slice(0, 10);
  const endIso = end.toISOString().slice(0, 10);
  return `[${startIso},${endIso})`;
}

/**
 * Seed a fresh agency_rule_version + citation under the SYSTEM tenant.
 *
 * Runs in its own transaction. Returns the IDs needed by callers layering
 * a per-rule_kind agency_rule INSERT on top (e.g. seedAgencyDerogRule) or
 * referencing the ARV from per-tenant program_version FKs (e.g.
 * seedTwoTenants).
 */
export async function seedAgencyVersion(
  adminPool: Pool,
  options: SeedAgencyVersionOptions = {},
): Promise<AgencyFixtureSeed> {
  const agency = options.agency ?? DEFAULT_AGENCY;
  const citationSourceUrl = options.citationSourceUrl ?? DEFAULT_CITATION_URL;
  const citationExcerpt = options.citationExcerpt ?? DEFAULT_CITATION_EXCERPT;
  const versionSourceUrl = options.versionSourceUrl ?? DEFAULT_VERSION_SOURCE;
  const effectivePeriod = makeRandomEffectivePeriod();

  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');

    const systemTenantId = await ensureSystemTenant(client);
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [systemTenantId]);

    // Phase 3 / Plan 03-01 Task 08 Delta 4 (REVIEWS.md B12) compatibility:
    // the partial unique index `rule_citation_unique_idx` on
    // `(tenant_id, citation_hash) WHERE source_url IS NOT NULL` rejects
    // duplicate INSERTs with the same (tenant_id, source_url, page_number,
    // excerpt) triple. Multiple test calls to seedAgencyVersion under the
    // shared SYSTEM tenant with the DEFAULT_CITATION_URL would collide;
    // ON CONFLICT (tenant_id, citation_hash) WHERE source_url IS NOT NULL
    // DO UPDATE returns the existing id (DO NOTHING returns zero rows on
    // conflict). The WHERE clause is REQUIRED to match the partial index
    // predicate exactly — Postgres raises 'no unique or exclusion
    // constraint matching the ON CONFLICT specification' otherwise.
    const cit = await client.query<{ id: string }>(
      `INSERT INTO rule_citation (tenant_id, source_url, excerpt)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, citation_hash) WHERE source_url IS NOT NULL
       DO UPDATE SET excerpt = EXCLUDED.excerpt
       RETURNING id::text`,
      [systemTenantId, citationSourceUrl, citationExcerpt],
    );
    const citationId = cit.rows[0]!.id;

    const arv = await client.query<{ id: string }>(
      `INSERT INTO agency_rule_version (agency, version_label, source_url, effective_period)
       VALUES ($1, 'SEL-' || gen_random_uuid()::text, $2, $3::daterange)
       RETURNING id::text`,
      [agency, versionSourceUrl, effectivePeriod],
    );
    const agencyRuleVersionId = arv.rows[0]!.id;

    await client.query('COMMIT');
    return { systemTenantId, agencyRuleVersionId, citationId };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* swallow */
    }
    throw err;
  } finally {
    client.release();
  }
}
