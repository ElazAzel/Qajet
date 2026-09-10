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

interface ItemRow {
  name: string;
  category: string;
  qty: number;
  requests:
    | { status: string; created_at: string }
    | { status: string; created_at: string }[]
    | null;
}

export async function loadReorderCandidates(supabase: SupabaseClient): Promise<ReorderCandidate[]> {
  const { data } = await supabase
    .from('request_items')
    .select('name, category, qty, requests(status, created_at)');

  const byName = new Map<string, { row: ItemRow; at: string; count: number }>();
  for (const row of (data ?? []) as ItemRow[]) {
    const request = Array.isArray(row.requests) ? row.requests[0] : row.requests;
    // Повторять имеет смысл только то, что действительно было исполнено.
    if (!request || request.status !== 'closed') continue;
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
