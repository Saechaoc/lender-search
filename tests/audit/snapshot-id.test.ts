/**
 * snapshotId determinism contract — AUD-04 / D-04.
 *
 * Phase 3 Plan 03-01 Task 01 RED gate. Asserts the four-assertion contract
 * (A1/A2/A3/A4) that Phase 4 evaluator imports unchanged.
 */
import { describe, expect, it } from 'vitest';
import { snapshotId } from '../../lib/audit/snapshotId.js';

const sampleA = { id: '11111111-1111-1111-1111-111111111111', recorded_at: '2026-01-01T00:00:00.000Z' };
const sampleB = { id: '22222222-2222-2222-2222-222222222222', recorded_at: '2026-01-02T00:00:00.000Z' };
const sampleC = { id: '33333333-3333-3333-3333-333333333333', recorded_at: '2026-01-03T00:00:00.000Z' };

describe('snapshotId determinism contract (AUD-04 / D-04)', () => {
  it('A1: same input -> same hash', () => {
    const input = { agencyVersions: [sampleA], programVersions: [sampleB], overlayVersions: [] };
    expect(snapshotId(input)).toBe(snapshotId(input));
  });

  it('A2: reordered arrays -> same hash', () => {
    const ab = { agencyVersions: [sampleA, sampleB], programVersions: [], overlayVersions: [] };
    const ba = { agencyVersions: [sampleB, sampleA], programVersions: [], overlayVersions: [] };
    expect(snapshotId(ab)).toBe(snapshotId(ba));
  });

  it('A3: extra version -> different hash', () => {
    const base = { agencyVersions: [sampleA], programVersions: [], overlayVersions: [] };
    const plus = { agencyVersions: [sampleA, sampleC], programVersions: [], overlayVersions: [] };
    expect(snapshotId(base)).not.toBe(snapshotId(plus));
  });

  it('A4: mutated recorded_at -> different hash', () => {
    const t1 = { agencyVersions: [{ ...sampleA, recorded_at: '2026-01-01T00:00:00.000Z' }], programVersions: [], overlayVersions: [] };
    const t2 = { agencyVersions: [{ ...sampleA, recorded_at: '2026-01-01T00:00:01.000Z' }], programVersions: [], overlayVersions: [] };
    expect(snapshotId(t1)).not.toBe(snapshotId(t2));
  });

  it('returns 64-char lowercase hex string', () => {
    const result = snapshotId({ agencyVersions: [sampleA], programVersions: [], overlayVersions: [] });
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  // Plan 03 review WR-09: recorded_at must match the strict ISO 8601 with-millis
  // shape so hand-built strings missing millis cannot produce a different hash
  // for the same logical timestamp.
  it('A5: rejects non-ISO-8601-with-millis recorded_at (no millis)', () => {
    expect(() =>
      snapshotId({
        agencyVersions: [{ id: sampleA.id, recorded_at: '2026-01-01T00:00:00Z' }],
        programVersions: [],
        overlayVersions: [],
      }),
    ).toThrow(/recorded_at must match/);
  });

  it('A5: rejects non-ISO-8601-with-millis recorded_at (no Z suffix)', () => {
    expect(() =>
      snapshotId({
        agencyVersions: [],
        programVersions: [{ id: sampleB.id, recorded_at: '2026-01-01T00:00:00.000' }],
        overlayVersions: [],
      }),
    ).toThrow(/recorded_at must match/);
  });

  it('A5: rejects non-ISO-8601-with-millis recorded_at in overlayVersions', () => {
    expect(() =>
      snapshotId({
        agencyVersions: [],
        programVersions: [],
        overlayVersions: [{ id: sampleC.id, recorded_at: 'not-a-date' }],
      }),
    ).toThrow(/recorded_at must match/);
  });
});
