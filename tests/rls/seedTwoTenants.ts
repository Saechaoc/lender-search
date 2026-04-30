/**
 * seedTwoTenants — creates two tenants + canary rows + program family rows
 * per tenant. Phase 1 baseline + Phase 2 D-19 extension.
 *
 * Implements the bootstrap pattern (RESEARCH §Pitfall 7) because the
 * tenant table's self-filtering policy `using id = current_setting(...)`
 * means a new tenant can only be inserted when the GUC matches the new
 * tenant's id. Pattern:
 *
 *   1. Generate the new tenant's UUID server-side (gen_random_uuid).
 *   2. set_config('app.tenant_id', new_uuid, true).
 *   3. INSERT INTO tenant (id, ...) VALUES (new_uuid, ...).
 *      WITH CHECK passes because id == GUC.
 *   4. INSERT INTO _rls_canary (tenant_id, ...) VALUES (new_uuid, ...).
 *      WITH CHECK passes because tenant_id == GUC.
 *
 * Each tenant is seeded in its OWN transaction so the GUC resets between
 * them — the second tenant cannot see the first via leftover GUC state.
 *
 * Phase 2 D-19 extension: ALSO creates rule_citation + program +
 * program_version (state='active') + program_rule per tenant so the new
 * cross-tenant pen tests have rows to target.
 *
 * The shared agency_rule_version is seeded under the postgres adminPool
 * (Pitfall G — agency tables require system_role policy) before any tenant
 * seeds. This row's UUID is in the result so all tests can reference it.
 *
 * Per Plan 02-09 / Issue Plan-revision-2026-04-30 / W5: this fixture lives at
 * tests/rls/seedTwoTenants.ts (top-level), not tests/rls/fixtures/tenants.ts.
 * The Plan 01-06 baseline at fixtures/tenants.ts was relocated by Plan 02-09
 * as a Rule 3 deviation (plan-mandated path doesn't match Phase 1 layout).
 */
import type { Pool } from 'pg';

export interface SeedResult {
  // Phase 1 baseline
  tenantA: string;
  tenantB: string;
  canaryA: string;
  canaryB: string;
  // Phase 2 D-19 extension
  sharedAgencyRuleVersionId: string;
  sharedAgencyCitationId: string;
  programA: string;
  programB: string;
  programVersionA: string;
  programVersionB: string;
  programRuleA: string;
  programRuleB: string;
  citationA: string;
  citationB: string;
}

/**
 * Seed an agency_rule_version + a citation under the postgres connection.
 * Returns the IDs for use in subsequent tenant seeding.
 *
 * Per Pitfall G: agency_rule_version + agency_rule are system-owned
 * (system_role policy); only the postgres role can write to them. The
 * adminPool connection-string yields a postgres-superuser session.
 *
 * Generates a non-overlapping daterange per call so the
 * agency_rule_version_no_overlap EXCLUDE constraint (Plan 02-06) doesn't
 * fire across multiple seedTwoTenants invocations within a single test run
 * — same pattern as tests/schema/fixtures/seed.ts::seedAgencyDerogRule.
 */
