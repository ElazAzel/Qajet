'use server';

import type { PlanKind } from '@qajet/engine/combine';
import { checkRequestCompleteness } from '@qajet/engine/completeness';
import { allocateCommission } from '@qajet/engine/costing';
import { estimate as engineEstimate } from '@qajet/engine/estimate';
import {
  DEFAULT_WEIGHTS,
  isExplorationSlot,
  type MatchWeights,
  passesHardFilters,
  pickExplorationCandidate,
  scoreSupplier,
} from '@qajet/engine/match';
import { roundKzt } from '@qajet/engine/money';
import { transition } from '@qajet/engine/order';
import { calculateSettlement } from '@qajet/engine/settlement';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { type ActionResult, actionFailure } from '../action-result';
import { logAutoTimeEntry } from '../autotimer';
import { CATALOG_BY_KEY } from '../catalog';
import { loadRequestComparison } from '../comparison';
import { type OrderActor, orderActorFor, requireCurrentUser } from '../current-user';
import { buildActDocument, buildPrepayInvoiceDocument } from '../documents';
import type { OrderState } from '../order-state';
import { buildRfqNotification, type OutboxMessageInput } from '../outbox';
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

export type { ActionResult } from '../action-result';

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
    reason: z.string().trim().min(5).max(2000).optional(),
  })
  .strict();
const paymentFactInputSchema = z
  .object({
    amountKzt: z
      .number()
      .finite()
      .positive()
      .refine(Number.isSafeInteger, 'Сумма должна быть целым числом'),
    reference: z.string().trim().min(1).max(200),
    occurredAt: z.string().datetime().optional(),
    proofUrl: z.string().trim().max(2000).optional(),
  })
  .strict();

export type PaymentFactInput = z.infer<typeof paymentFactInputSchema>;

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
  if (error) return actionFailure('order.rateSupplier', error);

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
    return actionFailure('order.intakeRequest', orderError, 'Не удалось создать заказ');
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
  if (!comparison?.result.plans.some((plan) => plan.kind === kind)) {
    return { ok: false, error: 'Этот вариант плана не найден' };
  }

  // Сохраняем все допустимые варианты одной ревизии, а не только карточку,
  // по которой кликнул консьерж. Buyer сможет выбрать другой вариант до
  // подтверждения; selected kind остаётся оптимистичным указателем заказа.
  const serializedPlans = comparison.result.plans.map((plan) => {
    const lineCommissions = allocateCommission(
      plan.totalSupplierKzt,
      comparison.commissionRatePct,
      plan.lines.map((line) => line.lineTotalKzt),
    );
    return {
      kind: plan.kind,
      total_supplier_kzt: plan.totalSupplierKzt,
      delivery_kzt: plan.deliveryKzt,
      commission_kzt: lineCommissions.reduce((sum, value) => sum + value, 0),
      commission_base: plan.commissionBase,
      tax_effect_kzt: plan.taxEffectKzt,
      total_kzt: plan.totalKzt,
      eta_date: addDaysIso(plan.etaDays),
      slack_days: plan.slackDays,
      supplier_count: plan.supplierCount,
      explanation: plan.explanation,
      lines: plan.lines.map((line, index) => ({
        request_item_id: line.requestItemId,
        supplier_company_id: line.supplierId,
        quote_line_id: line.offerId,
        qty: line.qty,
        line_total_kzt: line.lineTotalKzt,
        commission_pct: comparison.commissionRatePct,
        commission_kzt: lineCommissions[index] ?? 0,
      })),
    };
  });

  const stageStartedAt = await captureStageStart(supabase, order.id, actor);
  const { error: planError } = await supabase.rpc('propose_order_plans', {
    p_order_id: order.id,
    p_expected_state: order.state,
    p_plans: serializedPlans,
    p_rejections: comparison.result.rejections.map((r) => ({
      quote_line_id: r.offerId,
      reason_code: r.code,
      reason_human: r.reasonHuman,
    })),
    p_selected_kind: kind,
  });
  if (planError) return actionFailure('order.proposePlan', planError);
  await logStageWork(supabase, order.id, order.state, user.id, actor, stageStartedAt);

  revalidateOrder(order.id);
  return { ok: true };
}

