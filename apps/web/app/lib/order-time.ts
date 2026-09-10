import type { TimeEntryStage } from '@qajet/engine/order';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Учёт времени по стадиям заказа — agents.md §10 «Консьерж → учёт времени
 * по стадиям» и §9 (учёт времени как функция первого класса).
 *
 * Читающая часть живёт здесь, а не в `actions/time-actions.ts`: файл с
 * `'use server'` может экспортировать только async-функции, и подписи
 * стадий вместе с типом строки в нём падали ошибкой сборки.
 */

export const TIME_ENTRY_STAGE_LABEL: Record<TimeEntryStage, string> = {
  intake: 'Приём заявки',
  sourcing: 'Подбор поставщиков',
  normalization: 'Сведение КП',
  approval: 'Согласование',
  execution: 'Исполнение',
  closing: 'Закрытие',
  exception: 'Исключения',
};

/** Порядок — по ходу жизненного цикла: таблица читается сверху вниз как история работы. */
const STAGE_ORDER: readonly TimeEntryStage[] = [
  'intake',
  'sourcing',
  'normalization',
  'approval',
  'execution',
  'closing',
  'exception',
];

export interface StageTime {
  stage: TimeEntryStage;
  label: string;
  autoSeconds: number;
  manualSeconds: number;
}

export async function loadOrderTime(
  supabase: SupabaseClient,
  orderId: string,
): Promise<StageTime[]> {
  const { data } = await supabase
    .from('time_entries')
    .select('stage, seconds, source')
    .eq('order_id', orderId);

  const byStage = new Map<TimeEntryStage, StageTime>();
  for (const row of data ?? []) {
    const stage = row.stage as TimeEntryStage;
    const current = byStage.get(stage) ?? {
      stage,
      label: TIME_ENTRY_STAGE_LABEL[stage],
      autoSeconds: 0,
      manualSeconds: 0,
    };
    // Автоматическое и ручное складываются раздельно: правка консьержа не
    // должна выглядеть замером автотаймера.
    if (row.source === 'manual') current.manualSeconds += row.seconds;
    else current.autoSeconds += row.seconds;
    byStage.set(stage, current);
  }

  return STAGE_ORDER.filter((stage) => byStage.has(stage)).map(
    (stage) => byStage.get(stage) as StageTime,
  );
}
