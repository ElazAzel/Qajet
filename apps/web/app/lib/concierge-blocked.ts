import type { SupabaseClient } from '@supabase/supabase-js';
import { pickLatestQuoteByRfq } from './latest-quote';

/**
 * Заказы, по которым нельзя предложить план: ни одно КП не проходит допустимость.
 *
 * Зачем. Такой заказ выглядел на доске консьержа здоровым («КП получены») и не
 * попадал в «Исключения», потому что «все КП отбракованы» — не состояние заказа,
 * а вывод сравнения. Человек узнавал о тупике, только открыв заказ (аудит F1, F6).
 *
 * Почему проверка здесь ДЕШЕВЛЕ настоящей. Настоящая допустимость живёт в
 * packages/engine/src/combine/combine.ts и требует на каждый заказ надёжности
 * поставщиков, маршрута доставки и нескольких настроек — это семь запросов и
 * заметный счёт на каждую строку доски. Здесь проверяются только те признаки,
 * которые видны в самих строках КП.
 *
 * Отсюда свойство, на котором всё держится: набор дешёвых признаков — ПОДМНОЖЕСТВО
 * настоящих, поэтому **пометка не может солгать**. Если по позиции не проходит
 * ничего даже по дешёвым признакам, combine() вернёт пустой список планов.
 * Обратное неверно: заказ, заблокированный ТОЛЬКО просроченным сроком поставки,
 * здесь не пометится. Это сознательная недоговорённость, а не ошибка; она
 * записана в docs/qa/post-hardening-ux-audit.md.
 */

export interface BlockedRequestItem {
  id: string;
  request_id: string;
  name: string;
  qty: number;
}

export interface BlockedQuoteLine {
  request_item_id: string;
  capability_confirmed: boolean;
  field_flags: Record<string, unknown> | null;
  min_qty: number | null;
  quote: {
    id: string;
    rfq_id: string;
    version: number;
    submitted_at: string;
    valid_until: string | null;
  };
}

export interface BlockedRequest {
  requestId: string;
  blockingItemName: string;
}

/**
 * Чистая часть: по позициям и строкам КП говорит, какие заявки собрать нельзя.
 * Без Supabase — чтобы её можно было проверить тестом, а не только глазами.
 */
export function blockedRequests({
  items,
  lines,
  today,
}: {
  items: readonly BlockedRequestItem[];
  lines: readonly BlockedQuoteLine[];
  today: string;
}): Map<string, BlockedRequest> {
  // Актуальная версия КП по каждому RFQ — тем же правилом, что и экран сравнения.
  const latestQuoteIds = new Set(
    [...pickLatestQuoteByRfq(lines.map((line) => line.quote)).values()].map((quote) => quote.id),
  );

  const admissible = (line: BlockedQuoteLine, item: BlockedRequestItem): boolean => {
    if (!latestQuoteIds.has(line.quote.id)) return false;
    if (line.capability_confirmed !== true) return false;
    if (Object.keys(line.field_flags ?? {}).length > 0) return false;
    if (line.min_qty !== null && item.qty < line.min_qty) return false;
    if (line.quote.valid_until !== null && line.quote.valid_until < today) return false;
    return true;
  };

  const linesByItem = new Map<string, BlockedQuoteLine[]>();
  for (const line of lines) {
    const bucket = linesByItem.get(line.request_item_id);
    if (bucket) bucket.push(line);
    else linesByItem.set(line.request_item_id, [line]);
  }

  const itemsByRequest = new Map<string, BlockedRequestItem[]>();
  for (const item of items) {
    const bucket = itemsByRequest.get(item.request_id);
    if (bucket) bucket.push(item);
    else itemsByRequest.set(item.request_id, [item]);
  }

  const blocked = new Map<string, BlockedRequest>();
  for (const [requestId, requestItems] of itemsByRequest) {
    const blocking = requestItems.find(
      (item) => !(linesByItem.get(item.id) ?? []).some((line) => admissible(line, item)),
    );
    if (blocking) blocked.set(requestId, { requestId, blockingItemName: blocking.name });
  }
  return blocked;
}

export interface BlockedOrder {
  orderId: string;
  requestId: string;
  blockingItemName: string;
}

/**
 * Часть с запросами. Кандидаты — только заказы в `quotes_received`: это
 * единственная стадия, на которой консьерж собирает план и где тупик возможен.
 * При пустом списке кандидатов не делается ни одного запроса.
 *
 * Никогда не бросает исключение: загрузчик вызывается из layout консьержа, и
 * ошибка здесь положила бы все его маршруты. Молчаливый отказ означает «пометок
 * нет», то есть возврат к прежнему поведению, а не к сломанному экрану.
 */
export async function loadBlockedOrders(
  supabase: SupabaseClient,
  candidates: readonly { orderId: string; requestId: string }[],
): Promise<Map<string, BlockedOrder>> {
  const result = new Map<string, BlockedOrder>();
  if (candidates.length === 0) return result;

  const requestIds = [...new Set(candidates.map((candidate) => candidate.requestId))];

  try {
    const [{ data: itemRows }, { data: lineRows }] = await Promise.all([
      supabase
        .from('request_items')
        .select('id, request_id, name, qty')
        .in('request_id', requestIds),
      supabase
        .from('quote_lines')
        .select(
          'request_item_id, capability_confirmed, field_flags, min_qty, quotes!inner(id, rfq_id, version, submitted_at, valid_until, rfqs!inner(request_id))',
        )
        .in('quotes.rfqs.request_id', requestIds),
    ]);

    const lines: BlockedQuoteLine[] = [];
    for (const row of lineRows ?? []) {
      const quote = Array.isArray(row.quotes) ? row.quotes[0] : row.quotes;
      if (!quote) continue;
      lines.push({
        request_item_id: row.request_item_id,
        capability_confirmed: row.capability_confirmed,
        field_flags: row.field_flags,
        min_qty: row.min_qty,
        quote: {
          id: quote.id,
          rfq_id: quote.rfq_id,
          version: quote.version,
          submitted_at: quote.submitted_at,
          valid_until: quote.valid_until,
        },
      });
    }

    const blocked = blockedRequests({
      items: (itemRows ?? []) as BlockedRequestItem[],
      lines,
      today: new Date().toISOString().slice(0, 10),
    });

    for (const candidate of candidates) {
      const hit = blocked.get(candidate.requestId);
      if (hit) {
        result.set(candidate.orderId, {
          orderId: candidate.orderId,
          requestId: candidate.requestId,
          blockingItemName: hit.blockingItemName,
        });
      }
    }
  } catch {
    return new Map();
  }
  return result;
}
