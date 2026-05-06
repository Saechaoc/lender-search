/**
 * pollAgencyPublications stub contract — AGY-07 / D-17.
 *
 * Phase 3 Plan 03-01 Task 01 RED gate. Asserts the Phase 3 / Phase 6 contract:
 * Phase 3 ships the producer signature returning empty array; Phase 6
 * implements the real HTTP fetch + sha256-diff body.
 */
import { describe, expect, it } from 'vitest';
import { pollAgencyPublications, type PollResult } from '../../lib/cascade/poll.js';

describe('pollAgencyPublications stub (AGY-07 / D-17)', () => {
  it('returns empty array at Phase 3', async () => {
    const result: PollResult[] = await pollAgencyPublications();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it('signature is async and returns Promise<PollResult[]>', async () => {
    const promise = pollAgencyPublications();
    expect(promise).toBeInstanceOf(Promise);
    const value = await promise;
    expect(value).toBeDefined();
  });
});
