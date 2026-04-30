/**
 * Unit tests for dscrMethodSchema (SCH-07 / Pitfall 1.9).
 */
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { dscrMethodSchema } from '../../lib/rules/schemas/dscr-method.js';

describe('dscrMethodSchema', () => {
  it('parses lease-only body with LTV tiers', () => {
    const body = {
      numerator_rule: 'LEASE_ONLY',
      short_term_rental_allowed: false,
      short_term_rental_seasoning_months: null,
      denominator_method: 'NOTE_RATE_PITIA',
      min_dscr_by_ltv_tier: [
        { ltv_max: 70, min_dscr: 1.0 },
        { ltv_max: 80, min_dscr: 1.15 },
      ],
      no_ratio_option: false,
      no_ratio_max_ltv: null,
    };
    const parsed = dscrMethodSchema.parse(body);
    expect(parsed.numerator_rule).toBe('LEASE_ONLY');
    expect(parsed.min_dscr_by_ltv_tier).toHaveLength(2);
    expect(parsed.min_dscr_by_ltv_tier[0]?.min_dscr).toBe(1.0);
  });

  it('parses no-ratio DSCR with no_ratio_max_ltv=65', () => {
    const body = {
      numerator_rule: 'MARKET_ONLY',
      short_term_rental_allowed: true,
      short_term_rental_seasoning_months: 12,
      denominator_method: 'FULLY_AMORTIZED_QUALIFYING',
      min_dscr_by_ltv_tier: [],
      no_ratio_option: true,
      no_ratio_max_ltv: 65,
    };
    const parsed = dscrMethodSchema.parse(body);
    expect(parsed.no_ratio_option).toBe(true);
    expect(parsed.no_ratio_max_ltv).toBe(65);
  });

  it('parses IO denominator method', () => {
    const body = {
      numerator_rule: 'LOWER_OF_LEASE_AND_MARKET',
      short_term_rental_allowed: false,
      denominator_method: 'NOTE_RATE_ITIA_FOR_IO',
      min_dscr_by_ltv_tier: [{ ltv_max: 75, min_dscr: 1.10 }],
      no_ratio_option: false,
    };
    const parsed = dscrMethodSchema.parse(body);
    expect(parsed.denominator_method).toBe('NOTE_RATE_ITIA_FOR_IO');
  });

  it('rejects invalid numerator_rule', () => {
    const bad = {
      numerator_rule: 'WHATEVER',
      short_term_rental_allowed: false,
      denominator_method: 'NOTE_RATE_PITIA',
      no_ratio_option: false,
    };
    expect(() => dscrMethodSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects negative min_dscr in tier', () => {
    const bad = {
      numerator_rule: 'LEASE_ONLY',
      short_term_rental_allowed: false,
      denominator_method: 'NOTE_RATE_PITIA',
      min_dscr_by_ltv_tier: [{ ltv_max: 75, min_dscr: -0.5 }],
      no_ratio_option: false,
    };
    expect(() => dscrMethodSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects no_ratio_max_ltv > 120', () => {
    const bad = {
      numerator_rule: 'LEASE_ONLY',
      short_term_rental_allowed: false,
      denominator_method: 'NOTE_RATE_PITIA',
      no_ratio_option: true,
      no_ratio_max_ltv: 125,
    };
    expect(() => dscrMethodSchema.parse(bad)).toThrow(ZodError);
  });
});
