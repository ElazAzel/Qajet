'use server';

import type { PlanKind } from '@qajet/engine/combine';
import { checkRequestCompleteness } from '@qajet/engine/completeness';
import { estimate as engineEstimate } from '@qajet/engine/estimate';
import {
  DEFAULT_WEIGHTS,
  isExplorationSlot,
  type MatchWeights,
  passesHardFilters,
  pickExplorationCandidate,
  type ScoringFeatures,
  scoreSupplier,
} from '@qajet/engine/match';
import { percentOfKzt, roundKzt } from '@qajet/engine/money';
import { transition } from '@qajet/engine/order';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logAutoTimeEntry } from '../autotimer';
import { CATALOG_BY_KEY } from '../catalog';
import { loadRequestComparison } from '../comparison';
import { type OrderActor, orderActorFor, requireCurrentUser } from '../current-user';
import { createActDocument, createPrepayInvoiceDocument } from '../documents';
import type { OrderState } from '../order-state';
import { recalibrateLeadTimeForSupplier, recalibrateMatcherForOrder } from '../recalibration';

/** Ставка за единицу для позиций вне справочника каталога (не должно случаться
 *  для заявок, созданных через createRequest, — только защита от старых данных). */
const FALLBACK_BASE_RATE_KZT = 5000;
const RFQ_RESPOND_WINDOW_DAYS = 5;
/** Сколько поставщиков на позицию рассылаются по умолчанию, если в settings нет rfq_batch_size_per_item. */
const FALLBACK_RFQ_BATCH_SIZE = 5;
/** «Один слот исследования из каждых N» (agents.md §8C) по умолчанию, если в settings нет rfq_exploration_every_n. */
const FALLBACK_RFQ_EXPLORATION_EVERY_N = 4;

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

export type OrderRow = {
  id: string;
  state: OrderState;
  request_id: string;
  approved_plan_id: string | null;
};

