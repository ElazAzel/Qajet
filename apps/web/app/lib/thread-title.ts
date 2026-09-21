/**
 * Как называется переписка в списке.
 *
 * У треда есть и `order_id`, и `request_id`: беседа начинается по заявке и
 * продолжается по заказу, когда тот появляется. Заголовок надо брать из обоих
 * источников, иначе до превращения заявки в заказ все строки списка выглядят
 * одинаково и человек не понимает, какая из них про какую закупку (аудит F5).
 */

export interface ThreadTitleSources {
  /** Название заявки, добытое через заказ треда. */
  orderRequestTitle: string | null | undefined;
  /** Название заявки, на которую тред ссылается напрямую. */
  ownRequestTitle: string | null | undefined;
}

/**
 * Заглушка намеренно НЕ «Заказ»: такое слово выглядит настоящим названием и
 * делает строки неразличимыми. «Без названия» честно говорит, что названия нет.
 */
const FALLBACK = 'Без названия';

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function threadTitle({ orderRequestTitle, ownRequestTitle }: ThreadTitleSources): string {
  return clean(orderRequestTitle) ?? clean(ownRequestTitle) ?? FALLBACK;
}
