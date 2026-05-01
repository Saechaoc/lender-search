/**
 * tests/schema/fixtures/seed.ts — bootstrap helpers for schema-constraint tests.
 *
 * Reuses Phase 1 Pitfall 7 bootstrap (set_config + INSERT tenant with id=GUC)
 * for tenant-scoped writes; uses postgres connection for agency-side writes
 * (Pitfall G).
 */
import type { Pool } from 'pg';
import type { DerogSeasoning } from '../../../lib/rules/schemas/derog-seasoning.js';
import { seedAgencyVersion } from '../../_shared/agency-fixture.js';

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
  // Per WR-05: delegate the SYSTEM-tenant + ARV + citation bootstrap to the
  // shared module so this stays in lockstep with seedTwoTenants. The
  // _effectivePeriodHint param is kept for backward compatibility but
  // ignored — the shared module randomizes the daterange to avoid the
  // agency_rule_version_no_overlap EXCLUDE tripping across multiple seeds
  // in a single test run.
  const bootstrap = await seedAgencyVersion(adminPool, {
    agency,
    citationExcerpt: 'FNMA derog matrix excerpt',
  });

  // Layer the per-rule_kind agency_rule INSERT under the same admin
  // connection. This runs in its OWN transaction (the shared bootstrap
  // already committed before returning), which is fine because the FK
  // target (agency_rule_version) is now visible.
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [bootstrap.systemTenantId]);

    const ruleResult = await client.query<{ id: string }>(
      `INSERT INTO agency_rule (agency_rule_version_id, rule_kind, rule_body, primary_citation_id)
       VALUES ($1, 'derog_seasoning', $2::jsonb, $3)
       RETURNING id::text`,
      [bootstrap.agencyRuleVersionId, JSON.stringify(derogBody), bootstrap.citationId],
    );
    const agencyRuleId = ruleResult.rows[0]!.id;

    await client.query('COMMIT');
    return {
      agencyRuleVersionId: bootstrap.agencyRuleVersionId,
      agencyRuleId,
      citationId: bootstrap.citationId,
    };
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
