/**
 * SC#2 acceptance: structured DerogRule round-trip (D-20.6).
 */
import { describe, expect, it } from 'vitest';
import { seedAgencyDerogRule } from './fixtures/seed.js';
import { fnmaForeclosure } from '../rules/fixtures/fnma-foreclosure.js';

describe('FNMA post-FC DerogRule round-trip (SC#2 / D-20.6)', () => {
  it('inserts fixture, queries by event_type=FORECLOSURE, asserts structured body', async () => {
    const seed = await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2026-04-01,2027-04-01)', fnmaForeclosure);

    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      const { rows } = await adminClient.query<{ rule_body: typeof fnmaForeclosure }>(
        `SELECT rule_body FROM agency_rule
          WHERE rule_kind = 'derog_seasoning'
            AND rule_body->>'event_type' = 'FORECLOSURE'
            AND id = $1::uuid`,
        [seed.agencyRuleId],
      );

      expect(rows).toHaveLength(1);
      const body = rows[0]!.rule_body;
      expect(body.event_type).toBe('FORECLOSURE');
      expect(body.base_waiting_months).toBe(84);
      expect(body.extenuating_circumstances_waiting_months).toBe(36);
      expect(body.post_event_LTV_caps).toHaveLength(1);
      expect(body.post_event_LTV_caps[0]?.max_LTV).toBe(90);
      expect(body.post_event_LTV_caps[0]?.purposeAllowList).toEqual(['PURCHASE', 'RATE_TERM_REFI']);
      expect(body.post_event_LTV_caps[0]?.occupancyAllowList).toEqual(['PRIMARY']);
      expect(body.mortgage_included_in_bk_rule).toBe('BK_CLOCK_APPLIES_IF_NOT_REAFFIRMED');
    } finally {
      adminClient.release();
    }
  });

  it('partial expression index supports the SC#2 query path', async () => {
    await seedAgencyDerogRule(globalThis.__pgAdminPool, 'FNMA', '[2030-04-01,2031-04-01)', fnmaForeclosure);

    const adminClient = await globalThis.__pgAdminPool.connect();
    try {
      await adminClient.query('BEGIN');
      await adminClient.query('SET LOCAL enable_seqscan = off');
      const { rows } = await adminClient.query<{ "QUERY PLAN": string }>(
        `EXPLAIN SELECT id FROM agency_rule
          WHERE rule_kind = 'derog_seasoning'
            AND rule_body->>'event_type' = 'FORECLOSURE'`,
      );
      await adminClient.query('ROLLBACK');

      const planText = rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(planText).toMatch(/Index/i);
    } finally {
      adminClient.release();
    }
  });
});
