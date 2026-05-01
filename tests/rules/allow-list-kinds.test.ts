/**
 * Unit tests for 8 medium-complexity Zod schemas: 4 allow-list + geo + special.
 */
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { occupancyAllowSchema } from '../../lib/rules/schemas/occupancy-allow.js';
import { purposeAllowSchema } from '../../lib/rules/schemas/purpose-allow.js';
import { propertyTypeAllowSchema } from '../../lib/rules/schemas/property-type-allow.js';
import { docTypeAllowSchema } from '../../lib/rules/schemas/doc-type-allow.js';
import { geoStateSchema } from '../../lib/rules/schemas/geo-state.js';
import { geoCountySchema } from '../../lib/rules/schemas/geo-county.js';
import { miRequiredSchema } from '../../lib/rules/schemas/mi-required.js';
import { manualUwPathSchema } from '../../lib/rules/schemas/manual-uw-path.js';

describe('allow-list / geo / special rule_kind schemas', () => {
  describe('occupancyAllowSchema', () => {
    it('parses primary + investment', () => {
      const body = { values: ['PRIMARY', 'INVESTMENT'] };
      expect(occupancyAllowSchema.parse(body)).toEqual(body);
    });
    it('rejects unknown occupancy', () => {
      expect(() => occupancyAllowSchema.parse({ values: ['VACATION_RENTAL'] })).toThrow(ZodError);
    });
    it('parses missing values key as empty allow-list (WR-03 default consistency)', () => {
      const parsed = occupancyAllowSchema.parse({});
      expect(parsed.values).toEqual([]);
    });
  });

  describe('purposeAllowSchema', () => {
    it('parses purchase + RT-refi', () => {
      const body = { values: ['PURCHASE', 'RATE_TERM_REFI'] };
      expect(purposeAllowSchema.parse(body)).toEqual(body);
    });
    it('rejects unknown purpose', () => {
      expect(() => purposeAllowSchema.parse({ values: ['BRIDGE_LOAN'] })).toThrow(ZodError);
    });
    it('parses missing values key as empty allow-list (WR-03 default consistency)', () => {
      const parsed = purposeAllowSchema.parse({});
      expect(parsed.values).toEqual([]);
    });
  });

  describe('propertyTypeAllowSchema', () => {
    it('parses SFR + condo warrantable', () => {
      const body = { values: ['SFR', 'CONDO_WARRANTABLE'] };
      expect(propertyTypeAllowSchema.parse(body)).toEqual(body);
    });
    it('rejects unknown property type', () => {
      expect(() => propertyTypeAllowSchema.parse({ values: ['HOTEL'] })).toThrow(ZodError);
    });
    it('parses missing values key as empty allow-list (WR-03 default consistency)', () => {
      const parsed = propertyTypeAllowSchema.parse({});
      expect(parsed.values).toEqual([]);
    });
  });

  describe('docTypeAllowSchema', () => {
    it('parses bank-statement variants', () => {
      const body = { values: ['BANK_STATEMENT_12MO', 'BANK_STATEMENT_24MO', 'FULL_DOC'] };
      expect(docTypeAllowSchema.parse(body)).toEqual(body);
    });
    it('rejects unknown doc type', () => {
      expect(() => docTypeAllowSchema.parse({ values: ['STATED'] })).toThrow(ZodError);
    });
    it('parses missing values key as empty allow-list (WR-03 default consistency)', () => {
      const parsed = docTypeAllowSchema.parse({});
      expect(parsed.values).toEqual([]);
    });
  });

  describe('geoStateSchema (two-letter US codes)', () => {
    it('parses allowList = [CA, TX, NY], denyList = []', () => {
      const body = { allowList: ['CA', 'TX', 'NY'], denyList: [] };
      expect(geoStateSchema.parse(body)).toEqual(body);
    });
    it('rejects three-letter code', () => {
      expect(() => geoStateSchema.parse({ allowList: ['CAL'], denyList: [] })).toThrow(ZodError);
    });
    it('rejects lowercase code', () => {
      expect(() => geoStateSchema.parse({ allowList: ['ca'], denyList: [] })).toThrow(ZodError);
    });
    it('parses with default empty arrays', () => {
      const parsed = geoStateSchema.parse({});
      expect(parsed.allowList).toEqual([]);
      expect(parsed.denyList).toEqual([]);
    });
  });

  describe('geoCountySchema (5-digit FIPS codes)', () => {
    it('parses entries with valid FIPS', () => {
      const body = {
        entries: [
          { state: 'CA', fips: '06037', allowed: true },
          { state: 'TX', fips: '48201', allowed: false },
        ],
      };
      expect(geoCountySchema.parse(body)).toEqual(body);
    });
    it('rejects 4-digit FIPS', () => {
      const bad = { entries: [{ state: 'CA', fips: '6037', allowed: true }] };
      expect(() => geoCountySchema.parse(bad)).toThrow(ZodError);
    });
  });

  describe('miRequiredSchema', () => {
    it('parses required=true with provider list', () => {
      const body = { required: true, providers: ['MGIC', 'Genworth'] };
      expect(miRequiredSchema.parse(body)).toEqual(body);
    });
    it('rejects non-boolean required', () => {
      expect(() => miRequiredSchema.parse({ required: 'yes', providers: [] })).toThrow(ZodError);
    });
  });

  describe('manualUwPathSchema', () => {
    it('parses allowed=true with compensating factors', () => {
      const body = { allowed: true, compensatingFactors: ['low_LTV', 'reserves'] };
      expect(manualUwPathSchema.parse(body)).toEqual(body);
    });
    it('rejects non-boolean allowed', () => {
      expect(() => manualUwPathSchema.parse({ allowed: 1, compensatingFactors: [] })).toThrow(ZodError);
    });
  });
});
