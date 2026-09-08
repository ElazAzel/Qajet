import { type CombineResult, combine, type QuoteOffer } from '@qajet/engine/combine';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Загрузка данных для экрана сравнения (agents.md §8D, §12) — единственное
 * место, где строки из Supabase превращаются в вход combine(). Буфер
 * логистики и стоимость доставки по городу — то же правило, что и в
 * packages/db/src/seed/generator.ts (сид генерирует историю тем же
 * combine(), поэтому вычисления обязаны совпадать).
 *
 * supplierHistory для предсказания срока намеренно пустая: без сохранённой
 * истории k' сходится к 1.0 (agents.md §8: «сдвиг к базовому 1.0 при малом
 * N»), что даёт корректный прогноз = заявленный срок + буфер логистики.
 *
 * ВАЖНО: результат содержит offerSupplierNames — реальные названия
 * компаний-исполнителей. agents.md §10 «Покупатель»: личность исполнителя
 * покупателю не раскрывается ни в UI, ни в данных, которые может прочитать
 * его сессия. Вызывать эту функцию можно только из concierge/admin-гейтед
 * маршрутов (сегодня: /concierge/orders/[id], proposePlan в
 * order-actions.ts) — НИКОГДА из buyer-роута. RLS на `companies` уже не
 * даёт покупательской сессии разрешить чужой company_id в имя (защита в
 * глубину), но эта функция не должна давать шанс проверить это на практике.
 */

const LOGISTICS_BUFFER_ALMATY_DAYS = 1;
const LOGISTICS_BUFFER_INTERCITY_DAYS = 3;
const DELIVERY_ALMATY_KZT = 5_000;
const DELIVERY_INTERCITY_KZT = 15_000;
const FALLBACK_COMMISSION_RATE_PCT = 12;
const FALLBACK_CIT_RATE_PCT = 20;

export interface ComparisonItem {
  id: string;
  name: string;
  category: string;
  qty: number;
  unit: string;
}

export interface RequestComparison {
  requestId: string;
  requestTitle: string;
  deadlineDate: string | null;
  items: ComparisonItem[];
  offerSupplierNames: Map<string, string>;
  result: CombineResult;
}

export async function loadRequestComparison(
  supabase: SupabaseClient,
  requestId: string,
): Promise<RequestComparison | null> {
  const { data: request } = await supabase
    .from('requests')
    .select('id, title, deadline_date')
    .eq('id', requestId)
    .maybeSingle();
  if (!request) return null;

  const { data: items } = await supabase
    .from('request_items')
    .select('id, name, category, qty, unit')
    .eq('request_id', requestId);
  if (!items || items.length === 0) return null;

  const { data: rfqs } = await supabase
    .from('rfqs')
    .select('id, supplier_company_id')
    .eq('request_id', requestId);
  const rfqList = rfqs ?? [];
  const supplierIdByRfqId = new Map(rfqList.map((rfq) => [rfq.id, rfq.supplier_company_id]));
  const supplierIds = [...new Set(rfqList.map((rfq) => rfq.supplier_company_id))];

  const { data: suppliers } = supplierIds.length
    ? await supabase.from('companies').select('id, name, city, tax_mode').in('id', supplierIds)
    : { data: [] };
  const supplierById = new Map((suppliers ?? []).map((s) => [s.id, s]));

  const rfqIds = rfqList.map((rfq) => rfq.id);
  const { data: quotes } = rfqIds.length
    ? await supabase.from('quotes').select('id, rfq_id, valid_until').in('rfq_id', rfqIds)
    : { data: [] };
  const quoteList = quotes ?? [];
  const rfqIdByQuoteId = new Map(quoteList.map((q) => [q.id, q.rfq_id]));
  const validUntilByQuoteId = new Map(quoteList.map((q) => [q.id, q.valid_until as string | null]));

  const quoteIds = quoteList.map((q) => q.id);
  const { data: quoteLines } = quoteIds.length
    ? await supabase
        .from('quote_lines')
        .select(
          'id, quote_id, request_item_id, unit_price_kzt, min_qty, setup_fee_kzt, lead_time_days, bundle_rule, capability_confirmed, field_flags',
        )
        .in('quote_id', quoteIds)
    : { data: [] };

  const { data: settingsRows } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', ['commission_rate_pct', 'cit_rate_pct']);
  const settingsMap = new Map((settingsRows ?? []).map((s) => [s.key, s.value as number]));
  const commissionRatePct = settingsMap.get('commission_rate_pct') ?? FALLBACK_COMMISSION_RATE_PCT;
  const citRatePct = settingsMap.get('cit_rate_pct') ?? FALLBACK_CIT_RATE_PCT;

  const offers: QuoteOffer[] = [];
  const offerSupplierNames = new Map<string, string>();

  for (const line of quoteLines ?? []) {
    const rfqId = rfqIdByQuoteId.get(line.quote_id);
    const supplierId = rfqId ? supplierIdByRfqId.get(rfqId) : undefined;
    const supplier = supplierId ? supplierById.get(supplierId) : undefined;
    if (!supplierId || !supplier) continue;

    const isAlmaty = supplier.city === 'Алматы';
    const bundleRule = line.bundle_rule as { thresholdKzt: number; discountPct: number } | null;
    const fieldFlags = (line.field_flags ?? {}) as Record<string, unknown>;

    offers.push({
      id: line.id,
      requestItemId: line.request_item_id,
      supplierId,
      unitPriceKzt: line.unit_price_kzt,
      setupFeeKzt: line.setup_fee_kzt,
      predictedLeadDays:
        line.lead_time_days +
        (isAlmaty ? LOGISTICS_BUFFER_ALMATY_DAYS : LOGISTICS_BUFFER_INTERCITY_DAYS),
      minQty: line.min_qty,
      orderMultiple: null,
      bundleRule,
      capabilityConfirmed: line.capability_confirmed,
      hasOpenFieldFlags: Object.keys(fieldFlags).length > 0,
      validUntil: validUntilByQuoteId.get(line.quote_id) ?? null,
      supplierTaxMode: supplier.tax_mode as QuoteOffer['supplierTaxMode'],
      supplierDeliveryKzt: isAlmaty ? DELIVERY_ALMATY_KZT : DELIVERY_INTERCITY_KZT,
    });
    offerSupplierNames.set(line.id, supplier.name);
  }

  const today = new Date().toISOString().slice(0, 10);
  const deadlineDate = request.deadline_date ?? today;

  const result = combine({
    items: items.map((item) => ({ id: item.id, qty: item.qty })),
    offers,
    deadlineDate,
    today,
    commissionRatePct,
    citRatePct,
  });

  return {
    requestId: request.id,
    requestTitle: request.title,
    deadlineDate: request.deadline_date,
    items,
    offerSupplierNames,
    result,
  };
}
