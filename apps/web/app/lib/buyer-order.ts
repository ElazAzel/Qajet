import type { Explanation, ExplanationLine } from '@qajet/engine/explain';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ORDER_STATE_LABEL, type OrderState } from './order-state';

/**
 * Карточка заказа для покупателя — таймлайн стадий + сохранённый
 * (не пересчитанный на лету) утверждённый/предложенный план. В отличие от
 * apps/web/app/lib/comparison.ts, который живьём гоняет combine() для
 * консьержа на стадии quotes_received, здесь план уже существует в БД
 * (записан proposePlan()) — покупатель видит замороженный вариант, а не
 * то, что получилось бы, если пересчитать сейчас.
 */

export interface StageEvent {
  toState: OrderState;
  toStateLabel: string;
  at: string;
  actorName: string | null;
}

export interface BuyerOrderPlan {
  kind: string;
  status: string;
  totalSupplierKzt: number;
  deliveryKzt: number;
  commissionKzt: number;
  taxEffectKzt: number;
  totalKzt: number;
  etaDate: string | null;
  slackDays: number | null;
  supplierCount: number;
  decomposition: ExplanationLine[];
}

export interface BuyerOrderDetail {
  id: string;
  requestId: string;
  requestTitle: string;
  state: OrderState;
  acceptedAt: string | null;
  closedAt: string | null;
  finalCostKzt: number | null;
  settlement: 'refund' | 'surcharge' | 'exact' | null;
  settlementAmountKzt: number | null;
  plan: BuyerOrderPlan | null;
  events: StageEvent[];
}

export async function loadBuyerOrder(
  supabase: SupabaseClient,
  orderId: string,
): Promise<BuyerOrderDetail | null> {
  const { data: order } = await supabase
    .from('orders')
    .select(
      'id, request_id, state, approved_plan_id, accepted_at, closed_at, final_cost_kzt, settlement, settlement_amount_kzt, requests(title)',
    )
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return null;

  const request = Array.isArray(order.requests) ? order.requests[0] : order.requests;

  let plan: BuyerOrderPlan | null = null;
  if (order.approved_plan_id) {
    const { data: planRow } = await supabase
      .from('plans')
      .select(
        'kind, status, total_supplier_kzt, delivery_kzt, commission_kzt, tax_effect_kzt, total_kzt, eta_date, slack_days, supplier_count, explanation',
      )
      .eq('id', order.approved_plan_id)
      .maybeSingle();
    if (planRow) {
      const explanation = planRow.explanation as Explanation | null;
      plan = {
        kind: planRow.kind,
        status: planRow.status,
        totalSupplierKzt: planRow.total_supplier_kzt,
        deliveryKzt: planRow.delivery_kzt,
        commissionKzt: planRow.commission_kzt,
        taxEffectKzt: planRow.tax_effect_kzt,
        totalKzt: planRow.total_kzt,
        etaDate: planRow.eta_date,
        slackDays: planRow.slack_days,
        supplierCount: planRow.supplier_count,
        decomposition: explanation?.decomposition ?? [],
      };
    }
  }

  const { data: eventRows } = await supabase
    .from('order_stage_events')
    .select('to_state, at, users(full_name)')
    .eq('order_id', orderId)
    .order('at', { ascending: true });

  const events: StageEvent[] = (eventRows ?? []).map((row) => {
    const actor = Array.isArray(row.users) ? row.users[0] : row.users;
    return {
      toState: row.to_state as OrderState,
      toStateLabel: ORDER_STATE_LABEL[row.to_state as OrderState],
      at: row.at,
      actorName: actor?.full_name ?? null,
    };
  });

  return {
    id: order.id,
    requestId: order.request_id,
    requestTitle: request?.title ?? '—',
    state: order.state as OrderState,
    acceptedAt: order.accepted_at,
    closedAt: order.closed_at,
    finalCostKzt: order.final_cost_kzt,
    settlement: order.settlement,
    settlementAmountKzt: order.settlement_amount_kzt,
    plan,
    events,
  };
}
