/**
 * scripts/seed-agency.ts — idempotent agency-rule + FHFA loan-limit loader.
 *
 * Per CONTEXT D-05: connects via DATABASE_MIGRATION_URL (postgres superuser
 *   with system_role GRANT). Wired into:
 *   - .github/workflows/ci.yml (after pnpm drizzle-kit migrate)
 *   - tests/rls/global-setup.ts (after migrate, before tenant seeds)
 *   - tests/schema/setup.ts (after migrate)
 *   - production deploy step (Phase 6+ wires Vercel/Supabase invocation)
 *
 * Per CONTEXT D-05/D-06: idempotency keyed on (agency, version_label, rule_kind,
 *   seedKey ?? event_type) via INSERT ... WHERE NOT EXISTS for the agency_rule
 *   body. Get-or-create on agency_rule_version keyed on (agency, version_label).
 *
 * Per Pitfall PG-3: recorded_at timestamps are ISO strings everywhere downstream
 *   (snapshotId.ts contract). The loader doesn't compute snapshotIds; it only
 *   writes rows.
 *
 * Wave 0 ships the skeleton with empty seeds; Wave 1 plans (03-02..03-05)
 *   import per-agency seed arrays and pass them to seedAgencyVersionAndRules().
 *
 * Task 08 Delta 7 / REVIEWS.md B2: the dedupe predicate uses
 *   `coalesce(rule_body->>'_seed_key', rule_body->>'event_type')` so multi-row
 *   splits (FNMA's FORECLOSURE PURCHASE-vs-LCOR) don't collide.
 *
 * Task 08 Delta 2 / REVIEWS.md B8a: SeedAgencyVersionInput accepts state /
 *   sunsetDate / deprecationReason; the agency_rule_version INSERT threads
 *   these into the row. Defaults: state='ACTIVE', sunsetDate=null,
 *   deprecationReason=null.
 *
 * Loader defense-in-depth (A2): citation URLs are validated against
 *   /^https?:\/\// before INSERT.
 */
import { readFile } from 'node:fs/promises';
import { config as loadDotenv } from 'dotenv';
import { parse } from 'csv-parse/sync';
import { Pool, type PoolClient } from 'pg';
import { z } from 'zod';
import { parseRuleBody, type RuleKind } from '../lib/rules/schemas/index.js';
import type { AgencyRuleSeed } from '../lib/agency-seeds/types.js';

loadDotenv({ path: '.env.local' });
loadDotenv({ path: '.env' });

const MIGRATION_DB_URL =
  process.env.DATABASE_MIGRATION_URL ??
  process.env.DATABASE_URL?.replace('app_user:app_user_password', 'postgres:postgres') ??
  '';

if (!MIGRATION_DB_URL) {
  throw new Error('seed-agency: DATABASE_MIGRATION_URL or DATABASE_URL must be set.');
}

export const pool = new Pool({ connectionString: MIGRATION_DB_URL, max: 3 });

/**
 * Get-or-create the kind='SYSTEM' tenant idempotently. Mirrors the pattern in
 * tests/_shared/agency-fixture.ts::ensureSystemTenant.
 */
async function ensureSystemTenant(client: PoolClient): Promise<string> {
  const lookup = await client.query<{ id: string }>(
    `SELECT id::text FROM tenant WHERE kind = 'SYSTEM' LIMIT 1`,
  );
  if (lookup.rows[0]) return lookup.rows[0].id;
  const created = await client.query<{ id: string }>(
    `INSERT INTO tenant (id, kind, name)
     VALUES (gen_random_uuid(), 'SYSTEM', 'Agency Hand-Authoring System Tenant')
     RETURNING id::text`,
  );
  return created.rows[0]!.id;
}

export interface SeedAgencyVersionInput {
  agency: 'FNMA' | 'FHLMC' | 'FHA' | 'VA' | 'USDA';
  versionLabel: string;
  effectivePeriod: string;
  /** Per Task 08 Delta 2 / REVIEWS.md B8a — defaults to 'ACTIVE'. */
  state?: 'ACTIVE' | 'DEPRECATED' | 'RETIRED';
  /** Per Task 08 Delta 2 — ISO date string when state='DEPRECATED'. */
  sunsetDate?: string | null;
  /** Per Task 08 Delta 2 — free-text reason citing source ML/etc. */
  deprecationReason?: string | null;
  sourceUrl: string;
  seeds: AgencyRuleSeed[];
}

