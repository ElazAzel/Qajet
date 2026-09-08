import type { StampTone } from '@qajet/ui/motion';

/**
 * Человеко-читаемые подписи и тон пилюли для каждой стадии заказа —
 * agents.md §6, машина состояний дословно. Общий источник для доски
 * консьержа, карточки заказа и (позже) таймлайна покупателя, чтобы стадия
 * не переводилась в разных местах по-разному.
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

export const ORDER_STATE_LABEL: Record<OrderState, string> = {
  draft: 'Черновик',
  estimated: 'Оценён',
  prepaid: 'Предоплачен',
  rfq_sent: 'RFQ отправлен',
  quotes_received: 'КП получены',
  plan_proposed: 'План предложен',
  plan_approved: 'План утверждён',
  suppliers_paid: 'Поставщики оплачены',
  in_production: 'В производстве',
  shipped: 'Отгружен',
  delivered: 'Доставлен',
  accepted: 'Принят',
  closed: 'Закрыт',
  awaiting_internal_approval: 'Ждёт согласования',
  on_hold: 'На паузе',
  cancelled: 'Отменён',
  disputed: 'Спор',
};

export const ORDER_STATE_TONE: Record<OrderState, StampTone> = {
  draft: 'neutral',
  estimated: 'progress',
  prepaid: 'progress',
  rfq_sent: 'progress',
  quotes_received: 'pending',
  plan_proposed: 'pending',
  plan_approved: 'progress',
  suppliers_paid: 'progress',
  in_production: 'progress',
  shipped: 'done',
  delivered: 'done',
  accepted: 'success',
  closed: 'success',
  awaiting_internal_approval: 'pending',
  on_hold: 'neutral',
  cancelled: 'neutral',
  disputed: 'signal',
};

/**
 * Стадии, на которых разрешена правка позиций заявки (просмотр/split/merge/
 * коррекция категории — волна 1, шаги 2-3-6-7-8). После rfq_sent
 * quote_lines/plan_lines уже могут ссылаться на request_items с
 * onDelete:'restrict' — split/merge стал бы небезопасен, поэтому единое
 * окно редактирования для всех этих действий, не разное для каждого.
 */
export const ITEMS_EDITABLE_STATES: readonly OrderState[] = ['draft', 'estimated', 'prepaid'];

/** Порядок приоритета для доски консьержа — что горит, всплывает наверх. */
export const ORDER_STATE_PRIORITY: Record<OrderState, number> = {
  disputed: 0,
  quotes_received: 1,
  plan_proposed: 2,
  awaiting_internal_approval: 3,
  on_hold: 4,
  rfq_sent: 5,
  estimated: 6,
  draft: 7,
  prepaid: 8,
  plan_approved: 9,
  suppliers_paid: 10,
  in_production: 11,
  shipped: 12,
  delivered: 13,
  accepted: 14,
  closed: 15,
  cancelled: 16,
};
