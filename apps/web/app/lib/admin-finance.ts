import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Сверка предоплат/выплат/резервов — agents.md §10 «Админ → Финансы».
 * Маршрута не существовало, пункт убран из навигации как ведущий на 404.
 *
 * «Резерв» — сумма предоплаты, ещё не разнесённая в выплату поставщику:
 * это деньги, которые QAJET держит между приёмом оплаты от покупателя и
 * расчётом с поставщиком. Ровно то, что должна показывать сверка, а не
 * готовый агрегат где-то в схеме.
 */

export interface FinanceRow {
  requestId: string;
  requestTitle: string;
  buyerCompany: string;
  prepaidKzt: number;
  payoutKzt: number;
  prepaymentStatus: string | null;
  payoutStatus: string | null;
}

export interface FinanceSummary {
  totalPrepaidKzt: number;
  totalPaidOutKzt: number;
  reserveKzt: number;
  rows: FinanceRow[];
}

export async function loadAdminFinance(supabase: SupabaseClient): Promise<FinanceSummary> {
  const [{ data: prepaymentRows }, { data: payoutRows }] = await Promise.all([
    supabase
      .from('prepayments')
      .select('amount_kzt, status, requests(id, title, companies(name))')
      .order('created_at', { ascending: false }),
    supabase.from('supplier_payouts').select('amount_kzt, status, orders(request_id)'),
  ]);

  const payoutByRequest = new Map<string, { amount: number; status: string }>();
  for (const row of payoutRows ?? []) {
    const order = Array.isArray(row.orders) ? row.orders[0] : row.orders;
    if (!order) continue;
    const existing = payoutByRequest.get(order.request_id) ?? { amount: 0, status: row.status };
    existing.amount += row.amount_kzt;
    payoutByRequest.set(order.request_id, existing);
  }

  const rows: FinanceRow[] = (prepaymentRows ?? []).map((row) => {
    const request = Array.isArray(row.requests) ? row.requests[0] : row.requests;
    const company = request
      ? Array.isArray(request.companies)
        ? request.companies[0]
        : request.companies
      : null;
    const payout = request ? payoutByRequest.get(request.id) : undefined;
    return {
      requestId: request?.id ?? '',
      requestTitle: request?.title ?? '—',
      buyerCompany: company?.name ?? '—',
      prepaidKzt: row.amount_kzt,
      payoutKzt: payout?.amount ?? 0,
      prepaymentStatus: row.status,
      payoutStatus: payout?.status ?? null,
    };
  });

  const totalPrepaidKzt = rows.reduce((s, r) => s + r.prepaidKzt, 0);
  const totalPaidOutKzt = rows.reduce((s, r) => s + r.payoutKzt, 0);

  return {
    totalPrepaidKzt,
    totalPaidOutKzt,
    reserveKzt: totalPrepaidKzt - totalPaidOutKzt,
    rows,
  };
}