const URL_GATE = /^https?:\/\//;

export async function seedAgencyVersionAndRules(input: SeedAgencyVersionInput): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const systemTenantId = await ensureSystemTenant(client);
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [systemTenantId]);

    // Get-or-create agency_rule_version idempotently keyed on (agency, version_label).
    // Task 08 Delta 2: when row already exists, leave its state/sunset/reason fields
    // alone (a hand-authored loader re-run should not flip a previously-deprecated
    // ARV back to ACTIVE).
    let arvId: string;
    const existing = await client.query<{ id: string }>(
      `SELECT id::text FROM agency_rule_version
       WHERE agency = $1 AND version_label = $2 LIMIT 1`,
      [input.agency, input.versionLabel],
    );
    if (existing.rows[0]) {
      arvId = existing.rows[0].id;
    } else {
      // Task 08 Delta 2 (REVIEWS.md B8a): thread state / sunset_date /
      // deprecation_reason into the INSERT. Defaults are 'ACTIVE' / null / null
      // when callers omit them. Migration 0013 added the columns; this INSERT
      // is now safe.
      const created = await client.query<{ id: string }>(
        `INSERT INTO agency_rule_version (agency, version_label, source_url, effective_period, state, sunset_date, deprecation_reason)
         VALUES ($1, $2, $3, $4::daterange, $5::agency_rule_state, $6::date, $7)
         RETURNING id::text`,
        [
          input.agency,
          input.versionLabel,
          input.sourceUrl,
          input.effectivePeriod,
          input.state ?? 'ACTIVE',
          input.sunsetDate ?? null,
          input.deprecationReason ?? null,
        ],
      );
      arvId = created.rows[0]!.id;
    }

    // Per-rule INSERT with idempotency via WHERE NOT EXISTS keyed on
    // (agency_rule_version_id, rule_kind, coalesce(rule_body->>'_seed_key', rule_body->>'event_type')).
    // Task 08 Delta 7: the seedKey discriminator is threaded into the rule_body
    // jsonb under the reserved `_seed_key` field so dedupe survives across runs
    // even when 2+ rows share an event_type (FNMA FORECLOSURE B2 split).
    for (const seed of input.seeds) {
      // A2 defense-in-depth: reject non-https?:// citation URLs at load time.
      if (!URL_GATE.test(seed.citation.sourceUrl)) {
        throw new Error(`Citation URL violates ^https?:// gate: ${seed.citation.sourceUrl}`);
      }

      // Defense-in-depth: Zod validate every seed at load time even though
      // fixtures already validate at compile time (Pattern P3).
      parseRuleBody(seed.ruleKind as RuleKind, seed.ruleBody);

      // Citation row (URL-only per D-07).
      //
      // Task 08 Delta 4 (REVIEWS.md B12): use ON CONFLICT (tenant_id,
      // citation_hash) WHERE source_url IS NOT NULL so re-running pnpm
      // db:seed reuses existing citation rows instead of creating orphan
      // duplicates. The DO UPDATE clause is a no-op trick to make
      // ON CONFLICT also return id (DO NOTHING returns zero rows when the
      // row already exists). The WHERE clause is REQUIRED — Postgres
      // demands the conflict_target predicate match the partial unique
      // index predicate exactly, otherwise it raises:
      // `there is no unique or exclusion constraint matching the
      // ON CONFLICT specification`.
      const cit = await client.query<{ id: string }>(
        `INSERT INTO rule_citation (tenant_id, source_url, excerpt)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, citation_hash) WHERE source_url IS NOT NULL
         DO UPDATE SET excerpt = EXCLUDED.excerpt
         RETURNING id::text`,
        [systemTenantId, seed.citation.sourceUrl, seed.citation.excerpt],
      );
      const citationId = cit.rows[0]!.id;

      // seedKey discriminator: prefer explicit seedKey, fall back to event_type.
      const eventType = (seed.ruleBody as { event_type?: string })?.event_type ?? null;
      const dedupeKey = seed.seedKey ?? eventType ?? '';

      await client.query(
        `INSERT INTO agency_rule (
           agency_rule_version_id, rule_kind, rule_body, primary_citation_id
         )
         SELECT $1, $2, jsonb_set($3::jsonb, '{_seed_key}', to_jsonb($5::text)), $4
         WHERE NOT EXISTS (
           SELECT 1 FROM agency_rule
           WHERE agency_rule_version_id = $1
             AND rule_kind = $2
             AND COALESCE(rule_body->>'_seed_key', rule_body->>'event_type', '') = COALESCE($5::text, '')
         )`,
        [arvId, seed.ruleKind, JSON.stringify(seed.ruleBody), citationId, dedupeKey],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* swallow */ }
    throw err;
  } finally {
    client.release();
  }
}

