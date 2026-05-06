/**
 * Phase 3 / Plan 03-01 Task 08 Delta 5 (REVIEWS.md A3a) + quick task
 * 260506-al0 / Option B (rule_snapshot per-tenant scope).
 *
 * Asserts:
 *   - rule_snapshot table has UNIQUE (tenant_id, sha256_hash) — composite
 *     replaces the single-column UNIQUE dropped by migration 0022.
 *   - persistSnapshot is idempotent under (tenantId, hash).
 *   - loadSnapshot returns the same bundle that was persisted (round-trip).
 *   - 260506-al0 / Option B: cross-tenant isolation — loadSnapshot under
 *     a different tenant returns null (canonical Option B isolation proof).
 *     Tested under both the admin pool (WHERE clause filter) and the
 *     app_user pool (RLS policy filter).
 *   - 260506-al0 / Option B: hash divergence by construction — bundles
 *     for different tenants hash differently even if the agency-ref bodies
 *     match, because tenantId is in the canonical hash input AND because
 *     program_version UUIDs are tenant-namespaced.
 *   - captureCurrentBundle filters tenant-scoped tables to the requesting
 *     tenant.
 *   - SC#1 deterministic replay: rule_body in loaded bundle is independent
 *     of live mutations (Plan 03 review BL-02).
 */
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  persistSnapshot,
  loadSnapshot,
  captureCurrentBundle,
  type CanonicalBundle,
} from '../../lib/audit/snapshot-persistence.js';
import { snapshotId } from '../../lib/audit/snapshotId.js';

let tenantA: string;
let tenantB: string;

declare global {
  // setup.ts assigns these.
  // eslint-disable-next-line no-var
  var __pgAdminPool: Pool;
  // eslint-disable-next-line no-var
  var __pgPool: Pool;
}

