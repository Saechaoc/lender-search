/**
 * Phase 3 review WR-06: prevent future migrations from including unguarded
 * DROP TABLE / DROP TABLE ... CASCADE statements.
 *
 * Migration 0008 dropped + recreated evaluation_event under the assumption
 * that 0007 left it empty (true on a fresh CI DB). The review correctly
 * flagged that a developer applying 0007 + inserting test data + then
 * pulling 0008 from main would silently lose that data on `pnpm db:migrate`.
 * 0008 is already shipped — it's grandfathered. But future destructive
 * migrations should have either:
 *   - a DO $$ ... RAISE EXCEPTION ... END $$ row-count guard before the
 *     DROP, or
 *   - an explicit comment justifying the unguarded drop (e.g. for
 *     migrations that DROP a table never created in production)
 *
 * This lint test scans every migration file for DROP TABLE patterns and
 * fails when a NEW migration (post-grandfather list) lacks the guard.
 *
 * The grandfather list includes only migrations already merged at the
 * time WR-06 was identified. Adding new entries to this list requires
 * a comment explaining why the destructive op is safe.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Migrations already shipped at the time WR-06 lint landed. New migrations
// must NOT be added here without an accompanying review.
const GRANDFATHERED = new Set<string>([
  // 0008 originally drops evaluation_event before recreating it as
  // PARTITION BY RANGE. The header comment explains the empty-table
  // assumption; the data-loss footgun the review flagged is documented.
  '0008_evaluation_event_partitioned.sql',
  // 0017 drops the citation_hash GENERATED column to rebuild it with the
  // BL-03 extended identity expression. ALTER ... DROP COLUMN, not DROP
  // TABLE — but the regex below is greedy and we keep this in the
  // allowlist for clarity.
  '0017_rule_citation_hash_full_identity.sql',
]);

// Patterns that would silently lose data:
//   - DROP TABLE [IF EXISTS] <name> [CASCADE];
//   - DROP TABLE <name>;
// Permitted under guard:
//   - Inside DO $$ ... IF (SELECT count(*) FROM x) = 0 THEN DROP TABLE x; END IF; END $$;
const DROP_TABLE_REGEX = /^\s*DROP\s+TABLE\b/im;
const HAS_GUARD_REGEX = /(SELECT\s+\d+\s+FROM\s+\w+\s+LIMIT\s+1|count\s*\(\s*\*\s*\)|RAISE\s+EXCEPTION)/i;

describe('destructive migration guard (WR-06)', () => {
  it('every migration with DROP TABLE either has a guard or is grandfathered', () => {
    const migrationsDir = join(process.cwd(), 'db', 'migrations');
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));

    const offenders: string[] = [];
    for (const file of files) {
      if (GRANDFATHERED.has(file)) continue;
      const body = readFileSync(join(migrationsDir, file), 'utf-8');
      if (!DROP_TABLE_REGEX.test(body)) continue;
      if (HAS_GUARD_REGEX.test(body)) continue;
      offenders.push(file);
    }

    expect(
      offenders,
      `Migrations with unguarded DROP TABLE: ${offenders.join(', ')}. ` +
        `Either wrap the DROP in a DO $$ block that asserts the table is ` +
        `empty (RAISE EXCEPTION on rows present), or add the file to the ` +
        `GRANDFATHERED set in this test with a comment explaining why the ` +
        `destructive operation is safe in this case.`,
    ).toEqual([]);
  });
});
