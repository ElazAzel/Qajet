import type { SupabaseClient } from '@supabase/supabase-js';
import { ORDER_STATE_LABEL, type OrderState } from './order-state';

/**
 * Карточка заказа для покупателя — таймлайн стадий + сохранённый
 * (не пересчитанный на лету) утверждённый/предложенный план. В отличие от
 * apps/web/app/lib/comparison.ts, который живьём гоняет combine() для
 * консьержа на стадии quotes_received, здесь план уже существует в БД
 * (записан proposePlan()) — покупатель видит замороженный вариант, а не
 * то, что получилось бы, если пересчитать сейчас.
 *
 * Осознанно НЕ грузим `total_supplier_kzt`/`commission_kzt`/`explanation`
 * (decomposition) из `plans` — задача «комиссия платформы»: покупатель
 * видит только итоговую цену исполнения заказа, без разбивки поставщик/
 * комиссия. `delivery_kzt` оставлен отдельной строкой — это логистика, не
 * структура наценки. Честная оговорка: `plans_select_via_request`
 * по-прежнему пускает покупательскую сессию читать ВСЮ строку `plans`
 * напрямую через PostgREST (RLS не умеет колоночно), так что
 * `commission_kzt`/`total_supplier_kzt` в самой БД остаются technically
 * достижимы в обход этого файла при прямом запросе — тот же класс
 * остаточного риска, что уже документирован в ADR-0009 (RFQ/plan_lines
 * UUID). Настоящая колоночная защита потребовала бы отдельного view, вне
 * объёма этой задачи. Запись цены отдельно закрыта — см. approve_plan()
 * RPC, packages/db/migrations/0013.
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
  deliveryKzt: number;
  totalKzt: number;
  etaDate: string | null;
  slackDays: number | null;
  supplierCount: number;
}

/**
 * Журнал отбраковки — §15 (обязательный пункт: «отбракованное предложение
 * попадает в журнал с человеческой причиной и видно покупателю») и §16.2
 * («отказ с причиной — доказательство работы, а не служебный лог»). Раньше
 * `plan_rejections` читал только экран консьержа, хотя RLS
 * `plan_rejections_select_via_request` пускает покупателя к своим строкам
 * с самого начала.
 *
 * Причины сгруппированы по коду и показаны с количеством: покупателю важно
 * «сколько предложений и почему не прошли», а не построчный список, из
 * которого можно было бы восстановить число и состав участников тендера.
 * Личность исполнителя тексты причин не содержат (ADR-0009) — спека прямо
 * требует причины «по существу (срок, партия, требования), не „поставщик X
 * отказал"».
 */
export interface RejectionSummary {
  reasonCode: string;
  reasonHuman: string;
  count: number;
}

export interface BuyerRatingTarget {
  supplierCompanyId: string;
  rated: boolean;
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
  rejections: RejectionSummary[];
  ratingTargets: BuyerRatingTarget[];
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

  const { data: ratingTargetRows } =
    order.state === 'closed'
      ? await supabase.rpc('get_buyer_rating_targets', { p_order_id: orderId })
      : { data: [] };
  const ratingTargets: BuyerRatingTarget[] = (
    (ratingTargetRows ?? []) as Array<{ supplier_company_id: string; rated: boolean }>
  ).map((row) => ({
    supplierCompanyId: row.supplier_company_id,
    rated: row.rated,
  }));

  let plan: BuyerOrderPlan | null = null;
  if (order.approved_plan_id) {
    const { data: planRow } = await supabase
      .from('plans')
      .select('kind, status, delivery_kzt, total_kzt, eta_date, slack_days, supplier_count')
      .eq('id', order.approved_plan_id)
      .maybeSingle();
    if (planRow) {
      plan = {
        kind: planRow.kind,
        status: planRow.status,
        deliveryKzt: planRow.delivery_kzt,
        totalKzt: planRow.total_kzt,
        etaDate: planRow.eta_date,
        slackDays: planRow.slack_days,
        supplierCount: planRow.supplier_count,
      };
    }
  }

  const { data: rejectionRows } = await supabase
    .from('plan_rejections')
    .select('reason_code, reason_human')
    .eq('request_id', order.request_id);

  const rejectionByCode = new Map<string, RejectionSummary>();
  for (const row of rejectionRows ?? []) {
    const existing = rejectionByCode.get(row.reason_code);
    if (existing) existing.count += 1;
    else
      rejectionByCode.set(row.reason_code, {
        reasonCode: row.reason_code,
        reasonHuman: row.reason_human,
        count: 1,
      });
  }
  const rejections = [...rejectionByCode.values()].sort((a, b) => b.count - a.count);

  const { data: eventRows } = await supabase
    .from('order_stage_events')
    .select('to_state, at, users(full_name, role, companies(type))')
    .eq('order_id', orderId)
    .order('at', { ascending: true });

  const events: StageEvent[] = (eventRows ?? []).map((row) => {
    const actor = Array.isArray(row.users) ? row.users[0] : row.users;
    const actorCompany = actor
      ? Array.isArray(actor.companies)
        ? actor.companies[0]
        : actor.companies
      : null;
    return {
      toState: row.to_state as OrderState,
      toStateLabel: ORDER_STATE_LABEL[row.to_state as OrderState],
      at: row.at,
      // Покупателю нельзя раскрывать персональную личность поставщика —
      // снаружи он видит исполнителя как компанию.
      actorName:
        actor?.role &&
        ['owner', 'manager'].includes(actor.role) &&
        actorCompany?.type === 'supplier'
          ? 'Поставщик'
          : (actor?.full_name ?? null),
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
    rejections,
    ratingTargets,
  };
}
