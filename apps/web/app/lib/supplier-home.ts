import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Дашборд поставщика — agents.md §10. RLS уже сужает выборки до своей
 * компании (rfqs_select_own_supplier, orders_select_supplier_in_plan,
 * supplier_payouts_select_own_supplier) — здесь нет отдельных .eq по
 * company_id для этих трёх таблиц, кроме supplier_stats (его select-policy
 * открыта всем аутентифицированным, agents.md §10: рейтинг поставщика виден
 * покупателю при сравнении — поэтому фильтр по своей компании нужен явно).
 */

export interface SupplierRfqRow {
  id: string;
  requestTitle: string;
  buyerCompany: string;
  itemsSummary: string;
  respondBy: string | null;
  isExploration: boolean;
  assignedSupplierUserId: string | null;
  assignedSupplierUserName: string | null;
}

export interface SupplierTeamMemberOption {
  id: string;
  fullName: string;
  role: string;
}

export interface SupplierOrderRow {
  id: string;
  title: string;
  buyerCompany: string;
  state: string;
  etaDate: string | null;
}

export interface SupplierHomeData {
  pendingRfqs: SupplierRfqRow[];
  activeOrders: SupplierOrderRow[];
  totalPayoutsKzt: number;
  avgBuyerScore: number | null;
  supplierMembers: SupplierTeamMemberOption[];
}

export async function loadSupplierHome(
  supabase: SupabaseClient,
  companyId: string | null,
): Promise<SupplierHomeData> {
  const [
    { data: rfqRows },
    { data: orderRows },
    { data: payoutRows },
    statsResult,
    { data: supplierMembers },
  ] = await Promise.all([
    supabase
      .from('rfqs')
      .select(
        'id, assigned_supplier_user_id, respond_by, is_exploration, requests(title, companies(name), request_items(name, qty, unit))',
      )
      .eq('status', 'sent')
      .order('respond_by', { ascending: true }),
    supabase
      .from('orders')
      .select('id, state, requests(title, companies(name)), plans(eta_date)')
      .not('state', 'in', '(closed,cancelled)'),
    supabase.from('supplier_payouts').select('amount_kzt').eq('status', 'paid'),
    companyId
      ? supabase
          .from('supplier_stats')
          .select('avg_buyer_score')
          .eq('company_id', companyId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    companyId
      ? supabase
          .from('users')
          .select('id, full_name, role')
          .eq('company_id', companyId)
          .eq('is_active', true)
          .in('role', ['owner', 'manager'])
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [] as { id: string; full_name: string; role: string }[] }),
  ]);

  const memberNameById = new Map(
    (supplierMembers ?? []).map((member) => [member.id, member.full_name]),
  );

  const pendingRfqs: SupplierRfqRow[] = (rfqRows ?? []).map((row) => {
    const request = Array.isArray(row.requests) ? row.requests[0] : row.requests;
    const company = request
      ? Array.isArray(request.companies)
        ? request.companies[0]
        : request.companies
      : null;
    const items = request?.request_items ?? [];
    const firstItem = items[0];
    const itemsSummary =
      items.length === 0
        ? '—'
        : items.length === 1 && firstItem
          ? `${firstItem.qty} ${firstItem.unit} · ${firstItem.name}`
          : `${items.length} позиций`;
    return {
      id: row.id,
      requestTitle: request?.title ?? '—',
      buyerCompany: company?.name ?? '—',
      itemsSummary,
      respondBy: row.respond_by,
      isExploration: row.is_exploration,
      assignedSupplierUserId: row.assigned_supplier_user_id,
      assignedSupplierUserName: row.assigned_supplier_user_id
        ? (memberNameById.get(row.assigned_supplier_user_id) ?? null)
        : null,
    };
  });

  const activeOrders: SupplierOrderRow[] = (orderRows ?? []).map((row) => {
    const request = Array.isArray(row.requests) ? row.requests[0] : row.requests;
    const company = request
      ? Array.isArray(request.companies)
        ? request.companies[0]
        : request.companies
      : null;
    const plan = Array.isArray(row.plans) ? row.plans[0] : row.plans;
    return {
      id: row.id,
      title: request?.title ?? '—',
      buyerCompany: company?.name ?? '—',
      state: row.state,
      etaDate: plan?.eta_date ?? null,
    };
  });

  const totalPayoutsKzt = (payoutRows ?? []).reduce((sum, r) => sum + r.amount_kzt, 0);

  return {
    pendingRfqs,
    activeOrders,
    totalPayoutsKzt,
    avgBuyerScore: statsResult.data?.avg_buyer_score ?? null,
    supplierMembers: (supplierMembers ?? []).map((member) => ({
      id: member.id,
      fullName: member.full_name,
      role: member.role,
    })),
  };
}