export async function loadOrder(
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
  actor: OrderActor,
  note?: string,
): Promise<string | null> {
  // Автотаймер (agents.md §9, autotimer.ts) — читает предыдущий
  // order_stage_events ДО вставки нового, иначе нашёл бы сам себя.
  // Best-effort: ошибка не должна валить сам переход стадии.
  await logAutoTimeEntry(supabase, orderId, fromState, actor, actorUserId).catch(() => undefined);

  const { error } = await supabase.from('order_stage_events').insert({
    order_id: orderId,
    from_state: fromState,
    to_state: toState,
    actor_user_id: actorUserId,
    ...(note ? { note } : {}),
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
        // По умолчанию — та же плоская ставка, что уже использовалась при
        // подборе вариантов (comparison.commissionRatePct); консьерж правит
        // точечно по позиции на экране плана, 21-24% (agents.md §7).
        commission_pct: comparison.commissionRatePct,
        commission_kzt: percentOfKzt(line.lineTotalKzt, comparison.commissionRatePct),
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

  const eventError = await logStageEvent(
    supabase,
    order.id,
    order.state,
    'plan_proposed',
    user.id,
    actor,
  );
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

  // RPC вместо прямого update — plans_update_buyer_own снята (была без
  // ограничения по колонкам, покупатель мог бы переписать commission_kzt/
  // total_kzt в своём же плане). approve_plan() сама проверяет владение
  // заказом и меняет только status.
  const { error: planError } = await supabase.rpc('approve_plan', { p_order_id: order.id });
  if (planError) return { ok: false, error: 'Нет доступа к этому плану' };

  // Audit log §11.3: «кто → когда → какую версию плана → подтвердил».
  // Кто и когда пишет сам order_stage_events (actor_user_id, at); версия
  // плана — единственное, чего в событии не было, а без неё запись не
  // отвечает на вопрос, ЧТО именно утвердили: план живёт версиями, и
  // «утвердил план заказа» без номера версии не восстанавливает решение.
  const { data: approvedPlan } = await supabase
    .from('plans')
    .select('version')
    .eq('id', order.approved_plan_id)
    .maybeSingle();
  const auditNote = `Утверждена версия плана ${approvedPlan?.version ?? '?'} (${order.approved_plan_id})`;

  const { error: orderError } = await supabase
    .from('orders')
    .update({ state: 'plan_approved' })
    .eq('id', order.id);
  if (orderError) return { ok: false, error: orderError.message };

  const eventError = await logStageEvent(
    supabase,
    order.id,
    order.state,
    'plan_approved',
    user.id,
    actor,
    auditNote,
  );
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
    const completenessError = await checkCompletenessBeforeRfq(supabase, order);
    if (completenessError) return { ok: false, error: completenessError };
    const rfqError = await createRfqsForOrder(supabase, order);
    if (rfqError) return { ok: false, error: rfqError };
  }
  if (toState === 'suppliers_paid') {
    const payoutError = await recordSupplierPayouts(supabase, order);
    if (payoutError) return { ok: false, error: payoutError };
  }

  const payload: Record<string, unknown> = { state: toState };
  if (toState === 'accepted') payload.accepted_at = new Date().toISOString();
  // Захвачено вне if-блока — нужно и для payload, и для Document Engine
  // (акт выполненных работ) после успешного update() ниже.
  let closedSettlement: {
    settlement: 'refund' | 'surcharge' | 'exact';
    settlementAmountKzt: number;
    planTotalKzt: number;
    finalCostKzt: number;
  } | null = null;
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
    closedSettlement = {
      settlement: options.settlement,
      settlementAmountKzt,
      planTotalKzt: planTotal,
      finalCostKzt: planTotal + settlementAmountKzt,
    };
  }

  const { error: orderError, count } = await supabase
    .from('orders')
    .update(payload, { count: 'exact' })
    .eq('id', order.id);
  if (orderError) return { ok: false, error: orderError.message };
  if (count === 0) return { ok: false, error: 'Нет доступа к этому заказу' };

  const eventError = await logStageEvent(supabase, order.id, order.state, toState, user.id, actor);
  if (eventError) return { ok: false, error: eventError };

  if (toState === 'closed' && closedSettlement) {
    const { data: itemRows } = await supabase
      .from('request_items')
      .select('name, qty, unit')
      .eq('request_id', order.request_id);
    const documentError = await createActDocument(
      supabase,
      { id: order.id, requestId: order.request_id, ...closedSettlement },
      itemRows ?? [],
    );
    if (documentError) return { ok: false, error: documentError };
  }

  // Замыкание контура обучения (agents.md §8G, §14 шаг 10) — best-effort,
  // никогда не проваливает сам переход стадии: это фоновое обучение, а не
  // условие успеха действия пользователя. recalibration.ts объясняет, почему
  // только staff-актёр (RLS model_snapshots_insert_staff — staffOnly).
  if (toState === 'delivered' && order.approved_plan_id) {
    const { data: lines } = await supabase
      .from('plan_lines')
      .select('supplier_company_id')
      .eq('plan_id', order.approved_plan_id);
    const supplierIds = [...new Set((lines ?? []).map((l) => l.supplier_company_id))];
    await Promise.all(
      supplierIds.map((id) => recalibrateLeadTimeForSupplier(supabase, id).catch(() => undefined)),
    );
  }
  if (toState === 'closed' && (actor === 'concierge' || actor === 'admin')) {
    await recalibrateMatcherForOrder(supabase, {
      requestId: order.request_id,
      approvedPlanId: order.approved_plan_id,
    }).catch(() => undefined);
  }

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
  const amountKzt = roundKzt(p50 * 0.5);
  const invoiceNo = `PRE-${order.id.slice(0, 8)}`;

  const { error } = await supabase.from('prepayments').insert({
    request_id: order.request_id,
    amount_kzt: amountKzt,
    invoice_no: invoiceNo,
    status: 'paid',
    paid_at: new Date().toISOString(),
  });
  if (error) return error.message;

  return createPrepayInvoiceDocument(
    supabase,
    { id: order.id, requestId: order.request_id },
    invoiceNo,
    amountKzt,
  );
}

interface SupplierCandidateRow {
  id: string;
  categories: string[];
  capabilities: string[];
  minOrderKzt: number | null;
  isVerified: boolean;
  stats: {
    ordersTotal: number;
    ordersOnTime: number;
    ordersDisputed: number;
    rfqSent: number;
    rfqAnswered: number;
    medianResponseHours: number | null;
  };
}