/** Buyer approval binds the click to the exact plan/version rendered on screen. */
export async function approvePlan(
  orderId: string,
  expectedPlanId: string,
  expectedPlanVersion: number,
): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  if (!UUID_RE.test(orderId) || !UUID_RE.test(expectedPlanId)) {
    return { ok: false, error: 'Заказ или план указаны некорректно' };
  }
  if (!Number.isSafeInteger(expectedPlanVersion) || expectedPlanVersion < 1) {
    return { ok: false, error: 'Версия плана указана некорректно' };
  }
  const supabase = await createSupabaseServerClient();

  const order = await loadOrder(supabase, { orderId });
  if (!order) return { ok: false, error: 'Заказ не найден' };
  if (!order.approved_plan_id) return { ok: false, error: 'У заказа нет предложенного плана' };

  const check = transition(order.state, 'plan_approved', actor);
  if (!check.ok) return { ok: false, error: check.reason };

  // The RPC checks permission overrides and routes an over-limit manager to the owner.
  const { error: planError } = await supabase.rpc('approve_plan', {
    p_order_id: order.id,
    p_expected_plan_id: expectedPlanId,
    p_expected_plan_version: expectedPlanVersion,
  });
  if (planError) return actionFailure('order.approvePlan', planError);
  // RPC commits plan + order + history together and routes managers above
  // their limit to awaiting_internal_approval. Do not overwrite its state.

  revalidateOrder(order.id);
  return { ok: true };
}

/** Buyer changes only the selected pointer; money and lines stay immutable. */
export async function selectPlan(
  orderId: string,
  expectedPlanId: string,
  planId: string,
): Promise<ActionResult> {
  const user = await requireCurrentUser();
  if (orderActorFor(user) !== 'buyer') {
    return { ok: false, error: 'Вариант может выбрать только покупатель' };
  }
  if (!UUID_RE.test(orderId) || !UUID_RE.test(expectedPlanId) || !UUID_RE.test(planId)) {
    return { ok: false, error: 'Заказ или план указаны некорректно' };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('select_order_plan', {
    p_order_id: orderId,
    p_expected_plan_id: expectedPlanId,
    p_plan_id: planId,
  });
  if (error) return actionFailure('order.selectPlan', error);
  revalidateOrder(orderId);
  return { ok: true };
}

/** Выставляет счёт на P80 оценки, не подменяя его фактом оплаты. */
export async function issuePrepaymentInvoice(orderId: string): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  if (actor !== 'concierge' && actor !== 'admin') {
    return { ok: false, error: 'Счёт может выставить только сотрудник QAJET' };
  }
  if (!UUID_RE.test(orderId)) return { ok: false, error: 'Заказ указан некорректно' };

  const supabase = await createSupabaseServerClient();
  const order = await loadOrder(supabase, { orderId });
  if (!order) return { ok: false, error: 'Заказ не найден' };
  if (order.state !== 'estimated' && order.state !== 'prepaid') {
    return { ok: false, error: 'Счёт на предоплату выставляется после оценки заказа' };
  }
  const error = await issuePrepaymentInvoiceForOrder(supabase, order);
  if (error) return { ok: false, error };
  revalidateOrder(order.id);
  return { ok: true };
}

