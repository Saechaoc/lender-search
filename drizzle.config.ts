import { defineConfig } from 'drizzle-kit';
import { config as loadDotenv } from 'dotenv';

// Load .env.local first (local-dev secrets per Plan 01-01/02 contract; gitignored),
// then fall back to .env so production / CI environments without .env.local still work.
// Plan 01-04 documented the original `import 'dotenv/config'` (loads .env only) as a
// forward-looking issue; Plan 01-05 fixes it so `pnpm drizzle-kit migrate` works
// without ad-hoc DATABASE_URL=... prefixes. dotenv won't override existing env vars,
// so CI's GitHub Actions secrets / Vercel env take precedence over committed files.
loadDotenv({ path: '.env.local' });
loadDotenv({ path: '.env' });

// Two distinct connection strings:
//   - DATABASE_URL: runtime/test connection (app_user, NOBYPASSRLS NOSUPERUSER per
//     Plan 01-01's scripts/init-db.sh). Pen tests connect with this so FORCE RLS is
//     meaningful — superusers bypass RLS silently.
//   - DATABASE_MIGRATION_URL: migration-only connection (postgres superuser, the
//     table owner). Required because only the owner can ALTER TABLE FORCE ROW LEVEL
//     SECURITY (Plan 01-05's 0001_force_rls.sql) and CREATE TABLE / CREATE POLICY.
//
// drizzle-kit (migrate, generate) needs the migration URL. The runtime app/pen-tests
// use DATABASE_URL via lib/db/client.ts (Plan 01-03). If DATABASE_MIGRATION_URL is
// unset, fall back to DATABASE_URL — covers the case where the env only has the
// privileged connection (e.g., Plan 08 CI workflow runs migrate as postgres only).
const migrationUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;

if (!migrationUrl) {
  throw new Error(
    'DATABASE_MIGRATION_URL or DATABASE_URL is required for drizzle-kit. ' +
      'Local dev: set DATABASE_MIGRATION_URL=postgresql://postgres:postgres@localhost:5432/lender_search_dev in .env.local.',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema/index.ts',
  out: './db/migrations',
  dbCredentials: {
    url: migrationUrl,
  },
  verbose: true,
  strict: true,
});
