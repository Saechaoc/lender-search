/**
 * Unit tests for the 6 simple-numeric Zod schemas (D-09 numeric kinds).
 */
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { ltvMaxSchema } from '../../lib/rules/schemas/ltv-max.js';
import { cltvMaxSchema } from '../../lib/rules/schemas/cltv-max.js';
import { hcltvMaxSchema } from '../../lib/rules/schemas/hcltv-max.js';
import { ficoMinSchema } from '../../lib/rules/schemas/fico-min.js';
import { dtiMaxSchema } from '../../lib/rules/schemas/dti-max.js';
import { reservesMinSchema } from '../../lib/rules/schemas/reserves-min.js';

describe('numeric rule_kind schemas', () => {
  describe('ltvMaxSchema', () => {
    it('parses { value: 80 }', () => {
      expect(ltvMaxSchema.parse({ value: 80 })).toEqual({ value: 80 });
    });
    it('rejects { value: 105 }', () => {
      expect(() => ltvMaxSchema.parse({ value: 105 })).toThrow(ZodError);
    });
    it('rejects negative value', () => {
      expect(() => ltvMaxSchema.parse({ value: -5 })).toThrow(ZodError);
    });
  });

  describe('cltvMaxSchema (0-120)', () => {
    it('parses { value: 115 }', () => {
      expect(cltvMaxSchema.parse({ value: 115 })).toEqual({ value: 115 });
    });
    it('rejects { value: 121 }', () => {
      expect(() => cltvMaxSchema.parse({ value: 121 })).toThrow(ZodError);
    });
  });

  describe('hcltvMaxSchema (0-120)', () => {
    it('parses { value: 100 }', () => {
      expect(hcltvMaxSchema.parse({ value: 100 })).toEqual({ value: 100 });
    });
    it('rejects { value: 121 }', () => {
      expect(() => hcltvMaxSchema.parse({ value: 121 })).toThrow(ZodError);
    });
  });

  describe('ficoMinSchema (int 300-850)', () => {
    it('parses { value: 720 }', () => {
      expect(ficoMinSchema.parse({ value: 720 })).toEqual({ value: 720 });
    });
    it('rejects non-integer', () => {
      expect(() => ficoMinSchema.parse({ value: 720.5 })).toThrow(ZodError);
    });
    it('rejects { value: 299 }', () => {
      expect(() => ficoMinSchema.parse({ value: 299 })).toThrow(ZodError);
    });
    it('rejects { value: 851 }', () => {
      expect(() => ficoMinSchema.parse({ value: 851 })).toThrow(ZodError);
    });
  });

  describe('dtiMaxSchema (0-100)', () => {
    it('parses { value: 43 }', () => {
      expect(dtiMaxSchema.parse({ value: 43 })).toEqual({ value: 43 });
    });
    it('rejects { value: 105 }', () => {
      expect(() => dtiMaxSchema.parse({ value: 105 })).toThrow(ZodError);
    });
  });

  describe('reservesMinSchema (non-negative + unit enum)', () => {
    it('parses { value: 6, unit: months }', () => {
      expect(reservesMinSchema.parse({ value: 6, unit: 'months' })).toEqual({ value: 6, unit: 'months' });
    });
    it('parses { value: 50000, unit: dollars }', () => {
      expect(reservesMinSchema.parse({ value: 50000, unit: 'dollars' })).toEqual({ value: 50000, unit: 'dollars' });
    });
    it('rejects negative value', () => {
      expect(() => reservesMinSchema.parse({ value: -1, unit: 'months' })).toThrow(ZodError);
    });
    it('rejects invalid unit', () => {
      expect(() => reservesMinSchema.parse({ value: 6, unit: 'years' })).toThrow(ZodError);
    });
  });
});
