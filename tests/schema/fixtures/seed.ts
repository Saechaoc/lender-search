/**
 * tests/schema/fixtures/seed.ts — bootstrap helpers for schema-constraint tests.
 *
 * Reuses Phase 1 Pitfall 7 bootstrap (set_config + INSERT tenant with id=GUC)
 * for tenant-scoped writes; uses postgres connection for agency-side writes
 * (Pitfall G).
 */
import type { Pool } from 'pg';
import type { DerogSeasoning } from '../../../lib/rules/schemas/derog-seasoning.js';

export interface TenantSeed {
  tenantId: string;
  programId: string;
  citationId: string;
  programVersionId: string;
}

export async function seedTenantWithProgramAndCitation(
  pool: Pool,
  _adminPool: Pool,
  agencyRuleVersionId: string,
): Promise<TenantSeed> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const idResult = await client.query<{ id: string }>(`SELECT gen_random_uuid()::text AS id`);
    const tenantId = idResult.rows[0]!.id;

    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

    await client.query(
      `INSERT INTO tenant (id, kind, name) VALUES ($1, 'BROKERAGE', 'Schema Test Tenant')`,
      [tenantId],
    );

    const programResult = await client.query<{ id: string }>(
      `INSERT INTO program (tenant_id, lender, channel, name)
       VALUES ($1, 'PennyMac TPO', 'wholesale', 'Bank Statement 24-mo DSCR')
       RETURNING id::text`,
      [tenantId],
    );
    const programId = programResult.rows[0]!.id;

    const citationResult = await client.query<{ id: string }>(
      `INSERT INTO rule_citation (tenant_id, source_url, excerpt)
       VALUES ($1, 'https://lender.example/matrix.pdf', 'Test excerpt for schema fixture')
       RETURNING id::text`,
      [tenantId],
    );
    const citationId = citationResult.rows[0]!.id;

    const versionResult = await client.query<{ id: string }>(
      `INSERT INTO program_version (
         tenant_id, program_id, agency_rule_version_id,
         effective_period, state, source_document_fingerprint
       ) VALUES ($1, $2, $3, '[2026-01-01,2027-01-01)', 'draft', 'sha256:fixture')
       RETURNING id::text`,
      [tenantId, programId, agencyRuleVersionId],
    );
    const programVersionId = versionResult.rows[0]!.id;

    await client.query('COMMIT');
    return { tenantId, programId, citationId, programVersionId };
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

export async function seedAgencyDerogRule(
  adminPool: Pool,
  agency: 'FNMA' | 'FHLMC' | 'FHA' | 'VA' | 'USDA',
  _effectivePeriodHint: string,
  derogBody: DerogSeasoning,
): Promise<{ agencyRuleVersionId: string; agencyRuleId: string; citationId: string }> {
  // Generate a unique non-overlapping daterange per call so the
  // agency_rule_version_no_overlap EXCLUDE constraint doesn't fire across
  // multiple seed invocations within a test run. The hint param is kept for
  // backward compatibility but ignored — Phase 3 hand-authoring will use
  // real dated ranges; Phase 2 tests just need uniqueness.
  const startYear = 2100 + Math.floor(Math.random() * 100000);
  const effectivePeriod = `[${startYear}-01-01,${startYear + 1}-01-01)`;
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');

    let systemTenantId: string;
    const lookup = await client.query<{ id: string }>(
      `SELECT id::text FROM tenant WHERE kind = 'SYSTEM' LIMIT 1`,
    );
    if (lookup.rows[0]) {
      systemTenantId = lookup.rows[0].id;
    } else {
      const created = await client.query<{ id: string }>(
        `INSERT INTO tenant (id, kind, name)
         VALUES (gen_random_uuid(), 'SYSTEM', 'Agency Hand-Authoring System Tenant')
         RETURNING id::text`,
      );
      systemTenantId = created.rows[0]!.id;
    }

    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [systemTenantId]);

    const citationResult = await client.query<{ id: string }>(
      `INSERT INTO rule_citation (tenant_id, source_url, excerpt)
       VALUES ($1, 'https://selling-guide.fanniemae.com/B3-5.3-07', 'FNMA derog matrix excerpt')
       RETURNING id::text`,
      [systemTenantId],
    );
    const citationId = citationResult.rows[0]!.id;

    const arvResult = await client.query<{ id: string }>(
      `INSERT INTO agency_rule_version (agency, version_label, source_url, effective_period)
       VALUES ($1, 'SEL-' || gen_random_uuid()::text, 'https://selling-guide.fanniemae.com/2026-04', $2::daterange)
       RETURNING id::text`,
      [agency, effectivePeriod],
    );
    const agencyRuleVersionId = arvResult.rows[0]!.id;

    const ruleResult = await client.query<{ id: string }>(
      `INSERT INTO agency_rule (agency_rule_version_id, rule_kind, rule_body, primary_citation_id)
       VALUES ($1, 'derog_seasoning', $2::jsonb, $3)
       RETURNING id::text`,
      [agencyRuleVersionId, JSON.stringify(derogBody), citationId],
    );
    const agencyRuleId = ruleResult.rows[0]!.id;

    await client.query('COMMIT');
    return { agencyRuleVersionId, agencyRuleId, citationId };
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

export async function truncateAllTables(adminPool: Pool): Promise<void> {
  const client = await adminPool.connect();
  try {
    await client.query(
      `TRUNCATE TABLE
         program_rule, program_version, program, lender_overlay_rule,
         agency_rule, agency_rule_version, rule_citation, _rls_canary, tenant
       CASCADE`,
    );
  } finally {
    client.release();
  }
}
