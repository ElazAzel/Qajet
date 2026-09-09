import { TIME_ENTRY_STAGE_BY_STATE } from '@qajet/engine/order';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrderActor } from './current-user';
import type { OrderState } from './order-state';

/**
 * Автотаймер консьержа (agents.md §9: «учёт времени как функция первого
 * класса, а не метрика») — до этой правки `time_entries` существовала в
 * схеме (RLS уже staffOnly insert), но ничто в apps/web в неё не писало
 * (README «Известные ограничения» честно фиксировал именно это). Вместо
 * ручного старт/стоп-таймера на клиенте (спека §9 упоминает «пауза после
 * 60с бездействия» — отдельный клиентский механизм, не собран в этом
 * заходе) — таймер автоматический и серверный: при каждом
 * staff-инициированном переходе стадии заказа пишется время, реально
 * проведённое в ПРЕДЫДУЩЕЙ стадии (now − момент входа в неё), без риска
 * потерять отсчёт при закрытой вкладке или разрыве сети. `source: 'auto'`
 * (столбец уже есть в схеме) отличает эту запись от гипотетической ручной
 * правки, если такая появится позже.
 */

/**
 * Пишет время, проведённое в состоянии `fromState`, при переходе на
 * следующую стадию. Только для staff-актёра — RLS `time_entries_insert_own`
 * (packages/db/src/schema/learning.ts) допускает вставку только
 * concierge/admin, вызывающий код в order-actions.ts поэтому проверяет
 * актёра до вызова, а не полагается только на отказ RLS.
 */
export async function logAutoTimeEntry(
  supabase: SupabaseClient,
  orderId: string,
  fromState: OrderState,
  actor: OrderActor,
  actorUserId: string,
): Promise<void> {
  if (actor !== 'concierge' && actor !== 'admin') return;

  const { data: previousEvent } = await supabase
    .from('order_stage_events')
    .select('at')
    .eq('order_id', orderId)
    .order('at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let sinceIso = previousEvent?.at as string | undefined;
  if (!sinceIso) {
    const { data: order } = await supabase
      .from('orders')
      .select('created_at')
      .eq('id', orderId)
      .maybeSingle();
    sinceIso = order?.created_at as string | undefined;
  }
  if (!sinceIso) return;

  const seconds = Math.round((Date.now() - new Date(sinceIso).getTime()) / 1000);
  if (seconds <= 0) return;

  await supabase.from('time_entries').insert({
    order_id: orderId,
    user_id: actorUserId,
    stage: TIME_ENTRY_STAGE_BY_STATE[fromState],
    seconds,
  });
}
