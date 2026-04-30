/**
 * lib/rules/schemas — per-rule_kind Zod schema dispatch.
 *
 * Per CONTEXT D-09: 17 rule_kind values; each has a Zod schema validating
 * the rule_body jsonb shape. Database-level validation is minimal (NOT NULL
 * + jsonb_typeof = 'object' + rule_kind enum membership); heavy shape
 * validation lives here in TypeScript so migrations don't churn on shape
 * changes (D-08).
 *
 * Consumed by:
 *   - Phase 4 evaluator (lib/eval/) — read-path validation when hydrating RuleSnapshot
 *   - Phase 7 extraction validator — write-path validation before staging persist
 *   - Phase 8 AM commit transaction — final validation before staging→canonical
 *
 * `parseRuleBody(kind, body)` is the single entry point. It throws z.ZodError
 * on shape mismatch; callers translate to user-facing errors (extraction reject,
 * AM commit block, evaluator skip).
 */
import { z } from 'zod';
import { ltvMaxSchema } from './ltv-max.js';
import { cltvMaxSchema } from './cltv-max.js';
import { hcltvMaxSchema } from './hcltv-max.js';
import { ficoMinSchema } from './fico-min.js';
import { dtiMaxSchema } from './dti-max.js';
import { reservesMinSchema } from './reserves-min.js';
import { derogSeasoningSchema } from './derog-seasoning.js';
import { incomeDocMethodSchema } from './income-doc-method.js';
import { dscrMethodSchema } from './dscr-method.js';
import { geoStateSchema } from './geo-state.js';
import { geoCountySchema } from './geo-county.js';
import { occupancyAllowSchema } from './occupancy-allow.js';
import { purposeAllowSchema } from './purpose-allow.js';
import { propertyTypeAllowSchema } from './property-type-allow.js';
import { docTypeAllowSchema } from './doc-type-allow.js';
import { miRequiredSchema } from './mi-required.js';
import { manualUwPathSchema } from './manual-uw-path.js';

/**
 * The 17 rule_kind values per CONTEXT D-09. MUST match the Drizzle pgEnum
 * literal in db/schema/program-rule.ts (Plan 02-02) verbatim — both literals
 * land in this PR / Wave 0 + Wave 1 set.
 */
export const ruleKinds = [
  'ltv_max', 'cltv_max', 'hcltv_max', 'fico_min', 'dti_max', 'reserves_min',
  'derog_seasoning', 'income_doc_method', 'dscr_method',
  'geo_state', 'geo_county',
  'occupancy_allow', 'purpose_allow', 'property_type_allow', 'doc_type_allow',
  'mi_required', 'manual_uw_path',
] as const;

export type RuleKind = typeof ruleKinds[number];

/**
 * Type-narrow rule_body validation by rule_kind.
 * `satisfies Record<RuleKind, z.ZodType>` makes adding a new rule_kind a
 * compile-error (forces matching schema entry).
 */
export const ruleBodySchemas = {
  ltv_max: ltvMaxSchema,
  cltv_max: cltvMaxSchema,
  hcltv_max: hcltvMaxSchema,
  fico_min: ficoMinSchema,
  dti_max: dtiMaxSchema,
  reserves_min: reservesMinSchema,
  derog_seasoning: derogSeasoningSchema,
  income_doc_method: incomeDocMethodSchema,
  dscr_method: dscrMethodSchema,
  geo_state: geoStateSchema,
  geo_county: geoCountySchema,
  occupancy_allow: occupancyAllowSchema,
  purpose_allow: purposeAllowSchema,
  property_type_allow: propertyTypeAllowSchema,
  doc_type_allow: docTypeAllowSchema,
  mi_required: miRequiredSchema,
  manual_uw_path: manualUwPathSchema,
} as const satisfies Record<RuleKind, z.ZodType>;

/**
 * Type-narrow rule_body validation by rule_kind.
 * Phase 7 extraction validator + Phase 8 AM commit + Phase 4 evaluator all use this.
 * Throws z.ZodError on shape mismatch.
 */
export function parseRuleBody(kind: RuleKind, body: unknown): unknown {
  return ruleBodySchemas[kind].parse(body);
}

// Re-export per-kind schemas + types so external consumers can import either
// the dispatch or a specific schema directly.
export * from './ltv-max.js';
export * from './cltv-max.js';
export * from './hcltv-max.js';
export * from './fico-min.js';
export * from './dti-max.js';
export * from './reserves-min.js';
export * from './derog-seasoning.js';
export * from './income-doc-method.js';
export * from './dscr-method.js';
export * from './geo-state.js';
export * from './geo-county.js';
export * from './occupancy-allow.js';
export * from './purpose-allow.js';
export * from './property-type-allow.js';
export * from './doc-type-allow.js';
export * from './mi-required.js';
export * from './manual-uw-path.js';
