/**
 * lib/rules/active-agency-rule.ts — typed query helpers for "find active
 * agency rules" that pre-filter on state='ACTIVE' AND
 * effective_period @> CURRENT_DATE.
 *
 * Plan 03 review WR-01: the FHA Back-to-Work fixture lands as
 * state='DEPRECATED' with effective_period='[2013-08-15,2016-09-30)'. A
 * Phase 4 evaluator query that forgets the state filter
 *
 *   db.select().from(agencyRule)
 *     .where(eq(agencyRule.agencyRuleVersionId, arvId));
 *
 * would silently return the DEPRECATED Back-to-Work 12-month-FC waiting
 * period rule for an active 2026 evaluation. The DEPRECATED row exists
 * for historical-scenario replay (SC#4) — it must NEVER fire for active
 * eligibility decisions.
 *
 * The fix is a single source of truth: `activeAgencyRulesWhere(arv)`
 * returns the predicate every Phase 4+ evaluator query must use. Direct
 * imports of `agencyRule` from db/schema/agency-rule.ts should funnel
 * through this helper. A future CI lint should reject `from(agencyRule)`
 * outside this module.
 *
 * The helper accepts EITHER an AgencyRuleVersion row (lookup by
 * version_id is the common case) OR an agency string (broader query
 * across all active versions of an agency). Both paths emit the same
 * state + effective_period filter.
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { agencyRule } from '../../db/schema/agency-rule.js';
import { agencyRuleVersion, type AgencyRuleVersion } from '../../db/schema/agency-rule-version.js';

/**
 * Predicate for "active agency rule rows under a specific
 * agency_rule_version row." The caller already has the ARV (e.g. from a
 * cascade event); we filter the rule's parent ARV by state + effective_period.
 *
 * Usage:
 *   const rules = await db
 *     .select()
 *     .from(agencyRule)
 *     .innerJoin(agencyRuleVersion, eq(agencyRuleVersion.id, agencyRule.agencyRuleVersionId))
 *     .where(activeAgencyRulesUnderVersion(arv));
 */
export function activeAgencyRulesUnderVersion(arv: AgencyRuleVersion): SQL {
  return and(
    eq(agencyRule.agencyRuleVersionId, arv.id),
    eq(agencyRuleVersion.state, 'ACTIVE'),
    sql`${agencyRuleVersion.effectivePeriod} @> CURRENT_DATE`,
  )!;
}

/**
 * Predicate for "active agency rule rows for an agency, today." Joins
 * agency_rule_version and filters by state + effective_period contains
 * today. Phase 4 evaluator's primary entry point when given a scenario
 * + agency (e.g. FNMA) without a specific ARV id.
 *
 * Usage:
 *   const rules = await db
 *     .select()
 *     .from(agencyRule)
 *     .innerJoin(agencyRuleVersion, eq(agencyRuleVersion.id, agencyRule.agencyRuleVersionId))
 *     .where(activeAgencyRulesForAgency('FNMA'));
 */
export function activeAgencyRulesForAgency(
  agency: 'FNMA' | 'FHLMC' | 'FHA' | 'VA' | 'USDA',
): SQL {
  return and(
    eq(agencyRuleVersion.agency, agency),
    eq(agencyRuleVersion.state, 'ACTIVE'),
    sql`${agencyRuleVersion.effectivePeriod} @> CURRENT_DATE`,
  )!;
}
