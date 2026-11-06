import { describe, expect, it } from 'vitest';
import { database } from '../../test/postgrest-fixture';
import { loadMetrics } from './metrics';

const id = (n: number) => String(n).padStart(8, '0');
function tables() {
  return {
    rfqs: Array.from({ length: 1001 }, (_, n) => ({ id: id(n), request_id: id(n) })),
    orders: Array.from({ length: 1001 }, (_, n) => ({
      id: id(n),
      request_id: id(n),
      state: 'closed',
      final_cost_kzt: 10,
      approved_plan_id: id(n),
    })),
    plans: Array.from({ length: 1001 }, (_, n) => ({
      id: id(n),
      commission_kzt: 2,
      total_kzt: 10,
    })),
    requests: Array.from({ length: 1001 }, (_, n) => ({
      id: id(n),
      buyer_company_id: 'company',
      orders: [{ state: 'closed' }],
    })),
    time_entries: Array.from({ length: 1001 }, (_, n) => ({
      id: id(n),
      order_id: 'order',
      seconds: 3600,
      source: 'active',
      created_at: '2026-01-01',
    })),
    settings: [
      { key: 'commission_rate_pct', value: 23 },
      { key: 'procurement_hour_cost_kzt', value: 1000 },
    ],
  };
}
describe('metrics complete histories', () => {
  it('includes all visible orders, plans, RFQs and hours beyond1000 without oversized IN queries', async () => {
    const result = await loadMetrics(database(tables()));
    expect(result.rfqConversion).toEqual({ requestsWithRfq: 1001, requestsWithRfqAndOrder: 1001 });
    expect(result.gmv).toEqual({ closedOrders: 1001, totalKzt: 10010 });
    expect(result.commission.totalKzt).toBe(2002);
    expect(result.avgHoursPerOrder).toBe(1001);
  });
  for (const table of [
    'rfqs',
    'orders',
    'requests',
    'plans',
    'time_entries',
    'settings',
    'model_snapshots',
  ]) {
    it(`rejects failed ${table} instead of publishing partial or invented metrics`, async () => {
      await expect(loadMetrics(database(tables(), table))).rejects.toThrow();
    });
  }
});