// FHFA 2026 baseline per Assumption A5 — the threshold above which is_high_cost=true.
// Open Question 7: is_high_cost is stored at load time (not derived at read time)
// because the threshold is a function of the FHFA-published year-specific baseline,
// and storing it lets readers JOIN/filter without recomputing.
const FHFA_2026_ONE_UNIT_BASELINE = 832750;

/**
 * Plan 03-06 Rule 1 deviation #1: the actual FHFA CSV's column names contain
 * embedded NEWLINES (e.g. `"One-Unit\nLimit"`) because the published file wraps
 * the headers across two lines inside quoted cells. csv-parse preserves the
 * newline in the column key. The plan-supplied schema used single-space
 * `"One-Unit Limit"` which never matches; we use the literal newline form.
 *
 * Plan 03-06 Rule 1 deviation #2: the limit columns are formatted strings like
 * `"$832,750 "` (dollar sign + thousand-separator commas + trailing space).
 * `z.coerce.number()` directly on these yields NaN. We strip `$`, `,`, and
 * whitespace BEFORE coercion via `.transform`.
 */
const formattedDollarsToInt = (raw: string): number => {
  const cleaned = raw.replace(/[$,\s]/g, '');
  const parsed = Number.parseInt(cleaned, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid dollar value: ${JSON.stringify(raw)}`);
  }
  return parsed;
};

const fhfaRowSchema = z.object({
  'FIPS State Code': z.string().regex(/^\d{1,2}$/, 'expected 1-2 digit state FIPS').transform((s) => s.padStart(2, '0')),
  'FIPS County Code': z.string().regex(/^\d{1,3}$/, 'expected 1-3 digit county FIPS').transform((s) => s.padStart(3, '0')),
  'County Name': z.string().min(1).max(120),
  'State': z.string().length(2),
  'CBSA Number': z.string().regex(/^\d{0,5}$/, 'expected 0-5 digit CBSA').optional().nullable(),
  // Newline-named columns (see deviation #1 above). transform() handles formatted dollars (deviation #2).
  'One-Unit\nLimit': z.string().transform(formattedDollarsToInt),
  'Two-Unit\nLimit': z.string().transform(formattedDollarsToInt).optional().nullable(),
  'Three-Unit\nLimit': z.string().transform(formattedDollarsToInt).optional().nullable(),
  'Four-Unit\nLimit': z.string().transform(formattedDollarsToInt).optional().nullable(),
});

/**
 * seedFhfaYear — extends the Plan 03-01 skeleton with the real CSV-parse +
 *   Zod-validate + per-row INSERT path. Per D-23 two-step daterange close
 *   convention. Idempotent via INSERT ... ON CONFLICT DO NOTHING on both
 *   the version row (year UNIQUE-by-EXCLUDE) and the county row (composite PK).
 *
 * Per REVIEWS.md B10: open-ended versions are detected via
 *   `upper_inf(effective_period)` — the canonical PostgreSQL daterange function
 *   — NOT a fragile text-comparison form that casts the daterange to text and
 *   string-matches the substring 'infinity', which would break if Postgres
 *   ever changed the canonical text form.
 *
 * Per Open Question 7 + Assumption A5: is_high_cost is computed at load time
 *   as `one_unit_baseline > $832,750` (the FHFA 2026 baseline). Stored, not
 *   derived — readers do not recompute.
 */
export async function seedFhfaYear(year: number, csvPath: string): Promise<void> {
  const baseline = year === 2026 ? FHFA_2026_ONE_UNIT_BASELINE : null;
  if (baseline === null) {
    throw new Error(`seedFhfaYear: no baseline configured for year ${year} (Open Question 7 — extend FHFA_*_ONE_UNIT_BASELINE constants when FHFA publishes a new annual table).`);
  }

  const csvBytes = await readFile(csvPath);
  // Pitfall PG-7: bom: true strips the UTF-8 BOM if present.
  // columns: true emits objects keyed by header (header lives across two
  //   physical lines of the file but is one logical CSV header — csv-parse
  //   handles the multiline-quoted header and yields keys with embedded \n).
  // skip_empty_lines: true protects against trailing blank lines from Excel.
  const records = parse(csvBytes, {
    columns: true,
    bom: true,
    trim: true,
    skip_empty_lines: true,
  }) as unknown[];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // D-23 two-step daterange close convention: when this loader runs for year
    // N, any prior open-ended version (year < N) is closed at [its-lower,
    // ${year}-01-01). REVIEWS.md B10 — use upper_inf() instead of fragile text
    // comparison.
    await client.query(
      `UPDATE conforming_loan_limit_version
         SET effective_period = daterange(lower(effective_period), $1::date, '[)')
       WHERE upper_inf(effective_period)
         AND year < $2`,
      [`${year}-01-01`, year],
    );

    // Get-or-create version row keyed on year. The EXCLUDE constraint enforces
    // year-uniqueness over overlapping effective_periods, so a duplicate
    // attempt would raise — instead we look up existing first.
    let versionId: string;
    const existing = await client.query<{ id: string }>(
      `SELECT id::text FROM conforming_loan_limit_version WHERE year = $1 LIMIT 1`,
      [year],
    );
    if (existing.rows[0]) {
      versionId = existing.rows[0].id;
    } else {
      // REVIEWS.md B10 + Plan 03-06 Rule 1 deviation #3: insert with TRULY
      // unbounded upper (`[YYYY-01-01,)`) so `upper_inf(effective_period)`
      // returns true. PostgreSQL distinguishes `'[YYYY-01-01,infinity)'`
      // (bounded by the date type's +infinity sentinel; upper_inf=false)
      // from `'[YYYY-01-01,)'` (unbounded; upper_inf=true). The text form
      // canonicalizes to `[YYYY-01-01,)`. Wave 0/1 agency seeds keep the
      // legacy `infinity` form because their daterange-close detection uses
      // text comparison; FHFA is where B10's upper_inf mandate actually
      // lands.
      const created = await client.query<{ id: string }>(
        `INSERT INTO conforming_loan_limit_version (year, effective_period, source_url)
         VALUES ($1, $2::daterange, $3)
         RETURNING id::text`,
        [
          year,
          `[${year}-01-01,)`,
          'https://www.fhfa.gov/data/conforming-loan-limit',
        ],
      );
      versionId = created.rows[0]!.id;
    }

    // Per-row Zod validation + INSERT.
    for (const raw of records) {
      const row = fhfaRowSchema.parse(raw);
      const countyFips = `${row['FIPS State Code']}${row['FIPS County Code']}`;
      const oneUnit = row['One-Unit\nLimit'];
      const isHighCost = oneUnit > baseline;

      await client.query(
        `INSERT INTO conforming_loan_limit_county (
           limit_version_id, county_fips, state_code,
           one_unit_baseline, two_unit_baseline, three_unit_baseline, four_unit_baseline,
           is_high_cost
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (limit_version_id, county_fips) DO NOTHING`,
        [
          versionId, countyFips, row['State'],
          oneUnit,
          row['Two-Unit\nLimit'] ?? null,
          row['Three-Unit\nLimit'] ?? null,
          row['Four-Unit\nLimit'] ?? null,
          isHighCost,
        ],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* swallow */ }
    throw err;
  } finally {
    client.release();
  }
}
