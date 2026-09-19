import type { SupabaseClient } from '@supabase/supabase-js';
import { CATEGORY_LABEL, type CatalogCategory } from './catalog';

/**
 * Аналитика закупок покупателя, в том числе по сотрудникам — agents.md
 * §10 «Покупатель». Маршрута не было даже в комментариях-заглушках layout
 * — не упомянут ни разу.
 *
 * Сумма закупки берётся из `orders.final_cost_kzt` (реальный итог со
 * сверкой), а не из `plans.total_kzt` (план до факта) — иначе аналитика
 * считала бы не то, что покупатель на самом деле заплатил.
 */

export interface EmployeeSpend {
  userId: string;
  fullName: string;
  ordersCount: number;
  totalKzt: number;
}

export interface CategorySpend {
  category: string;
  label: string;
  ordersCount: number;
  totalKzt: number;
}

export interface BuyerAnalytics {
  totalKzt: number;
  ordersCount: number;
  byEmployee: EmployeeSpend[];
  byCategory: CategorySpend[];
}

interface OrderRow {
  final_cost_kzt: number | null;
  requests: {
    created_by: string;
    users: { full_name: string } | { full_name: string }[] | null;
    request_items: { category: string }[] | null;
  } | null;
}

export async function loadBuyerAnalytics(supabase: SupabaseClient): Promise<BuyerAnalytics> {
  // RLS (orders_select_via_request → requests_select_own_company) уже
  // ограничивает выборку компанией текущего пользователя.
  const { data } = await supabase
    .from('orders')
    .select('final_cost_kzt, requests(created_by, users(full_name), request_items(category))')
    .eq('state', 'closed');

  const rows = (data ?? []) as unknown as OrderRow[];

  const byEmployeeMap = new Map<string, EmployeeSpend>();
  const byCategoryMap = new Map<string, CategorySpend>();
  let totalKzt = 0;

  for (const row of rows) {
    const amount = row.final_cost_kzt ?? 0;
    totalKzt += amount;
    const request = row.requests;
    if (!request) continue;

    const author = Array.isArray(request.users) ? request.users[0] : request.users;
    const employee = byEmployeeMap.get(request.created_by) ?? {
      userId: request.created_by,
      fullName: author?.full_name ?? '—',
      ordersCount: 0,
      totalKzt: 0,
    };
    employee.ordersCount += 1;
    employee.totalKzt += amount;
    byEmployeeMap.set(request.created_by, employee);

    // Категория берётся по первой позиции заявки — заказы в демо-истории и
    // в реальной практике однокатегорийны (см. buildQuotesReceivedDemoOrder).
    const category = request.request_items?.[0]?.category;
    if (category) {
      const entry = byCategoryMap.get(category) ?? {
        category,
        label: CATEGORY_LABEL[category as CatalogCategory] ?? category,
        ordersCount: 0,
        totalKzt: 0,
      };
      entry.ordersCount += 1;
      entry.totalKzt += amount;
      byCategoryMap.set(category, entry);
    }
  }

  return {
    totalKzt,
    ordersCount: rows.length,
    byEmployee: [...byEmployeeMap.values()].sort((a, b) => b.totalKzt - a.totalKzt),
    byCategory: [...byCategoryMap.values()].sort((a, b) => b.totalKzt - a.totalKzt),
  };
}
