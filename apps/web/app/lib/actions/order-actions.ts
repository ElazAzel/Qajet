'use server';

import type { PlanKind } from '@qajet/engine/combine';
import { estimate as engineEstimate } from '@qajet/engine/estimate';
import { roundKzt } from '@qajet/engine/money';
import { transition } from '@qajet/engine/order';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { CATALOG_BY_KEY } from '../catalog';
import { loadRequestComparison } from '../comparison';
import { orderActorFor, requireCurrentUser } from '../current-user';
import type { OrderState } from '../order-state';

/** Ставка за единицу для позиций вне справочника каталога (не должно случаться
 *  для заявок, созданных через createRequest, — только защита от старых данных). */
const FALLBACK_BASE_RATE_KZT = 5000;
const RFQ_RESPOND_WINDOW_DAYS = 5;

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

/**
 * Концьерж берёт поданную заявку в работу — создаёт плейсхолдер-план и
 * orders(state='draft'), тем же приёмом, что и packages/db/src/seed/
 * generator.ts (approved_plan_id NOT NULL с самого начала, реальный план
 * появится только после КП). До этого действия заявка существует сама по
 * себе (requests/request_items) и не видна ни на одной доске заказов.
 */
export async function intakeRequest(
  requestId: string,
): Promise<ActionResult & { orderId?: string }> {
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  if (actor !== 'concierge' && actor !== 'admin') {
    return { ok: false, error: 'Только концьерж может взять заявку в работу' };
  }

  const supabase = await createSupabaseServerClient();

  const { data: existing } = await supabase
    .from('orders')
    .select('id')
    .eq('request_id', requestId)
    .maybeSingle();
  if (existing) return { ok: false, error: 'Заявка уже взята в работу' };

  const { data: placeholderPlan, error: planError } = await supabase
    .from('plans')
    .insert({
      request_id: requestId,
      version: 1,
      kind: 'manual',
      total_supplier_kzt: 0,
      delivery_kzt: 0,
      commission_kzt: 0,
      commission_base: 'supplier_ex_delivery',
      tax_effect_kzt: 0,
      total_kzt: 0,
      supplier_count: 0,
      explanation: {
        decomposition: [],
        notes: ['Черновик — реальный план появится после получения КП.'],
      },
      status: 'draft',
    })
    .select('id')
    .single();
  if (planError || !placeholderPlan) {
    return { ok: false, error: planError?.message ?? 'Не удалось создать план' };
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      request_id: requestId,
      approved_plan_id: placeholderPlan.id,
      state: 'draft',
      concierge_user_id: user.id,
    })
    .select('id')
    .single();
  if (orderError || !order) {
    return { ok: false, error: orderError?.message ?? 'Не удалось создать заказ' };
  }

  revalidatePath('/concierge');
  revalidatePath('/buyer');
  return { ok: true, orderId: order.id };
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

  if (toState === 'estimated') {
    const estimateError = await computeAndInsertEstimate(supabase, order);
    if (estimateError) return { ok: false, error: estimateError };
    await supabase.from('requests').update({ status: 'estimated' }).eq('id', order.request_id);
  }
  if (toState === 'prepaid') {
    const prepaymentError = await insertPrepayment(supabase, order);
    if (prepaymentError) return { ok: false, error: prepaymentError };
  }
  if (toState === 'rfq_sent') {
    const rfqError = await createRfqsForOrder(supabase, order);
    if (rfqError) return { ok: false, error: rfqError };
  }
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

/**
 * agents.md §8B — реальный engine.estimate() по накопленным
 * price_observations (ключ item_key, та же группировка, что в
 * packages/db/src/seed/generator.ts), не подрисованная сумма. baseRateKzt —
 * из справочника каталога по itemKey, сохранённому в request_items.specs
 * при createRequest(); пусто/не найдено — честный плоский фолбэк, не сбой.
 * Суммирование по позициям и marginPct = max по позициям — дословно тот же
 * метод агрегации, что в generator.ts, для сопоставимости с демо-историей.
 */
