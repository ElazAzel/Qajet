import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Обработка исключений — agents.md §10 «Консьерж → Исключения». Состояния
 * `on_hold`/`disputed` существуют в графе с самого начала, но заказ в
 * одном из них виден только на общей доске вперемешку со штатным потоком
 * — здесь тот же список, отфильтрованный и приоритизированный по тому,
 * что требует решения прямо сейчас.
 */

export interface ExceptionRow {
  orderId: string;
  requestTitle: string;
  buyerCompany: string;
  state: 'on_hold' | 'disputed';
  since: string | null;
  note: string | null;
}

export async function loadConciergeExceptions(supabase: SupabaseClient): Promise<ExceptionRow[]> {
  const { data: orderRows } = await supabase
    .from('orders')
    .select('id, state, updated_at, requests(title, companies(name))')
    .in('state', ['on_hold', 'disputed'])
    .order('updated_at', { ascending: true });

  if (!orderRows || orderRows.length === 0) return [];

  const orderIds = orderRows.map((r) => r.id);
  const { data: eventRows } = await supabase
    .from('order_stage_events')
    .select('order_id, to_state, at, note')
    .in('order_id', orderIds)
    .in('to_state', ['on_hold', 'disputed'])
    .order('at', { ascending: false });

  // Последнее событие «стал on_hold/disputed» по заказу — момент входа в
  // исключение, а не updated_at заказа (тот двигается и от других правок).
  const latestEventByOrder = new Map<string, { at: string; note: string | null }>();
  for (const event of eventRows ?? []) {
    if (!latestEventByOrder.has(event.order_id)) {
      latestEventByOrder.set(event.order_id, { at: event.at, note: event.note });
    }
  }

  return orderRows.map((row) => {
    const request = Array.isArray(row.requests) ? row.requests[0] : row.requests;
    const company = request
      ? Array.isArray(request.companies)
        ? request.companies[0]
        : request.companies
      : null;
    const event = latestEventByOrder.get(row.id);
    return {
      orderId: row.id,
      requestTitle: request?.title ?? '—',
      buyerCompany: company?.name ?? '—',
      state: row.state as 'on_hold' | 'disputed',
      since: event?.at ?? row.updated_at,
      note: event?.note ?? null,
    };
  });
}
