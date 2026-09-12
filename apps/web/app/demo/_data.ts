import type { SupabaseClient } from '@supabase/supabase-js';
import { loadRequestComparison } from '../lib/comparison';

/**
 * Данные для /demo (agents.md §13 «`/demo` — режим сцены», обязательный
 * пункт §15) — до этой правки маршрута не существовало вообще (не
 * подхвачено ранее ни в одной волне, docs/state/routes.md его не
 * перечислял). Восемь сцен спеки дословно; вместо переизобретения каждого
 * экрана внутри /demo сцена показывает реальные цифры текущего
 * демо-заказа + ссылку «Открыть на сцене →» на настоящий, уже собранный
 * экран (сравнение, план, /metrics) — тот же живой UI, что видит
 * консьерж/покупатель, не копия. Это честнее, чем дублировать вёрстку:
 * число одно и то же, потому что источник один и тот же.
 *
 * Сцены 1/3/4/5/6 — заказ на стадии `quotes_received` (agents.md §13:
 * «1 подготовленный заказ... 6 позиций, 5 КП, 2 с пропущенными полями,
 * 1 с невыполнимым сроком»). Сцены 2/8 — агрегаты по всей демо-истории
 * (та же логика, что /metrics и /admin/learning). Сцена 7 (утверждение,
 * аудит, документы) содержательно требует заказ, УЖЕ прошедший этот шаг —
 * показывает реальный пример по другому, уже закрытому заказу сида,
 * это явно подписано в UI, а не выдаётся за тот же заказ.
 */

export interface DemoScene1 {
  requestId: string;
  requestTitle: string;
  itemsTotal: number;
  itemsNeedingClarification: { name: string; reason: string | null }[];
}

export interface DemoScene2 {
  currentMarginPct: number | null;
  firstMarginPct: number | null;
  nClosedOrders: number;
}

export interface DemoScene3 {
  requestId: string;
  rfqsTotal: number;
  explorationCount: number;
  sampleReasons: { supplierName: string; reason: string; category: string }[];
}

export interface DemoScene4 {
  requestId: string;
  quotesTotal: number;
  quoteLinesWithOpenFlags: number;
  rejectedWithReasons: { supplierName: string; reasonHuman: string }[];
}

export interface DemoScene5and6 {
  requestId: string;
  requestTitle: string;
  plans: { kind: string; totalKzt: number; supplierCount: number; taxEffectKzt: number }[];
  cheaperWithFewerSuppliers: boolean;
}

export interface DemoScene7Example {
  orderId: string;
  requestTitle: string;
  stageEventsCount: number;
  documentsCount: number;
}

export interface DemoScene8 {
  gmvTotalKzt: number;
  closedOrdersCount: number;
  avgHoursPerOrder: number | null;
}

export interface DemoData {
  demoOrderId: string | null;
  demoRequestId: string | null;
  scene1: DemoScene1 | null;
  scene2: DemoScene2 | null;
  scene3: DemoScene3 | null;
  scene4: DemoScene4 | null;
  scene5and6: DemoScene5and6 | null;
  scene7: DemoScene7Example | null;
  scene8: DemoScene8;
}

