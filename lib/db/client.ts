/**
 * Drizzle 0.45 + postgres-js client (CFG-02).
 *
 * `prepare: false` is non-negotiable — Supabase's Supavisor connection pooler
 * (Phase 6 wires the real one) does not support prepared statements. Setting
 * the posture now means Phase 6 Supabase migration is a DATABASE_URL change,
 * not a client refactor.
 *
 * Phase 1 / Phase 6 driver split (RESEARCH §Pitfall 5):
 *   - App / migrations: postgres-js (this file). Used by Drizzle.
 *   - Pen tests: node-postgres (`pg` package, in tests/rls/). Pen tests open
 *     transactions explicitly and bypass setTenantContext to exercise the raw
 *     SQL contract, not the TS abstraction.
 *
 * Phase 1 ships this client but does not exercise it through app code (no app
 * code yet). Phase 6 wires it into Server Actions / route handlers.
 *
 * Reference: orm.drizzle.team/docs/get-started-postgresql#postgresjs
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env.js';

/**
 * postgres-js connection. `prepare: false` is the Supabase pooler posture.
 * Exported for advanced cases (raw SQL); prefer `db` for typed queries.
 */
export const sql = postgres(env.DATABASE_URL, {
  prepare: false,
  // max connections — small at Phase 1 (no app load); Phase 6 raises with Vercel concurrency.
  max: 10,
  // 30s idle timeout matches Supabase pooler defaults; documented in Phase 6 wiring notes.
  idle_timeout: 30,
  // Phase 1 uses plain Postgres docker; SSL not required. Phase 6 sets ssl: 'require'.
  ssl: false,
});

/**
 * Drizzle instance. Schema is wired in once `db/schema/index.ts` exists (Plan 04).
 */
export const db = drizzle(sql);

export type Db = typeof db;