async function computeAndInsertEstimate(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  order: OrderRow,
): Promise<string | null> {
  const { data: items } = await supabase
    .from('request_items')
    .select('qty, specs')
    .eq('request_id', order.request_id);
  if (!items || items.length === 0) return 'В заявке нет позиций';

  let totalP50 = 0;
  let totalP80 = 0;
  let maxMargin = 0;
  let nSamplesTotal = 0;

  for (const item of items) {
    const itemKey = (item.specs as { itemKey?: string } | null)?.itemKey;
    const catalogItem = itemKey ? CATALOG_BY_KEY.get(itemKey) : undefined;
    const baseRateKzt = catalogItem?.baseUnitPriceKzt ?? FALLBACK_BASE_RATE_KZT;

    const { data: observations } = itemKey
      ? await supabase
          .from('price_observations')
          .select('qty, unit_price_kzt')
          .eq('item_key', itemKey)
      : { data: null };
    const obs = (observations ?? []).map((o) => ({ qty: o.qty, unitPriceKzt: o.unit_price_kzt }));
    nSamplesTotal += obs.length;

    const est = engineEstimate({ qty: item.qty, observations: obs, baseRateKzt });
    totalP50 += est.p50Kzt;
    totalP80 += est.p80Kzt;
    maxMargin = Math.max(maxMargin, est.marginPct);
  }

  const { error } = await supabase.from('estimates').insert({
    request_id: order.request_id,
    p50_kzt: roundKzt(totalP50),
    p80_kzt: roundKzt(totalP80),
    margin_pct: maxMargin,
    basis: { nSamples: nSamplesTotal, method: 'engine.estimate log-log + Bayesian shrinkage' },
  });
  return error?.message ?? null;
}

/** Предоплата — 50% от p50, без эквайринга (agents.md §17): факт фиксируется
 *  вручную, счёт/подтверждение — не платёжный шлюз. */
async function insertPrepayment(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  order: OrderRow,
): Promise<string | null> {
  const { data: estimateRow } = await supabase
    .from('estimates')
    .select('p50_kzt')
    .eq('request_id', order.request_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const p50 = estimateRow?.p50_kzt ?? 0;

  const { error } = await supabase.from('prepayments').insert({
    request_id: order.request_id,
    amount_kzt: roundKzt(p50 * 0.5),
    invoice_no: `PRE-${order.id.slice(0, 8)}`,
    status: 'paid',
    paid_at: new Date().toISOString(),
  });
  return error?.message ?? null;
}

interface SupplierCandidateRow {
  id: string;
  categories: string[];
  capabilities: string[];
}

function supplierCoversItem(
  supplier: SupplierCandidateRow,
  item: { category: string; required_capabilities: string[] | null },
): boolean {
  return (
    supplier.categories.includes(item.category) &&
    (item.required_capabilities ?? []).every((cap) => supplier.capabilities.includes(cap))
  );
}

/**
 * Подбор поставщиков под RFQ — та же простая модель, что в
 * packages/db/src/seed/generator.ts (совпадение по category+
 * requiredCapabilities с гарантией покрытия каждой позиции хотя бы одним
 * поставщиком), а не online-скоринг/Thompson sampling из
 * packages/engine/match — то обучается на историю кликов, которой для
 * новой живой заявки просто ещё нет. Честно: слот исследования тоже не
 * заводится здесь.
 */
async function createRfqsForOrder(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  order: OrderRow,
): Promise<string | null> {
  const { data: items } = await supabase
    .from('request_items')
    .select('category, required_capabilities')
    .eq('request_id', order.request_id);
  if (!items || items.length === 0) return 'В заявке нет позиций';

  const { data: supplierRows } = await supabase
    .from('companies')
    .select('id, supplier_profiles(categories, capabilities)')
    .eq('type', 'supplier')
    .eq('is_active', true);

  const candidates: SupplierCandidateRow[] = (supplierRows ?? [])
    .map((row) => {
      const profile = Array.isArray(row.supplier_profiles)
        ? row.supplier_profiles[0]
        : row.supplier_profiles;
      return {
        id: row.id,
        categories: (profile?.categories ?? []) as string[],
        capabilities: (profile?.capabilities ?? []) as string[],
      };
    })
    .filter((s) => s.categories.length > 0);

  const chosen = candidates.filter((s) => items.some((item) => supplierCoversItem(s, item)));
  for (const item of items) {
    if (chosen.some((s) => supplierCoversItem(s, item))) continue;
    const backup = candidates.find((s) => supplierCoversItem(s, item) && !chosen.includes(s));
    if (backup) chosen.push(backup);
  }
  if (chosen.length === 0) {
    return 'Не нашлось ни одного поставщика по категории и техпроцессам этой заявки';
  }

  const sentAt = new Date();
  const respondBy = new Date(sentAt);
  respondBy.setUTCDate(respondBy.getUTCDate() + RFQ_RESPOND_WINDOW_DAYS);

  const { error } = await supabase.from('rfqs').insert(
    chosen.map((s) => ({
      request_id: order.request_id,
      supplier_company_id: s.id,
      token: crypto.randomUUID(),
      sent_at: sentAt.toISOString(),
      respond_by: respondBy.toISOString(),
      status: 'sent',
      selection_reason: { reason: 'category_and_capability_match' },
    })),
  );
  return error?.message ?? null;
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
