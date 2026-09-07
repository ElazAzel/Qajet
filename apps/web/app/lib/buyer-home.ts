import type { SupabaseClient } from '@supabase/supabase-js';
import { ORDER_STATE_PRIORITY, type OrderState } from './order-state';

/**
 * Данные для главной покупателя — реальные заказы его компании, а не
 * заглушка ScreenLedger. RLS (`requests_select_own_company`) сам ограничивает
 * выборку компанией текущего пользователя — здесь нет отдельного .eq на
 * company_id, фильтрация уже произошла на уровне Postgres.
 */

export interface BuyerOrderRow {
  id: string;
  state: OrderState;
  title: string;
}

export interface BuyerUpdateRow {
  orderId: string;
  orderTitle: string;
  toState: OrderState;
  at: string;
}

export interface BuyerHomeData {
  orders: BuyerOrderRow[];
  updates: BuyerUpdateRow[];
  stats: {
    active: number;
    inProduction: number;
    awaitingDecision: number;
  };
}

const IN_PRODUCTION_STATES: OrderState[] = ['in_production', 'shipped'];
const AWAITING_DECISION_STATES: OrderState[] = ['plan_proposed', 'awaiting_internal_approval'];

export async function loadBuyerHome(supabase: SupabaseClient): Promise<BuyerHomeData> {
  const { data: orderRows } = await supabase.from('orders').select('id, state, requests(title)');

  const orders: BuyerOrderRow[] = (orderRows ?? []).map((row) => {
    const request = Array.isArray(row.requests) ? row.requests[0] : row.requests;
    return { id: row.id, state: row.state as OrderState, title: request?.title ?? '—' };
  });
  orders.sort((a, b) => ORDER_STATE_PRIORITY[a.state] - ORDER_STATE_PRIORITY[b.state]);

  const orderIds = orders.map((o) => o.id);
  const titleByOrderId = new Map(orders.map((o) => [o.id, o.title]));

  const { data: eventRows } = orderIds.length
    ? await supabase
        .from('order_stage_events')
        .select('order_id, to_state, at')
        .in('order_id', orderIds)
        .order('at', { ascending: false })
        .limit(5)
    : { data: [] };

  const updates: BuyerUpdateRow[] = (eventRows ?? []).map((row) => ({
    orderId: row.order_id,
    orderTitle: titleByOrderId.get(row.order_id) ?? '—',
    toState: row.to_state as OrderState,
    at: row.at,
  }));

  const active = orders.filter((o) => o.state !== 'closed' && o.state !== 'cancelled').length;
  const inProduction = orders.filter((o) => IN_PRODUCTION_STATES.includes(o.state)).length;
  const awaitingDecision = orders.filter((o) => AWAITING_DECISION_STATES.includes(o.state)).length;

  return { orders, updates, stats: { active, inProduction, awaitingDecision } };
}
