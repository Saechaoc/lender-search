/**
 * CFG-05: env-boot fail-closed contract.
 *
 * Proves that `lib/env.ts` validates required env vars at module-load time.
 * Each case mutates process.env via vi.stubEnv, resets the module cache, and
 * dynamically imports lib/env.ts so the schema is re-evaluated.
 *
 * No DB connection. Safe to run before Plan 04 (schema) or Plan 06 (DB harness).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const VALID_DB_URL = 'postgresql://user:pw@localhost:5432/lender_search_test';

describe('lib/env (CFG-05 boot-fail-closed)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    vi.stubEnv('RLS_TEST_JWT_SECRET', '');
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws when DATABASE_URL is empty (emptyStringAsUndefined → required violated)', async () => {
    vi.stubEnv('DATABASE_URL', '');
    await expect(import('../../lib/env.js')).rejects.toThrow();
  });

  it('throws when DATABASE_URL is not a valid URL', async () => {
    vi.stubEnv('DATABASE_URL', 'not-a-url');
    await expect(import('../../lib/env.js')).rejects.toThrow();
  });

  it('throws when DATABASE_URL is a URL but not a Postgres scheme', async () => {
    vi.stubEnv('DATABASE_URL', 'https://example.com');
    await expect(import('../../lib/env.js')).rejects.toThrow();
  });

  it('succeeds when DATABASE_URL is a valid postgresql:// URL', async () => {
    vi.stubEnv('DATABASE_URL', VALID_DB_URL);
    const mod = await import('../../lib/env.js');
    expect(mod.env.DATABASE_URL).toBe(VALID_DB_URL);
  });

  it('succeeds when DATABASE_URL is a valid postgres:// URL (no `ql`)', async () => {
    const url = 'postgres://u:p@h:5432/d';
    vi.stubEnv('DATABASE_URL', url);
    const mod = await import('../../lib/env.js');
    expect(mod.env.DATABASE_URL).toBe(url);
  });

  it('throws when RLS_TEST_JWT_SECRET is shorter than 16 chars', async () => {
    vi.stubEnv('DATABASE_URL', VALID_DB_URL);
    vi.stubEnv('RLS_TEST_JWT_SECRET', 'short-secret');
    await expect(import('../../lib/env.js')).rejects.toThrow();
  });

  it('succeeds when SUPABASE_SERVICE_ROLE_KEY is omitted (optional at Phase 1)', async () => {
    vi.stubEnv('DATABASE_URL', VALID_DB_URL);
    // SUPABASE_SERVICE_ROLE_KEY is left unset by beforeEach
    const mod = await import('../../lib/env.js');
    expect(mod.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });

  it('defaults NODE_ENV to "development" when unset', async () => {
    vi.stubEnv('DATABASE_URL', VALID_DB_URL);
    vi.stubEnv('NODE_ENV', '');
    const mod = await import('../../lib/env.js');
    expect(mod.env.NODE_ENV).toBe('development');
  });
});
