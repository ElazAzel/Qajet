'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { actionFailure } from '../action-result';
import { orderActorFor, requireCurrentUser } from '../current-user';
import { TIME_ENTRY_STAGE_LABEL } from '../order-time';
import type { ActionResult } from './request-actions';

/**
 * Ручная корректировка учёта времени — agents.md §9: «автотаймер… ручная
 * корректировка доступна». Автотаймер (`autotimer.ts`) пишет время
 * автоматически при переходах стадий, но он не знает о работе, которая
 * шла между переходами: разговор с клиентом, переписка с поставщиком,
 * пересбор плана. Без ручной правки «часы на заказ» систематически
 * занижены, а §9 называет учёт времени функцией первого класса.
 *
 * `source: 'manual'` (колонка была в схеме с самого начала и до сих пор
 * всегда заполнялась значением `'auto'`) отличает такую запись от
 * автоматической — на экране они показаны раздельно, чтобы правка не
 * выглядела замером.
 */

export async function addManualTimeEntry(
  orderId: string,
  stage: string,
  minutes: number,
  reason: string,
): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  if (actor !== 'concierge' && actor !== 'admin') {
    return { ok: false, error: 'Учёт времени ведёт только staff' };
  }
  if (!(stage in TIME_ENTRY_STAGE_LABEL)) {
    return { ok: false, error: 'Неизвестная стадия учёта' };
  }
  if (!Number.isFinite(minutes) || minutes === 0) {
    return { ok: false, error: 'Укажите количество минут' };
  }
  // Отрицательные значения разрешены намеренно: корректировка — это и
  // «забыл записать», и «автотаймер посчитал лишнего», а вторая половина
  // без минуса невыразима.
  if (Math.abs(minutes) > 8 * 60) {
    return { ok: false, error: 'Правка больше рабочего дня — разбейте на несколько записей' };
  }
  const correctionReason = reason.trim();
  if (correctionReason.length < 5 || correctionReason.length > 1000) {
    return { ok: false, error: 'Укажите причину правки от 5 до 1000 символов' };
  }

  const supabase = await createSupabaseServerClient();
  const { data: order } = await supabase
    .from('orders')
    .select('state')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return { ok: false, error: 'Заказ не найден' };
  if (order.state === 'closed' || order.state === 'cancelled') {
    return { ok: false, error: 'В закрытый или отменённый заказ нельзя добавлять время' };
  }
  const { error } = await supabase.from('time_entries').insert({
    order_id: orderId,
    user_id: user.id,
    stage,
    seconds: Math.round(minutes * 60),
    source: 'manual',
    correction_reason: correctionReason,
  });
  if (error) return actionFailure('time.addManualTimeEntry', error);

  revalidatePath(`/concierge/orders/${orderId}`);
  revalidatePath('/metrics');
  return { ok: true };
}

/**
 * Записывает один heartbeat активной работы. Суммирование, cap в 60 секунд и
 * идемпотентность interval_id выполняются в PostgreSQL, поэтому две вкладки
 * или повтор server action не могут размножить часы локальным счётчиком.
 */
export async function heartbeatActiveTime(
  orderId: string,
  stage: string,
  intervalId: string,
  startedAt: string,
): Promise<ActionResult> {
  const user = await requireCurrentUser();
  const actor = orderActorFor(user);
  if (actor !== 'concierge' && actor !== 'admin') {
    return { ok: false, error: 'Активный учёт ведёт только staff' };
  }
  if (!/^[0-9a-f-]{16,120}$/i.test(orderId) || !/^[0-9a-f-]{16,120}$/i.test(intervalId)) {
    return { ok: false, error: 'Идентификатор активного интервала указан некорректно' };
  }
  if (!(stage in TIME_ENTRY_STAGE_LABEL)) {
    return { ok: false, error: 'Неизвестная стадия учёта' };
  }
  const parsedStartedAt = new Date(startedAt);
  if (!startedAt || Number.isNaN(parsedStartedAt.getTime())) {
    return { ok: false, error: 'Начало активного интервала указано некорректно' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('record_active_time_heartbeat', {
    p_order_id: orderId,
    p_stage: stage,
    p_interval_id: intervalId,
    p_started_at: parsedStartedAt.toISOString(),
  });
  if (error) return actionFailure('time.heartbeatActiveTime', error);
  return { ok: true };
}
