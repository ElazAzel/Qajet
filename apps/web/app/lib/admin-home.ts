import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Данные для /admin (agents.md §10 «Админ»: верификация и комплаенс
 * поставщиков) — раньше вся страница была хардкодом (STATS/VENDORS/USERS/
 * PAYOUTS прямо в page.tsx), найдено при UI-аудите. Тот же принцип, что и
 * apps/web/app/lib/metrics.ts: реальные запросы к Supabase, честные «нет
 * данных» вместо подставных чисел там, где данных действительно нет.
 */

export interface VerificationRow {
  companyId: string;
  name: string;
  category: string | null;
  city: string | null;
  submittedAt: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface RecentUserRow {
  userId: string;
  name: string;
  companyName: string | null;
  role: string;
}

export interface RecentPayoutRow {
  payoutId: string;
  orderTitle: string;
  supplierName: string;
  amountKzt: number;
}

export interface AdminHomeData {
  usersTotal: number;
  usersNewLast30d: number;
  suppliersTotal: number;
  suppliersNewLast30d: number;
  turnoverThisMonthKzt: number;
  turnoverLastMonthKzt: number;
  pendingVerificationCount: number;
  verificationQueue: VerificationRow[];
  recentUsers: RecentUserRow[];
  recentPayouts: RecentPayoutRow[];
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Покупатель',
  manager: 'Покупатель',
  concierge: 'Консьерж',
  admin: 'Админ',
};

function verificationStatus(row: {
  verified_at: string | null;
  is_active: boolean;
}): VerificationRow['status'] {
  if (!row.is_active) return 'rejected';
  if (row.verified_at) return 'approved';
  return 'pending';
}

export async function loadAdminHome(supabase: SupabaseClient): Promise<AdminHomeData> {
  const now = new Date();
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: usersTotal },
    { count: usersNewLast30d },
    { count: suppliersTotal },
    { count: suppliersNewLast30d },
    { data: closedOrdersThisMonth },
    { data: closedOrdersLastMonth },
    { data: verificationCompanies },
    { data: recentUserRows },
    { data: payoutRows },
  ] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }),
    supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', thirtyDaysAgo),
    supabase.from('companies').select('*', { count: 'exact', head: true }).eq('type', 'supplier'),
    supabase
      .from('companies')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'supplier')
      .gte('created_at', thirtyDaysAgo),
    supabase
      .from('orders')
      .select('final_cost_kzt')
      .eq('state', 'closed')
      .gte('closed_at', startOfThisMonth),
    supabase
      .from('orders')
      .select('final_cost_kzt')
      .eq('state', 'closed')
      .gte('closed_at', startOfLastMonth)
      .lt('closed_at', startOfThisMonth),
    supabase
      .from('companies')
      .select('id, name, city, verified_at, is_active, created_at, supplier_profiles(categories)')
      .eq('type', 'supplier')
      .order('created_at', { ascending: false })
      .limit(6),
    supabase
      .from('users')
      .select('id, full_name, role, companies(name)')
      .order('created_at', { ascending: false })
      .limit(4),
    supabase
      .from('supplier_payouts')
      .select('id, amount_kzt, companies(name), orders(requests(title))')
      .order('created_at', { ascending: false })
      .limit(4),
  ]);

  const turnoverThisMonthKzt = (closedOrdersThisMonth ?? []).reduce(
    (sum, o) => sum + (o.final_cost_kzt ?? 0),
    0,
  );
  const turnoverLastMonthKzt = (closedOrdersLastMonth ?? []).reduce(
    (sum, o) => sum + (o.final_cost_kzt ?? 0),
    0,
  );

  const verificationQueue: VerificationRow[] = (verificationCompanies ?? []).map((c) => {
    const profile = Array.isArray(c.supplier_profiles)
      ? c.supplier_profiles[0]
      : c.supplier_profiles;
    return {
      companyId: c.id,
      name: c.name,
      category: profile?.categories?.[0] ?? null,
      city: c.city,
      submittedAt: c.created_at,
      status: verificationStatus(c),
    };
  });
  const pendingVerificationCount = verificationQueue.filter((r) => r.status === 'pending').length;

  const recentUsers: RecentUserRow[] = (recentUserRows ?? []).map((u) => {
    const company = Array.isArray(u.companies) ? u.companies[0] : u.companies;
    return {
      userId: u.id,
      name: u.full_name,
      companyName: company?.name ?? null,
      role: ROLE_LABEL[u.role] ?? u.role,
    };
  });

  const recentPayouts: RecentPayoutRow[] = (payoutRows ?? []).map((p) => {
    const supplier = Array.isArray(p.companies) ? p.companies[0] : p.companies;
    const order = Array.isArray(p.orders) ? p.orders[0] : p.orders;
    const request = order
      ? Array.isArray(order.requests)
        ? order.requests[0]
        : order.requests
      : null;
    return {
      payoutId: p.id,
      orderTitle: request?.title ?? '—',
      supplierName: supplier?.name ?? '—',
      amountKzt: p.amount_kzt,
    };
  });

  return {
    usersTotal: usersTotal ?? 0,
    usersNewLast30d: usersNewLast30d ?? 0,
    suppliersTotal: suppliersTotal ?? 0,
    suppliersNewLast30d: suppliersNewLast30d ?? 0,
    turnoverThisMonthKzt,
    turnoverLastMonthKzt,
    pendingVerificationCount,
    verificationQueue,
    recentUsers,
    recentPayouts,
  };
}
