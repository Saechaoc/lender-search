/**
 * Phase 3 review WR-07: enqueue_agency_cascade is SECURITY DEFINER + owned
 * by postgres so RLS WITH CHECK on cascade_review_queue cannot silently
 * drop cross-tenant fan-out rows when the inserter is not a system_role
 * member.
 *
 * Migration 0019 redefines the function via CREATE OR REPLACE.
 */
import { describe, expect, it } from 'vitest';

describe('enqueue_agency_cascade SECURITY DEFINER (WR-07 / migration 0019)', () => {
  it('function is SECURITY DEFINER (prosecdef = true)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ prosecdef: boolean }>(
        `SELECT prosecdef FROM pg_proc
         WHERE proname = 'enqueue_agency_cascade'
           AND pronamespace = 'public'::regnamespace`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.prosecdef).toBe(true);
    } finally {
      adminClient.release();
    }
  });

  it('function is owned by postgres', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ proowner_name: string }>(
        `SELECT pg_get_userbyid(proowner) AS proowner_name FROM pg_proc
         WHERE proname = 'enqueue_agency_cascade'
           AND pronamespace = 'public'::regnamespace`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.proowner_name).toBe('postgres');
    } finally {
      adminClient.release();
    }
  });

  it('function has search_path pinned to public, pg_catalog', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ proconfig: string[] | null }>(
        `SELECT proconfig FROM pg_proc
         WHERE proname = 'enqueue_agency_cascade'
           AND pronamespace = 'public'::regnamespace`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.proconfig).toEqual(
        expect.arrayContaining([expect.stringMatching(/^search_path=public,\s*pg_catalog$/)]),
      );
    } finally {
      adminClient.release();
    }
  });
});
