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
  scoreSupplier,
} from '@qajet/engine/match';
import { percentOfKzt, roundKzt } from '@qajet/engine/money';
import { transition } from '@qajet/engine/order';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logAutoTimeEntry } from '../autotimer';
import { CATALOG_BY_KEY } from '../catalog';
import { loadRequestComparison } from '../comparison';
import { type OrderActor, orderActorFor, requireCurrentUser } from '../current-user';
import { buildActDocument, buildPrepayInvoiceDocument } from '../documents';
import type { OrderState } from '../order-state';
import { buildRfqNotification, type OutboxMessageInput } from '../outbox';
import {
  recalibrateEstimatorForOrder,
  recalibrateLeadTimeForSupplier,
  recalibrateMatcherForOrder,
} from '../recalibration';
import { matcherFeatures } from '../supplier-matcher';

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
 * тронуть), (4) оставляет запись аудита Postgres-триггеру в той же
 * транзакции. enforce_order_transition и guard_order_actor — независимые
 * барьеры на случай прямого обращения мимо этого файла.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface SupplierRatingInput {
  buyerScore1To5: number;
  wasOnTime: boolean;
  hadDispute: boolean;
  comment?: string | undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_STATE_VALUES = [
  'draft',
  'estimated',
  'prepaid',
  'rfq_sent',
  'quotes_received',
  'plan_proposed',
  'plan_approved',
  'suppliers_paid',
  'in_production',
  'shipped',
  'delivered',
  'accepted',
  'closed',
  'awaiting_internal_approval',
  'on_hold',
  'cancelled',
  'disputed',
] as const;
const orderStateSchema = z.enum(ORDER_STATE_VALUES);
const advanceOptionsSchema = z
  .object({
    settlement: z.enum(['refund', 'surcharge', 'exact']).optional(),
    settlementAmountKzt: z
      .number()
      .finite()
      .nonnegative()
      .refine(Number.isSafeInteger, 'Сумма должна быть целым числом')
      .optional(),
  })
  .strict();

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

/**
 * Оценка исполнения после закрытия заказа — единственная точка записи
 * рейтинга. Проверка заказа, поставщика, повторной оценки и пересчёт
 * `supplier_stats` выполняются внутри submit_supplier_rating() одной
 * транзакцией; клиент не получает права писать рейтинги напрямую.
 */
export async function rateSupplier(
  orderId: string,
  supplierCompanyId: string,
  input: SupplierRatingInput,
): Promise<ActionResult> {
  const user = await requireCurrentUser();
  if (orderActorFor(user) !== 'buyer') {
    return { ok: false, error: 'Оценку может оставить только покупатель' };
  }
  if (!UUID_RE.test(orderId) || !UUID_RE.test(supplierCompanyId)) {
    return { ok: false, error: 'Заказ или поставщик указаны некорректно' };
  }
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Оценка указана некорректно' };
  }
  if (
    !Number.isSafeInteger(input?.buyerScore1To5) ||
    input.buyerScore1To5 < 1 ||
    input.buyerScore1To5 > 5
  ) {
    return { ok: false, error: 'Оценка должна быть целым числом от 1 до 5' };
  }
  if (typeof input.wasOnTime !== 'boolean' || typeof input.hadDispute !== 'boolean') {
    return { ok: false, error: 'Укажите корректные исходы исполнения' };
  }
  if (input.comment !== undefined && typeof input.comment !== 'string') {
    return { ok: false, error: 'Комментарий указан некорректно' };
  }
  const comment = input.comment?.trim() || null;
  if (comment && comment.length > 2000) {
    return { ok: false, error: 'Комментарий не должен быть длиннее 2000 символов' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('submit_supplier_rating', {
    p_order_id: orderId,
    p_supplier_company_id: supplierCompanyId,
    p_buyer_score: input.buyerScore1To5,
    p_was_on_time: input.wasOnTime,
    p_had_dispute: input.hadDispute,
    p_comment: comment,
  });
  if (error) return { ok: false, error: error.message };

  revalidateOrder(orderId);
  return { ok: true };
}

function addDaysIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

async function captureStageStart(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  orderId: string,
  actor: OrderActor,
): Promise<string | undefined> {
  if (actor !== 'concierge' && actor !== 'admin') return undefined;

  const { data: previousEvent } = await supabase
    .from('order_stage_events')
    .select('at')
    .eq('order_id', orderId)
    .order('at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (previousEvent?.at) return previousEvent.at as string;

  const { data: order } = await supabase
    .from('orders')
    .select('created_at')
    .eq('id', orderId)
    .maybeSingle();
  return order?.created_at as string | undefined;
}

async function logStageWork(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  orderId: string,
  fromState: OrderState,
  actorUserId: string,
  actor: OrderActor,
  stageStartedAt?: string,
): Promise<void> {
  // Автотаймер получает timestamp, захваченный ДО UPDATE: после UPDATE новый
  // audit event создаётся триггером в той же транзакции.
  await logAutoTimeEntry(supabase, orderId, fromState, actor, actorUserId, stageStartedAt).catch(
    () => undefined,
  );
}

function revalidateOrder(orderId: string): void {
  revalidatePath(`/concierge/orders/${orderId}`);
  revalidatePath(`/buyer/orders/${orderId}`);
  revalidatePath('/concierge');
  revalidatePath('/buyer');
}

/**
 * Консьерж берёт поданную заявку в работу — создаёт плейсхолдер-план и
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
    return { ok: false, error: 'Только консьерж может взять заявку в работу' };
  }
  if (!UUID_RE.test(requestId)) return { ok: false, error: 'Заявка указана некорректно' };

  const supabase = await createSupabaseServerClient();

  const { data: existing } = await supabase
    .from('orders')
    .select('id')
    .eq('request_id', requestId)
    .maybeSingle();
  if (existing) return { ok: false, error: 'Заявка уже взята в работу' };

  const { data: orderId, error: orderError } = await supabase.rpc('intake_request', {
    p_request_id: requestId,
  });
  if (orderError || !orderId) {
    return { ok: false, error: orderError?.message ?? 'Не удалось создать заказ' };
  }

  revalidatePath('/concierge');
  revalidatePath('/buyer');
  return { ok: true, orderId: orderId as string };
}

/** Консьерж/админ предлагает план — quotes_received → plan_proposed. */
export async function proposePlan(requestId: string, kind: PlanKind): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  if (!UUID_RE.test(requestId)) return { ok: false, error: 'Заявка указана некорректно' };
  if (!['recommended', 'cheaper', 'more_slack'].includes(kind)) {
    return { ok: false, error: 'Вариант плана указан некорректно' };
  }
  const supabase = await createSupabaseServerClient();

  const order = await loadOrder(supabase, { requestId });
  if (!order) return { ok: false, error: 'Заказ не найден' };

  const check = transition(order.state, 'plan_proposed', actor);
  if (!check.ok) return { ok: false, error: check.reason };

  const comparison = await loadRequestComparison(supabase, requestId);
  const chosen = comparison?.result.plans.find((p) => p.kind === kind);
  if (!comparison || !chosen) return { ok: false, error: 'Этот вариант плана не найден' };

  const stageStartedAt = await captureStageStart(supabase, order.id, actor);
  const { error: planError } = await supabase.rpc('propose_order_plan', {
    p_order_id: order.id,
    p_expected_state: order.state,
    p_plan: {
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
    },
    p_lines: chosen.lines.map((line) => ({
      request_item_id: line.requestItemId,
      supplier_company_id: line.supplierId,
      quote_line_id: line.offerId,
      qty: line.qty,
      line_total_kzt: line.lineTotalKzt,
      commission_pct: comparison.commissionRatePct,
      commission_kzt: percentOfKzt(line.lineTotalKzt, comparison.commissionRatePct),
    })),
    p_rejections: comparison.result.rejections.map((r) => ({
      quote_line_id: r.offerId,
      reason_code: r.code,
      reason_human: r.reasonHuman,
    })),
  });
  if (planError) return { ok: false, error: planError.message };
  await logStageWork(supabase, order.id, order.state, user.id, actor, stageStartedAt);

  revalidateOrder(order.id);
  return { ok: true };
}

/** Buyer approval is committed with authorization, limits and audit history in one RPC. */
export async function approvePlan(orderId: string): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  if (!UUID_RE.test(orderId)) return { ok: false, error: 'Заказ указан некорректно' };
  const supabase = await createSupabaseServerClient();

  const order = await loadOrder(supabase, { orderId });
  if (!order) return { ok: false, error: 'Заказ не найден' };
  if (!order.approved_plan_id) return { ok: false, error: 'У заказа нет предложенного плана' };

  const check = transition(order.state, 'plan_approved', actor);
  if (!check.ok) return { ok: false, error: check.reason };

  // The RPC checks permission overrides and routes an over-limit manager to the owner.
  const { error: planError } = await supabase.rpc('approve_plan', { p_order_id: order.id });
  if (planError) return { ok: false, error: planError.message };
  // RPC commits plan + order + history together and routes managers above
  // their limit to awaiting_internal_approval. Do not overwrite its state.

  revalidateOrder(order.id);
  return { ok: true };
}

export interface AdvanceOptions {
  settlement?: 'refund' | 'surcharge' | 'exact';
  /** Сумма из формы сверки, всегда положительная — знак выставляет сам action по типу расчёта. */
  settlementAmountKzt?: number;
}

/**
 * Все остальные рёбра графа: suppliers_paid…shipped (консьерж/админ),
 * accepted (покупатель), disputed/on_hold/cancelled (покупатель или staff — см. граф).
 */
export async function advanceOrderStage(
  orderId: string,
  toState: OrderState,
  rawOptions: AdvanceOptions = {},
): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  const supabase = await createSupabaseServerClient();

  if (!UUID_RE.test(orderId)) return { ok: false, error: 'Заказ указан некорректно' };
  const parsedState = orderStateSchema.safeParse(toState);
  if (!parsedState.success) return { ok: false, error: 'Стадия заказа указана некорректно' };
  const parsedOptions = advanceOptionsSchema.safeParse(rawOptions ?? {});
  if (!parsedOptions.success) return { ok: false, error: 'Параметры перехода указаны некорректно' };
  toState = parsedState.data;
  const options: AdvanceOptions = {};
  if (parsedOptions.data.settlement !== undefined) {
    options.settlement = parsedOptions.data.settlement;
  }
  if (parsedOptions.data.settlementAmountKzt !== undefined) {
    options.settlementAmountKzt = parsedOptions.data.settlementAmountKzt;
  }

  const order = await loadOrder(supabase, { orderId });
  if (!order) return { ok: false, error: 'Заказ не найден' };

  const check = transition(order.state, toState, actor);
  if (!check.ok) return { ok: false, error: check.reason };

  let estimatePayload: Record<string, unknown> | null = null;
  let prepaymentPayload: Record<string, unknown> | null = null;
  let rfqPayload: PreparedRfqs | null = null;
  let payoutPayload: PreparedPayout[] | null = null;

  if (toState === 'estimated') {
    const estimate = await computeEstimate(supabase, order);
    if (typeof estimate === 'string') return { ok: false, error: estimate };
    estimatePayload = estimate;
  }
  if (toState === 'prepaid') {
    const prepayment = await preparePrepayment(supabase, order);
    if (typeof prepayment === 'string') return { ok: false, error: prepayment };
    prepaymentPayload = prepayment;
  }
  if (toState === 'rfq_sent') {
    const completenessError = await checkCompletenessBeforeRfq(supabase, order);
    if (completenessError) return { ok: false, error: completenessError };
    const rfqs = await prepareRfqsForOrder(supabase, order);
    if (typeof rfqs === 'string') return { ok: false, error: rfqs };
    rfqPayload = rfqs;
  }
  if (toState === 'suppliers_paid') {
    const payouts = await prepareSupplierPayouts(supabase, order);
    if (typeof payouts === 'string') return { ok: false, error: payouts };
    payoutPayload = payouts;
  }

  const payload: Record<string, unknown> = {};
  let closeDocument: { url: string; meta: Record<string, unknown> } | null = null;
  if (toState === 'accepted') payload.accepted_at = new Date().toISOString();
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

    const { data: itemRows } = await supabase
      .from('request_items')
      .select('name, qty, unit')
      .eq('request_id', order.request_id);
    closeDocument = await buildActDocument(
      supabase,
      { id: order.id, requestId: order.request_id, ...closedSettlement },
      itemRows ?? [],
    );
  }

  const stageStartedAt = await captureStageStart(supabase, order.id, actor);
  const { error: orderError } = await supabase.rpc('advance_order_stage', {
    p_order_id: order.id,
    p_expected_state: order.state,
    p_to_state: toState,
    p_estimate: estimatePayload,
    p_prepayment: prepaymentPayload,
    p_rfqs: rfqPayload?.rfqs ?? null,
    p_outbox: rfqPayload?.outbox ?? null,
    p_payouts: payoutPayload,
    p_payload: payload,
    p_close_document: closeDocument,
  });
  if (orderError) return { ok: false, error: orderError.message };
  // Timestamp захвачен до RPC: audit event создаётся триггером внутри той же
  // транзакции, что и все зависимые записи стадии.
  await logStageWork(supabase, order.id, order.state, user.id, actor, stageStartedAt);

  // Замыкание контура обучения (agents.md §8G, §14 шаг 10) — best-effort,
  // никогда не проваливает сам переход стадии: это фоновое обучение, а не
  // условие успеха действия пользователя. recalibration.ts объясняет, почему
  // только staff-актёр (RLS model_snapshots_insert_staff — staffOnly).
  if (toState === 'closed' && (actor === 'concierge' || actor === 'admin')) {
    if (order.approved_plan_id) {
      const { data: lines } = await supabase
        .from('plan_lines')
        .select('supplier_company_id')
        .eq('plan_id', order.approved_plan_id);
      const supplierIds = [...new Set((lines ?? []).map((l) => l.supplier_company_id))];
      await Promise.all(
        supplierIds.map((id) =>
          recalibrateLeadTimeForSupplier(supabase, id).catch(() => undefined),
        ),
      );
    }
    await recalibrateMatcherForOrder(supabase, {
      requestId: order.request_id,
      approvedPlanId: order.approved_plan_id,
    }).catch(() => undefined);
    // Калькулятор — вторая половина того же контура: после закрытия
    // сохраняется новый estimator snapshot, а следующая оценка читает из
    // него накопленный запас P80 по itemKey.
    await recalibrateEstimatorForOrder(supabase, order.id).catch(() => undefined);
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
async function computeEstimate(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  order: OrderRow,
): Promise<Record<string, unknown> | string> {
  const { data: items } = await supabase
    .from('request_items')
    .select('qty, specs')
    .eq('request_id', order.request_id);
  if (!items || items.length === 0) return 'В заявке нет позиций';

  let totalP50 = 0;
  let totalP80 = 0;
  let maxMargin = 0;
  let nSamplesTotal = 0;

  const { data: latestEstimator } = await supabase
    .from('model_snapshots')
    .select('metrics')
    .eq('model', 'estimator')
    .order('trained_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const previousErrorsByItemKey = new Map(
    (
      (
        latestEstimator?.metrics as
          | { byCategory?: { category: string; relativeErrors?: number[] }[] }
          | null
          | undefined
      )?.byCategory ?? []
    ).map((entry) => [entry.category, entry.relativeErrors ?? []]),
  );

  for (const item of items) {
    const itemKey = (item.specs as { itemKey?: string } | null)?.itemKey;
    const catalogItem = itemKey ? CATALOG_BY_KEY.get(itemKey) : undefined;
    const baseRateKzt = catalogItem?.baseUnitPriceKzt ?? FALLBACK_BASE_RATE_KZT;

    const { data: observations } = itemKey
      ? await supabase
          .from('price_observations')
          .select('qty, unit_price_kzt, observed_at')
          .eq('item_key', itemKey)
      : { data: null };
    const obs = (observations ?? []).map((o) => ({ qty: o.qty, unitPriceKzt: o.unit_price_kzt }));
    nSamplesTotal += obs.length;
    const pastRelativeErrors = itemKey ? previousErrorsByItemKey.get(itemKey) : undefined;

    const lastObservedAt = (observations ?? [])
      .map((observation) => observation.observed_at)
      .filter((observedAt): observedAt is string => typeof observedAt === 'string')
      .sort()
      .at(-1);
    const est = engineEstimate({
      qty: item.qty,
      observations: obs,
      baseRateKzt,
      ...(pastRelativeErrors ? { pastRelativeErrors } : {}),
      ...(lastObservedAt ? { lastObservedAt } : {}),
    });
    totalP50 += est.p50Kzt;
    totalP80 += est.p80Kzt;
    maxMargin = Math.max(maxMargin, est.marginPct);
  }

  return {
    p50_kzt: roundKzt(totalP50),
    p80_kzt: roundKzt(totalP80),
    margin_pct: maxMargin,
    basis: { nSamples: nSamplesTotal, method: 'engine.estimate log-log + Bayesian shrinkage' },
  };
}

/** Предоплата — 50% от p50, без эквайринга (agents.md §17): факт фиксируется
 *  вручную, счёт/подтверждение — не платёжный шлюз. */
async function preparePrepayment(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  order: OrderRow,
): Promise<Record<string, unknown> | string> {
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
  const paidAt = new Date().toISOString();
  const document = await buildPrepayInvoiceDocument(
    supabase,
    { id: order.id, requestId: order.request_id },
    invoiceNo,
    amountKzt,
  );
  return {
    amount_kzt: amountKzt,
    invoice_no: invoiceNo,
    status: 'paid',
    paid_at: paidAt,
    document,
  };
}

interface SupplierCandidateRow {
  id: string;
  categories: string[];
  capabilities: string[];
  minOrderKzt: number | null;
  isVerified: boolean;
  activity: {
    openOrderCount: number;
    lastClosedAt: string | null;
  };
  stats: {
    ordersTotal: number;
    ordersOnTime: number;
    ordersDisputed: number;
    rfqSent: number;
    rfqAnswered: number;
    medianResponseHours: number | null;
  };
}

interface PreparedRfq {
  id: string;
  supplier_company_id: string;
  token: string;
  sent_at: string;
  respond_by: string;
  status: 'sent';
  is_exploration: boolean;
  selection_reason: Record<string, unknown>;
}

interface PreparedRfqs {
  rfqs: PreparedRfq[];
  outbox: OutboxMessageInput[];
}

interface PreparedPayout {
  supplier_company_id: string;
  amount_kzt: number;
  status: 'paid';
  paid_at: string;
}

/** Поставщик без единого закрытого заказа или отправленного RFQ — кандидат в слот исследования (agents.md §8C). */
const LOW_HISTORY_THRESHOLD = 3;

/**
 * Подбор и ранжирование поставщиков под RFQ — agents.md §8C: жёсткие
 * фильтры (packages/engine/match/passesHardFilters), затем скоринг
 * (scoreSupplier по стартовым весам DEFAULT_WEIGHTS) с отбором топ-N на
 * позицию, и слот исследования (Thompson sampling) для поставщиков без
 * истории — обязательный пункт чек-листа §15.
 *
 * Честно про оставшееся ограничение: `supplier_profiles` не хранит список
 * городов обслуживания, поэтому `servesCities` остаётся null (= поставщик
 * сам заявляет, что доставляет в любой город). `companies.city` хранится как
 * город поставщика, но не является доказательством зоны доставки.
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

async function prepareRfqsForOrder(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  order: OrderRow,
): Promise<PreparedRfqs | string> {
  const { data: items } = await supabase
    .from('request_items')
    .select('category, required_capabilities')
    .eq('request_id', order.request_id);
  if (!items || items.length === 0) return 'В заявке нет позиций';

  const { data: requestRow } = await supabase
    .from('requests')
    .select('city, budget_kzt, title')
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

  const [{ data: supplierRows }, { data: activityOrders }, { data: activityPlanLines }] =
    await Promise.all([
      supabase
        .from('companies')
        .select(
          'id, verified_at, supplier_profiles(categories, capabilities, min_order_kzt), supplier_stats(orders_total, orders_on_time, orders_disputed, rfq_sent, rfq_answered, median_response_hours)',
        )
        .eq('type', 'supplier')
        .eq('is_active', true),
      supabase.from('orders').select('id, approved_plan_id, state, closed_at'),
      supabase.from('plan_lines').select('plan_id, supplier_company_id'),
    ]);

  const orderByPlanId = new Map<string, { id: string; state: string; closed_at: string | null }>(
    (activityOrders ?? [])
      .filter((row) => row.approved_plan_id)
      .map((row) => [row.approved_plan_id as string, row]),
  );
  const activityBySupplier = new Map<
    string,
    { openOrderIds: Set<string>; lastClosedAt: string | null }
  >();
  for (const line of activityPlanLines ?? []) {
    const order = orderByPlanId.get(line.plan_id);
    if (!order) continue;
    const activity = activityBySupplier.get(line.supplier_company_id) ?? {
      openOrderIds: new Set<string>(),
      lastClosedAt: null,
    };
    if (order.state === 'closed' && order.closed_at) {
      if (
        activity.lastClosedAt === null ||
        new Date(order.closed_at).getTime() > new Date(activity.lastClosedAt).getTime()
      ) {
        activity.lastClosedAt = order.closed_at;
      }
    } else if (order.state !== 'cancelled') {
      activity.openOrderIds.add(order.id);
    }
    activityBySupplier.set(line.supplier_company_id, activity);
  }

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
        activity: {
          openOrderCount: activityBySupplier.get(row.id)?.openOrderIds.size ?? 0,
          lastClosedAt: activityBySupplier.get(row.id)?.lastClosedAt ?? null,
        },
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
  const scoringAt = new Date().toISOString();

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
      .map((candidate) => ({
        candidate,
        features: matcherFeatures(candidate.stats, candidate.activity, scoringAt),
      }))
      .map((entry) => ({
        ...entry,
        score: scoreSupplier(entry.features, matchWeights),
      }))
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

    for (const { candidate, features, score } of scored) {
      if (!picked.some((p) => p.id === candidate.id)) continue;
      chosenIds.add(candidate.id);
      if (!selectionReasonById.has(candidate.id)) {
        selectionReasonById.set(candidate.id, {
          reason: 'scored',
          category: item.category,
          score,
          features,
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

  const rfqDrafts: PreparedRfq[] = [...chosenIds].map((supplierId) => ({
    id: crypto.randomUUID(),
    supplier_company_id: supplierId,
    token: crypto.randomUUID(),
    sent_at: sentAt.toISOString(),
    respond_by: respondBy.toISOString(),
    status: 'sent',
    is_exploration: explorationIds.has(supplierId),
    selection_reason: selectionReasonById.get(supplierId) ?? { reason: 'scored' },
  }));

  // В очередь попадают только активные owner/manager поставщика. Адреса
  // читаются staff-сессией, а покупатель никогда не получает эту выборку.
  const { data: recipients, error: recipientsError } = await supabase
    .from('users')
    .select('company_id, email')
    .in('company_id', [...chosenIds])
    .in('role', ['owner', 'manager'])
    .eq('is_active', true);
  if (recipientsError) return recipientsError.message;

  const outbox = rfqDrafts.flatMap((rfq) =>
    (recipients ?? [])
      .filter((recipient) => recipient.company_id === rfq.supplier_company_id)
      .map((recipient) =>
        buildRfqNotification({
          rfqId: rfq.id,
          token: rfq.token,
          requestTitle: requestRow?.title ?? 'Новая заявка',
          respondBy: respondBy.toISOString(),
          recipient: recipient.email,
        }),
      ),
  );
  return { rfqs: rfqDrafts, outbox };
}

async function prepareSupplierPayouts(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  order: OrderRow,
): Promise<PreparedPayout[] | string> {
  if (!order.approved_plan_id) return [];
  const { data: lines } = await supabase
    .from('plan_lines')
    .select('supplier_company_id, line_total_kzt')
    .eq('plan_id', order.approved_plan_id);
  if (!lines || lines.length === 0) return [];

  const totalsBySupplier = new Map<string, number>();
  for (const line of lines) {
    totalsBySupplier.set(
      line.supplier_company_id,
      (totalsBySupplier.get(line.supplier_company_id) ?? 0) + line.line_total_kzt,
    );
  }

  const paidAt = new Date().toISOString();
  return [...totalsBySupplier.entries()].map(([supplierCompanyId, amountKzt]) => ({
    supplier_company_id: supplierCompanyId,
    amount_kzt: amountKzt,
    status: 'paid',
    paid_at: paidAt,
  }));
}
