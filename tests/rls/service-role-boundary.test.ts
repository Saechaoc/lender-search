/**
 * TNT-02 (service-role) / T-01-04: SUPABASE_SERVICE_ROLE_KEY (BYPASSRLS) must
 * never be present in the application request path's env.
 *
 * Phase 1 defense: env-var segregation (CONTEXT §D-02). The pen test
 * connects with the pen-test env, which intentionally does NOT define
 * SUPABASE_SERVICE_ROLE_KEY. The corresponding ESLint import-block rule
 * (Plan 08 eslint.config.mjs) is the second layer; it cannot be tested
 * here because no app code exists yet. Plan 08 ships an ESLint smoke test
 * fixture to exercise the rule statically.
 *
 * Closes D-03 row #5.
 */
import { describe, expect, it } from 'vitest';

describe('Service-role boundary (env-var segregation; T-01-04)', () => {
  it('SUPABASE_SERVICE_ROLE_KEY is NOT in the test process env', () => {
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });

  it('DATABASE_URL points at app_user (NOT postgres superuser)', () => {
    const dbUrl = process.env.DATABASE_URL;
    expect(dbUrl).toBeDefined();
    expect(dbUrl).toContain('app_user'); // username segment
    expect(dbUrl).not.toMatch(/postgres:postgres@/); // superuser pattern
  });

  it('test process cannot construct a BYPASSRLS connection string from env alone', () => {
    // Defense-in-depth: even if SUPABASE_SERVICE_ROLE_KEY appeared in env,
    // the test path would have to use it explicitly to connect. Plan 08
    // ESLint rule blocks `process.env.SUPABASE_SERVICE_ROLE_KEY` access from
    // app paths; here we just confirm the env contract.
    const allEnvKeys = Object.keys(process.env).filter((k) => k.includes('SERVICE_ROLE'));
    expect(allEnvKeys).toEqual([]);
  });
});
