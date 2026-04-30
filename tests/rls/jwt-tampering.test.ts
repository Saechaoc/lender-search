/**
 * TNT-02 (JWT) / T-01-03: forged JWT with foreign tenant_id is structurally
 * neutralized — even when the GUC is set to the tampered value, RLS still
 * returns zero rows for queries on tenants the user doesn't have data in.
 *
 * Phase 1 has no user table or auth flow — the test exercises the GUC-only
 * path. Phase 6 layers JWT signature verification on top: a forged JWT
 * (signed with the wrong key) won't reach the GUC-set step.
 *
 * Closes D-03 row #4.
 */
import { describe, expect, it } from 'vitest';
import { connectAsTenant } from './fixtures/connection.js';
import { extractTenantIdFromJWT, forgeJWT } from './fixtures/jwt.js';
import { seedTwoTenants } from './fixtures/tenants.js';

describe('RLS: JWT tampering', () => {
  it('forgeJWT + extractTenantIdFromJWT round-trips the tampered tenant_id (sanity)', async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool);
    const forged = await forgeJWT({
      tenantId: seed.tenantA,
      tamperedTenantId: seed.tenantB,
    });
    const extracted = await extractTenantIdFromJWT(forged);
    expect(extracted).toBe(seed.tenantB);
  });

  it('forged JWT pointing at a non-existent tenant → 0 rows (RLS filters)', async () => {
    await seedTwoTenants(globalThis.__pgPool);
    const fakeTenantId = '00000000-0000-0000-0000-000000000000';
    const forged = await forgeJWT({
      tenantId: fakeTenantId,
      tamperedTenantId: fakeTenantId,
    });
    const extracted = await extractTenantIdFromJWT(forged);
    await connectAsTenant(globalThis.__pgPool, extracted, async (client) => {
      const { rows } = await client.query(`SELECT id FROM _rls_canary`);
      expect(rows).toHaveLength(0);
    });
  });

  it("forged JWT pointing at Tenant B while user 'belongs to' A → A's rows are 0 (the tampered GUC is B; cannot see A)", async () => {
    const seed = await seedTwoTenants(globalThis.__pgPool);
    // Forge a JWT that claims B even though the user (in a real system) belongs to A.
    const forged = await forgeJWT({
      tenantId: seed.tenantA,
      tamperedTenantId: seed.tenantB,
    });
    const extracted = await extractTenantIdFromJWT(forged);
    // Set the GUC to the tampered tenant id (B). Querying for A's canary id
    // returns 0 rows because B's RLS context does not see A's row. The
    // structural property: the GUC determines visibility, not the user's
    // "real" tenant. Phase 6 adds JWT signature verification so a tampered
    // JWT never reaches this path in production code.
    await connectAsTenant(globalThis.__pgPool, extracted, async (client) => {
      // Query for A's canary id — A's rows are NOT visible from B's GUC.
      const { rows } = await client.query(`SELECT id FROM _rls_canary WHERE id = $1`, [
        seed.canaryA,
      ]);
      expect(rows).toHaveLength(0);
    });
  });
});
