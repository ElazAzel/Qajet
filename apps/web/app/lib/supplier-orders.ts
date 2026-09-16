import { nextStatesFor, type OrderState } from '@qajet/engine/order';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Заказы поставщика — agents.md §10 «Поставщик → активные заказы, статусы,
 * которые он подтверждает сам». Маршрута не существовало, пункт навигации
 * был убран как ведущий на 404.
 *
 * Дашборд `/supplier` показывает активные заказы списком без действий;
 * смысл отдельного экрана — именно подтверждение стадий и вся история
 * заказа, включая закрытые. Личность покупателя поставщику видна (он с
 * ним работает напрямую по доставке), состав чужих строк плана — нет:
 * `plan_lines` закрыты до staff (ADR-0009), поэтому сумма своей части
 * читается из `supplier_payouts`, а не из плана.
 */

export interface SupplierOrderCard {
  id: string;
  title: string;
  buyerCompany: string;
  state: OrderState;
  etaDate: string | null;
  /** Своя выплата по этому заказу, а не сумма плана — чужие строки поставщику не видны. */
  payoutKzt: number | null;
  payoutStatus: string | null;
  /** Стадии, которые поставщик может подтвердить прямо сейчас (обычно 0 или 1). */
  confirmable: OrderState[];
}

export const SUPPLIER_CONFIRM_LABEL: Partial<Record<OrderState, string>> = {
  in_production: 'Взял в производство',
  shipped: 'Отгрузил',
};

export async function loadSupplierOrders(supabase: SupabaseClient): Promise<SupplierOrderCard[]> {
  // RLS (`orders_select_supplier_in_plan`, `supplier_payouts_select_own_supplier`)
  // уже сужает обе выборки до заказов своей компании — отдельного .eq нет.
  const [{ data: orderRows }, { data: payoutRows }] = await Promise.all([
    supabase
      .from('orders')
      .select('id, state, created_at, requests(title, companies(name)), plans(eta_date)')
      .order('created_at', { ascending: false }),
    supabase.from('supplier_payouts').select('order_id, amount_kzt, status'),
  ]);

  const payoutByOrder = new Map(
    (payoutRows ?? []).map((p) => [p.order_id, { amount: p.amount_kzt, status: p.status }]),
  );

  return (orderRows ?? []).map((row) => {
    const request = Array.isArray(row.requests) ? row.requests[0] : row.requests;
    const company = request
      ? Array.isArray(request.companies)
        ? request.companies[0]
        : request.companies
      : null;
    const plan = Array.isArray(row.plans) ? row.plans[0] : row.plans;
    const payout = payoutByOrder.get(row.id);
    const state = row.state as OrderState;
    return {
      id: row.id,
      title: request?.title ?? '—',
      buyerCompany: company?.name ?? '—',
      state,
      etaDate: plan?.eta_date ?? null,
      payoutKzt: payout?.amount ?? null,
      payoutStatus: payout?.status ?? null,
      // Кнопки рисует граф состояний, а не список зашитых в экран условий:
      // разойтись они бы могли молча.
      confirmable: nextStatesFor(state, 'supplier'),
    };
  });
}
