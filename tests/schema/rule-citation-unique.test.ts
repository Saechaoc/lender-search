/**
 * Phase 3 / Plan 03-01 Task 08 Delta 4 (REVIEWS.md B12).
 *
 * Asserts:
 *   - rule_citation_unique_idx exists with the expected partial-unique definition
 *   - Duplicate INSERT with same (tenant_id, source_url, page_number, excerpt)
 *     is no-op (ON CONFLICT DO UPDATE returns the existing id)
 */
import { describe, expect, it } from 'vitest';

describe('rule_citation unique idempotency (B12 / Delta 4)', () => {
  it('rule_citation_unique_idx exists as partial unique index', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'rule_citation_unique_idx'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.indexdef).toMatch(/UNIQUE INDEX rule_citation_unique_idx/);
      expect(rows[0]?.indexdef).toMatch(/\(tenant_id, citation_hash\)/);
      expect(rows[0]?.indexdef).toMatch(/WHERE \(source_url IS NOT NULL\)/);
    } finally {
      adminClient.release();
    }
  });

  it('duplicate INSERT with same (tenant_id, source_url, excerpt) returns existing id', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      await adminClient.query('BEGIN');
      // Get-or-create a SYSTEM tenant to write under.
      const tenantLookup = await adminClient.query<{ id: string }>(
        `SELECT id::text FROM tenant WHERE kind='SYSTEM' LIMIT 1`,
      );
      let tenantId: string;
      if (tenantLookup.rows[0]) {
        tenantId = tenantLookup.rows[0].id;
      } else {
        const created = await adminClient.query<{ id: string }>(
          `INSERT INTO tenant (id, kind, name)
           VALUES (gen_random_uuid(), 'SYSTEM', 'B12 test tenant')
           RETURNING id::text`,
        );
        tenantId = created.rows[0]!.id;
      }
      await adminClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

      const url = 'https://example/B12-citation-' + Date.now().toString();
      const excerpt = 'B12 unique-key test excerpt';

      const first = await adminClient.query<{ id: string }>(
        `INSERT INTO rule_citation (tenant_id, source_url, excerpt)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, citation_hash) WHERE source_url IS NOT NULL
         DO UPDATE SET excerpt = EXCLUDED.excerpt
         RETURNING id::text`,
        [tenantId, url, excerpt],
      );
      const firstId = first.rows[0]!.id;

      const second = await adminClient.query<{ id: string }>(
        `INSERT INTO rule_citation (tenant_id, source_url, excerpt)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, citation_hash) WHERE source_url IS NOT NULL
         DO UPDATE SET excerpt = EXCLUDED.excerpt
         RETURNING id::text`,
        [tenantId, url, excerpt],
      );
      const secondId = second.rows[0]!.id;

      expect(secondId).toBe(firstId);

      // Confirm only ONE row exists for this URL+excerpt under this tenant.
      const count = await adminClient.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM rule_citation
         WHERE tenant_id = $1 AND source_url = $2 AND excerpt = $3`,
        [tenantId, url, excerpt],
      );
      expect(count.rows[0]?.n).toBe('1');

      await adminClient.query('ROLLBACK');
    } finally {
      adminClient.release();
    }
  });
});
