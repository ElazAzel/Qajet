import type { SupabaseClient } from '@supabase/supabase-js';
import { CATALOG, CATEGORY_LABEL, type CatalogCategory } from './catalog';

/**
 * Повтор заказа — agents.md §10 «Покупатель»: «повтор заказа в один клик с
 * новым количеством — по истории СВОИХ заказов, не по каталогу
 * исполнителей». До этого экран показывал четыре выдуманные карточки
 * («Футболки с логотипом, 50 шт, июль 2026»), которых в базе никогда не
 * было — покупателю предъявлялась несуществующая история его же закупок.
 *
 * RLS (`requests_select_own_company`) сама ограничивает выборку компанией
 * текущего пользователя, отдельного .eq по company_id здесь нет —
 * фильтрация уже произошла на уровне Postgres.
 *
 * Позиции сводятся по названию: одна и та же номенклатура заказывалась
 * много раз с разным тиражом, и повторять интересно именно её, а не
 * конкретную старую заявку целиком.
 */

const CATALOG_KEY_BY_NAME = new Map(CATALOG.map((item) => [item.name, item.itemKey]));

export interface ReorderCandidate {
  name: string;
  /** null → позиции больше нет в каталоге, повторить одним кликом нельзя. */
  itemKey: string | null;
  categoryLabel: string;
  timesOrdered: number;
  lastQty: number;
  lastOrderedAt: string;
}

interface RequestRow {
  created_at: string;
  orders: { state: string }[] | { state: string } | null;
}

interface ItemRow {
  name: string;
  category: string;
  qty: number;
  requests: RequestRow | RequestRow[] | null;
}

export async function loadReorderCandidates(supabase: SupabaseClient): Promise<ReorderCandidate[]> {
  // Исполненность читается по состоянию ЗАКАЗА, а не по `requests.status`.
  // Живой путь доводит заявку до 'closed' только начиная с этой ревизии
  // (см. advanceOrderStage), а исторические строки, закрытые до неё,
  // остались в 'estimated' — по ним экран показал бы пусто, хотя заказы
  // закрыты. Состояние заказа — единственный источник истины жизненного
  // цикла (agents.md §6), и он верен для любой строки независимо от того,
  // когда она была создана.
  const { data } = await supabase
    .from('request_items')
    .select('name, category, qty, requests(created_at, orders(state))');

  const byName = new Map<string, { row: ItemRow; at: string; count: number }>();
  for (const row of (data ?? []) as ItemRow[]) {
    const request = Array.isArray(row.requests) ? row.requests[0] : row.requests;
    if (!request) continue;
    const orders = Array.isArray(request.orders)
      ? request.orders
      : request.orders
        ? [request.orders]
        : [];
    // Повторять имеет смысл только то, что действительно было исполнено.
    if (!orders.some((o) => o.state === 'closed')) continue;
    const existing = byName.get(row.name);
    if (!existing) {
      byName.set(row.name, { row, at: request.created_at, count: 1 });
      continue;
    }
    existing.count += 1;
    if (request.created_at > existing.at) {
      existing.at = request.created_at;
      existing.row = row;
    }
  }

  return [...byName.values()]
    .map(({ row, at, count }) => ({
      name: row.name,
      itemKey: CATALOG_KEY_BY_NAME.get(row.name) ?? null,
      categoryLabel: CATEGORY_LABEL[row.category as CatalogCategory] ?? row.category,
      timesOrdered: count,
      lastQty: row.qty,
      lastOrderedAt: at,
    }))
    .sort(
      (a, b) => b.timesOrdered - a.timesOrdered || b.lastOrderedAt.localeCompare(a.lastOrderedAt),
    );
}
