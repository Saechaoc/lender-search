/**
 * Schema barrel — re-exports every table/enum so drizzle.config.ts has one
 * import path. Phase 2 (Rule Schema) appends `export * from './program.js'`
 * (and friends) here.
 */
export * from './tenant.js';
export * from './canary.js';
