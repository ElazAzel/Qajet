import type { SupabaseClient } from '@supabase/supabase-js';
import { checkedQuery, readInBatches, readQueryRows } from './data/query-rows';
import { pickLatestQuoteByRfq } from './latest-quote';

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

/**
 * Отправленное КП, которое ещё не стало заказом этого поставщика (аудит F3).
 * `unconfirmedCount > 0` — в нём остались позиции без отметки «могу исполнить»:
 * они не идут в сравнение, и поставщик должен видеть это у себя, а не узнавать
 * о последствии из письма (аудит F1).
 */
export interface SupplierSentQuoteRow {
  rfqId: string;
  requestTitle: string;
  submittedAt: string;
  unconfirmedCount: number;
}

/** Сколько последних отправленных КП показывать: список не должен расти вечно. */
export const SENT_QUOTES_LIMIT = 10;

export interface SupplierHomeData {
  pendingRfqs: SupplierRfqRow[];
  activeOrders: SupplierOrderRow[];
  sentQuotes: SupplierSentQuoteRow[];
  totalPayoutsKzt: number;
  avgBuyerScore: number | null;
  supplierMembers: SupplierTeamMemberOption[];
}

export async function loadSupplierHome(
  supabase: SupabaseClient,
  companyId: string | null,
): Promise<SupplierHomeData> {
  const [rfqRows, orderRows, payoutRows, statsResult, supplierMembers, quotedRfqRows] =
    await Promise.all([
      readQueryRows(() =>
        supabase
          .from('rfqs')
          .select(
            'id, assigned_supplier_user_id, respond_by, is_exploration, requests(title, companies(name), request_items(name, qty, unit))',
          )
          .eq('status', 'sent'),
      ),
      readQueryRows(() =>
        supabase
          .from('orders')
          .select('id, state, request_id, requests(title, companies(name)), plans(eta_date)')
          .not('state', 'in', '(closed,cancelled)'),
      ),
      readQueryRows(() =>
        supabase.from('supplier_payouts').select('id, amount_kzt').eq('status', 'paid'),
      ),
      companyId
        ? checkedQuery(
            supabase
              .from('supplier_stats')
              .select('avg_buyer_score')
              .eq('company_id', companyId)
              .maybeSingle(),
          )
        : Promise.resolve({ data: null }),
      companyId
        ? readQueryRows(() =>
            supabase
              .from('users')
              .select('id, full_name, role, created_at')
              .eq('company_id', companyId)
              .eq('is_active', true)
              .in('role', ['owner', 'manager']),
          )
        : Promise.resolve(
            [] as { id: string; full_name: string; role: string; created_at: string }[],
          ),
      // RLS ограничивает выборку своей компанией, поэтому отдельной проверки здесь нет.
      readQueryRows(() =>
        supabase.from('rfqs').select('id, request_id, requests(title)').eq('status', 'quoted'),
      ),
    ]);

  // Заказ, в план которого вошёл поставщик, уже виден в «Заказах» — дублировать
  // его среди отправленных КП незачем. RLS отдаёт только такие заказы, поэтому
  // чужой исход (КП не выбрано) отсюда не узнать, и экран этого не утверждает.
  const requestsWithMyOrder = new Set(
    (orderRows ?? []).map((row) => row.request_id as string | null).filter(Boolean),
  );
  const quoteRows = await readInBatches(
    quotedRfqRows.filter((row) => !requestsWithMyOrder.has(row.request_id)).map((row) => row.id),
    (ids) =>
      readQueryRows(() =>
        supabase.from('quotes').select('id, rfq_id, version, submitted_at').in('rfq_id', ids),
      ),
  );
  const latestByRfq = pickLatestQuoteByRfq(quoteRows);
  const sentQuotes: SupplierSentQuoteRow[] = [];
  for (const row of quotedRfqRows ?? []) {
    if (requestsWithMyOrder.has(row.request_id)) continue;
    const latest = latestByRfq.get(row.id);
    if (!latest) continue;
    const request = Array.isArray(row.requests) ? row.requests[0] : row.requests;
    sentQuotes.push({
      rfqId: row.id,
      requestTitle: request?.title ?? '—',
      submittedAt: latest.submitted_at,
      unconfirmedCount: 0,
    });
  }
  sentQuotes.sort(
    (a, b) => b.submittedAt.localeCompare(a.submittedAt) || a.rfqId.localeCompare(b.rfqId),
  );
  sentQuotes.splice(SENT_QUOTES_LIMIT);
  const displayedQuoteIds = sentQuotes
    .map((row) => latestByRfq.get(row.rfqId)?.id)
    .filter((value): value is string => Boolean(value));
  const unconfirmedLines = await readInBatches(displayedQuoteIds, (ids) =>
    readQueryRows(() =>
      supabase
        .from('quote_lines')
        .select('id, quote_id')
        .in('quote_id', ids)
        .eq('capability_confirmed', false),
    ),
  );
  const unconfirmedByQuote = new Map<string, number>();
  for (const line of unconfirmedLines) {
    unconfirmedByQuote.set(line.quote_id, (unconfirmedByQuote.get(line.quote_id) ?? 0) + 1);
  }
  for (const row of sentQuotes) {
    row.unconfirmedCount = unconfirmedByQuote.get(latestByRfq.get(row.rfqId)?.id ?? '') ?? 0;
  }

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
    pendingRfqs: pendingRfqs.sort(
      (a, b) =>
        (a.respondBy ?? '9999').localeCompare(b.respondBy ?? '9999') || a.id.localeCompare(b.id),
    ),
    activeOrders,
    sentQuotes,
    totalPayoutsKzt,
    avgBuyerScore: statsResult.data?.avg_buyer_score ?? null,
    supplierMembers: supplierMembers
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      .map((member) => ({
        id: member.id,
        fullName: member.full_name,
        role: member.role,
      })),
  };
}
