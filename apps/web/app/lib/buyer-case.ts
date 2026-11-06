import type { SupabaseClient } from '@supabase/supabase-js';
import { type CaseDescription, describeCase, isBuyerTurn } from './buyer-stage';
import { checkedQuery, readInBatches, readQueryRows } from './data/query-rows';
import type { OrderState } from './order-state';

/**
 * Закупка покупателя — производная модель поверх `requests` и `orders`, без
 * новой таблицы. Ключ — заявка: она появляется в момент отправки формы и живёт
 * до закрытия, тогда как заказ создаётся позже, когда консьерж берёт заявку в
 * работу. Раньше все экраны покупателя строились от заказа, и заявка после
 * отправки исчезала: не было ни адреса, ни строки в списке, ни статуса.
 *
 * Доступ решает RLS покупателя (`requests_select_own_company` и связанные
 * политики): здесь нет отдельного фильтра по компании.
 */

export interface BuyerCaseSummary {
  requestId: string;
  orderId: string | null;
  title: string;
  description: CaseDescription;
  /** Ожидаемая дата: срок утверждённого/предложенного плана, иначе желаемая дата покупателя. */
  expectedAt: string | null;
  updatedAt: string;
}

export interface BuyerCaseItem {
  id: string;
  name: string;
  qty: number;
  unit: string;
}

export interface BuyerCaseDetail extends BuyerCaseSummary {
  city: string | null;
  budgetKzt: number | null;
  deliveryAddress: string | null;
  createdAt: string;
  items: BuyerCaseItem[];
}

interface OrderEmbed {
  id: string;
  state: string;
  updated_at: string;
}

function firstOrder(embed: OrderEmbed | OrderEmbed[] | null | undefined): OrderEmbed | null {
  if (!embed) return null;
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

/** Закупки, где ход за покупателем, идут первыми; остальные — по свежести. */
export function sortCases<T extends BuyerCaseSummary>(cases: T[]): T[] {
  return [...cases].sort((a, b) => {
    const turn = Number(isBuyerTurn(b.description)) - Number(isBuyerTurn(a.description));
    if (turn !== 0) return turn;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export async function loadBuyerCases(
  supabase: SupabaseClient,
  isOwner: boolean,
): Promise<BuyerCaseSummary[]> {
  const requests = await readQueryRows(() =>
    supabase
      .from('requests')
      .select('id, title, status, deadline_date, updated_at, orders(id, state, updated_at)'),
  );
  if (requests.length === 0) return [];

  const planRows = await readInBatches(
    requests.map((row) => row.id),
    (ids) =>
      readQueryRows(() =>
        supabase
          .from('plans')
          .select('id, request_id, eta_date, version')
          .in('request_id', ids)
          .in('status', ['proposed', 'approved']),
      ),
  );
  planRows.sort((a, b) => b.version - a.version || a.id.localeCompare(b.id));
  const etaByRequest = new Map<string, string>();
  for (const plan of planRows ?? []) {
    if (plan.eta_date && !etaByRequest.has(plan.request_id)) {
      etaByRequest.set(plan.request_id, plan.eta_date);
    }
  }

  return sortCases(
    requests.map((row) => {
      const order = firstOrder(row.orders as OrderEmbed | OrderEmbed[] | null);
      return {
        requestId: row.id,
        orderId: order?.id ?? null,
        title: row.title,
        description: describeCase({
          requestStatus: row.status,
          orderState: (order?.state as OrderState | undefined) ?? null,
          isOwner,
        }),
        expectedAt: etaByRequest.get(row.id) ?? row.deadline_date ?? null,
        updatedAt:
          order?.updated_at && order.updated_at > row.updated_at
            ? order.updated_at
            : row.updated_at,
      };
    }),
  );
}

export async function loadBuyerCase(
  supabase: SupabaseClient,
  requestId: string,
  isOwner: boolean,
): Promise<BuyerCaseDetail | null> {
  const { data: request } = await checkedQuery(
    supabase
      .from('requests')
      .select(
        'id, title, status, city, budget_kzt, delivery_address, deadline_date, created_at, updated_at',
      )
      .eq('id', requestId)
      .maybeSingle(),
  );
  if (!request) return null;

  const [{ data: order }, items, { data: plan }] = await Promise.all([
    checkedQuery(
      supabase
        .from('orders')
        .select('id, state, updated_at')
        .eq('request_id', requestId)
        .maybeSingle(),
    ),
    readQueryRows(() =>
      supabase
        .from('request_items')
        .select('id, name, qty, unit, created_at')
        .eq('request_id', requestId),
    ),
    checkedQuery(
      supabase
        .from('plans')
        .select('eta_date')
        .eq('request_id', requestId)
        .in('status', ['proposed', 'approved'])
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
  ]);

  return {
    requestId: request.id,
    orderId: order?.id ?? null,
    title: request.title,
    description: describeCase({
      requestStatus: request.status,
      orderState: (order?.state as OrderState | undefined) ?? null,
      isOwner,
    }),
    expectedAt: plan?.eta_date ?? request.deadline_date ?? null,
    updatedAt:
      order?.updated_at && order.updated_at > request.updated_at
        ? order.updated_at
        : request.updated_at,
    city: request.city,
    budgetKzt: request.budget_kzt,
    deliveryAddress: request.delivery_address,
    createdAt: request.created_at,
    items: items
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      .map((item) => ({
        id: item.id,
        name: item.name,
        qty: item.qty,
        unit: item.unit,
      })),
  };
}