export async function loadDemoData(supabase: SupabaseClient): Promise<DemoData> {
  const { data: demoOrder } = await supabase
    .from('orders')
    .select('id, request_id')
    .eq('state', 'quotes_received')
    .limit(1)
    .maybeSingle();

  let scene1: DemoScene1 | null = null;
  let scene3: DemoScene3 | null = null;
  let scene4: DemoScene4 | null = null;
  let scene5and6: DemoScene5and6 | null = null;

  if (demoOrder) {
    const requestId = demoOrder.request_id;

    const { data: request } = await supabase
      .from('requests')
      .select('title')
      .eq('id', requestId)
      .maybeSingle();
    const { data: items } = await supabase
      .from('request_items')
      .select('name, needs_clarification, clarification_reason')
      .eq('request_id', requestId);
    scene1 = {
      requestId,
      requestTitle: request?.title ?? '—',
      itemsTotal: items?.length ?? 0,
      itemsNeedingClarification: (items ?? [])
        .filter((i) => i.needs_clarification)
        .map((i) => ({ name: i.name, reason: i.clarification_reason })),
    };

    const { data: rfqs } = await supabase
      .from('rfqs')
      .select('supplier_company_id, is_exploration, selection_reason')
      .eq('request_id', requestId);
    const supplierIds = [...new Set((rfqs ?? []).map((r) => r.supplier_company_id))];
    const { data: suppliers } = supplierIds.length
      ? await supabase.from('companies').select('id, name').in('id', supplierIds)
      : { data: [] };
    const supplierNameById = new Map((suppliers ?? []).map((s) => [s.id, s.name]));
    scene3 = {
      requestId,
      rfqsTotal: rfqs?.length ?? 0,
      explorationCount: (rfqs ?? []).filter((r) => r.is_exploration).length,
      sampleReasons: (rfqs ?? []).slice(0, 3).map((r) => {
        const reason = r.selection_reason as { reason?: string; category?: string } | null;
        return {
          supplierName: supplierNameById.get(r.supplier_company_id) ?? '—',
          reason: reason?.reason ?? 'scored',
          category: reason?.category ?? '—',
        };
      }),
    };

    const { data: rfqRows2 } = await supabase.from('rfqs').select('id').eq('request_id', requestId);
    const rfqIds = (rfqRows2 ?? []).map((r) => r.id);
    const { data: quotes } = rfqIds.length
      ? await supabase.from('quotes').select('id').in('rfq_id', rfqIds)
      : { data: [] };
    const quoteIds = (quotes ?? []).map((q) => q.id);
    const { data: quoteLines } = quoteIds.length
      ? await supabase.from('quote_lines').select('field_flags').in('quote_id', quoteIds)
      : { data: [] };
    const { data: rejections } = await supabase
      .from('plan_rejections')
      .select('reason_human, quote_line_id')
      .eq('request_id', requestId);
    scene4 = {
      requestId,
      quotesTotal: quotes?.length ?? 0,
      quoteLinesWithOpenFlags: (quoteLines ?? []).filter(
        (l) => Object.keys((l.field_flags as Record<string, unknown>) ?? {}).length > 0,
      ).length,
      rejectedWithReasons: (rejections ?? []).slice(0, 2).map((r) => ({
        supplierName: '—',
        reasonHuman: r.reason_human,
      })),
    };

    const comparison = await loadRequestComparison(supabase, requestId);
    if (comparison) {
      const plans = comparison.result.plans.map((p) => ({
        kind: p.kind,
        totalKzt: p.totalKzt,
        supplierCount: p.supplierCount,
        taxEffectKzt: p.taxEffectKzt,
      }));
      const cheapest = [...plans].sort((a, b) => a.totalKzt - b.totalKzt)[0];
      scene5and6 = {
        requestId,
        requestTitle: comparison.requestTitle,
        plans,
        cheaperWithFewerSuppliers:
          plans.length > 1 && cheapest !== undefined
            ? plans.some((p) => p.supplierCount > cheapest.supplierCount)
            : false,
      };
    }
  }

  const { data: estimatorSnapshots } = await supabase
    .from('model_snapshots')
    .select('metrics, trained_at')
    .eq('model', 'estimator')
    .order('trained_at', { ascending: true });
  const marginOf = (row: { metrics: unknown } | undefined): number | null => {
    const byCategory = (row?.metrics as { byCategory?: { marginPct: number }[] } | undefined)
      ?.byCategory;
    if (!byCategory || byCategory.length === 0) return null;
    return Math.max(...byCategory.map((c) => c.marginPct)) * 100;
  };
  const { count: closedOrdersCountForScene2 } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('state', 'closed');
  const scene2: DemoScene2 = {
    currentMarginPct: marginOf(estimatorSnapshots?.at(-1)),
    firstMarginPct: marginOf(estimatorSnapshots?.[0]),
    nClosedOrders: closedOrdersCountForScene2 ?? 0,
  };

  const { data: exampleClosedOrder } = await supabase
    .from('orders')
    .select('id, request_id')
    .eq('state', 'closed')
    .limit(1)
    .maybeSingle();
  let scene7: DemoScene7Example | null = null;
  if (exampleClosedOrder) {
    const { data: request } = await supabase
      .from('requests')
      .select('title')
      .eq('id', exampleClosedOrder.request_id)
      .maybeSingle();
    const { count: stageEventsCount } = await supabase
      .from('order_stage_events')
      .select('*', { count: 'exact', head: true })
      .eq('order_id', exampleClosedOrder.id);
    const { count: documentsCount } = await supabase
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('order_id', exampleClosedOrder.id);
    scene7 = {
      orderId: exampleClosedOrder.id,
      requestTitle: request?.title ?? '—',
      stageEventsCount: stageEventsCount ?? 0,
      documentsCount: documentsCount ?? 0,
    };
  }

  const { data: closedOrders } = await supabase
    .from('orders')
    .select('final_cost_kzt')
    .eq('state', 'closed');
  const gmvTotalKzt = (closedOrders ?? []).reduce((s, o) => s + (o.final_cost_kzt ?? 0), 0);
  const { data: timeEntryRows } = await supabase.from('time_entries').select('order_id, seconds');
  const secondsByOrder = new Map<string, number>();
  for (const row of timeEntryRows ?? []) {
    secondsByOrder.set(row.order_id, (secondsByOrder.get(row.order_id) ?? 0) + row.seconds);
  }
  const avgHoursPerOrder =
    secondsByOrder.size > 0
      ? [...secondsByOrder.values()].reduce((s, v) => s + v, 0) / secondsByOrder.size / 3600
      : null;

  return {
    demoOrderId: demoOrder?.id ?? null,
    demoRequestId: demoOrder?.request_id ?? null,
    scene1,
    scene2,
    scene3,
    scene4,
    scene5and6,
    scene7,
    scene8: {
      gmvTotalKzt,
      closedOrdersCount: closedOrders?.length ?? 0,
      avgHoursPerOrder,
    },
  };
}
