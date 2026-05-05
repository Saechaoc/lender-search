/**
 * Phase 3 / Plan 03-01 Task 08 Delta 5 (REVIEWS.md A3a).
 *
 * Asserts:
 *   - rule_snapshot table exists with sha256_hash UNIQUE
 *   - persistSnapshot is idempotent (same input → same id across runs)
 *   - loadSnapshot(hash) returns the same bundle that was persisted (round-trip)
 *   - After pnpm db:seed: at least 1 rule_snapshot row exists
 */
import { describe, expect, it } from 'vitest';
import { persistSnapshot, loadSnapshot, captureCurrentBundle } from '../../lib/audit/snapshot-persistence.js';
import { snapshotId, type SnapshotInput } from '../../lib/audit/snapshotId.js';

describe('rule_snapshot table + persistence helpers (A3a / Delta 5)', () => {
  it('rule_snapshot table has sha256_hash UNIQUE', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes
         WHERE tablename = 'rule_snapshot' AND indexdef ILIKE '%UNIQUE%'`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.some((r) => r.indexdef.includes('sha256_hash'))).toBe(true);
    } finally {
      adminClient.release();
    }
  });

  it('persistSnapshot is idempotent (same input → same id)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const bundle: SnapshotInput = {
        agencyVersions: [
          { id: '11111111-1111-1111-1111-111111111111', recorded_at: '2026-05-01T00:00:00.000Z' },
        ],
        programVersions: [],
        overlayVersions: [],
      };
      const first = await persistSnapshot(adminClient, bundle);
      const second = await persistSnapshot(adminClient, bundle);
      expect(second.id).toBe(first.id);
      expect(second.hash).toBe(first.hash);
      expect(second.hash).toBe(snapshotId(bundle));
    } finally {
      adminClient.release();
    }
  });

  it('loadSnapshot returns the same bundle that was persisted (round-trip)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const bundle: SnapshotInput = {
        agencyVersions: [
          { id: '22222222-2222-2222-2222-222222222222', recorded_at: '2026-06-01T00:00:00.000Z' },
        ],
        programVersions: [
          { id: '33333333-3333-3333-3333-333333333333', recorded_at: '2026-06-02T00:00:00.000Z' },
        ],
        overlayVersions: [],
      };
      const { hash } = await persistSnapshot(adminClient, bundle);
      const loaded = await loadSnapshot(adminClient, hash);
      expect(loaded).not.toBeNull();
      expect(loaded?.agencyVersions).toEqual(bundle.agencyVersions);
      expect(loaded?.programVersions).toEqual(bundle.programVersions);
      expect(loaded?.overlayVersions).toEqual([]);
    } finally {
      adminClient.release();
    }
  });

  it('after seed, at least 1 rule_snapshot row exists with valid sha256_hash', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ count_text: string }>(
        `SELECT count(*)::text AS count_text FROM rule_snapshot`,
      );
      expect(Number(rows[0]?.count_text)).toBeGreaterThanOrEqual(1);

      // Verify at least one row's sha256_hash is a 64-char lowercase hex.
      const sample = await adminClient.query<{ sha256_hash: string }>(
        `SELECT sha256_hash FROM rule_snapshot LIMIT 1`,
      );
      expect(sample.rows[0]?.sha256_hash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      adminClient.release();
    }
  });

  it('captureCurrentBundle returns a SnapshotInput hydrated from live tables', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const bundle = await captureCurrentBundle(adminClient);
      expect(Array.isArray(bundle.agencyVersions)).toBe(true);
      expect(Array.isArray(bundle.programVersions)).toBe(true);
      expect(Array.isArray(bundle.overlayVersions)).toBe(true);
      // Recorded_at strings must be ISO 8601 (Pitfall PG-3).
      for (const v of bundle.agencyVersions) {
        expect(v.recorded_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      }
    } finally {
      adminClient.release();
    }
  });
});