async function seedSharedAgency(
  adminPool: Pool,
): Promise<{ agencyRuleVersionId: string; citationId: string }> {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');

    // System tenant for agency citations (RLS-policed; system-tenant rows
    // are visible to system_role).
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

    const cit = await client.query<{ id: string }>(
      `INSERT INTO rule_citation (tenant_id, source_url, excerpt)
       VALUES ($1, 'https://selling-guide.fanniemae.com/B3-5.3-07', 'shared agency citation')
       RETURNING id::text`,
      [systemTenantId],
    );
    const citationId = cit.rows[0]!.id;

    // Non-overlapping daterange per call — uses a wide random window so the
    // EXCLUDE (agency WITH =, effective_period WITH &&) constraint doesn't
    // fire across multiple seedTwoTenants() calls in a single suite run.
    const startYear = 2100 + Math.floor(Math.random() * 100000);
    const effectivePeriod = `[${startYear}-01-01,${startYear + 1}-01-01)`;

    const arv = await client.query<{ id: string }>(
      `INSERT INTO agency_rule_version (agency, version_label, source_url, effective_period)
       VALUES ('FNMA', 'SEL-' || gen_random_uuid()::text, 'https://selling-guide.fanniemae.com/2026-04', $1::daterange)
       RETURNING id::text`,
      [effectivePeriod],
    );
    const agencyRuleVersionId = arv.rows[0]!.id;

    await client.query('COMMIT');
    return { agencyRuleVersionId, citationId };
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

/**
 * Seed one tenant + canary + program family. Used internally by
 * seedTwoTenants for both A and B; each runs in its own transaction so the
 * GUC resets.
 *
 * Insert order (Pitfall F): rule_citation MUST exist before program_rule
 * INSERTs that FK to it. The order below honors the FK chain
 * tenant → rule_citation → program → program_version → program_rule.
 */
async function seedOneTenantWithProgramFamily(
  pool: Pool,
  agencyRuleVersionId: string,
  label: string,
): Promise<{
  tenantId: string;
  canaryId: string;
  programId: string;
  programVersionId: string;
  programRuleId: string;
  citationId: string;
}> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. tenant (bootstrap pattern — generate uuid, set_config, INSERT).
    const idResult = await client.query<{ id: string }>(
      `SELECT gen_random_uuid()::text AS id`,
    );
    const tenantId = idResult.rows[0]!.id;
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await client.query(
      `INSERT INTO tenant (id, kind, name) VALUES ($1, 'BROKERAGE', $2)`,
      [tenantId, `Tenant ${label}`],
    );

    // 2. canary (Phase 1 baseline).
    const canaryResult = await client.query<{ id: string }>(
      `INSERT INTO _rls_canary (tenant_id, payload) VALUES ($1, $2) RETURNING id::text`,
      [tenantId, `${label}-payload`],
    );
    const canaryId = canaryResult.rows[0]!.id;

    // 3. rule_citation (NEEDED by program_rule.primary_citation_id FK).
    const citationResult = await client.query<{ id: string }>(
      `INSERT INTO rule_citation (tenant_id, source_url, excerpt)
       VALUES ($1, $2, $3) RETURNING id::text`,
      [
        tenantId,
        `https://${label.toLowerCase()}.example/matrix.pdf`,
        `${label} citation excerpt`,
      ],
    );
    const citationId = citationResult.rows[0]!.id;

    // 4. program (parent for program_version).
    const programResult = await client.query<{ id: string }>(
      `INSERT INTO program (tenant_id, lender, channel, name)
       VALUES ($1, $2, 'wholesale', $3) RETURNING id::text`,
      [tenantId, `Lender ${label}`, `Bank Statement 24-mo ${label}`],
    );
    const programId = programResult.rows[0]!.id;

    // 5. program_version (active; FK to shared agency_rule_version).
    const versionResult = await client.query<{ id: string }>(
      `INSERT INTO program_version (
         tenant_id, program_id, agency_rule_version_id,
         effective_period, state, source_document_fingerprint
       ) VALUES ($1, $2, $3, '[2026-01-01,2027-01-01)', 'active', $4)
       RETURNING id::text`,
      [tenantId, programId, agencyRuleVersionId, `sha256:${label}-fixture`],
    );
    const programVersionId = versionResult.rows[0]!.id;

    // 6. program_rule (one INVESTOR_OVERLAY ltv_max so cross-tenant tests
    //    have a row to target).
    const ruleResult = await client.query<{ id: string }>(
      `INSERT INTO program_rule (
         tenant_id, program_version_id, layer, rule_kind, rule_body, primary_citation_id
       ) VALUES ($1, $2, 'INVESTOR_OVERLAY', 'ltv_max', '{"value": 80}'::jsonb, $3)
       RETURNING id::text`,
      [tenantId, programVersionId, citationId],
    );
    const programRuleId = ruleResult.rows[0]!.id;

    await client.query('COMMIT');
    return { tenantId, canaryId, programId, programVersionId, programRuleId, citationId };
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

/**
 * Phase 2 D-19 extension: seed two tenants + each tenant's program family.
 *
 * Requires an adminPool (postgres role) for the shared agency_rule_version
 * seed (Pitfall G). Falls back to deriving from the existing __pgAdminPool
 * global if not provided — works around the Vitest 4 module-context boundary
 * (Plan 01-06 §Rule 3) where setupFiles globals may not propagate from
 * globalSetup. setup.ts's beforeAll constructs __pgAdminPool defensively.
 */
export async function seedTwoTenants(
  pool: Pool,
  adminPool?: Pool,
): Promise<SeedResult> {
  const adminPoolToUse =
    adminPool ?? (globalThis as { __pgAdminPool?: Pool }).__pgAdminPool;
  if (!adminPoolToUse) {
    throw new Error(
      'seedTwoTenants requires adminPool (or globalThis.__pgAdminPool) for agency_rule_version seeding (Pitfall G)',
    );
  }

  // Step 1: shared agency_rule_version + citation (system tenant).
  const shared = await seedSharedAgency(adminPoolToUse);

  // Step 2: tenant A's program family.
  const a = await seedOneTenantWithProgramFamily(pool, shared.agencyRuleVersionId, 'A');

  // Step 3: tenant B's program family (separate transaction; GUC resets).
  const b = await seedOneTenantWithProgramFamily(pool, shared.agencyRuleVersionId, 'B');

  return {
    tenantA: a.tenantId,
    tenantB: b.tenantId,
    canaryA: a.canaryId,
    canaryB: b.canaryId,
    sharedAgencyRuleVersionId: shared.agencyRuleVersionId,
    sharedAgencyCitationId: shared.citationId,
    programA: a.programId,
    programB: b.programId,
    programVersionA: a.programVersionId,
    programVersionB: b.programVersionId,
    programRuleA: a.programRuleId,
    programRuleB: b.programRuleId,
    citationA: a.citationId,
    citationB: b.citationId,
  };
}

/**
 * Cleanup helper — TRUNCATE every Phase 1 + Phase 2 table. Used between
 * describe blocks if a test wants a fresh seed without running globalSetup
 * again. globalSetup's TRUNCATE handles suite-level cleanup; this helper
 * is for narrower cases.
 *
 * Connects as the migration role (postgres / adminPool) because
 * truncating tenant requires bypassing the self-filter policy.
 */
export async function deleteAllTenants(adminPool: Pool): Promise<void> {
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
