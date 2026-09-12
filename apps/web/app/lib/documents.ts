import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Document Engine (agents.md §11.3 «экран подтверждения с реквизитами»,
 * §14 шаг 11 «юридический слой») — до этой правки таблица `documents`
 * существовала в схеме, но ни один путь в apps/web не писал в неё ни
 * строки: order-actions.ts вызывает эти функции в момент перехода стадии
 * заказа (prepaid → счёт на предоплату, closed → акт), той же RLS-сессией
 * текущего актёра, что и остальные записи жизненного цикла — см. новую
 * политику `documents_insert_via_order` (packages/db/src/schema/
 * procurement.ts): покупатель пишет акт по своему же заказу при закрытии,
 * staff — по любому видимому.
 *
 * Документ — не PDF (нет библиотеки рендера и печати в стеке), а
 * структурированный `meta` JSON + `url` на внутренний просмотрщик
 * `/documents/[id]` — тот же принцип, что и остальные «честные
 * упрощения» этого репозитория: реальные данные заказа, реальные
 * реквизиты, без изобретения PDF-рендеринга, которого не просили.
 */

export interface QajetRequisites {
  legalName: string;
  bin: string;
  address: string;
  bankName: string;
  iban: string;
  bik: string;
  phone: string;
  email: string;
}

export interface BuiltDocument {
  url: string;
  meta: Record<string, unknown>;
}

/** Реквизиты QAJET (agents.md §11.3) — settings.qajet_requisites, читается
 *  и покупателем (RLS settings_select_public_requisites), не только staff. */
export async function loadQajetRequisites(
  supabase: SupabaseClient,
): Promise<QajetRequisites | null> {
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'qajet_requisites')
    .maybeSingle();
  return (data?.value as QajetRequisites | undefined) ?? null;
}

interface BuyerCompanyInfo {
  name: string;
  bin: string | null;
}

async function loadBuyerCompanyForRequest(
  supabase: SupabaseClient,
  requestId: string,
): Promise<BuyerCompanyInfo | null> {
  const { data: request } = await supabase
    .from('requests')
    .select('buyer_company_id')
    .eq('id', requestId)
    .maybeSingle();
  if (!request) return null;
  const { data: company } = await supabase
    .from('companies')
    .select('name, bin')
    .eq('id', request.buyer_company_id)
    .maybeSingle();
  return company ? { name: company.name, bin: company.bin } : null;
}

/** Счёт на предоплату — строится до транзакционного перехода в 'prepaid'. */
export async function buildPrepayInvoiceDocument(
  supabase: SupabaseClient,
  order: { id: string; requestId: string },
  invoiceNo: string,
  amountKzt: number,
): Promise<BuiltDocument> {
  const [requisites, buyerCompany] = await Promise.all([
    loadQajetRequisites(supabase),
    loadBuyerCompanyForRequest(supabase, order.requestId),
  ]);

  return {
    url: `/documents/${order.id}?type=prepay_invoice`,
    meta: {
      invoiceNo,
      amountKzt,
      buyerCompany,
      qajetRequisites: requisites,
      issuedAt: new Date().toISOString(),
    },
  };
}

/** Сохраняет счёт на предоплату. Используется legacy-путём и тестами. */
export async function createPrepayInvoiceDocument(
  supabase: SupabaseClient,
  order: { id: string; requestId: string },
  invoiceNo: string,
  amountKzt: number,
): Promise<string | null> {
  const document = await buildPrepayInvoiceDocument(supabase, order, invoiceNo, amountKzt);
  const { error } = await supabase.from('documents').insert({
    order_id: order.id,
    stage: 'prepaid',
    type: 'prepay_invoice',
    url: document.url,
    meta: document.meta,
  });
  return error?.message ?? null;
}

export interface ActItem {
  name: string;
  qty: number;
  unit: string;
}

/** Акт выполненных работ — строится до транзакционного перехода в 'closed'. */
export async function buildActDocument(
  supabase: SupabaseClient,
  order: {
    id: string;
    requestId: string;
    settlement: 'refund' | 'surcharge' | 'exact';
    settlementAmountKzt: number;
    planTotalKzt: number;
    finalCostKzt: number;
  },
  items: readonly ActItem[],
): Promise<BuiltDocument> {
  const [requisites, buyerCompany] = await Promise.all([
    loadQajetRequisites(supabase),
    loadBuyerCompanyForRequest(supabase, order.requestId),
  ]);

  return {
    url: `/documents/${order.id}?type=act`,
    meta: {
      actNo: `ACT-${order.id.slice(0, 8)}`,
      buyerCompany,
      qajetRequisites: requisites,
      planTotalKzt: order.planTotalKzt,
      settlement: order.settlement,
      settlementAmountKzt: order.settlementAmountKzt,
      finalCostKzt: order.finalCostKzt,
      items,
      closedAt: new Date().toISOString(),
    },
  };
}

/** Сохраняет акт. Используется legacy-путём и тестами. */
export async function createActDocument(
  supabase: SupabaseClient,
  order: {
    id: string;
    requestId: string;
    settlement: 'refund' | 'surcharge' | 'exact';
    settlementAmountKzt: number;
    planTotalKzt: number;
    finalCostKzt: number;
  },
  items: readonly ActItem[],
): Promise<string | null> {
  const document = await buildActDocument(supabase, order, items);
  const { error } = await supabase.from('documents').insert({
    order_id: order.id,
    stage: 'closed',
    type: 'act',
    url: document.url,
    meta: document.meta,
  });
  return error?.message ?? null;
}
