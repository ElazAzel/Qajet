import {
  applyReliability,
  calculateSupplierReliability,
  type SupplierLeadHistoryEntry,
} from '@qajet/engine/leadtime';
import {
  type MatchOutcome,
  recalibrateEstimators,
  recalibrateMatchWeights,
} from '@qajet/engine/learn';
import { DEFAULT_WEIGHTS, type MatchWeights, type ScoringFeatures } from '@qajet/engine/match';
import type { SupabaseClient } from '@supabase/supabase-js';
import { appendEstimatorError, itemKeyForEstimator } from './estimator-recalibration';
import { checkedLearningQuery } from './learning/query';

/**
 * Learning recalibration is run by the leased learning dispatcher with its
 * server-only client. Successful empty history remains a no-op, but every
 * failed read/write must reject so the dispatcher does not mark it complete.
 * Snapshot writes are not atomic with event completion: partial retries can
 * still repeat an earlier model update.
 */

const LEADTIME_MODEL = 'leadtime' as const;
const MATCHER_MODEL = 'matcher' as const;
const DAY_MS = 24 * 60 * 60 * 1000;

interface BySupplierEntry {
  supplierId: string;
  kShrunk: number;
}

/**
 * Пересчитывает надёжность по сроку для одного поставщика по всей его
 * истории доставленных/принятых/закрытых заказов и дописывает новый
 * снапшот 'leadtime' — тот же формат `params.bySupplier`, что уже
 * пишет packages/db/src/seed/generator.ts для демо-истории, чтобы
 * /admin/learning и comparison.ts читали единый источник.
 */