/** Поставщик без единого закрытого заказа или отправленного RFQ — кандидат в слот исследования (agents.md §8C). */
const LOW_HISTORY_THRESHOLD = 3;
/** «Медленный» ориентир для нормировки скорости ответа в 0..1 — нет отдельного бенчмарка, 48ч выбрано как явный аутсайдер относительно RFQ_RESPOND_WINDOW_DAYS=5 суток. */
const SLOW_RESPONSE_HOURS_REFERENCE = 48;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * Признаки матчера из накопленной статистики поставщика (agents.md §8C).
 * У нового поставщика (нет строки в supplier_stats или ordersTotal=0)
 * признаки на истории — нейтральные 0.5, не 0: ноль наказывал бы за
 * отсутствие данных так же, как за подтверждённо плохую историю, а это
 * ровно то искажение, которое и должен закрывать слот исследования.
 * currentLoad и freshnessScore здесь всегда нейтральны — учёт текущей
 * загрузки поставщика и давности последней сделки в это подключение не
 * вошёл (нужен отдельный live-запрос числа открытых заказов), честно
 * оставлено на потом, а не подделано правдоподобным числом.
 */
function featuresFor(s: SupplierCandidateRow): ScoringFeatures {
  const { stats } = s;
  return {
    categoryMatch: 1, // уже гарантировано passesHardFilters ниже по вызову
    onTimeRate: stats.ordersTotal > 0 ? stats.ordersOnTime / stats.ordersTotal : 0.5,
    noDisputeRate: stats.ordersTotal > 0 ? 1 - stats.ordersDisputed / stats.ordersTotal : 0.5,
    responseSpeedScore:
      stats.medianResponseHours !== null
        ? clamp01(1 - stats.medianResponseHours / SLOW_RESPONSE_HOURS_REFERENCE)
        : 0.5,
    winRate: stats.rfqSent > 0 ? stats.ordersTotal / stats.rfqSent : 0.5,
    freshnessScore: 0.5,
    currentLoad: 0,
  };
}

/**
 * Подбор и ранжирование поставщиков под RFQ — agents.md §8C: жёсткие
 * фильтры (packages/engine/match/passesHardFilters), затем скоринг
 * (scoreSupplier по стартовым весам DEFAULT_WEIGHTS) с отбором топ-N на
 * позицию, и слот исследования (Thompson sampling) для поставщиков без
 * истории — обязательный пункт чек-листа §15.
 *
 * Честно про то, что подключено не целиком:
 * - веса матчера — DEFAULT_WEIGHTS, не дообученные онлайн: model_snapshots
 *   уже хранит модель 'matcher' (packages/engine/learn/recalibrate.ts
 *   производит нужную форму — MatchWeightsSnapshot), но ничто в apps/web
 *   пока не пишет туда снапшоты при закрытии заказа и не читает последний
 *   перед скорингом здесь — обучающий контур остаётся отдельной задачей;
 * - servesCities всегда null (= обслуживает любой город): в
 *   supplier_profiles нет колонки под географию поставщика, добавлять её
 *   ради этого подключения — расширение схемы за рамками задачи;
 * - orderValueKzt берётся из requests.budget_kzt, но если бюджет не
 *   указан — не 0 (0 отсекал бы буквально всех поставщиков с ненулевым
 *   minOrderKzt, см. комментарий у orderValueKzt ниже), а +∞, чтобы
 *   отсутствие бюджета не отсекало никого по минимальной сумме заказа.
 */
/**
 * Completeness Engine — agents.md §7.4/§8. Гейт СЕРВЕРНЫЙ, не только
 * визуальный: вызывается здесь, до createRfqsForOrder, а не только
 * скрывает/показывает кнопку в UI — иначе его можно обойти прямым
 * вызовом server action. packages/engine/src/completeness/check.ts —
 * почему блокер именно на deadline_date, а не на needs_clarification
 * позиций (последнее сегодня почти никогда не срабатывает, каталожные
 * позиции полны по построению — станет живым, когда появится
 * split/merge позиций).
 */
