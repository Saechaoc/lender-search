/**
 * lib/agency-seeds/types.ts — shared types for the Phase 3 hand-authored
 *   agency-rule seed pipeline.
 *
 * Phase 3 / Plan 03-01 Task 01 + Task 08 Delta 2/7.
 *
 * `AgencyRuleSeed<T>` is the contract every per-agency seed module
 *   (Wave 1 plans 03-02..03-05) emits. The Wave 0 loader skeleton
 *   (`scripts/seed-agency.ts`) consumes the array via
 *   `seedAgencyVersionAndRules`.
 *
 * Discriminator (`seedKey`) per Task 08 Delta 7 (REVIEWS.md B2 fix): some
 *   agencies need 2+ rows for the same `event_type` (FNMA's FORECLOSURE
 *   PURCHASE-vs-LCOR split is the canonical case). When `seedKey` is
 *   provided the loader uses it as the dedupe discriminator instead of
 *   `rule_body->>'event_type'`.
 *
 * State/sunset/deprecation per Task 08 Delta 2 (REVIEWS.md B8a fix) live
 *   on `SeedAgencyVersionInput` rather than here because they belong to the
 *   `agency_rule_version` row, not the per-rule body.
 */
import type { RuleKind } from '../rules/schemas/index.js';

export interface AgencyRuleSeedCitation {
  sourceUrl: string;
  excerpt: string;
}

export interface AgencyRuleSeed<TBody = unknown> {
  versionLabel: string;
  ruleKind: RuleKind;
  /**
   * Optional dedupe discriminator. When undefined the loader falls back
   * to `rule_body->>'event_type'` (preserves Wave 0 behavior). Set this
   * when multiple rows share the same `event_type` (e.g., FNMA's
   * FORECLOSURE PURCHASE-vs-LCOR 2-row split per REVIEWS.md B2).
   * The loader threads the value into the reserved `_seed_key` field
   * inside the persisted `rule_body` jsonb so dedupe survives across runs.
   */
  seedKey?: string;
  ruleBody: TBody;
  citation: AgencyRuleSeedCitation;
}
