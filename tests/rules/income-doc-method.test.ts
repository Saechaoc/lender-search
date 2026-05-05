/**
 * Unit tests for incomeDocMethodSchema (SCH-06 / Pitfall 1.8).
 */
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { incomeDocMethodSchema } from '../../lib/rules/schemas/income-doc-method.js';

describe('incomeDocMethodSchema', () => {
  it('parses 12-mo bank-statement body with comingling SEASONED', () => {
    const body = {
      method: 'BANK_STATEMENT_12MO',
      account_type: 'BUSINESS',
      expense_factor: 0.5,
      expense_factor_source: 'FIXED_PERCENTAGE',
      exclude_transfers: true,
      max_nsf_per_period: 3,
      comingling_treatment: 'SEASONED',
      qualifying_deposit_seasoning: '60_days',
      qualifying_period_months: 12,
    };
    const parsed = incomeDocMethodSchema.parse(body);
    expect(parsed.method).toBe('BANK_STATEMENT_12MO');
    expect(parsed.expense_factor).toBe(0.5);
    expect(parsed.comingling_treatment).toBe('SEASONED');
  });

  it('parses minimal FULL_DOC body (only method)', () => {
    const body = { method: 'FULL_DOC' };
    const parsed = incomeDocMethodSchema.parse(body);
    expect(parsed.method).toBe('FULL_DOC');
  });

  it('parses 24-mo bank statement with CPA letter expense source', () => {
    const body = {
      method: 'BANK_STATEMENT_24MO',
      account_type: 'PERSONAL',
      expense_factor: 0.4,
      expense_factor_source: 'CPA_LETTER',
      qualifying_period_months: 24,
    };
    const parsed = incomeDocMethodSchema.parse(body);
    expect(parsed.expense_factor_source).toBe('CPA_LETTER');
  });

  it('rejects invalid method enum', () => {
    const bad = { method: 'STATED_INCOME' };
    expect(() => incomeDocMethodSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects expense_factor > 1', () => {
    const bad = { method: 'BANK_STATEMENT_12MO', expense_factor: 1.5 };
    expect(() => incomeDocMethodSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects negative max_nsf_per_period', () => {
    const bad = { method: 'BANK_STATEMENT_12MO', max_nsf_per_period: -1 };
    expect(() => incomeDocMethodSchema.parse(bad)).toThrow(ZodError);
  });

  it('rejects invalid expense_factor_source', () => {
    const bad = { method: 'BANK_STATEMENT_12MO', expense_factor_source: 'GUESS' };
    expect(() => incomeDocMethodSchema.parse(bad)).toThrow(ZodError);
  });
});
