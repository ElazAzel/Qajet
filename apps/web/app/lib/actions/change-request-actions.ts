'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { type ActionResult, actionFailure } from '../action-result';
import { orderActorFor, requireCurrentUser } from '../current-user';

const uuid = z.string().uuid();
const requestSchema = z
  .object({
    reason: z.string().trim().min(5).max(2000),
    supplierDeltaKzt: z.number().int().safe().min(-100_000_000).max(100_000_000).default(0),
    deliveryDeltaKzt: z.number().int().safe().min(-100_000_000).max(100_000_000).default(0),
  })
  .strict();

export type PlanChangeInput = z.infer<typeof requestSchema>;

export async function requestPlanChange(
  orderId: string,
  rawInput: PlanChangeInput,
): Promise<ActionResult> {
  const user = await requireCurrentUser();
  if (orderActorFor(user) !== 'buyer') {
    return { ok: false, error: 'Запрос изменения может создать только покупатель' };
  }
  if (!uuid.safeParse(orderId).success) return { ok: false, error: 'Заказ указан некорректно' };
  const parsed = requestSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: 'Опишите изменение и корректную сумму' };

  const supabase = await createSupabaseServerClient();
  // Проверки состояния, запись запроса и сообщение покупателю — один RPC в
  // одной транзакции; единственность pending держит частичный индекс.
  const { error } = await supabase.rpc('request_plan_change', {
    p_order_id: orderId,
    p_reason: parsed.data.reason,
    p_supplier_delta_kzt: parsed.data.supplierDeltaKzt,
    p_delivery_delta_kzt: parsed.data.deliveryDeltaKzt,
  });
  if (error) return actionFailure('changeRequest.request', error, 'Не удалось создать запрос');

  revalidatePath(`/buyer/orders/${orderId}`);
  revalidatePath(`/concierge/orders/${orderId}`);
  revalidatePath('/concierge');
  return { ok: true };
}

export async function resolvePlanChange(
  changeRequestId: string,
  decision: 'accepted' | 'declined',
): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  if (actor !== 'concierge' && actor !== 'admin') {
    return { ok: false, error: 'Изменение плана рассматривает только QAJET' };
  }
  if (!uuid.safeParse(changeRequestId).success)
    return { ok: false, error: 'Запрос указан некорректно' };
  const supabase = await createSupabaseServerClient();
  const { data: change, error: changeError } = await supabase
    .from('change_requests')
    .select('id, order_id, proposed_plan_id, diff, status')
    .eq('id', changeRequestId)
    .maybeSingle();
  if (changeError || !change)
    return actionFailure('change-request.resolvePlanChange', changeError, 'Запрос не найден');
  if (change.status !== 'pending') return { ok: false, error: 'Запрос уже обработан' };

  if (decision === 'declined') {
    const { error } = await supabase
      .from('change_requests')
      .update({ status: 'declined', updated_at: new Date().toISOString() })
      .eq('id', change.id)
      .eq('status', 'pending');
    if (error) return actionFailure('change-request.resolvePlanChange', error);
  } else {
    const diff = (change.diff ?? {}) as {
      requestedSupplierDeltaKzt?: unknown;
      requestedDeliveryDeltaKzt?: unknown;
      expectedPlanId?: unknown;
    };
    const supplierDelta = Number(diff.requestedSupplierDeltaKzt ?? 0);
    const deliveryDelta = Number(diff.requestedDeliveryDeltaKzt ?? 0);
    if (
      !Number.isSafeInteger(supplierDelta) ||
      !Number.isSafeInteger(deliveryDelta) ||
      diff.expectedPlanId !== change.proposed_plan_id
    ) {
      return { ok: false, error: 'Запрос содержит устаревшие или некорректные условия' };
    }
    const { error } = await supabase.rpc('resolve_plan_change', {
      p_change_request_id: change.id,
      p_expected_plan_id: change.proposed_plan_id,
      p_supplier_delta_kzt: supplierDelta,
      p_delivery_delta_kzt: deliveryDelta,
    });
    if (error) return actionFailure('change-request.resolvePlanChange', error);
  }

  revalidatePath(`/buyer/orders/${change.order_id}`);
  revalidatePath(`/concierge/orders/${change.order_id}`);
  revalidatePath('/concierge');
  return { ok: true };
}
