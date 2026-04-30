/**
 * Unit tests for derogSeasoningSchema (SCH-04 + SCH-05).
 *
 * Coverage per VALIDATION D8: parse-good (FNMA SC#2 fixture) + reject-bad
 * (Pitfalls 1.1 / 1.2 / 1.6).
 */
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { derogSeasoningSchema } from '../../lib/rules/schemas/derog-seasoning.js';
import { fnmaForeclosure } from './fixtures/fnma-foreclosure.js';

describe('derogSeasoningSchema', () => {
  it('parses the FNMA post-foreclosure fixture (SC#2)', () => {
    const parsed = derogSeasoningSchema.parse(fnmaForeclosure);
    expect(parsed.event_type).toBe('FORECLOSURE');
    expect(parsed.base_waiting_months).toBe(84);
    expect(parsed.extenuating_circumstances_waiting_months).toBe(36);
    expect(parsed.post_event_LTV_caps).toHaveLength(1);
    expect(parsed.post_event_LTV_caps[0]?.max_LTV).toBe(90);
    expect(parsed.post_event_LTV_caps[0]?.purposeAllowList).toEqual(['PURCHASE', 'RATE_TERM_REFI']);
    expect(parsed.post_event_LTV_caps[0]?.occupancyAllowList).toEqual(['PRIMARY']);
    expect(parsed.mortgage_included_in_bk_rule).toBe('BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED');
  });

  it('rejects body missing event_type', () => {
    const bad = { ...fnmaForeclosure } as unknown as Record<string, unknown>;
    delete bad.event_type;
    expect(() => derogSeasoningSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects invalid event_type value', () => {
    const bad = { ...fnmaForeclosure, event_type: 'JURY_DUTY' };
    expect(() => derogSeasoningSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects negative base_waiting_months', () => {
    const bad = { ...fnmaForeclosure, base_waiting_months: -12 };
    expect(() => derogSeasoningSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects post_event_LTV_caps with max_LTV > 100', () => {
    const bad = {
      ...fnmaForeclosure,
      post_event_LTV_caps: [
        {
          months_since_min: 36,
          months_since_max: 84,
          max_LTV: 101,
          purposeAllowList: ['PURCHASE'],
          occupancyAllowList: ['PRIMARY'],
        },
      ],
    };
    expect(() => derogSeasoningSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects missing mortgage_included_in_bk_rule (Pitfall 1.6)', () => {
    const bad = { ...fnmaForeclosure } as unknown as Record<string, unknown>;
    delete bad.mortgage_included_in_bk_rule;
    expect(() => derogSeasoningSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects invalid purposeAllowList element', () => {
    const bad = {
      ...fnmaForeclosure,
      post_event_LTV_caps: [
        {
          months_since_min: 36,
          months_since_max: 84,
          max_LTV: 90,
          purposeAllowList: ['PRIVATE_LOAN'],
          occupancyAllowList: ['PRIMARY'],
        },
      ],
    };
    expect(() => derogSeasoningSchema.parse(bad)).toThrow(ZodError);
  });

  it('parses a BK7 derog with extenuating circumstances 24mo', () => {
    const bk7: unknown = {
      event_type: 'BK7',
      measurement_anchor: 'DISCHARGE',
      base_waiting_months: 48,
      extenuating_circumstances_waiting_months: 24,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: ['FNMA Selling Guide B3-5.3-07 BK7'],
    };
    const parsed = derogSeasoningSchema.parse(bk7);
    expect(parsed.event_type).toBe('BK7');
  });
});
