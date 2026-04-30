/**
 * Boot-time environment-variable validation contract.
 *
 * Phase 1 / CFG-05: every Phase 1+ runtime path reads from `env.*` (typed,
 * validated) instead of `process.env.*` (untyped, lazy). Importing this
 * module throws synchronously if any required `server` var is missing or
 * malformed — boot fails closed BEFORE the first DB connection.
 *
 * Plan 08 lands an ESLint `no-restricted-properties` rule on `process.env`
 * to enforce single-source-of-truth access through this module.
 *
 * Phase 6 migration path:
 *   - Swap `@t3-oss/env-core` → `@t3-oss/env-nextjs` (same Zod schemas).
 *   - Tighten `SUPABASE_SERVICE_ROLE_KEY` from `.optional()` to `.min(20)`.
 *   - Add `client` keys (e.g. NEXT_PUBLIC_* surfaces) when the app exists.
 *
 * Reference: env.t3.gg/docs/core
 */
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  server: {
    DATABASE_URL: z
      .string()
      .url()
      .refine(
        (s) => s.startsWith('postgresql://') || s.startsWith('postgres://'),
        'DATABASE_URL must be a Postgres connection string',
      ),
    // Phase 1: optional. Phase 6 tightens to z.string().min(20).
    // Plan 08 ESLint rule additionally blocks reads of this var from app paths.
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    // Pen-test JWT signing secret (used by tests/rls/fixtures/jwt.ts in Plan 06).
    // Optional so production-style boots without test secrets still pass.
    RLS_TEST_JWT_SECRET: z.string().min(16).optional(),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  },
  // No client-side env at Phase 1 (no app yet). Phase 6 adds NEXT_PUBLIC_* keys.
  // Empty `clientPrefix` is required by @t3-oss/env-core@0.13.11's ClientOptions
  // type when `client` is set (even to {}). Phase 6 swaps this to 'NEXT_PUBLIC_'.
  clientPrefix: '',
  client: {},
  runtimeEnv: process.env,
  // A typo'd empty value in `.env.local` (e.g. `DATABASE_URL=`) becomes undefined,
  // which triggers the missing-var fail path instead of an empty-string passthrough.
  emptyStringAsUndefined: true,
});

export type Env = typeof env;
