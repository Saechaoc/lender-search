/**
 * ESLint flat config (Phase 1 / D-02 / TNT-02 / CFG-05).
 *
 * Three load-bearing rules:
 *   1. `no-restricted-properties` blocks `process.env` reads from app paths.
 *      Single source of truth is `lib/env.ts` (t3-env validated).
 *   2. `no-restricted-imports` blocks `service-role*` / `admin-db*` patterns.
 *      Service-role connections must NEVER appear in the application graph.
 *   3. typescript-eslint recommended rules for type-aware static analysis.
 *
 * Forward-looking: `app/` does not exist until Phase 6. Plan 08 ships the
 * rule + a smoke fixture (`app/.eslint-fixture.ts`) that exercises it; the
 * lint command rejects the fixture, proving the rule fires.
 *
 * Sanctioned env-reader exclusions: `lib/env.ts` (the t3-env schema),
 * `db/migrations/**` (drizzle artifacts; no logic), `tests/**` (pen-test
 * env access for stubEnv etc.), `scripts/**` (local-dev maintenance),
 * `*.config.*` (drizzle.config.ts / vitest.config.ts).
 *
 * peer-dep note (Plan 08): typescript-eslint bumped from 8.46.0 → 8.59.1
 * so its peer `eslint@^8.57.0 || ^9.0.0 || ^10.0.0` accepts the locked
 * `eslint@10.2.1`. Plan 01 logged the mismatch as a Plan 08 task.
 */
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Base TS recommended rules.
  ...tseslint.configs.recommended,

  // Phase 1 application-path guards (forward-looking; app/ arrives Phase 6).
  {
    files: [
      'app/**/*.ts',
      'app/**/*.tsx',
      'pages/**/*.ts',
      'pages/**/*.tsx',
      'src/**/*.ts',
      'src/**/*.tsx',
    ],
    rules: {
      // Block all `process.env` access from app paths.
      // The single sanctioned env-reader is lib/env.ts (t3-env).
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            'Read env vars from `lib/env.ts` (t3-env) only. Direct `process.env` access in app paths bypasses runtime validation (CFG-05).',
        },
      ],

      // Block service-role / admin-db import patterns.
      // Migration scripts and CI tools may use them; app code may not.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/service-role*', '**/admin-db*'],
              message:
                'service_role / admin DB clients must not be imported from app paths. Only migration scripts and CI tools may use them (TNT-02 / D-02).',
            },
          ],
        },
      ],
    },
  },

  // Global ignores (paths the rule exclusions don't reach).
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.next/**',
      'build/**',
      'src/App.js', // legacy CRA prototype — Phase 6 deletes
      'src/App.test.js',
      'src/index.js',
      'src/setupTests.js',
      'src/reportWebVitals.js',
      'public/**',
      'coverage/**',
      '.tsbuildinfo',
    ],
  },
);
