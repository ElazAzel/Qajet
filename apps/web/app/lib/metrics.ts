import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Данные для /metrics (agents.md §9) — юнит-экономика на реальных данных
 * сида. «Активные часы на заказ» честно показаны как отсутствующие:
 * time_entries пуста, автотаймер консьержа ещё не подключён к UI —
 * это описано в agents.md §9 как отдельная функция, а не посчитано здесь
 * по угадыванию.
 */

export interface MetricsData {
  rfqConversion: { requestsWithRfq: number; requestsWithRfqAndOrder: number };
  estimatorMapePct: number | null;
  repeatCompanies: { total: number; repeat: number };
  gmv: { closedOrders: number; totalKzt: number };
  commission: { closedOrders: number; totalKzt: number; avgKzt: number };
  hasTimeEntries: boolean;
  commissionRatePct: number;
}

export async function loadMetrics(supabase: SupabaseClient): Promise<MetricsData> {
  const { data: rfqRows } = await supabase.from('rfqs').select('request_id');
  const { data: orderRows } = await supabase
    .from('orders')
    .select('request_id, state, final_cost_kzt, approved_plan_id');

  const orderByRequestId = new Map((orderRows ?? []).map((o) => [o.request_id, o]));
  const requestIdsWithRfq = new Set((rfqRows ?? []).map((r) => r.request_id));
  let requestsWithRfqAndOrder = 0;
  for (const requestId of requestIdsWithRfq) {
    const order = orderByRequestId.get(requestId);
    if (order && order.state !== 'cancelled') requestsWithRfqAndOrder++;
  }

  const { data: latestEstimatorSnapshot } = await supabase
    .from('model_snapshots')
    .select('metrics')
    .eq('model', 'estimator')
    .order('trained_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const byCategory =
    (latestEstimatorSnapshot?.metrics?.byCategory as { mape: number | null }[] | undefined) ?? [];
  const withMape = byCategory.filter((c) => c.mape !== null);
  const estimatorMapePct =
    withMape.length > 0
      ? (withMape.reduce((sum, c) => sum + (c.mape ?? 0), 0) / withMape.length) * 100
      : null;

  const { data: requestsWithOrders } = await supabase
    .from('requests')
    .select('buyer_company_id, orders(state)');

  const companyOrderCounts = new Map<string, number>();
  for (const row of requestsWithOrders ?? []) {
    const orders = Array.isArray(row.orders) ? row.orders : row.orders ? [row.orders] : [];
    const hasRealOrder = orders.some(
      (o: { state: string }) => o.state !== 'draft' && o.state !== 'cancelled',
    );
    if (hasRealOrder) {
      companyOrderCounts.set(
        row.buyer_company_id,
        (companyOrderCounts.get(row.buyer_company_id) ?? 0) + 1,
      );
    }
  }
  const totalCompanies = companyOrderCounts.size;
  const repeatCompanies = [...companyOrderCounts.values()].filter((n) => n > 1).length;

  const closedOrderIds = (orderRows ?? [])
    .filter((o) => o.state === 'closed')
    .map((o) => o.approved_plan_id);
  const { data: closedPlans } = closedOrderIds.length
    ? await supabase.from('plans').select('commission_kzt, total_kzt').in('id', closedOrderIds)
    : { data: [] };

  const gmvTotal = (orderRows ?? [])
    .filter((o) => o.state === 'closed' && o.final_cost_kzt !== null)
    .reduce((sum, o) => sum + (o.final_cost_kzt ?? 0), 0);
  const commissionTotal = (closedPlans ?? []).reduce((sum, p) => sum + p.commission_kzt, 0);

  const { count: timeEntriesCount } = await supabase
    .from('time_entries')
    .select('*', { count: 'exact', head: true });

  const { data: commissionSetting } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'commission_rate_pct')
    .maybeSingle();

  return {
    rfqConversion: {
      requestsWithRfq: requestIdsWithRfq.size,
      requestsWithRfqAndOrder,
    },
    estimatorMapePct,
    repeatCompanies: { total: totalCompanies, repeat: repeatCompanies },
    gmv: { closedOrders: closedOrderIds.length, totalKzt: gmvTotal },
    commission: {
      closedOrders: closedPlans?.length ?? 0,
      totalKzt: commissionTotal,
      avgKzt: closedPlans?.length ? Math.round(commissionTotal / closedPlans.length) : 0,
    },
    hasTimeEntries: (timeEntriesCount ?? 0) > 0,
    commissionRatePct: (commissionSetting?.value as number) ?? 12,
  };
}
