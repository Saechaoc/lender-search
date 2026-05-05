/**
 * Tests the lib/rules/schemas/index.ts dispatch table for runtime
 * exhaustiveness + parseRuleBody routing correctness.
 */
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { ruleKinds, ruleBodySchemas, parseRuleBody } from '../../lib/rules/schemas/index.js';

describe('rule_kind dispatch table', () => {
  it('ruleKinds has 17 values per CONTEXT D-09', () => {
    expect(ruleKinds).toHaveLength(17);
  });

  it('ruleKinds matches D-09 verbatim (order + values)', () => {
    expect(ruleKinds).toEqual([
      'ltv_max',
      'cltv_max',
      'hcltv_max',
      'fico_min',
      'dti_max',
      'reserves_min',
      'derog_seasoning',
      'income_doc_method',
      'dscr_method',
      'geo_state',
      'geo_county',
      'occupancy_allow',
      'purpose_allow',
      'property_type_allow',
      'doc_type_allow',
      'mi_required',
      'manual_uw_path',
    ]);
  });

  it('every rule_kind has a matching ruleBodySchemas entry', () => {
    for (const kind of ruleKinds) {
      expect(ruleBodySchemas).toHaveProperty(kind);
      expect(typeof (ruleBodySchemas[kind].parse)).toBe('function');
    }
  });

  it('parseRuleBody routes ltv_max to ltvMaxSchema', () => {
    const parsed = parseRuleBody('ltv_max', { value: 80 });
    expect(parsed).toEqual({ value: 80 });
  });

  it('parseRuleBody throws ZodError for malformed body', () => {
    expect(() => parseRuleBody('ltv_max', { value: 105 })).toThrow(ZodError);
  });

  it('parseRuleBody rejects ltv_max body when given to fico_min slot', () => {
    expect(() => parseRuleBody('fico_min', { value: 80 })).toThrow(ZodError);
  });

  it('parseRuleBody routes derog_seasoning to derogSeasoningSchema', () => {
    const body = {
      event_type: 'BK7',
      measurement_anchor: 'DISCHARGE',
      base_waiting_months: 48,
      extenuating_circumstances_waiting_months: 24,
      post_event_LTV_caps: [],
      reestablished_credit_required: true,
      mortgage_included_in_bk_rule: 'NOT_APPLICABLE',
      notes_citations: [],
    };
    const parsed = parseRuleBody('derog_seasoning', body) as { event_type: string };
    expect(parsed.event_type).toBe('BK7');
  });
});
