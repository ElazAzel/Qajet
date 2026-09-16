import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Дашборд роста поставщика — agents.md §10 «Поставщик → дашборд роста».
 * Маршрута не существовало, пункт был убран из навигации как ведущий на
 * 404 (см. `apps/web/app/supplier/layout.tsx`).
 *
 * Смысл экрана — показать поставщику ровно те величины, по которым его
 * ранжирует матчер (packages/engine/src/match): доля отвеченных RFQ,
 * медиана времени ответа, доля заказов в срок, споры, средний балл. До
 * сих пор эти числа существовали, влияли на его поток заказов и были ему
 * не видны — то есть система оценивала его по правилам, которых он не
 * знал. Здесь они названы явно, вместе с тем, что каждое из них меняет.
 *
 * Ничего не досчитывается «на лету»: `supplier_stats` — это и есть
 * агрегат, который читает матчер. Показывать пересчитанное иначе значило
 * бы показать не то, по чему его судят.
 */

export interface GrowthMetric {
  key: string;
  label: string;
  value: string;
  /** Что именно эта величина меняет в подборе — без этого экран бесполезен. */
  effect: string;
}

export interface SupplierRatingRow {
  orderTitle: string;
  score: number;
  wasOnTime: boolean;
  hadDispute: boolean;
  comment: string | null;
  at: string;
}

export interface SupplierGrowth {
  metrics: GrowthMetric[];
  ordersTotal: number;
  ratings: SupplierRatingRow[];
}

function percent(part: number, whole: number): string {
  if (whole === 0) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

export async function loadSupplierGrowth(
  supabase: SupabaseClient,
  companyId: string | null,
): Promise<SupplierGrowth | null> {
  if (!companyId) return null;

  // supplier_stats виден всем аутентифицированным (рейтинг показывается
  // покупателю при сравнении), поэтому фильтр по своей компании — явный.
  // Для ratings политика уже сужает до своей компании, но .eq оставлен:
  // цена лишнего условия нулевая, а зависимость от чужой политики в коде
  // одного экрана — нет.
  const [{ data: stats }, { data: ratingRows }] = await Promise.all([
    supabase
      .from('supplier_stats')
      .select(
        'orders_total, orders_on_time, orders_disputed, avg_buyer_score, rfq_sent, rfq_answered, median_response_hours',
      )
      .eq('company_id', companyId)
      .maybeSingle(),
    supabase
      .from('ratings')
      .select(
        'buyer_score_1_5, was_on_time, had_dispute, comment, created_at, orders(requests(title))',
      )
      .eq('supplier_company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  if (!stats) return null;

  const metrics: GrowthMetric[] = [
    {
      key: 'response-rate',
      label: 'Отвечено на RFQ',
      value: percent(stats.rfq_answered, stats.rfq_sent),
      effect: `${stats.rfq_answered} из ${stats.rfq_sent}. Чем выше доля, тем чаще вы попадаете в подбор.`,
    },
    {
      key: 'response-speed',
      label: 'Медиана ответа',
      value: stats.median_response_hours !== null ? `${stats.median_response_hours} ч` : '—',
      effect: 'Быстрый ответ поднимает вас в очереди на следующий запрос той же категории.',
    },
    {
      key: 'on-time',
      label: 'Заказов в срок',
      value: percent(stats.orders_on_time, stats.orders_total),
      effect: `${stats.orders_on_time} из ${stats.orders_total}. Срыв срока увеличивает запас, который система закладывает на ваши сроки.`,
    },
    {
      key: 'disputes',
      label: 'Споров',
      value: String(stats.orders_disputed),
      effect:
        stats.orders_disputed === 0
          ? 'Ни одного спора — это самый весомый плюс в подборе.'
          : 'Каждый спор понижает вас в подборе надолго.',
    },
    {
      key: 'score',
      label: 'Средний балл',
      value: stats.avg_buyer_score !== null ? `${stats.avg_buyer_score} / 5` : '—',
      effect: 'Оценка покупателя после закрытия заказа. Виден покупателю при сравнении вариантов.',
    },
  ];

  const ratings: SupplierRatingRow[] = (ratingRows ?? []).map((row) => {
    const order = Array.isArray(row.orders) ? row.orders[0] : row.orders;
    const request = order
      ? Array.isArray(order.requests)
        ? order.requests[0]
        : order.requests
      : null;
    return {
      orderTitle: request?.title ?? '—',
      score: row.buyer_score_1_5,
      wasOnTime: row.was_on_time,
      hadDispute: row.had_dispute,
      comment: row.comment,
      at: row.created_at,
    };
  });

  return { metrics, ordersTotal: stats.orders_total, ratings };
}