/** Атомарно фиксирует банковский перевод и открывает стадию prepaid. */
export async function confirmPrepayment(
  orderId: string,
  rawInput: PaymentFactInput,
): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  if (actor !== 'concierge' && actor !== 'admin') {
    return { ok: false, error: 'Предоплату может подтвердить только сотрудник QAJET' };
  }
  if (!UUID_RE.test(orderId)) return { ok: false, error: 'Заказ указан некорректно' };
  const parsed = paymentFactInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: 'Проверьте сумму, reference и дату перевода' };

  const supabase = await createSupabaseServerClient();
  const order = await loadOrder(supabase, { orderId });
  if (!order) return { ok: false, error: 'Заказ не найден' };
  if (order.state !== 'estimated' && order.state !== 'prepaid') {
    return { ok: false, error: 'Предоплату можно подтвердить только после оценки заказа' };
  }
  const { data: prepayment } = await supabase
    .from('prepayments')
    .select('status')
    .eq('request_id', order.request_id)
    .maybeSingle();
  if (!prepayment) return { ok: false, error: 'Сначала выставьте счёт на предоплату' };

  const { error } = await supabase.rpc('confirm_prepayment', {
    p_order_id: order.id,
    p_amount_kzt: parsed.data.amountKzt,
    p_reference: parsed.data.reference,
    p_occurred_at: parsed.data.occurredAt ?? new Date().toISOString(),
    p_proof_url: parsed.data.proofUrl ?? null,
    p_idempotency_key: `prepayment:${order.id}:${parsed.data.reference}`,
  });
  if (error) return actionFailure('order.confirmPrepayment', error);
  revalidateOrder(order.id);
  return { ok: true };
}

/** Подтверждает полную или частичную выплату конкретному поставщику. */
export async function confirmSupplierPayout(
  orderId: string,
  supplierCompanyId: string,
  rawInput: PaymentFactInput,
): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  if (actor !== 'concierge' && actor !== 'admin') {
    return { ok: false, error: 'Выплату может подтвердить только сотрудник QAJET' };
  }
  if (!UUID_RE.test(orderId) || !UUID_RE.test(supplierCompanyId)) {
    return { ok: false, error: 'Заказ или поставщик указаны некорректно' };
  }
  const parsed = paymentFactInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: 'Проверьте сумму, reference и дату перевода' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('confirm_supplier_payout', {
    p_order_id: orderId,
    p_supplier_company_id: supplierCompanyId,
    p_amount_kzt: parsed.data.amountKzt,
    p_reference: parsed.data.reference,
    p_occurred_at: parsed.data.occurredAt ?? new Date().toISOString(),
    p_proof_url: parsed.data.proofUrl ?? null,
    p_idempotency_key: `supplier-payout:${orderId}:${supplierCompanyId}:${parsed.data.reference}`,
  });
  if (error) return actionFailure('order.confirmSupplierPayout', error);
  revalidateOrder(orderId);
  return { ok: true };
}

/** Фиксирует банковский возврат или доплату перед закрытием заказа. */
export async function confirmSettlementPayment(
  orderId: string,
  kind: 'refund' | 'surcharge',
  rawInput: PaymentFactInput,
): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  if (actor !== 'concierge' && actor !== 'admin') {
    return { ok: false, error: 'Сверку может подтвердить только сотрудник QAJET' };
  }
  if (!UUID_RE.test(orderId) || !['refund', 'surcharge'].includes(kind)) {
    return { ok: false, error: 'Заказ или тип сверки указаны некорректно' };
  }
  const parsed = paymentFactInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: 'Проверьте сумму, reference и дату перевода' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('confirm_settlement_payment', {
    p_order_id: orderId,
    p_direction: kind === 'refund' ? 'outbound' : 'inbound',
    p_kind: kind,
    p_amount_kzt: parsed.data.amountKzt,
    p_reference: parsed.data.reference,
    p_occurred_at: parsed.data.occurredAt ?? new Date().toISOString(),
    p_proof_url: parsed.data.proofUrl ?? null,
    p_idempotency_key: `settlement:${orderId}:${kind}:${parsed.data.reference}`,
  });
  if (error) return actionFailure('order.confirmSettlementPayment', error);
  revalidateOrder(orderId);
  return { ok: true };
}