async function checkCompletenessBeforeRfq(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  order: OrderRow,
): Promise<string | null> {
  const { data: requestRow } = await supabase
    .from('requests')
    .select('deadline_date, budget_kzt')
    .eq('id', order.request_id)
    .maybeSingle();
  const { data: itemRows } = await supabase
    .from('request_items')
    .select('id, name, needs_clarification, clarification_reason')
    .eq('request_id', order.request_id);

  const completeness = checkRequestCompleteness({
    deadlineDate: requestRow?.deadline_date ?? null,
    budgetKzt: requestRow?.budget_kzt ?? null,
    items: (itemRows ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      needsClarification: item.needs_clarification,
      clarificationReason: item.clarification_reason,
    })),
  });

  if (completeness.blockers.length === 0) return null;
  return completeness.blockers.map((b) => b.humanReason).join(' ');
}

async function createRfqsForOrder(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  order: OrderRow,
): Promise<string | null> {
  const { data: items } = await supabase
    .from('request_items')
    .select('category, required_capabilities')
    .eq('request_id', order.request_id);
  if (!items || items.length === 0) return 'В заявке нет позиций';

  const { data: requestRow } = await supabase
    .from('requests')
    .select('city, budget_kzt')
    .eq('id', order.request_id)
    .maybeSingle();
  const city = requestRow?.city ?? '';
  // budget_kzt в заявке необязателен (agents.md: покупатель может его не
  // указать). passesHardFilters() трактует below_min_order буквально —
  // 0 здесь означал бы «заказ на нулевую сумму» и отсёк бы ЛЮБОГО
  // поставщика с ненулевым minOrderKzt, то есть почти всех. Неизвестный
  // бюджет обязан не отсекать по минимальной сумме заказа, а не отсекать
  // максимально жёстко — отсюда Infinity, а не 0.
  const orderValueKzt = requestRow?.budget_kzt ?? Number.POSITIVE_INFINITY;

  const { data: supplierRows } = await supabase
    .from('companies')
    .select(
      'id, verified_at, supplier_profiles(categories, capabilities, min_order_kzt), supplier_stats(orders_total, orders_on_time, orders_disputed, rfq_sent, rfq_answered, median_response_hours)',
    )
    .eq('type', 'supplier')
    .eq('is_active', true);

  const { data: settingsRows } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', ['rfq_batch_size_per_item', 'rfq_exploration_every_n']);
  const settingsMap = new Map((settingsRows ?? []).map((s) => [s.key, s.value as number]));
  const batchSizePerItem = settingsMap.get('rfq_batch_size_per_item') ?? FALLBACK_RFQ_BATCH_SIZE;
  const explorationEveryN =
    settingsMap.get('rfq_exploration_every_n') ?? FALLBACK_RFQ_EXPLORATION_EVERY_N;

  const candidates: SupplierCandidateRow[] = (supplierRows ?? [])
    .map((row) => {
      const profile = Array.isArray(row.supplier_profiles)
        ? row.supplier_profiles[0]
        : row.supplier_profiles;
      const stats = Array.isArray(row.supplier_stats) ? row.supplier_stats[0] : row.supplier_stats;
      return {
        id: row.id,
        categories: (profile?.categories ?? []) as string[],
        capabilities: (profile?.capabilities ?? []) as string[],
        minOrderKzt: profile?.min_order_kzt ?? null,
        isVerified: row.verified_at !== null,
        stats: {
          ordersTotal: stats?.orders_total ?? 0,
          ordersOnTime: stats?.orders_on_time ?? 0,
          ordersDisputed: stats?.orders_disputed ?? 0,
          rfqSent: stats?.rfq_sent ?? 0,
          rfqAnswered: stats?.rfq_answered ?? 0,
          medianResponseHours: stats?.median_response_hours ?? null,
        },
      };
    })
    .filter((s) => s.categories.length > 0);

  if (candidates.length === 0) {
    return 'Не нашлось ни одного поставщика по категории и техпроцессам этой заявки';
  }

  // Дообученные веса матчера (agents.md §8C, §8G) — читает последний
  // снапшот 'matcher', который order-actions.ts/recalibration.ts пишет
  // при закрытии заказа; без истории — DEFAULT_WEIGHTS, то же поведение,
  // что было до подключения контура обучения.
  const { data: latestMatcherSnapshot } = await supabase
    .from('model_snapshots')
    .select('params')
    .eq('model', 'matcher')
    .order('trained_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const matchWeights: MatchWeights =
    (latestMatcherSnapshot?.params as { weights?: MatchWeights } | null)?.weights ??
    DEFAULT_WEIGHTS;

  const chosenIds = new Set<string>();
  const explorationIds = new Set<string>();
  const selectionReasonById = new Map<string, Record<string, unknown>>();

  items.forEach((item, itemIndex) => {
    const passing = candidates.filter(
      (c) =>
        passesHardFilters(
          {
            id: c.id,
            isActive: true, // уже отфильтровано в запросе (.eq('is_active', true))
            isVerified: c.isVerified,
            isBlocked: false, // в схеме нет отдельного признака блокировки поставщика
            categories: c.categories,
            capabilities: c.capabilities,
            minOrderKzt: c.minOrderKzt,
            servesCities: null,
          },
          {
            category: item.category,
            requiredCapabilities: item.required_capabilities ?? [],
            orderValueKzt,
            city,
          },
        ).passes,
    );
    if (passing.length === 0) return;

    const scored = passing
      .map((c) => ({ candidate: c, score: scoreSupplier(featuresFor(c), matchWeights) }))
      .sort((a, b) => b.score - a.score);

    const picked = scored.slice(0, batchSizePerItem).map((s) => s.candidate);

    if (isExplorationSlot(itemIndex, explorationEveryN)) {
      const explorationPool = passing.filter(
        (c) => c.stats.ordersTotal + c.stats.rfqSent < LOW_HISTORY_THRESHOLD,
      );
      const explorationPickId = pickExplorationCandidate(
        explorationPool.map((c) => ({
          id: c.id,
          successCount: c.stats.ordersTotal,
          failCount: Math.max(c.stats.rfqSent - c.stats.ordersTotal, 0),
        })),
      );
      // is_exploration отмечается только когда слот реально добавил
      // кандидата сверх обычного топ-N по скору — если Thompson sampling
      // выбрал того же поставщика, что и так вошёл бы по счёту, это не
      // «вырощенный сетью» поставщик (agents.md §8C), а совпадение, и
      // считать его в метрику слотов исследования было бы нечестно.
      if (explorationPickId && !picked.some((c) => c.id === explorationPickId)) {
        const explorer = explorationPool.find((c) => c.id === explorationPickId);
        if (explorer) {
          picked.push(explorer);
          explorationIds.add(explorationPickId);
          if (!selectionReasonById.has(explorationPickId)) {
            selectionReasonById.set(explorationPickId, {
              reason: 'exploration_slot',
              category: item.category,
            });
          }
        }
      }
    }

    for (const { candidate, score } of scored) {
      if (!picked.some((p) => p.id === candidate.id)) continue;
      chosenIds.add(candidate.id);
      if (!selectionReasonById.has(candidate.id)) {
        selectionReasonById.set(candidate.id, {
          reason: 'scored',
          category: item.category,
          score,
          features: featuresFor(candidate),
        });
      }
    }
  });

  if (chosenIds.size === 0) {
    return 'Не нашлось ни одного поставщика по категории и техпроцессам этой заявки';
  }

  const sentAt = new Date();
  const respondBy = new Date(sentAt);
  respondBy.setUTCDate(respondBy.getUTCDate() + RFQ_RESPOND_WINDOW_DAYS);

  const { error } = await supabase.from('rfqs').insert(
    [...chosenIds].map((supplierId) => ({
      request_id: order.request_id,
      supplier_company_id: supplierId,
      token: crypto.randomUUID(),
      sent_at: sentAt.toISOString(),
      respond_by: respondBy.toISOString(),
      status: 'sent',
      is_exploration: explorationIds.has(supplierId),
      selection_reason: selectionReasonById.get(supplierId) ?? { reason: 'scored' },
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