const emptyBundle = (tenantId: string, overrides: Partial<CanonicalBundle> = {}): CanonicalBundle => ({
  tenantId,
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

beforeAll(async () => {
  // 260506-al0: create two fixture tenants under the admin pool (RLS bypass
  // would still apply on app_user under FORCE RLS; admin role is the only
  // path that can INSERT a tenant whose id != app.tenant_id setting). We
  // use a distinct timestamp suffix so each test run has fresh fixture
  // tenants — the cleanup in afterAll deletes them.
  const admin = await globalThis.__pgAdminPool.connect();
  try {
    const ts = Date.now();
    const a = await admin.query<{ id: string }>(
      `INSERT INTO tenant (kind, name) VALUES ('BROKERAGE', $1) RETURNING id::text`,
      [`260506-al0-fixture-A-${ts}`],
    );
    const b = await admin.query<{ id: string }>(
      `INSERT INTO tenant (kind, name) VALUES ('BROKERAGE', $1) RETURNING id::text`,
      [`260506-al0-fixture-B-${ts}`],
    );
    tenantA = a.rows[0]!.id;
    tenantB = b.rows[0]!.id;
  } finally {
    admin.release();
  }
});

afterAll(async () => {
  if (!tenantA && !tenantB) return;
  const admin = await globalThis.__pgAdminPool.connect();
  try {
    // ON DELETE RESTRICT on rule_snapshot.tenant_id (per migration 0022)
    // means we have to clean out fixture-tenant snapshots before deleting
    // the tenant rows.
    await admin.query(`DELETE FROM rule_snapshot WHERE tenant_id = ANY($1::uuid[])`, [
      [tenantA, tenantB].filter(Boolean),
    ]);
    await admin.query(`DELETE FROM tenant WHERE id = ANY($1::uuid[])`, [
      [tenantA, tenantB].filter(Boolean),
    ]);
  } finally {
    admin.release();
  }
});

describe('rule_snapshot table + persistence helpers (A3a / Delta 5 / 260506-al0 Option B)', () => {
  it('rule_snapshot table has UNIQUE (tenant_id, sha256_hash)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes
         WHERE tablename = 'rule_snapshot' AND indexdef ILIKE '%UNIQUE%'`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      // Composite UNIQUE: indexdef must include BOTH column names.
      const hasComposite = rows.some(
        (r) => r.indexdef.includes('tenant_id') && r.indexdef.includes('sha256_hash'),
      );
      expect(hasComposite).toBe(true);
    } finally {
      adminClient.release();
    }
  });

  it('persistSnapshot is idempotent under (tenantId, hash)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const bundle = emptyBundle(tenantA, {
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
      const first = await persistSnapshot(adminClient, tenantA, bundle);
      const second = await persistSnapshot(adminClient, tenantA, bundle);
      expect(second.id).toBe(first.id);
      expect(second.hash).toBe(first.hash);
      expect(second.hash).toBe(snapshotId(bundle));
    } finally {
      adminClient.release();
    }
  });

  it('loadSnapshot returns the same bundle that was persisted (round-trip) — tenantA', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const bundle = emptyBundle(tenantA, {
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
            tenant_id: tenantA,
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
      const { hash } = await persistSnapshot(adminClient, tenantA, bundle);
      const loaded = await loadSnapshot(adminClient, tenantA, hash);
      expect(loaded).not.toBeNull();
      expect(loaded?.tenantId).toBe(tenantA);
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

  it('260506-al0 cross-tenant isolation: loadSnapshot under wrong tenant returns null (admin pool, WHERE filter)', async () => {
    // 260506-al0: this is the canonical proof Option B's tenant boundary
    // holds. The WHERE tenant_id = $1 clause rejects; even if RLS were
    // bypassed (admin pool is bypassing it for fixture setup), the WHERE
    // filter alone returns zero rows. Defense-in-depth: the policy is the
    // outer wall, the WHERE clause is the inner wall.
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const bundle = emptyBundle(tenantA, {
        agencyVersions: [
          { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', recorded_at: '2026-08-01T00:00:00.000Z' },
        ],
      });
      const { hash } = await persistSnapshot(adminClient, tenantA, bundle);

      // Wrong tenant: even on the admin pool (RLS-bypassing role), the
      // WHERE tenant_id = tenantB clause filters out tenantA's row.
      const loadedWrong = await loadSnapshot(adminClient, tenantB, hash);
      expect(loadedWrong).toBeNull();

      // Right tenant: confirms the snapshot still exists under tenantA.
      const loadedRight = await loadSnapshot(adminClient, tenantA, hash);
      expect(loadedRight).not.toBeNull();
    } finally {
      adminClient.release();
    }
  });

  it('260506-al0 cross-tenant isolation: app_user with mismatched app.tenant_id sees zero rows (RLS policy)', async () => {
    // First, persist a tenantA snapshot under the admin pool so there's
    // a row to attempt to read.
    const admin = await globalThis.__pgAdminPool.connect();
    let hash: string;
    try {
      const bundle = emptyBundle(tenantA, {
        agencyVersions: [
          { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', recorded_at: '2026-09-01T00:00:00.000Z' },
        ],
      });
      const result = await persistSnapshot(admin, tenantA, bundle);
      hash = result.hash;
    } finally {
      admin.release();
    }

    // Now under the app_user pool, set app.tenant_id to tenantB and try
    // to read tenantA's row. The tenant_isolation policy filters before
    // the WHERE clause sees anything — RLS is the outer wall.
    const tenantClient = await globalThis.__pgPool.connect();
    try {
      await tenantClient.query('BEGIN');
      await tenantClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantB]);
      const loaded = await loadSnapshot(tenantClient, tenantB, hash);
      expect(loaded).toBeNull();
      await tenantClient.query('ROLLBACK');
    } catch (err) {
      try {
        await tenantClient.query('ROLLBACK');
      } catch {
        /* swallow */
      }
      throw err;
    } finally {
      tenantClient.release();
    }
  });

  it('260506-al0 hash divergence by construction: same agency refs, different tenantId -> different hash', async () => {
    // 260506-al0: this construction tests BOTH guarantees:
    //   (1) tenantId-in-hash (snapshotId.ts) — even if the bundle bodies
    //       were byte-identical, hashes diverge because tenantId is
    //       canonical input.
    //   (2) tenant-scoped UUIDs in programVersionRows naturally diverge —
    //       different tenants insert different program_version rows.
    // A reviewer reading "identical agency refs, different hash" should
    // see both invariants in play, not just one.
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const sharedAgencyRef = {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        recorded_at: '2026-10-01T00:00:00.000Z',
      };
      const bundleA = emptyBundle(tenantA, {
        agencyVersions: [sharedAgencyRef],
        programVersionRows: [
          {
            // Tenant-A-namespaced UUID.
            id: 'a1111111-1111-1111-1111-111111111111',
            tenant_id: tenantA,
            program_id: 'a2222222-2222-2222-2222-222222222222',
            agency_rule_version_id: sharedAgencyRef.id,
            conforming_loan_limit_version_id: null,
            effective_period: '[2026-01-01,)',
            recorded_at: '2026-10-01T00:00:00.000Z',
            state: 'active',
            source_document_fingerprint: 'fingerprint-A',
          },
        ],
      });
      const bundleB = emptyBundle(tenantB, {
        agencyVersions: [sharedAgencyRef],
        programVersionRows: [
          {
            // Different UUID for tenant B.
            id: 'b1111111-1111-1111-1111-111111111111',
            tenant_id: tenantB,
            program_id: 'b2222222-2222-2222-2222-222222222222',
            agency_rule_version_id: sharedAgencyRef.id,
            conforming_loan_limit_version_id: null,
            effective_period: '[2026-01-01,)',
            recorded_at: '2026-10-01T00:00:00.000Z',
            state: 'active',
            source_document_fingerprint: 'fingerprint-B',
          },
        ],
      });

      const resultA = await persistSnapshot(adminClient, tenantA, bundleA);
      const resultB = await persistSnapshot(adminClient, tenantB, bundleB);
      expect(resultA.hash).not.toBe(resultB.hash);

      // Also assert: snapshotId() alone (without DB) yields different
      // hashes for two bundles that differ ONLY in tenantId (no body
      // differences). This isolates guarantee (1) above from (2).
      const isoA = snapshotId({ tenantId: tenantA, agencyVersions: [sharedAgencyRef], programVersions: [], overlayVersions: [] });
      const isoB = snapshotId({ tenantId: tenantB, agencyVersions: [sharedAgencyRef], programVersions: [], overlayVersions: [] });
      expect(isoA).not.toBe(isoB);
    } finally {
      adminClient.release();
    }
  });

  it('captureCurrentBundle hydrates from live tables for tenantA', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const bundle = await captureCurrentBundle(adminClient, tenantA);
      expect(bundle.tenantId).toBe(tenantA);
      expect(Array.isArray(bundle.agencyVersions)).toBe(true);
      expect(Array.isArray(bundle.programVersions)).toBe(true);
      expect(Array.isArray(bundle.overlayVersions)).toBe(true);
      // BL-02: per-rule rows are present.
      expect(Array.isArray(bundle.agencyRuleVersionRows)).toBe(true);
      expect(Array.isArray(bundle.agencyRuleRows)).toBe(true);
      // Tenant filter actually filtered: every program_version /
      // program_rule / lender_overlay_rule row is for tenantA.
      for (const r of bundle.programVersionRows) expect(r.tenant_id).toBe(tenantA);
      for (const r of bundle.programRuleRows) expect(r.tenant_id).toBe(tenantA);
      for (const r of bundle.lenderOverlayRuleRows) expect(r.tenant_id).toBe(tenantA);
      // Recorded_at strings must be ISO 8601 (Pitfall PG-3).
      for (const v of bundle.agencyVersions) {
        expect(v.recorded_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      }
    } finally {
      adminClient.release();
    }
  });

  // Plan 03 review BL-02: SC#1 deterministic replay contract — locked here
  // because 260506-al0 / Option B threads tenantId through every layer.
  // Persist a snapshot for tenantA, call loadSnapshot(tenantA, hash), assert
  // the rule_body bytes survive the round-trip.
  it('SC#1 deterministic replay: rule_body in loaded bundle is independent of live mutations', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const bundle = emptyBundle(tenantA, {
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

      const { hash } = await persistSnapshot(adminClient, tenantA, bundle);
      const loaded = await loadSnapshot(adminClient, tenantA, hash);
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
