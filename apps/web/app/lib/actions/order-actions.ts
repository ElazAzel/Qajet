'use server';

import type { PlanKind } from '@qajet/engine/combine';
import { transition } from '@qajet/engine/order';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loadRequestComparison } from '../comparison';
import { orderActorFor, requireCurrentUser } from '../current-user';
import type { OrderState } from '../order-state';

/**
 * Единственная точка, откуда состояние заказа реально меняется в БД —
 * agents.md §6: «прямые update state из UI отсутствуют физически». Каждая
 * функция здесь: (1) резолвит актёра из сессии, (2) проверяет переход через
 * packages/engine/order/transition() ДО записи, (3) пишет через
 * RLS-сессию текущего пользователя (не service role — политики в
 * packages/db/src/schema/procurement.ts уже ограничивают, кто и что может
 * тронуть), (4) добавляет строку в order_stage_events. Postgres-триггер
 * enforce_order_transition — второй, независимый барьер на случай прямого
 * обращения мимо этого файла.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

type OrderRow = {
  id: string;
  state: OrderState;
  request_id: string;
  approved_plan_id: string | null;
};

async function loadOrder(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  by: { orderId: string } | { requestId: string },
): Promise<OrderRow | null> {
  const query = supabase.from('orders').select('id, state, request_id, approved_plan_id');
  const { data } =
    'orderId' in by
      ? await query.eq('id', by.orderId).maybeSingle()
      : await query.eq('request_id', by.requestId).maybeSingle();
  return data as OrderRow | null;
}

function addDaysIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

async function logStageEvent(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  orderId: string,
  fromState: OrderState,
  toState: OrderState,
  actorUserId: string,
): Promise<string | null> {
  const { error } = await supabase.from('order_stage_events').insert({
    order_id: orderId,
    from_state: fromState,
    to_state: toState,
    actor_user_id: actorUserId,
  });
  return error?.message ?? null;
}

function revalidateOrder(orderId: string): void {
  revalidatePath(`/concierge/orders/${orderId}`);
  revalidatePath(`/buyer/orders/${orderId}`);
  revalidatePath('/concierge');
  revalidatePath('/buyer');
}

/** Концьерж/админ предлагает план — quotes_received → plan_proposed. */
export async function proposePlan(requestId: string, kind: PlanKind): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  const supabase = await createSupabaseServerClient();

  const order = await loadOrder(supabase, { requestId });
  if (!order) return { ok: false, error: 'Заказ не найден' };

  const check = transition(order.state, 'plan_proposed', actor);
  if (!check.ok) return { ok: false, error: check.reason };

  const comparison = await loadRequestComparison(supabase, requestId);
  const chosen = comparison?.result.plans.find((p) => p.kind === kind);
  if (!comparison || !chosen) return { ok: false, error: 'Этот вариант плана не найден' };

  const { data: versionRow } = await supabase
    .from('plans')
    .select('version')
    .eq('request_id', requestId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (versionRow?.version ?? 0) + 1;

  const { data: newPlan, error: planError } = await supabase
    .from('plans')
    .insert({
      request_id: requestId,
      version: nextVersion,
      kind: chosen.kind,
      total_supplier_kzt: chosen.totalSupplierKzt,
      delivery_kzt: chosen.deliveryKzt,
      commission_kzt: chosen.commissionKzt,
      commission_base: chosen.commissionBase,
      tax_effect_kzt: chosen.taxEffectKzt,
      total_kzt: chosen.totalKzt,
      eta_date: addDaysIso(chosen.etaDays),
      slack_days: chosen.slackDays,
      supplier_count: chosen.supplierCount,
      explanation: chosen.explanation,
      status: 'proposed',
    })
    .select('id')
    .single();
  if (planError || !newPlan)
    return { ok: false, error: planError?.message ?? 'Не удалось создать план' };

  if (order.approved_plan_id) {
    await supabase.from('plans').update({ status: 'superseded' }).eq('id', order.approved_plan_id);
  }

  if (chosen.lines.length > 0) {
    const { error: linesError } = await supabase.from('plan_lines').insert(
      chosen.lines.map((line) => ({
        plan_id: newPlan.id,
        request_item_id: line.requestItemId,
        supplier_company_id: line.supplierId,
        quote_line_id: line.offerId,
        qty: line.qty,
        line_total_kzt: line.lineTotalKzt,
      })),
    );
    if (linesError) return { ok: false, error: linesError.message };
  }

  if (comparison.result.rejections.length > 0) {
    const { error: rejectionsError } = await supabase.from('plan_rejections').insert(
      comparison.result.rejections.map((r) => ({
        request_id: requestId,
        plan_context: 'concierge_propose',
        quote_line_id: r.offerId,
        reason_code: r.code,
        reason_human: r.reasonHuman,
      })),
    );
    if (rejectionsError) return { ok: false, error: rejectionsError.message };
  }

  const { error: orderError } = await supabase
    .from('orders')
    .update({ approved_plan_id: newPlan.id, state: 'plan_proposed' })
    .eq('id', order.id);
  if (orderError) return { ok: false, error: orderError.message };

  const eventError = await logStageEvent(supabase, order.id, order.state, 'plan_proposed', user.id);
  if (eventError) return { ok: false, error: eventError };

  revalidateOrder(order.id);
  return { ok: true };
}