export interface AdvanceOptions {
  settlement?: 'refund' | 'surcharge' | 'exact';
  /** Сумма из формы сверки, всегда положительная — знак выставляет сам action по типу расчёта. */
  settlementAmountKzt?: number;
  /** Причина для паузы, отмены или открытия спора — обязательна и сохраняется в audit log. */
  reason?: string;
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
  if (toState === 'prepaid') {
    return {
      ok: false,
      error: 'Сначала выставьте счёт и подтвердите банковский перевод отдельным действием',
    };
  }
  if (toState === 'suppliers_paid') {
    return {
      ok: false,
      error: 'Выплаты поставщикам подтверждаются по каждой компании отдельным действием',
    };
  }
  const options: AdvanceOptions = {};
  if (parsedOptions.data.settlement !== undefined) {
    options.settlement = parsedOptions.data.settlement;
  }
  if (parsedOptions.data.settlementAmountKzt !== undefined) {
    options.settlementAmountKzt = parsedOptions.data.settlementAmountKzt;
  }
  const exceptionalState = ['on_hold', 'cancelled', 'disputed'].includes(toState);
  if (exceptionalState && !parsedOptions.data.reason) {
    return { ok: false, error: 'Для паузы, отмены или спора укажите причину' };
  }

  const order = await loadOrder(supabase, { orderId });
  if (!order) return { ok: false, error: 'Заказ не найден' };

  const check = transition(order.state, toState, actor);
  if (!check.ok) return { ok: false, error: check.reason };

  if (exceptionalState) {
    const stageStartedAt = await captureStageStart(supabase, order.id, actor);
    const { error } = await supabase.rpc('advance_order_exception', {
      p_order_id: order.id,
      p_expected_state: order.state,
      p_to_state: toState,
      p_reason: parsedOptions.data.reason,
    });
    if (error) return actionFailure('order.advanceOrderStage', error);
    await logStageWork(supabase, order.id, order.state, user.id, actor, stageStartedAt);
    revalidateOrder(order.id);
    return { ok: true };
  }

  let estimatePayload: Record<string, unknown> | null = null;
  let prepaymentPayload: Record<string, unknown> | null = null;
  let rfqPayload: PreparedRfqs | null = null;

