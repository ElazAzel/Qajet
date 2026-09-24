import type { SupabaseClient } from '@supabase/supabase-js';
import { pluralizeRu } from './pluralize';

/**
 * Журнал споров — agents.md §10 «Админ → Споры». Состояние `disputed`
 * существует в графе с самого начала (packages/engine/src/order/transition.ts),
 * но нигде не собрано отдельным списком — консьерж видит спорный заказ
 * только если сам на него попадёт со своей доски.
 */

export interface DisputeRow {
  orderId: string;
  requestTitle: string;
  buyerCompany: string;
  disputedAt: string | null;
  disputedNote: string | null;
  isResolved: boolean;
  /** Консьерж, за которым заказ; null — не назначен. */
  conciergeName: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Как давно спор ждёт решения — целые сутки с момента открытия. */
export function disputeAgeLabel(disputedAt: string | null, now: Date = new Date()): string {
  if (!disputedAt) return 'дата открытия неизвестна';
  const days = Math.floor((now.getTime() - Date.parse(disputedAt)) / DAY_MS);
  if (!Number.isFinite(days)) return 'дата открытия неизвестна';
  if (days < 1) return 'открыт сегодня';
  return `открыт ${days} ${pluralizeRu(days, 'день', 'дня', 'дней')}`;
}

export async function loadAdminDisputes(supabase: SupabaseClient): Promise<DisputeRow[]> {
  // Источник списка — событие «стал disputed», а не текущее состояние
  // заказа: заказ, для которого спор уже разрешён (accepted/cancelled),
  // обязан остаться в журнале, поэтому фильтровать по списку конечных
  // состояний было бы хрупко — проще идти от факта, что спор был.
  const { data: eventRows } = await supabase
    .from('order_stage_events')
    .select(
      'order_id, at, note, orders(state, concierge_user_id, requests(title, companies(name)))',
    )
    .eq('to_state', 'disputed')
    .order('at', { ascending: false });

  // Имена консьержей — отдельным запросом по id: у orders несколько ссылок на
  // users, и встраивание по имени связи было бы хрупким.
  const conciergeIds = [
    ...new Set(
      (eventRows ?? [])
        .map((row) => {
          const order = Array.isArray(row.orders) ? row.orders[0] : row.orders;
          return (order?.concierge_user_id as string | null) ?? null;
        })
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const { data: conciergeRows } =
    conciergeIds.length > 0
      ? await supabase.from('users').select('id, full_name').in('id', conciergeIds)
      : { data: [] as { id: string; full_name: string }[] };
  const conciergeNameById = new Map((conciergeRows ?? []).map((u) => [u.id, u.full_name]));

  return (eventRows ?? []).map((row) => {
    const order = Array.isArray(row.orders) ? row.orders[0] : row.orders;
    const request = order
      ? Array.isArray(order.requests)
        ? order.requests[0]
        : order.requests
      : null;
    const company = request
      ? Array.isArray(request.companies)
        ? request.companies[0]
        : request.companies
      : null;
    return {
      orderId: row.order_id,
      requestTitle: request?.title ?? '—',
      buyerCompany: company?.name ?? '—',
      disputedAt: row.at,
      disputedNote: row.note,
      isResolved: order?.state !== 'disputed',
      conciergeName: order?.concierge_user_id
        ? (conciergeNameById.get(order.concierge_user_id) ?? null)
        : null,
    };
  });
}
