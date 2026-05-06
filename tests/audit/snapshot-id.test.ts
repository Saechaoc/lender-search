/**
 * snapshotId determinism contract — AUD-04 / D-04.
 *
 * Phase 3 Plan 03-01 Task 01 RED gate. Asserts the four-assertion contract
 * (A1/A2/A3/A4) that Phase 4 evaluator imports unchanged.
 *
 * 260506-al0 / Option B: SnapshotInput now requires tenantId; every
 * existing test threads a shared FIXTURE_TENANT_ID through so the A1-A4
 * contracts still hold (same tenantId across both sides of each
 * comparison). A6 adds the new invariant: same versions, different
 * tenantId -> different hash.
 */
import { describe, expect, it } from 'vitest';
import { snapshotId } from '../../lib/audit/snapshotId.js';

const FIXTURE_TENANT_ID = '99999999-9999-9999-9999-999999999999';

const sampleA = { id: '11111111-1111-1111-1111-111111111111', recorded_at: '2026-01-01T00:00:00.000Z' };
const sampleB = { id: '22222222-2222-2222-2222-222222222222', recorded_at: '2026-01-02T00:00:00.000Z' };
const sampleC = { id: '33333333-3333-3333-3333-333333333333', recorded_at: '2026-01-03T00:00:00.000Z' };

describe('snapshotId determinism contract (AUD-04 / D-04)', () => {
  it('A1: same input -> same hash', () => {
    const input = {
      tenantId: FIXTURE_TENANT_ID,
      agencyVersions: [sampleA],
      programVersions: [sampleB],
      overlayVersions: [],
    };
    expect(snapshotId(input)).toBe(snapshotId(input));
  });

  it('A2: reordered arrays -> same hash', () => {
    const ab = {
      tenantId: FIXTURE_TENANT_ID,
      agencyVersions: [sampleA, sampleB],
      programVersions: [],
      overlayVersions: [],
    };
    const ba = {
      tenantId: FIXTURE_TENANT_ID,
      agencyVersions: [sampleB, sampleA],
      programVersions: [],
      overlayVersions: [],
    };
    expect(snapshotId(ab)).toBe(snapshotId(ba));
  });

  it('A3: extra version -> different hash', () => {
    const base = {
      tenantId: FIXTURE_TENANT_ID,
      agencyVersions: [sampleA],
      programVersions: [],
      overlayVersions: [],
    };
    const plus = {
      tenantId: FIXTURE_TENANT_ID,
      agencyVersions: [sampleA, sampleC],
      programVersions: [],
      overlayVersions: [],
    };
    expect(snapshotId(base)).not.toBe(snapshotId(plus));
  });

  it('A4: mutated recorded_at -> different hash', () => {
    const t1 = {
      tenantId: FIXTURE_TENANT_ID,
      agencyVersions: [{ ...sampleA, recorded_at: '2026-01-01T00:00:00.000Z' }],
      programVersions: [],
      overlayVersions: [],
    };
    const t2 = {
      tenantId: FIXTURE_TENANT_ID,
      agencyVersions: [{ ...sampleA, recorded_at: '2026-01-01T00:00:01.000Z' }],
      programVersions: [],
      overlayVersions: [],
    };
    expect(snapshotId(t1)).not.toBe(snapshotId(t2));
  });

  it('returns 64-char lowercase hex string', () => {
    const result = snapshotId({
      tenantId: FIXTURE_TENANT_ID,
      agencyVersions: [sampleA],
      programVersions: [],
      overlayVersions: [],
    });
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  // Plan 03 review WR-09: recorded_at must match the strict ISO 8601 with-millis
  // shape so hand-built strings missing millis cannot produce a different hash
  // for the same logical timestamp.
  it('A5: rejects non-ISO-8601-with-millis recorded_at (no millis)', () => {
    expect(() =>
      snapshotId({
        tenantId: FIXTURE_TENANT_ID,
        agencyVersions: [{ id: sampleA.id, recorded_at: '2026-01-01T00:00:00Z' }],
        programVersions: [],
        overlayVersions: [],
      }),
    ).toThrow(/recorded_at must match/);
  });

  it('A5: rejects non-ISO-8601-with-millis recorded_at (no Z suffix)', () => {
    expect(() =>
      snapshotId({
        tenantId: FIXTURE_TENANT_ID,
        agencyVersions: [],
        programVersions: [{ id: sampleB.id, recorded_at: '2026-01-01T00:00:00.000' }],
        overlayVersions: [],
      }),
    ).toThrow(/recorded_at must match/);
  });

  it('A5: rejects non-ISO-8601-with-millis recorded_at in overlayVersions', () => {
    expect(() =>
      snapshotId({
        tenantId: FIXTURE_TENANT_ID,
        agencyVersions: [],
        programVersions: [],
        overlayVersions: [{ id: sampleC.id, recorded_at: 'not-a-date' }],
      }),
    ).toThrow(/recorded_at must match/);
  });

  // 260506-al0 / Option B: tenantId is part of the canonical hash input.
  // Same versions on different tenants must produce different hashes so an
  // evaluation_event row referencing a hash from one tenant cannot collide
  // with another tenant's snapshot.
  it('A6: same versions, different tenantId -> different hash', () => {
    const left = {
      tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      agencyVersions: [sampleA],
      programVersions: [],
      overlayVersions: [],
    };
    const right = {
      tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      agencyVersions: [sampleA],
      programVersions: [],
      overlayVersions: [],
    };
    expect(snapshotId(left)).not.toBe(snapshotId(right));
  });
});
