/**
 * Машина состояний заказа — agents.md §6: «Переходы состояний — единственная
 * функция transition(order, to, actor), прямые update state из UI
 * отсутствуют физически.»
 *
 * Граф рёбер и то, какой актёр их совершает, взят дословно из
 * packages/db/src/seed/generator.ts (единственная существующая
 * авторитетная модель жизненного цикла — по ней уже сгенерирована и
 * проверена демо-история 24 заказов): концьерж выполняет все операционные
 * шаги (оценка → RFQ → КП → предложение плана → оплата поставщиков →
 * производство → отгрузка → доставка), покупатель — только решающие точки
 * (утверждение плана, приёмка, закрытие, спор, отмена). Поставщик в этой
 * модели не инициирует переходы состояния заказа напрямую — только
 * подтверждает возможность в самом КП (agents.md §10).
 *
 * Рёбра возобновления из awaiting_internal_approval/on_hold/disputed в
 * generator.ts не встречаются (там демо-история просто останавливается на
 * целевой стадии) — они добавлены здесь по смыслу состояний, без выдумки
 * новых процессов.
 */

export type OrderState =
  | 'draft'
  | 'estimated'
  | 'prepaid'
  | 'rfq_sent'
  | 'quotes_received'
  | 'plan_proposed'
  | 'plan_approved'
  | 'suppliers_paid'
  | 'in_production'
  | 'shipped'
  | 'delivered'
  | 'accepted'
  | 'closed'
  | 'awaiting_internal_approval'
  | 'on_hold'
  | 'cancelled'
  | 'disputed';

/** Кто совершает переход. 'admin' допущен везде, где допущен 'concierge' — staff. */
export type OrderActor = 'buyer' | 'concierge' | 'supplier' | 'admin';

interface Edge {
  to: OrderState;
  actors: readonly OrderActor[];
}

const STAFF: readonly OrderActor[] = ['concierge', 'admin'];
const BUYER_OR_STAFF: readonly OrderActor[] = ['buyer', 'concierge', 'admin'];

/** Единственный источник истины для графа — используется и здесь, и в SQL-триггере (см. RLS-миграцию). */
export const ORDER_TRANSITION_GRAPH: Record<OrderState, readonly Edge[]> = {
  draft: [{ to: 'estimated', actors: STAFF }],
  estimated: [{ to: 'prepaid', actors: STAFF }],
  prepaid: [{ to: 'rfq_sent', actors: STAFF }],
  rfq_sent: [
    { to: 'quotes_received', actors: STAFF },
    { to: 'cancelled', actors: BUYER_OR_STAFF },
  ],
  quotes_received: [{ to: 'plan_proposed', actors: STAFF }],
  plan_proposed: [
    { to: 'plan_approved', actors: ['buyer'] },
    { to: 'awaiting_internal_approval', actors: ['buyer'] },
    { to: 'cancelled', actors: BUYER_OR_STAFF },
  ],
  awaiting_internal_approval: [
    { to: 'plan_approved', actors: ['buyer'] },
    { to: 'cancelled', actors: BUYER_OR_STAFF },
  ],
  plan_approved: [
    { to: 'suppliers_paid', actors: STAFF },
    { to: 'on_hold', actors: STAFF },
    { to: 'cancelled', actors: STAFF },
  ],
  on_hold: [
    { to: 'suppliers_paid', actors: STAFF },
    { to: 'cancelled', actors: STAFF },
  ],
  suppliers_paid: [{ to: 'in_production', actors: STAFF }],
  in_production: [{ to: 'shipped', actors: STAFF }],
  shipped: [{ to: 'delivered', actors: STAFF }],
  delivered: [
    { to: 'accepted', actors: ['buyer'] },
    { to: 'disputed', actors: BUYER_OR_STAFF },
  ],
  // Спор завершается приёмкой или отменой — но не паузой. Ребро
  // disputed → on_hold существовало и было дефектом: из on_hold выход
  // только в suppliers_paid, то есть уже доставленный и оспоренный заказ
  // возвращался к стадии «поставщики оплачены», назад по жизненному циклу.
  // Найдено и честно описано в журнале 2026-09-08, но не исправлено.
  disputed: [
    { to: 'accepted', actors: STAFF },
    { to: 'cancelled', actors: STAFF },
  ],
  accepted: [{ to: 'closed', actors: BUYER_OR_STAFF }],
  closed: [],
  cancelled: [],
};

/** Стадии учёта времени — agents.md §9, дословно её список. */
export type TimeEntryStage =
  | 'intake'
  | 'sourcing'
  | 'normalization'
  | 'approval'
  | 'execution'
  | 'exception'
  | 'closing';

/**
 * Состояние заказа → стадия учёта времени (§9). Живёт рядом с графом
 * состояний, а не в apps/web: по этой карте пишут и автотаймер
 * (apps/web/app/lib/autotimer.ts), и генератор сида
 * (packages/db/src/seed/generator.ts) — две копии разошлись бы молча,
 * а расхождение здесь означало бы, что демо-история и живая работа
 * считают «часы на заказ» по-разному.
 */
export const TIME_ENTRY_STAGE_BY_STATE: Record<OrderState, TimeEntryStage> = {
  draft: 'intake',
  estimated: 'intake',
  prepaid: 'sourcing',
  rfq_sent: 'sourcing',
  quotes_received: 'normalization',
  plan_proposed: 'normalization',
  awaiting_internal_approval: 'normalization',
  plan_approved: 'approval',
  suppliers_paid: 'execution',
  in_production: 'execution',
  shipped: 'execution',
  delivered: 'execution',
  accepted: 'closing',
  closed: 'closing',
  on_hold: 'exception',
  disputed: 'exception',
  cancelled: 'exception',
};

export type TransitionResult = { ok: true } | { ok: false; reason: string };

/**
 * Единственная точка проверки допустимости перехода — вызывающий код
 * (server action) обязан проверить это ДО записи в БД, а не полагаться
 * только на UI, которое просто не рисует недопустимую кнопку.
 */
export function transition(from: OrderState, to: OrderState, actor: OrderActor): TransitionResult {
  const edge = ORDER_TRANSITION_GRAPH[from]?.find((e) => e.to === to);
  if (!edge) {
    return { ok: false, reason: `Переход ${from} → ${to} не существует в машине состояний` };
  }
  if (!edge.actors.includes(actor)) {
    return {
      ok: false,
      reason: `Роль «${actor}» не может выполнить переход ${from} → ${to} (допущены: ${edge.actors.join(', ')})`,
    };
  }
  return { ok: true };
}

/** Список допустимых следующих состояний для данного актёра — рисует кнопки в UI. */
export function nextStatesFor(from: OrderState, actor: OrderActor): OrderState[] {
  return (ORDER_TRANSITION_GRAPH[from] ?? [])
    .filter((e) => e.actors.includes(actor))
    .map((e) => e.to);
}