export async function recalibrateLeadTimeForSupplier(
  supabase: SupabaseClient,
  supplierId: string,
): Promise<void> {
  const { data: pastOrders } = await checkedLearningQuery(
    supabase
      .from('orders')
      .select('id, approved_plan_id')
      .in('state', ['delivered', 'accepted', 'closed']),
    'learning.leadtime.orders',
  );
  const planIds = (pastOrders ?? [])
    .map((o) => o.approved_plan_id)
    .filter((id): id is string => id !== null);
  if (planIds.length === 0) return;

  const { data: lines } = await checkedLearningQuery(
    supabase
      .from('plan_lines')
      .select('plan_id, quote_line_id, supplier_company_id')
      .eq('supplier_company_id', supplierId)
      .in('plan_id', planIds),
    'learning.leadtime.lines',
  );
  if (!lines || lines.length === 0) return;

  const orderIdByPlanId = new Map(
    (pastOrders ?? [])
      .filter((o) => o.approved_plan_id !== null)
      .map((o) => [o.approved_plan_id as string, o.id as string]),
  );
  const quoteLineIds = lines.map((l) => l.quote_line_id);
  const { data: quoteLines } = await checkedLearningQuery(
    supabase.from('quote_lines').select('id, lead_time_days').in('id', quoteLineIds),
    'learning.leadtime.quotes',
  );
  const declaredDaysByQuoteLineId = new Map(
    (quoteLines ?? []).map((q) => [q.id as string, q.lead_time_days as number]),
  );

  const relevantOrderIds = [
    ...new Set(
      lines
        .map((l) => orderIdByPlanId.get(l.plan_id))
        .filter((id): id is string => id !== undefined),
    ),
  ];
  const { data: events } = relevantOrderIds.length
    ? await checkedLearningQuery(
        supabase
          .from('order_stage_events')
          .select('order_id, to_state, at')
          .in('order_id', relevantOrderIds)
          .in('to_state', ['suppliers_paid', 'in_production', 'delivered']),
        'learning.leadtime.events',
      )
    : { data: [] };
  const executionStartedAtByOrder = new Map<string, number>();
  const deliveredAtByOrder = new Map<string, number>();
  for (const e of events ?? []) {
    const t = new Date(e.at as string).getTime();
    if (
      (e.to_state === 'suppliers_paid' || e.to_state === 'in_production') &&
      !executionStartedAtByOrder.has(e.order_id)
    ) {
      executionStartedAtByOrder.set(e.order_id, t);
    }
    if (e.to_state === 'delivered') deliveredAtByOrder.set(e.order_id, t);
  }

  // New orders have one confirmation per supplier. The order-level delivered
  // event remains a compatibility fallback for historical/demo rows created
  // before that table existed.
  const { data: deliveryRows } = relevantOrderIds.length
    ? await checkedLearningQuery(
        supabase
          .from('order_supplier_deliveries')
          .select('order_id, supplier_company_id, confirmed_at')
          .in('order_id', relevantOrderIds),
        'learning.leadtime.deliveries',
      )
    : { data: [] };
  const deliveredAtBySupplierOrder = new Map<string, number>();
  for (const row of deliveryRows ?? []) {
    deliveredAtBySupplierOrder.set(
      `${row.order_id}:${row.supplier_company_id}`,
      new Date(row.confirmed_at as string).getTime(),
    );
  }

  const history: SupplierLeadHistoryEntry[] = [];
  for (const line of lines) {
    const orderId = orderIdByPlanId.get(line.plan_id);
    const declaredDays = declaredDaysByQuoteLineId.get(line.quote_line_id);
    const startedAt = orderId ? executionStartedAtByOrder.get(orderId) : undefined;
    const deliveredAt = orderId
      ? (deliveredAtBySupplierOrder.get(`${orderId}:${line.supplier_company_id}`) ??
        deliveredAtByOrder.get(orderId))
      : undefined;
    if (!declaredDays || startedAt === undefined || deliveredAt === undefined) continue;
    history.push({ declaredDays, actualDays: (deliveredAt - startedAt) / DAY_MS });
  }
  if (history.length === 0) return;

  const reliability = calculateSupplierReliability(history);

  const { data: latestSnapshot } = await checkedLearningQuery(
    supabase
      .from('model_snapshots')
      .select('params')
      .eq('model', LEADTIME_MODEL)
      .order('trained_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    'learning.leadtime.snapshot_read',
  );
  const previousBySupplier = (
    (latestSnapshot?.params as { bySupplier?: BySupplierEntry[] } | null)?.bySupplier ?? []
  ).filter((s) => s.supplierId !== supplierId);
  const bySupplier = [...previousBySupplier, { supplierId, kShrunk: reliability.kShrunk }];

  await checkedLearningQuery(
    supabase.from('model_snapshots').insert({
      model: LEADTIME_MODEL,
      params: { bySupplier },
      metrics: { nSuppliersWithHistory: bySupplier.length },
      n_samples: history.length,
    }),
    'learning.leadtime.snapshot_write',
  );
}

/**
 * Читает последний снапшот 'leadtime' и применяет надёжность конкретного
 * поставщика к заявленному сроку — та же формула, что предсказывает
 * `predictAfterQuote()`, но без пересчёта сырой истории на каждый рендер
 * (comparison.ts вызывается на каждое открытие экрана консьержем).
 * Поставщик без сохранённой надёжности — kShrunk по умолчанию 1.0, то
 * есть прогноз = заявленный срок + буфер (то же поведение, что было до
 * подключения, для поставщиков без истории).
 */
export async function loadSupplierReliabilityMap(
  supabase: SupabaseClient,
  supplierIds: readonly string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (supplierIds.length === 0) return map;

  const { data: latestSnapshot } = await checkedLearningQuery(
    supabase
      .from('model_snapshots')
      .select('params')
      .eq('model', LEADTIME_MODEL)
      .order('trained_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    'learning.reliability.snapshot_read',
  );
  const bySupplier =
    (latestSnapshot?.params as { bySupplier?: BySupplierEntry[] } | null)?.bySupplier ?? [];
  for (const entry of bySupplier) {
    if (supplierIds.includes(entry.supplierId)) map.set(entry.supplierId, entry.kShrunk);
  }
  return map;
}

export { applyReliability };

/**
 * Дообучает веса матчера SGD-шагом по исходам RFQ этой заявки (§8G) —
 * признаки берутся из `rfqs.selection_reason.features`, реально
 * сохранённых в момент рассылки (`createRfqsForOrder`, тот же снимок,
 * которым скоринг принял решение тогда, а не пересчитанных по уже
 * изменившейся статистике поставщика задним числом). Цель — попал ли
 * поставщик в итоговый утверждённый план. RFQ, выигранные слотом
 * исследования, признаков не несут (agents.md §8C — это другой механизм,
 * не обучаемый скоринг) и в выборку не входят.
 */
export async function recalibrateMatcherForOrder(
  supabase: SupabaseClient,
  order: { requestId: string; approvedPlanId: string | null },
): Promise<void> {
  if (!order.approvedPlanId) return;

  const { data: rfqRows } = await checkedLearningQuery(
    supabase
      .from('rfqs')
      .select('supplier_company_id, selection_reason')
      .eq('request_id', order.requestId),
    'learning.matcher.rfqs',
  );
  const withFeatures = (rfqRows ?? [])
    .map((r) => ({
      supplierId: r.supplier_company_id as string,
      features: (r.selection_reason as { features?: ScoringFeatures } | null)?.features,
    }))
    .filter((r): r is { supplierId: string; features: ScoringFeatures } => !!r.features);
  if (withFeatures.length === 0) return;

  const { data: winningLines } = await checkedLearningQuery(
    supabase.from('plan_lines').select('supplier_company_id').eq('plan_id', order.approvedPlanId),
    'learning.matcher.winners',
  );
  const winners = new Set((winningLines ?? []).map((l) => l.supplier_company_id));

  const outcomes: MatchOutcome[] = withFeatures.map((o) => ({
    features: o.features,
    target: winners.has(o.supplierId) ? 1 : 0,
  }));

  const { data: latestSnapshot } = await checkedLearningQuery(
    supabase
      .from('model_snapshots')
      .select('params')
      .eq('model', MATCHER_MODEL)
      .order('trained_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    'learning.matcher.snapshot_read',
  );
  const startingWeights =
    (latestSnapshot?.params as { weights?: MatchWeights } | null)?.weights ?? DEFAULT_WEIGHTS;

  const result = recalibrateMatchWeights(outcomes, startingWeights);

  await checkedLearningQuery(
    supabase.from('model_snapshots').insert({
      model: MATCHER_MODEL,
      params: { weights: result.weights },
      metrics: { nSamples: result.nSamples },
      n_samples: result.nSamples,
    }),
    'learning.matcher.snapshot_write',
  );
}

/**
 * Пересчёт калькулятора по факту закрытого заказа (agents.md §8B, §8G).
 *
 * До этого `recalibrateEstimators()` из `packages/engine/learn` не
 * вызывался из `apps/web` ни разу: движок был написан и протестирован, но
 * точность калькулятора в проде не улучшалась никогда, а график на
 * `/admin/learning` показывал тренд, целиком сгенерированный сидом. То
 * есть «система учится» было правдой про демо-историю и неправдой про
 * живую работу.
 *
 * Снимок дополняет скользящую историю предыдущего снапшота новым фактом
 * закрытого заказа. Так расчёт остаётся дешёвым на каждом переходе, а
 * recalibrateEstimators() всё равно пересчитывает регрессию по актуальному
 * пулу price_observations для каждой позиции заказа.
 */
export async function recalibrateEstimatorForOrder(
  supabase: SupabaseClient,
  orderId: string,
): Promise<void> {
  const { data: order } = await checkedLearningQuery(
    supabase
      .from('orders')
      .select('request_id, final_cost_kzt, approved_plan_id')
      .eq('id', orderId)
      .maybeSingle(),
    'learning.estimator.order',
  );
  if (
    order?.final_cost_kzt === null ||
    order?.final_cost_kzt === undefined ||
    !order.approved_plan_id
  ) {
    return;
  }

  // Оценка против факта — относительная ошибка этого заказа. Сравнение
  // продукт-к-продукту: p50 покрывает только товар, а final_cost включает
  // доставку и комиссию, поэтому берётся plan.total_supplier_kzt.
  const { data: estimate } = await checkedLearningQuery(
    supabase
      .from('estimates')
      .select('p50_kzt, request_id')
      .eq('request_id', order.request_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    'learning.estimator.estimate',
  );
  if (!estimate?.p50_kzt) return;

  const { data: items } = await checkedLearningQuery(
    supabase.from('request_items').select('category, specs').eq('request_id', order.request_id),
    'learning.estimator.items',
  );
  const categories = (items ?? []).map((item) => itemKeyForEstimator(item.specs, item.category));
  const uniqueCategories = [...new Set(categories)];
  if (uniqueCategories.length === 0) return;

  const { data: snapshot } = await checkedLearningQuery(
    supabase
      .from('model_snapshots')
      .select('params, metrics')
      .eq('model', 'estimator')
      .order('trained_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    'learning.estimator.snapshot_read',
  );

  const previous = snapshot?.metrics as
    | {
        byCategory?: {
          category: string;
          relativeErrors?: number[];
          nSamples?: number;
        }[];
      }
    | undefined;

  const { data: plan } = await checkedLearningQuery(
    supabase
      .from('plans')
      .select('total_supplier_kzt')
      .eq('id', order.approved_plan_id)
      .maybeSingle(),
    'learning.estimator.plan',
  );
  if (!plan?.total_supplier_kzt) return;

  const relativeError = (plan.total_supplier_kzt - estimate.p50_kzt) / estimate.p50_kzt;
  if (!Number.isFinite(relativeError)) return;

  // История хранится по itemKey — это тот же ключ, который использует
  // computeAndInsertEstimate() при чтении price_observations. Ошибка заказа
  // добавляется всем его позициям, как в детерминированном сидере: иначе
  // многопозиционный заказ обучал бы только первую строку.
  const errorHistory = appendEstimatorError(
    previous?.byCategory ?? [],
    uniqueCategories,
    relativeError,
  );
  const observationRows = await Promise.all(
    uniqueCategories.map(async (category) => {
      const { data } = await checkedLearningQuery(
        supabase.from('price_observations').select('qty, unit_price_kzt').eq('item_key', category),
        'learning.estimator.observations',
      );
      return [
        category,
        (data ?? []).map((observation) => ({
          qty: observation.qty,
          unitPriceKzt: observation.unit_price_kzt,
        })),
      ] as const;
    }),
  );
  const observationsByCategory = new Map(observationRows);
  const estimatorSnapshots = recalibrateEstimators(
    uniqueCategories.map((category) => ({
      category,
      observations: observationsByCategory.get(category) ?? [],
      relativeErrors: errorHistory.get(category) ?? [],
    })),
  );
  if (estimatorSnapshots.length === 0) return;

  const byCategory = [
    ...(previous?.byCategory ?? []).filter((entry) => !uniqueCategories.includes(entry.category)),
    ...estimatorSnapshots.map((estimatorSnapshot) => ({
      category: estimatorSnapshot.category,
      mape: Number.isNaN(estimatorSnapshot.mape) ? null : estimatorSnapshot.mape,
      marginPct: estimatorSnapshot.marginPct,
      nSamples: estimatorSnapshot.nSamples,
      relativeErrors: errorHistory.get(estimatorSnapshot.category) ?? [],
    })),
  ];
  const previousParams = snapshot?.params as
    | { byCategory?: { category: string; regression: unknown; marginPct?: number }[] }
    | undefined;
  const paramsByCategory = [
    ...(previousParams?.byCategory ?? []).filter(
      (entry) => !uniqueCategories.includes(entry.category),
    ),
    ...estimatorSnapshots.map((estimatorSnapshot) => ({
      category: estimatorSnapshot.category,
      regression: estimatorSnapshot.regression,
      marginPct: estimatorSnapshot.marginPct,
    })),
  ];
  const nSamples = byCategory.reduce((sum, entry) => sum + (entry.nSamples ?? 0), 0);

  await checkedLearningQuery(
    supabase.from('model_snapshots').insert({
      model: 'estimator',
      params: { byCategory: paramsByCategory },
      metrics: { byCategory },
      trained_at: new Date().toISOString(),
      n_samples: nSamples,
    }),
    'learning.estimator.snapshot_write',
  );
}
