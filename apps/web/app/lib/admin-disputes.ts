import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Журнал споров — agents.md §10 «Админ → Споры». Состояние `disputed`
 * существует в графе с самого начала (packages/engine/src/order/transition.ts),
 * но нигде не собрано отдельным списком — консьерж видит спорный заказ
 * только если сам на него попадёт со своей доски.
 */

export interface DisputeRow {
  orderId: string;
  requestTitle: string;
  buyerCompany: string;
  disputedAt: string | null;
  disputedNote: string | null;
  isResolved: boolean;
}

export async function loadAdminDisputes(supabase: SupabaseClient): Promise<DisputeRow[]> {
  // Источник списка — событие «стал disputed», а не текущее состояние
  // заказа: заказ, для которого спор уже разрешён (accepted/cancelled),
  // обязан остаться в журнале, поэтому фильтровать по списку конечных
  // состояний было бы хрупко — проще идти от факта, что спор был.
  const { data: eventRows } = await supabase
    .from('order_stage_events')
    .select('order_id, at, note, orders(state, requests(title, companies(name)))')
    .eq('to_state', 'disputed')
    .order('at', { ascending: false });

  return (eventRows ?? []).map((row) => {
    const order = Array.isArray(row.orders) ? row.orders[0] : row.orders;
    const request = order
      ? Array.isArray(order.requests)
        ? order.requests[0]
        : order.requests
      : null;
    const company = request
      ? Array.isArray(request.companies)
        ? request.companies[0]
        : request.companies
      : null;
    return {
      orderId: row.order_id,
      requestTitle: request?.title ?? '—',
      buyerCompany: company?.name ?? '—',
      disputedAt: row.at,
      disputedNote: row.note,
      isResolved: order?.state !== 'disputed',
    };
  });
}