/** Покупатель утверждает предложенный план — plan_proposed/awaiting_internal_approval → plan_approved. */
export async function approvePlan(orderId: string): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  const supabase = await createSupabaseServerClient();

  const order = await loadOrder(supabase, { orderId });
  if (!order) return { ok: false, error: 'Заказ не найден' };
  if (!order.approved_plan_id) return { ok: false, error: 'У заказа нет предложенного плана' };

  const check = transition(order.state, 'plan_approved', actor);
  if (!check.ok) return { ok: false, error: check.reason };

  const { error: planError, count } = await supabase
    .from('plans')
    .update({ status: 'approved' }, { count: 'exact' })
    .eq('id', order.approved_plan_id);
  if (planError) return { ok: false, error: planError.message };
  if (count === 0) return { ok: false, error: 'Нет доступа к этому плану' };

  const { error: orderError } = await supabase
    .from('orders')
    .update({ state: 'plan_approved' })
    .eq('id', order.id);
  if (orderError) return { ok: false, error: orderError.message };

  const eventError = await logStageEvent(supabase, order.id, order.state, 'plan_approved', user.id);
  if (eventError) return { ok: false, error: eventError };

  revalidateOrder(order.id);
  return { ok: true };
}

export interface AdvanceOptions {
  settlement?: 'refund' | 'surcharge' | 'exact';
  /** Сумма из формы сверки, всегда положительная — знак выставляет сам action по типу расчёта. */
  settlementAmountKzt?: number;
}

/**
 * Все остальные рёбра графа: suppliers_paid…delivered (концьерж/админ),
 * accepted/disputed/on_hold/cancelled (покупатель или staff — см. граф).
 */
export async function advanceOrderStage(
  orderId: string,
  toState: OrderState,
  options: AdvanceOptions = {},
): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  const supabase = await createSupabaseServerClient();

  const order = await loadOrder(supabase, { orderId });
  if (!order) return { ok: false, error: 'Заказ не найден' };

  const check = transition(order.state, toState, actor);
  if (!check.ok) return { ok: false, error: check.reason };

  if (toState === 'suppliers_paid') {
    const payoutError = await recordSupplierPayouts(supabase, order);
    if (payoutError) return { ok: false, error: payoutError };
  }

  const payload: Record<string, unknown> = { state: toState };
  if (toState === 'accepted') payload.accepted_at = new Date().toISOString();
  if (toState === 'closed') {
    if (!options.settlement) return { ok: false, error: 'Не указан тип сверки' };
    const { data: plan } = await supabase
      .from('plans')
      .select('total_kzt')
      .eq('id', order.approved_plan_id ?? '')
      .maybeSingle();
    const planTotal = plan?.total_kzt ?? 0;
    const magnitude = Math.round(Math.abs(options.settlementAmountKzt ?? 0));
    const settlementAmountKzt =
      options.settlement === 'refund'
        ? -magnitude
        : options.settlement === 'surcharge'
          ? magnitude
          : 0;
    payload.settlement = options.settlement;
    payload.settlement_amount_kzt = settlementAmountKzt;
    payload.final_cost_kzt = planTotal + settlementAmountKzt;
    payload.closed_at = new Date().toISOString();
  }

  const { error: orderError, count } = await supabase
    .from('orders')
    .update(payload, { count: 'exact' })
    .eq('id', order.id);
  if (orderError) return { ok: false, error: orderError.message };
  if (count === 0) return { ok: false, error: 'Нет доступа к этому заказу' };

  const eventError = await logStageEvent(supabase, order.id, order.state, toState, user.id);
  if (eventError) return { ok: false, error: eventError };

  revalidateOrder(order.id);
  return { ok: true };
}

async function recordSupplierPayouts(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  order: OrderRow,
): Promise<string | null> {
  if (!order.approved_plan_id) return null;
  const { data: lines } = await supabase
    .from('plan_lines')
    .select('supplier_company_id, line_total_kzt')
    .eq('plan_id', order.approved_plan_id);
  if (!lines || lines.length === 0) return null;

  const totalsBySupplier = new Map<string, number>();
  for (const line of lines) {
    totalsBySupplier.set(
      line.supplier_company_id,
      (totalsBySupplier.get(line.supplier_company_id) ?? 0) + line.line_total_kzt,
    );
  }

  const paidAt = new Date().toISOString();
  const { error } = await supabase.from('supplier_payouts').insert(
    [...totalsBySupplier.entries()].map(([supplierCompanyId, amountKzt]) => ({
      order_id: order.id,
      supplier_company_id: supplierCompanyId,
      amount_kzt: amountKzt,
      status: 'paid',
      paid_at: paidAt,
    })),
  );
  return error?.message ?? null;
}
