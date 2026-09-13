import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Данные для /metrics (agents.md §9) — юнит-экономика на реальных данных
 * сида. «Активные часы на заказ» — реальное среднее по `time_entries`
 * (autotimer.ts пишет её при каждом staff-переходе стадии заказа);
 * `null`, пока ни одной записи ещё нет, а не подрисованное число.
 */

/**
 * Полная стоимость обслуживания заказа (§9): время, потраченное на подборы,
 * которые НЕ привели к заказу, разносится на выигранные через коэффициент
 * конверсии. Спека требует показывать это открыто — «полная стоимость
 * обслуживания заказа с учётом несостоявшихся подборов», а не прятать
 * невыигранные RFQ из юнит-экономики.
 */
export interface ServiceCost {
  /** Средние часы на выигранный заказ — только его собственное время. */
  directHours: number;
  /** Доля часов, разнесённая с несостоявшихся подборов. */
  allocatedHours: number;
  /** Ставка часа закупщика из settings — параметр, а не константа (§9). */
  hourCostKzt: number;
  /** Полная себестоимость обслуживания одного выигранного заказа. */
  fullCostKzt: number;
}

export interface HoursTrendPoint {
  /** YYYY-MM */
  month: string;
  hoursPerOrder: number;
  orders: number;
}

export interface MetricsData {
  rfqConversion: { requestsWithRfq: number; requestsWithRfqAndOrder: number };
  estimatorMapePct: number | null;
  repeatCompanies: { total: number; repeat: number };
  gmv: { closedOrders: number; totalKzt: number };
  commission: { closedOrders: number; totalKzt: number; avgKzt: number };
  avgHoursPerOrder: number | null;
  /** Тренд активных часов на заказ по месяцам (§9) — одно среднее скрывает, растёт эффективность или нет. */
  hoursTrend: HoursTrendPoint[];
  serviceCost: ServiceCost | null;
  /** Вклад после прямых затрат на заказ (§9): комиссия минус себестоимость обслуживания. */
  contributionPerOrderKzt: number | null;
  commissionRatePct: number;
  hourCostKzt: number;
}

