/**
 * Phase 3 review BL-03: extended citation_hash identity.
 *
 * Migration 0017 rebuilt rule_citation.citation_hash to include bbox +
 * source_pdf_sha256 alongside (source_url, page_number, excerpt). This
 * test asserts:
 *   - Two citations sharing all fields except bbox produce DISTINCT hashes
 *     (so a future fixture citing different page regions of the same URL
 *     does not silently collide on the partial unique index).
 *   - Two citations sharing all fields except source_pdf_sha256 produce
 *     DISTINCT hashes (so two PDF revisions of the same URL coexist).
 *   - Two citations sharing all fields including bbox + source_pdf_sha256
 *     produce IDENTICAL hashes (the dedupe path still works for a true
 *     idempotent re-seed).
 */
import { describe, expect, it } from 'vitest';

describe('rule_citation citation_hash full identity (BL-03 / migration 0017)', () => {
  async function getOrCreateSystemTenant(adminClient: import('pg').PoolClient): Promise<string> {
    const lookup = await adminClient.query<{ id: string }>(
      `SELECT id::text FROM tenant WHERE kind='SYSTEM' LIMIT 1`,
    );
    if (lookup.rows[0]) return lookup.rows[0].id;
    const created = await adminClient.query<{ id: string }>(
      `INSERT INTO tenant (id, kind, name)
       VALUES (gen_random_uuid(), 'SYSTEM', 'BL-03 test tenant')
       RETURNING id::text`,
    );
    return created.rows[0]!.id;
  }

  it('citation_hash distinguishes bbox', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      await adminClient.query('BEGIN');
      const tenantId = await getOrCreateSystemTenant(adminClient);
      await adminClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

      const url = `https://example.com/bl03-bbox-${Date.now()}`;
      const a = await adminClient.query<{ citation_hash: string }>(
        `INSERT INTO rule_citation (tenant_id, source_url, excerpt, bbox)
         VALUES ($1, $2, 'same excerpt', $3::jsonb)
         RETURNING citation_hash`,
        [tenantId, url, '{"x":0,"y":0,"w":100,"h":50}'],
      );
      const b = await adminClient.query<{ citation_hash: string }>(
        `INSERT INTO rule_citation (tenant_id, source_url, excerpt, bbox)
         VALUES ($1, $2, 'same excerpt', $3::jsonb)
         RETURNING citation_hash`,
        [tenantId, url, '{"x":50,"y":50,"w":100,"h":50}'],
      );
      expect(a.rows[0]?.citation_hash).not.toBe(b.rows[0]?.citation_hash);
      await adminClient.query('ROLLBACK');
    } finally {
      adminClient.release();
    }
  });

  it('citation_hash distinguishes source_pdf_sha256', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      await adminClient.query('BEGIN');
      const tenantId = await getOrCreateSystemTenant(adminClient);
      await adminClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

      const url = `https://example.com/bl03-pdf-sha-${Date.now()}`;
      const a = await adminClient.query<{ citation_hash: string }>(
        `INSERT INTO rule_citation (tenant_id, source_url, excerpt, source_pdf_sha256)
         VALUES ($1, $2, 'same excerpt', $3)
         RETURNING citation_hash`,
        [tenantId, url, 'a'.repeat(64)],
      );
      const b = await adminClient.query<{ citation_hash: string }>(
        `INSERT INTO rule_citation (tenant_id, source_url, excerpt, source_pdf_sha256)
         VALUES ($1, $2, 'same excerpt', $3)
         RETURNING citation_hash`,
        [tenantId, url, 'b'.repeat(64)],
      );
      expect(a.rows[0]?.citation_hash).not.toBe(b.rows[0]?.citation_hash);
      await adminClient.query('ROLLBACK');
    } finally {
      adminClient.release();
    }
  });

  it('citation_hash is identical when ALL identity fields match (idempotent seed path)', async () => {
    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      await adminClient.query('BEGIN');
      const tenantId = await getOrCreateSystemTenant(adminClient);
      await adminClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

      const url = `https://example.com/bl03-idempotent-${Date.now()}`;
      const bbox = '{"x":10,"y":20,"w":80,"h":40}';
      const sha256 = 'c'.repeat(64);

      const a = await adminClient.query<{ citation_hash: string; id: string }>(
        `INSERT INTO rule_citation (tenant_id, source_url, excerpt, bbox, source_pdf_sha256)
         VALUES ($1, $2, 'same excerpt', $3::jsonb, $4)
         RETURNING citation_hash, id::text`,
        [tenantId, url, bbox, sha256],
      );
      const b = await adminClient.query<{ id: string }>(
        `INSERT INTO rule_citation (tenant_id, source_url, excerpt, bbox, source_pdf_sha256)
         VALUES ($1, $2, 'same excerpt', $3::jsonb, $4)
         ON CONFLICT (tenant_id, citation_hash) WHERE source_url IS NOT NULL
         DO UPDATE SET excerpt = EXCLUDED.excerpt
         RETURNING id::text`,
        [tenantId, url, bbox, sha256],
      );
      expect(b.rows[0]?.id).toBe(a.rows[0]?.id);
      await adminClient.query('ROLLBACK');
    } finally {
      adminClient.release();
    }
  });
});
