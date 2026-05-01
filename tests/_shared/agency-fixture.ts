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
 * seeds in a single test run. The wide random window (100k years) makes
 * collisions in long CI runs vanishingly unlikely.
 */
function makeRandomEffectivePeriod(): string {
  const startYear = 2100 + Math.floor(Math.random() * 100000);
  return `[${startYear}-01-01,${startYear + 1}-01-01)`;
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

    const cit = await client.query<{ id: string }>(
      `INSERT INTO rule_citation (tenant_id, source_url, excerpt)
       VALUES ($1, $2, $3)
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