const CONVERTED_ORDER_STATES = new Set([
  'plan_approved',
  'suppliers_paid',
  'in_production',
  'shipped',
  'delivered',
  'accepted',
  'closed',
]);
const ACCEPTED_ORDER_STATES = new Set(['accepted', 'closed']);

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
    if (order && CONVERTED_ORDER_STATES.has(order.state)) requestsWithRfqAndOrder++;
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
    const hasRealOrder = orders.some((o: { state: string }) => ACCEPTED_ORDER_STATES.has(o.state));
    if (hasRealOrder) {
      companyOrderCounts.set(
        row.buyer_company_id,
        (companyOrderCounts.get(row.buyer_company_id) ?? 0) + 1,
      );
    }
  }
  const totalCompanies = companyOrderCounts.size;
  const repeatCompanies = [...companyOrderCounts.values()].filter((n) => n > 1).length;

  const closedPlanIds = (orderRows ?? [])
    .filter((o) => o.state === 'closed')
    .map((o) => o.approved_plan_id);
  const { data: closedPlans } = closedPlanIds.length
    ? await supabase.from('plans').select('commission_kzt, total_kzt').in('id', closedPlanIds)
    : { data: [] };

  const gmvTotal = (orderRows ?? [])
    .filter((o) => o.state === 'closed' && o.final_cost_kzt !== null)
    .reduce((sum, o) => sum + (o.final_cost_kzt ?? 0), 0);
  const commissionTotal = (closedPlans ?? []).reduce((sum, p) => sum + p.commission_kzt, 0);

  const { data: timeEntryRows } = await supabase
    .from('time_entries')
    .select('order_id, seconds, created_at, source')
    .in('source', ['active', 'manual']);
  const secondsByOrder = new Map<string, number>();
  for (const row of timeEntryRows ?? []) {
    secondsByOrder.set(row.order_id, (secondsByOrder.get(row.order_id) ?? 0) + row.seconds);
  }
  const avgHoursPerOrder =
    secondsByOrder.size > 0
      ? [...secondsByOrder.values()].reduce((s, v) => s + v, 0) / secondsByOrder.size / 3600
      : null;

  // Тренд по месяцам (§9). Месяц берётся по времени самой записи учёта, а не
  // по дате закрытия заказа: вопрос «сколько часов тратим сейчас» — про
  // работу, которая идёт в этом месяце, а не про заказы, закрытые в нём.
  const monthly = new Map<string, { seconds: number; orders: Set<string> }>();
  for (const row of timeEntryRows ?? []) {
    const month = String(row.created_at).slice(0, 7);
    const bucket = monthly.get(month) ?? { seconds: 0, orders: new Set<string>() };
    bucket.seconds += row.seconds;
    bucket.orders.add(row.order_id);
    monthly.set(month, bucket);
  }
  const hoursTrend: HoursTrendPoint[] = [...monthly.entries()]
    .map(([month, bucket]) => ({
      month,
      hoursPerOrder: bucket.seconds / bucket.orders.size / 3600,
      orders: bucket.orders.size,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const { data: settingRows } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', ['commission_rate_pct', 'procurement_hour_cost_kzt']);
  const settingValue = (key: string): number | null => {
    const row = (settingRows ?? []).find((r) => r.key === key);
    return typeof row?.value === 'number' ? row.value : null;
  };
  const commissionRatePct = settingValue('commission_rate_pct') ?? 23;
  const hourCostKzt = settingValue('procurement_hour_cost_kzt') ?? 0;

  // RFQ без сделки (§9): часы по подборам, не дошедшим до заказа,
  // разносятся на выигранные — считает buildServiceCost ниже через ту же
  // конверсию RFQ → сделка, что показана отдельной метрикой выше, а не
  // через второй, отдельно посчитанный процент.
  const serviceCost = buildServiceCost({
    secondsByOrder,
    closedOrderCount: closedPlanIds.length,
    requestsWithRfq: requestIdsWithRfq.size,
    requestsWithRfqAndOrder,
    hourCostKzt,
  });
  const contributionPerOrderKzt =
    serviceCost && closedPlans?.length
      ? Math.round(commissionTotal / closedPlans.length - serviceCost.fullCostKzt)
      : null;

  return {
    rfqConversion: {
      requestsWithRfq: requestIdsWithRfq.size,
      requestsWithRfqAndOrder,
    },
    estimatorMapePct,
    repeatCompanies: { total: totalCompanies, repeat: repeatCompanies },
    gmv: { closedOrders: closedPlanIds.length, totalKzt: gmvTotal },
    commission: {
      closedOrders: closedPlans?.length ?? 0,
      totalKzt: commissionTotal,
      avgKzt: closedPlans?.length ? Math.round(commissionTotal / closedPlans.length) : 0,
    },
    avgHoursPerOrder,
    hoursTrend,
    serviceCost,
    contributionPerOrderKzt,
    commissionRatePct,
    hourCostKzt,
  };
}

/**
 * Разнос времени несостоявшихся подборов на выигранные заказы (§9).
 * Коэффициент — конверсия RFQ → сделка: если из 10 подборов заказом
 * стали 4, то на каждый выигранный заказ приходится ещё 1.5 подбора,
 * которые тоже кто-то делал руками.
 */
export function buildServiceCost(input: {
  secondsByOrder: Map<string, number>;
  closedOrderCount: number;
  requestsWithRfq: number;
  requestsWithRfqAndOrder: number;
  hourCostKzt: number;
}): ServiceCost | null {
  const {
    secondsByOrder,
    closedOrderCount,
    requestsWithRfq,
    requestsWithRfqAndOrder,
    hourCostKzt,
  } = input;
  if (secondsByOrder.size === 0 || closedOrderCount <= 0 || hourCostKzt <= 0) return null;

  const totalHours = [...secondsByOrder.values()].reduce((s, v) => s + v, 0) / 3600;
  // The numerator includes all recorded work in the reporting cohort; divide
  // by actual closed wins, not by whichever orders happened to have a row.
  // This keeps the unit cost honest when open/lost RFQ work is allocated to
  // the orders that paid for the service.
  const directHours = totalHours / closedOrderCount;

  // Конверсия ниже 100% означает, что часть подборов не окупилась заказом.
  const conversion = requestsWithRfq > 0 ? requestsWithRfqAndOrder / requestsWithRfq : 1;
  const allocatedHours = conversion > 0 ? directHours * (1 / conversion - 1) : 0;

  return {
    directHours,
    allocatedHours,
    hourCostKzt,
    fullCostKzt: Math.round((directHours + allocatedHours) * hourCostKzt),
  };
}
