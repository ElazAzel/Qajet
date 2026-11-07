import type { SupabaseClient } from '@supabase/supabase-js';
import { loadBuyerPlans } from './buyer-plans';
import { loadQajetRequisites, type QajetRequisites } from './documents';

/**
 * Данные экрана подтверждения заказа — agents.md §11.3, который требует
 * технически зафиксировать и ПОКАЗАТЬ перед подтверждением: юридическое
 * лицо QAJET, БИН, цену, статус НДС, состав заказа, количество, срок,
 * адрес и способ доставки, порядок оплаты, условия возврата.
 *
 * До этого покупатель утверждал план кнопкой прямо на карточке заказа —
 * ни одного из перечисленных реквизитов на экране не было, хотя §11
 * прямо говорит: «эти пункты реализуются технически, а не описываются в
 * документации».
 *
 * Порядок оплаты и условия возврата — не выдуманный текст, а прямая
 * формулировка правил §11.7 (только безналичный перевод на счёт QAJET,
 * без эквайринга) и §7 (закрытие со сверкой предоплаты с фактом: возврат
 * или доплата). Меняются они вместе со спекой, поэтому лежат константами
 * здесь, а не в базе: это не параметр тарифа, а условие сделки.
 */

export const PAYMENT_TERMS =
  'Безналичный перевод на расчётный счёт QAJET. Предоплата выставляется по счёту на P80 оценки, остаток — после приёмки и сверки. Эквайринг, QR-платежи и наличные не принимаются.';

export const RETURN_TERMS =
  'При закрытии заказа предоплата сверяется с фактической стоимостью: разница возвращается на ваш счёт либо выставляется к доплате. Несоответствие приёмке фиксируется как спор до закрытия.';

const VAT_STATUS_LABEL: Record<string, string> = {
  registered: 'плательщик НДС',
  not_registered: 'не плательщик НДС',
  unknown: 'статус НДС не подтверждён',
};

export interface ConfirmationItem {
  name: string;
  qty: number;
  unit: string;
}

export interface OrderConfirmation {
  orderId: string;
  planId: string;
  requestTitle: string;
  planVersion: number;
  totalKzt: number;
  deliveryKzt: number;
  supplierRebateKzt: number;
  etaDate: string | null;
  deadlineDate: string | null;
  deliveryAddress: string | null;
  city: string | null;
  items: ConfirmationItem[];
  buyerCompany: { name: string; bin: string | null; vatStatusLabel: string } | null;
  qajet: QajetRequisites | null;
}

export async function loadOrderConfirmation(
  supabase: SupabaseClient,
  orderId: string,
): Promise<OrderConfirmation | null> {
  const { data: order } = await supabase
    .from('orders')
    .select('id, request_id, approved_plan_id, state')
    .eq('id', orderId)
    .maybeSingle();
  if (!order?.approved_plan_id) return null;

  const { data: request } = await supabase
    .from('requests')
    .select('title, deadline_date, delivery_address, city, buyer_company_id')
    .eq('id', order.request_id)
    .maybeSingle();
  if (!request) return null;

  const plans = await loadBuyerPlans(supabase, [order.request_id]);
  const plan = plans.find((row) => row.id === order.approved_plan_id);
  if (!plan) return null;

  const { data: itemRows } = await supabase
    .from('request_items')
    .select('name, qty, unit')
    .eq('request_id', order.request_id);

  const { data: company } = await supabase
    .from('companies')
    .select('name, bin, vat_status')
    .eq('id', request.buyer_company_id)
    .maybeSingle();

  return {
    orderId: order.id,
    planId: order.approved_plan_id,
    requestTitle: request.title,
    planVersion: plan.version,
    totalKzt: plan.total_kzt,
    deliveryKzt: plan.delivery_kzt,
    supplierRebateKzt: plan.supplier_rebate_kzt,
    etaDate: plan.eta_date,
    deadlineDate: request.deadline_date,
    deliveryAddress: request.delivery_address,
    city: request.city,
    items: (itemRows ?? []).map((row) => ({ name: row.name, qty: row.qty, unit: row.unit })),
    buyerCompany: company
      ? {
          name: company.name,
          bin: company.bin,
          vatStatusLabel: VAT_STATUS_LABEL[company.vat_status] ?? VAT_STATUS_LABEL.unknown ?? '—',
        }
      : null,
    qajet: await loadQajetRequisites(supabase),
  };
}
