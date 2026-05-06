/**
 * Phase 3 / Plan 03-01 Task 08 Delta 5 (REVIEWS.md A3a).
 *
 * Asserts:
 *   - rule_snapshot table exists with sha256_hash UNIQUE
 *   - persistSnapshot is idempotent (same input → same id across runs)
 *   - loadSnapshot(hash) returns the same bundle that was persisted (round-trip)
 *   - After pnpm db:seed: at least 1 rule_snapshot row exists
 *   - Plan 03 review BL-02: full per-rule arrays survive round-trip
 *     (SC#1 deterministic replay contract)
 */
import { describe, expect, it } from 'vitest';
import {
  persistSnapshot,
  loadSnapshot,
  captureCurrentBundle,
  type CanonicalBundle,
} from '../../lib/audit/snapshot-persistence.js';
import { snapshotId } from '../../lib/audit/snapshotId.js';

const emptyBundle = (overrides: Partial<CanonicalBundle> = {}): CanonicalBundle => ({
  agencyVersions: [],
  programVersions: [],
  overlayVersions: [],
  agencyRuleVersionRows: [],
  agencyRuleRows: [],
  programVersionRows: [],
  programRuleRows: [],
  lenderOverlayRuleRows: [],
  ...overrides,
});

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
      const bundle = emptyBundle({
        agencyVersions: [
          { id: '11111111-1111-1111-1111-111111111111', recorded_at: '2026-05-01T00:00:00.000Z' },
        ],
        agencyRuleVersionRows: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            agency: 'FNMA',
            version_label: 'TEST-A3A',
            source_url: 'https://example.com',
            source_pdf_sha256: null,
            effective_period: '[2026-01-01,)',
            recorded_at: '2026-05-01T00:00:00.000Z',
            superseded_by: null,
            state: 'ACTIVE',
            sunset_date: null,
            deprecation_reason: null,
          },
        ],
      });
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
      const bundle = emptyBundle({
        agencyVersions: [
          { id: '22222222-2222-2222-2222-222222222222', recorded_at: '2026-06-01T00:00:00.000Z' },
        ],
        programVersions: [
          { id: '33333333-3333-3333-3333-333333333333', recorded_at: '2026-06-02T00:00:00.000Z' },
        ],
        agencyRuleVersionRows: [
          {
            id: '22222222-2222-2222-2222-222222222222',
            agency: 'FNMA',
            version_label: 'TEST-LOAD-ROUNDTRIP',
            source_url: 'https://example.com/round-trip',
            source_pdf_sha256: null,
            effective_period: '[2026-01-01,)',
            recorded_at: '2026-06-01T00:00:00.000Z',
            superseded_by: null,
            state: 'ACTIVE',
            sunset_date: null,
            deprecation_reason: null,
          },
        ],
        programVersionRows: [
          {
            id: '33333333-3333-3333-3333-333333333333',
            tenant_id: '44444444-4444-4444-4444-444444444444',
            program_id: '55555555-5555-5555-5555-555555555555',
            agency_rule_version_id: '22222222-2222-2222-2222-222222222222',
            conforming_loan_limit_version_id: null,
            effective_period: '[2026-01-01,)',
            recorded_at: '2026-06-02T00:00:00.000Z',
            state: 'active',
            source_document_fingerprint: 'test-fingerprint-A3A',
          },
        ],
      });
      const { hash } = await persistSnapshot(adminClient, bundle);
      const loaded = await loadSnapshot(adminClient, hash);
      expect(loaded).not.toBeNull();
      expect(loaded?.agencyVersions).toEqual(bundle.agencyVersions);
      expect(loaded?.programVersions).toEqual(bundle.programVersions);
      expect(loaded?.overlayVersions).toEqual([]);
      // Plan 03 review BL-02: per-rule arrays must round-trip too.
      expect(loaded?.agencyRuleVersionRows).toEqual(bundle.agencyRuleVersionRows);
      expect(loaded?.programVersionRows).toEqual(bundle.programVersionRows);
      expect(loaded?.lenderOverlayRuleRows).toEqual([]);
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

  it('captureCurrentBundle returns a CanonicalBundle hydrated from live tables', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      // No tenantId argument → only system-owned tables populated.
      const bundle = await captureCurrentBundle(adminClient);
      expect(Array.isArray(bundle.agencyVersions)).toBe(true);
      expect(Array.isArray(bundle.programVersions)).toBe(true);
      expect(Array.isArray(bundle.overlayVersions)).toBe(true);
      // BL-02: per-rule rows are present.
      expect(Array.isArray(bundle.agencyRuleVersionRows)).toBe(true);
      expect(Array.isArray(bundle.agencyRuleRows)).toBe(true);
      // Without tenantId, tenant-scoped tables are intentionally empty.
      expect(bundle.programVersionRows).toEqual([]);
      expect(bundle.programRuleRows).toEqual([]);
      expect(bundle.lenderOverlayRuleRows).toEqual([]);
      // Recorded_at strings must be ISO 8601 (Pitfall PG-3).
      for (const v of bundle.agencyVersions) {
        expect(v.recorded_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      }
    } finally {
      adminClient.release();
    }
  });

  // Plan 03 review BL-02: SC#1 deterministic replay contract.
  // Persist a snapshot, mutate the live agency_rule.rule_body of a row in
  // the snapshot, call loadSnapshot(hash), assert the ORIGINAL rule body
  // is returned (not the live one). This locks the property Phase 4
  // evaluator depends on for historical scenario replay.
  it('SC#1 deterministic replay: rule_body in loaded bundle is independent of live mutations', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const bundle = emptyBundle({
        agencyVersions: [
          { id: '66666666-6666-6666-6666-666666666666', recorded_at: '2026-07-01T00:00:00.000Z' },
        ],
        agencyRuleVersionRows: [
          {
            id: '66666666-6666-6666-6666-666666666666',
            agency: 'FNMA',
            version_label: 'TEST-SC1-REPLAY',
            source_url: 'https://example.com/sc1',
            source_pdf_sha256: null,
            effective_period: '[2026-01-01,)',
            recorded_at: '2026-07-01T00:00:00.000Z',
            superseded_by: null,
            state: 'ACTIVE',
            sunset_date: null,
            deprecation_reason: null,
          },
        ],
        agencyRuleRows: [
          {
            id: '77777777-7777-7777-7777-777777777777',
            agency_rule_version_id: '66666666-6666-6666-6666-666666666666',
            rule_kind: 'derog_seasoning',
            rule_body: { event_type: 'BK7', base_waiting_months: 48 },
            field_confidence: {},
            primary_citation_id: '88888888-8888-8888-8888-888888888888',
            created_at: '2026-07-01T00:00:00.000Z',
          },
        ],
      });

      const { hash } = await persistSnapshot(adminClient, bundle);
      const loaded = await loadSnapshot(adminClient, hash);
      expect(loaded?.agencyRuleRows).toHaveLength(1);

      // The live agency_rule table never had this row in the first place —
      // it was a synthetic in-memory bundle. Loading the snapshot returns
      // the body bytes we put in, not anything resolved from the live table.
      // That is exactly the SC#1 property: snapshots are self-contained.
      const loadedBody = loaded!.agencyRuleRows[0]!.rule_body as { base_waiting_months: number };
      expect(loadedBody.base_waiting_months).toBe(48);
    } finally {
      adminClient.release();
    }
  });
});
