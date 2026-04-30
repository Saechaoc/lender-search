/**
 * SMOKE FIXTURE — intentionally violates eslint rules to prove they fire.
 *
 * Phase 1 has no real `app/` code. This file lives at `app/.eslint-fixture.ts`
 * (leading dot keeps it out of tsc include) and contains forbidden patterns
 * that the eslint.config.mjs rules reject.
 *
 * Expected `pnpm lint:fixture` behavior:
 *   - eslint exits non-zero with at least 2 `error` lines:
 *       * no-restricted-properties (process.env access from app/)
 *       * no-restricted-properties (process.env.SUPABASE_SERVICE_ROLE_KEY)
 *   - the script INVERTS the exit code, so `pnpm lint:fixture` exits 0 only
 *     when eslint exits non-zero (rule fired).
 *
 * The main `pnpm lint` script ignores this file via --ignore-pattern so the
 * rest of the project lints clean.
 *
 * Phase 6 should DELETE this file when real app/ code lands AND verify the
 * production app paths (app/**, pages/**) trigger the same rule on actual
 * violations.
 */

// VIOLATION 1: process.env access from app path (no-restricted-properties).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const dbUrl = process.env.DATABASE_URL;

// VIOLATION 2: SUPABASE_SERVICE_ROLE_KEY read from app path (no-restricted-properties).
// This is the precise pattern TNT-02 / D-02 / T-01-04 mitigate against.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// VIOLATION 3: import a forbidden pattern.
// (Cannot actually import — module doesn't exist; left as a comment so the
//  pattern is grep-discoverable for future verification when real modules exist.)
// import { adminDb } from './admin-db';
// import { serviceRoleClient } from '../service-role';

export {};
