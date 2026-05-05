/**
 * Schema barrel — re-exports every table/enum so drizzle.config.ts has one
 * import path. Phase 2 appends program/program_version/program_rule/
 * rule_citation (Plan 02-02) + agency_rule_version/agency_rule/
 * lender_overlay_rule (Plan 02-03) to the Phase 1 baseline.
 */
export * from './tenant.js';
export * from './canary.js';
export * from './rule-citation.js';
export * from './program.js';
export * from './program-version.js';
export * from './program-rule.js';
export * from './agency-rule-version.js';
export * from './agency-rule.js';
export * from './lender-overlay-rule.js';
export * from './system-role.js';
