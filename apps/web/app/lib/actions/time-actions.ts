'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
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

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('time_entries').insert({
    order_id: orderId,
    user_id: user.id,
    stage,
    seconds: Math.round(minutes * 60),
    source: 'manual',
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/concierge/orders/${orderId}`);
  revalidatePath('/metrics');
  return { ok: true };
}
