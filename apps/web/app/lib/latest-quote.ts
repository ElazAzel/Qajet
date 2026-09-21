/**
 * Одно правило выбора актуальной версии КП — на все экраны сразу.
 *
 * Поставщик отвечает версиями: после запроса исправления приходит версия 2, потом 3.
 * Сравнение, признак «заблокирован» на доске консьержа и статус на странице RFQ
 * обязаны смотреть на ОДНУ и ту же версию. Если они разойдутся, на одном экране
 * заказ будет выглядеть готовым, а на другом — нет, и это хуже любого из дефектов,
 * ради которых признак вводился.
 */

export interface QuoteVersionKey {
  id: string;
  rfq_id: string;
  version: number;
  submitted_at: string;
}

/**
 * Старшинство: сначала номер версии, при равенстве — время отправки, при равенстве
 * и его — идентификатор. Последняя ступень нужна не для красоты: внутри одной
 * транзакции now() одинаков, поэтому две версии могут иметь одно время, и без
 * устойчивого разрыва выбор зависел бы от порядка строк в ответе базы.
 */
function isNewer(candidate: QuoteVersionKey, current: QuoteVersionKey): boolean {
  if (candidate.version !== current.version) return candidate.version > current.version;
  if (candidate.submitted_at !== current.submitted_at) {
    return candidate.submitted_at > current.submitted_at;
  }
  return candidate.id > current.id;
}

/** Актуальная версия КП по каждому RFQ. */
export function pickLatestQuoteByRfq<T extends QuoteVersionKey>(
  quotes: readonly T[] | null | undefined,
): Map<string, T> {
  const latest = new Map<string, T>();
  for (const quote of quotes ?? []) {
    const current = latest.get(quote.rfq_id);
    if (!current || isNewer(quote, current)) latest.set(quote.rfq_id, quote);
  }
  return latest;
}
