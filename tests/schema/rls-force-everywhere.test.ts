/**
 * Phase 3 review WR-08: every RLS-enabled table must also have FORCE.
 *
 * Drizzle 0.45's pgPolicy declarations emit `ENABLE ROW LEVEL SECURITY`
 * but NOT `FORCE ROW LEVEL SECURITY`. The FORCE clause needs a follow-up
 * --custom migration on every Drizzle-generated RLS table. The Phase 3
 * baseline got this right (migrations 0001/0003/0005/0008/0010/0011/0015
 * all add FORCE explicitly), but the responsibility for adding the FORCE
 * migration is split across reviewers — there is no schema-level signal
 * that a new RLS table requires it.
 *
 * This assertion converts "remember to add FORCE" from a code-review
 * obligation into a CI gate: `pg_class.relrowsecurity = true` AND
 * `pg_class.relforcerowsecurity = false` for any application table is a
 * test failure.
 *
 * Allowlist: __drizzle_migrations is the migration journal table itself
 * — Drizzle owns it, and it's not subject to the project's RLS contract.
 * Add other system tables to this list ONLY if they're system-owned and
 * intentionally not FORCEd; never add an application table just to make
 * this test green.
 */
import { describe, expect, it } from 'vitest';

const ALLOWLIST = new Set<string>([
  // Drizzle's own journal — managed by drizzle-kit, not by our migrations.
  '__drizzle_migrations',
]);

describe('FORCE ROW LEVEL SECURITY everywhere (WR-08)', () => {
  it('every RLS-enabled application table has relforcerowsecurity = true', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ relname: string }>(
        `SELECT n.nspname || '.' || c.relname AS relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind IN ('r', 'p')
           AND c.relrowsecurity = true
           AND c.relforcerowsecurity = false
           AND n.nspname = 'public'`,
      );
      const offenders = rows
        .map((r) => r.relname.replace(/^public\./, ''))
        .filter((name) => !ALLOWLIST.has(name));

      expect(
        offenders,
        `tables with RLS but missing FORCE: ${offenders.join(', ')}. ` +
          `Add FORCE in a follow-up --custom migration. Drizzle 0.45's pgPolicy() ` +
          `does not emit FORCE; it must be added explicitly.`,
      ).toEqual([]);
    } finally {
      adminClient.release();
    }
  });
});