  if (toState === 'estimated') {
    const estimate = await computeEstimate(supabase, order);
    if (typeof estimate === 'string') return { ok: false, error: estimate };
    estimatePayload = estimate;
    const amountKzt = estimate.p80_kzt;
    if (typeof amountKzt !== 'number' || !Number.isSafeInteger(amountKzt) || amountKzt <= 0) {
      return { ok: false, error: 'Нельзя выставить счёт: P80 оценки отсутствует или равен нулю' };
    }
    const invoiceNo = `PRE-${order.id.slice(0, 8)}`;
    const document = await buildPrepayInvoiceDocument(
      supabase,
      { id: order.id, requestId: order.request_id },
      invoiceNo,
      amountKzt,
    );
    prepaymentPayload = {
      amount_kzt: amountKzt,
      invoice_no: invoiceNo,
      status: 'issued',
      paid_at: null,
      document: { url: document.url, meta: document.meta },
    };
  }
  if (toState === 'rfq_sent') {
    const completenessError = await checkCompletenessBeforeRfq(supabase, order);
    if (completenessError) return { ok: false, error: completenessError };
    const rfqs = await prepareRfqsForOrder(supabase, order);
    if (typeof rfqs === 'string') return { ok: false, error: rfqs };
    rfqPayload = rfqs;
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
    const { data: plan } = await supabase
      .from('plans')
      .select('total_kzt')
      .eq('id', order.approved_plan_id ?? '')
      .maybeSingle();
    if (!plan || !Number.isSafeInteger(plan.total_kzt) || plan.total_kzt < 0) {
      return { ok: false, error: 'У заказа нет корректной согласованной стоимости' };
    }
    const { data: paymentRows, error: paymentError } = await supabase
      .from('payment_facts')
      .select('direction, kind, status, amount_kzt')
      .eq('order_id', order.id)
      .eq('status', 'confirmed')
      .in('kind', ['prepayment', 'surcharge', 'refund']);
    if (paymentError) return actionFailure('order.advanceOrderStage', paymentError);

    let receivedKzt = 0;
    let refundedKzt = 0;
    for (const payment of paymentRows ?? []) {
      if (payment.direction === 'inbound') receivedKzt += payment.amount_kzt;
      if (payment.direction === 'outbound' && payment.kind === 'refund')
        refundedKzt += payment.amount_kzt;
    }
    const settlement = calculateSettlement(plan.total_kzt, receivedKzt - refundedKzt);
    if (options.settlement && options.settlement !== settlement.kind) {
      return { ok: false, error: 'Тип сверки не совпадает с подтверждёнными платежами' };
    }
    const hasAdjustment =
      settlement.amountKzt === 0 ||
      (paymentRows ?? [])
        .filter(
          (payment) =>
            payment.kind === settlement.kind &&
            payment.status === 'confirmed' &&
            ((settlement.kind === 'refund' && payment.direction === 'outbound') ||
              (settlement.kind === 'surcharge' && payment.direction === 'inbound')),
        )
        .reduce((sum, payment) => sum + payment.amount_kzt, 0) >= settlement.amountKzt;
    if (!hasAdjustment) {
      return {
        ok: false,
        error:
          settlement.kind === 'exact'
            ? 'Сверка ещё не готова'
            : `Сначала подтвердите ${settlement.kind === 'refund' ? 'возврат' : 'доплату'} на ${settlement.amountKzt} ₸`,
      };
    }
    const settlementAmountKzt =
      settlement.kind === 'refund' ? -settlement.amountKzt : settlement.amountKzt;
    payload.settlement = settlement.kind;
    payload.settlement_amount_kzt = settlementAmountKzt;
    payload.final_cost_kzt = plan.total_kzt;
    payload.closed_at = new Date().toISOString();
    closedSettlement = {
      settlement: settlement.kind,
      settlementAmountKzt,
      planTotalKzt: plan.total_kzt,
      finalCostKzt: plan.total_kzt,
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
    p_payouts: null,
    p_payload: payload,
    p_close_document: closeDocument,
  });
  if (orderError) return actionFailure('order.advanceOrderStage', orderError);
  // Timestamp захвачен до RPC: audit event создаётся триггером внутри той же
  // транзакции, что и все зависимые записи стадии.
  await logStageWork(supabase, order.id, order.state, user.id, actor, stageStartedAt);

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

/** Creates an idempotent P80 invoice without claiming that money arrived. */
async function issuePrepaymentInvoiceForOrder(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  order: OrderRow,
): Promise<string | null> {
  const { data: estimateRow, error: estimateError } = await supabase
    .from('estimates')
    .select('p80_kzt')
    .eq('request_id', order.request_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (estimateError) return estimateError.message;
  const amountKzt = estimateRow?.p80_kzt;
  if (!Number.isSafeInteger(amountKzt) || amountKzt <= 0) {
    return 'Нельзя выставить счёт: P80 оценки отсутствует или равен нулю';
  }

  const { data: existing, error: existingError } = await supabase
    .from('prepayments')
    .select('id, amount_kzt, invoice_no, status')
    .eq('request_id', order.request_id)
    .maybeSingle();
  if (existingError) return existingError.message;
  if (existing?.status === 'paid') return null;
  if (existing && existing.amount_kzt !== amountKzt) {
    return 'Счёт уже выставлен на другую сумму — создайте новую версию условий';
  }
  const invoiceNo = existing?.invoice_no ?? `PRE-${order.id.slice(0, 8)}`;
  const { error: prepaymentError } = await supabase.from('prepayments').upsert(
    {
      request_id: order.request_id,
      amount_kzt: amountKzt,
      invoice_no: invoiceNo,
      status: 'issued',
      paid_at: null,
    },
    { onConflict: 'request_id' },
  );
  if (prepaymentError) return prepaymentError.message;

  const document = await buildPrepayInvoiceDocument(
    supabase,
    { id: order.id, requestId: order.request_id },
    invoiceNo,
    amountKzt,
  );
  const { data: existingDocument, error: documentLookupError } = await supabase
    .from('documents')
    .select('id')
    .eq('order_id', order.id)
    .eq('type', 'prepay_invoice')
    .maybeSingle();
  if (documentLookupError) return documentLookupError.message;
  if (!existingDocument) {
    const { error: documentError } = await supabase.from('documents').insert({
      order_id: order.id,
      stage: 'estimated',
      type: 'prepay_invoice',
      url: document.url,
      meta: document.meta,
    });
    if (documentError) return documentError.message;
  }
  return null;
}

interface SupplierCandidateRow {
  id: string;
  categories: string[];
  capabilities: string[];
  serviceCities: string[];
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

/** Поставщик без единого закрытого заказа или отправленного RFQ — кандидат в слот исследования (agents.md §8C). */
const LOW_HISTORY_THRESHOLD = 3;

/**
 * Подбор и ранжирование поставщиков под RFQ — agents.md §8C: жёсткие
 * фильтры (packages/engine/match/passesHardFilters), затем скоринг
 * (scoreSupplier по стартовым весам DEFAULT_WEIGHTS) с отбором топ-N на
 * позицию, и слот исследования (Thompson sampling) для поставщиков без
 * истории — обязательный пункт чек-листа §15.
 *
 * `supplier_profiles.service_cities` — явная зона обслуживания; пустой
 * список означает «любой город». `companies.city` используется только для
 * тарифа и прогноза локальной/межгородской доставки.
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
          'id, verified_at, supplier_profiles(categories, capabilities, service_cities, min_order_kzt), supplier_stats(orders_total, orders_on_time, orders_disputed, rfq_sent, rfq_answered, median_response_hours)',
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
        serviceCities: (profile?.service_cities ?? []) as string[],
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
  // Exploration is a property of the outgoing RFQ stream, not of a request
  // item. Counting from zero per item would spend one slot for every item in
  // a basket and would over-train the network on large requests.
  let emittedRfqCount = 0;

  items.forEach((item) => {
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
            servesCities: c.serviceCities.length > 0 ? c.serviceCities : null,
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
    const chosenBefore = chosenIds.size;

    if (isExplorationSlot(emittedRfqCount, explorationEveryN)) {
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
    // The final RFQ list is de-duplicated by supplier. Count only newly
    // emitted supplier RFQs, otherwise a supplier selected for two basket
    // lines would consume two exploration slots while producing one RFQ.
    emittedRfqCount += chosenIds.size - chosenBefore;
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

/**
 * Внутренняя заметка по заказу — agents.md §5, §10 «Консьерж → внутренние
 * заметки». Тред `kind='internal'` заводится лениво, при первой заметке.
 */
export async function addInternalNote(orderId: string, body: string): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  if (actor !== 'concierge' && actor !== 'admin') {
    return { ok: false, error: 'Внутренние заметки ведёт только staff' };
  }
  const trimmed = body.trim();
  if (trimmed === '') return { ok: false, error: 'Заметка не может быть пустой' };

  const supabase = await createSupabaseServerClient();

  let { data: thread } = await supabase
    .from('threads')
    .select('id')
    .eq('order_id', orderId)
    .eq('kind', 'internal')
    .maybeSingle();

  if (!thread) {
    const { data: created, error: threadError } = await supabase
      .from('threads')
      .insert({ order_id: orderId, kind: 'internal' })
      .select('id')
      .single();
    if (threadError || !created) {
      return actionFailure('order.addInternalNote', threadError, 'Не удалось создать заметку');
    }
    thread = created;
  }

  const { error: messageError } = await supabase.from('messages').insert({
    thread_id: thread.id,
    author_user_id: user.id,
    body: trimmed,
  });
  if (messageError) return actionFailure('order.addInternalNote', messageError);

  revalidatePath(`/concierge/orders/${orderId}`);
  return { ok: true };
}
