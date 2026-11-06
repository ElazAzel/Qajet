import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { database } from '../../test/postgrest-fixture';
import { loadBuyerCase, loadBuyerCases } from './buyer-case';
import { loadBuyerOrder } from './buyer-order';
import { loadBuyerPlans } from './buyer-plans';
import { loadOrderConfirmation } from './order-confirmation';

vi.mock('./documents', () => ({ loadQajetRequisites: async () => null }));

const request = {
  id: 'request',
  title: 'E2E buyer plan',
  status: 'submitted',
  updated_at: '2026-01-01',
  deadline_date: '2026-12-31',
  buyer_company_id: 'buyer-company',
  orders: [],
};
const order = {
  id: 'order',
  request_id: request.id,
  state: 'plan_proposed',
  approved_plan_id: 'selected',
  requests: { title: request.title },
};
const selected = {
  id: 'selected',
  request_id: request.id,
  version: 2,
  kind: 'balanced',
  status: 'proposed',
  delivery_kzt: 100,
  supplier_rebate_kzt: 20,
  total_kzt: 1200,
  eta_date: '2026-12-01',
  slack_days: 3,
  supplier_count: 2,
};

/** Raw plans reads fail, even when the safe RPC returns authorized public fields. */
function buyerDatabase(plans = [selected], failRpc = false) {
  const base = database(
    { requests: [request], orders: [order], plans },
    failRpc ? 'get_buyer_plans' : undefined,
  );
  const from = vi.fn((table: string) => {
    if (table === 'plans') throw new Error('Buyer cannot SELECT raw plans');
    return base.from(table);
  });
  const rpc = vi.fn((name: string, args: { p_request_ids: string[] }) => base.rpc(name, args));
  return { client: { from, rpc } as unknown as SupabaseClient, from, rpc };
}

describe('buyer plan readers use the allowlisted RPC', () => {
  it('does not query for an empty request selection', async () => {
    const { client, rpc } = buyerDatabase();
    expect(await loadBuyerPlans(client, [])).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('deduplicates request IDs and batches at most 100 per RPC', async () => {
    const { client, rpc } = buyerDatabase();
    const ids = Array.from({ length: 101 }, (_, n) => `request-${n}`);
    expect(await loadBuyerPlans(client, [...ids, ...ids])).toEqual([]);
    expect(rpc.mock.calls.map((call) => call[1].p_request_ids.length)).toEqual([100, 1]);
  });

  it('preserves selected price, rebate, dates, and offered alternatives without raw plans', async () => {
    const { client, rpc } = buyerDatabase([
      selected,
      { ...selected, id: 'newer', version: 3, total_kzt: 1400 },
      { ...selected, id: 'draft', version: 4, status: 'draft' },
      { ...selected, id: 'rejected', version: 5, status: 'rejected' },
    ]);
    const result = await loadBuyerOrder(client, order.id);
    expect(result?.plan).toEqual({
      id: selected.id,
      version: 2,
      kind: 'balanced',
      status: 'proposed',
      deliveryKzt: 100,
      supplierRebateKzt: 20,
      totalKzt: 1200,
      etaDate: '2026-12-01',
      slackDays: 3,
      supplierCount: 2,
    });
    expect(result?.alternatives.map((plan) => plan.id)).toEqual(['newer', 'selected']);
    expect(rpc).toHaveBeenCalledWith('get_buyer_plans', { p_request_ids: [request.id] });
  });

  it('keeps confirmation bound to the selected plan rather than the latest version', async () => {
    const { client } = buyerDatabase([selected, { ...selected, id: 'newer', version: 3 }]);
    const result = await loadOrderConfirmation(client, order.id);
    expect(result).toMatchObject({
      planId: 'selected',
      planVersion: 2,
      totalKzt: 1200,
      deliveryKzt: 100,
      supplierRebateKzt: 20,
      etaDate: '2026-12-01',
    });
  });

  it('uses the newest offered ETA for list and detail, not a newer draft', async () => {
    const { client } = buyerDatabase([
      selected,
      { ...selected, id: 'newer', version: 3, eta_date: '2026-12-02' },
      { ...selected, id: 'draft', version: 4, status: 'draft', eta_date: '2026-12-03' },
    ]);
    expect((await loadBuyerCases(client, true))[0]?.expectedAt).toBe('2026-12-02');
    expect((await loadBuyerCase(client, request.id, true))?.expectedAt).toBe('2026-12-02');
  });

  it('paginates more than 1000 plans without losing the newest selected plan', async () => {
    const plans = Array.from({ length: 1001 }, (_, n) => ({
      ...selected,
      id: String(n).padStart(8, '0'),
      version: n + 1,
    }));
    const { client, rpc } = buyerDatabase([...plans, selected]);
    const result = await loadBuyerOrder(client, order.id);
    expect(result?.alternatives).toHaveLength(1002);
    expect(result?.alternatives[0]?.version).toBe(1001);
    expect(result?.plan?.id).toBe('selected');
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it('does not fall back to the raw table or silently hide a failed RPC', async () => {
    const { client, from } = buyerDatabase([selected], true);
    await expect(loadBuyerOrder(client, order.id)).rejects.toThrow();
    await expect(loadBuyerCase(client, request.id, true)).rejects.toThrow();
    await expect(loadOrderConfirmation(client, order.id)).rejects.toThrow();
    expect(from).not.toHaveBeenCalledWith('plans');
  });
});
