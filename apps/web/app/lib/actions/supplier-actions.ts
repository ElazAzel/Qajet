'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { orderActorFor, requireCurrentUser } from '../current-user';
import { verifyRfqResponseToken } from '../rfq-response';

/**
 * Ответ поставщика на RFQ и подтверждение доставки — agents.md §10
 * «Поставщик». Все изменения проходят через серверные actions/RPC, а не
 * через доверенный UI-параметр.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface QuoteLineInput {
  requestItemId: string;
  unitPriceKzt: number;
  leadTimeDays: number;
  /** Supplier must explicitly confirm that the quoted work is executable. */
  capabilityConfirmed: boolean;
  setupFeeKzt?: number | undefined;
  minQty?: number | undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Общая серверная валидация для авторизованного и подписанного пути. */
function validateQuoteLines(lines: QuoteLineInput[]): string | null {
  if (!Array.isArray(lines) || lines.length === 0) {
    return 'Укажите цену хотя бы по одной позиции';
  }
  if (lines.some((line) => !line || typeof line !== 'object')) {
    return 'Строка КП указана некорректно';
  }
  if (new Set(lines.map((line) => line.requestItemId)).size !== lines.length) {
    return 'Каждая позиция должна встречаться в КП только один раз';
  }
  for (const line of lines) {
    if (typeof line.requestItemId !== 'string' || !UUID_RE.test(line.requestItemId)) {
      return 'Позиция КП указана некорректно';
    }
    if (!Number.isSafeInteger(line.unitPriceKzt) || line.unitPriceKzt <= 0) {
      return 'Цена должна быть целым числом тенге больше нуля';
    }
    if (
      !Number.isSafeInteger(line.leadTimeDays) ||
      line.leadTimeDays <= 0 ||
      line.leadTimeDays > 2147483647
    ) {
      return 'Укажите корректный срок поставки';
    }
    if (typeof line.capabilityConfirmed !== 'boolean') {
      return 'Подтвердите возможность исполнить позицию';
    }
    if (!Number.isSafeInteger(line.setupFeeKzt ?? 0) || (line.setupFeeKzt ?? 0) < 0) {
      return 'Стоимость подготовки должна быть целым неотрицательным числом тенге';
    }
    if (
      line.minQty !== undefined &&
      (!Number.isSafeInteger(line.minQty) || line.minQty <= 0 || line.minQty > 2147483647)
    ) {
      return 'Минимальное количество должно быть целым числом больше нуля';
    }
  }
  return null;
}

export async function submitQuote(rfqId: string, lines: QuoteLineInput[]): Promise<ActionResult> {
  const user = await requireCurrentUser();
  if (orderActorFor(user) !== 'supplier') {
    return { ok: false, error: 'Только поставщик может ответить на RFQ' };
  }
  if (!UUID_RE.test(rfqId)) {
    return { ok: false, error: 'RFQ указан некорректно' };
  }
  const validationError = validateQuoteLines(lines);
  if (validationError) return { ok: false, error: validationError };

  const supabase = await createSupabaseServerClient();

  // One transaction locks the RFQ and validates item ownership before any
  // writes. A failed line or a second concurrent response leaves no orphan КП.
  const { error } = await supabase.rpc('submit_supplier_quote', {
    p_rfq_id: rfqId,
    p_lines: lines,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/supplier');
  revalidatePath(`/supplier/rfq/${rfqId}`);
  return { ok: true };
}

export async function declineRfq(rfqId: string): Promise<ActionResult> {
  const user = await requireCurrentUser();
  if (orderActorFor(user) !== 'supplier') {
    return { ok: false, error: 'Только поставщик может отказаться от RFQ' };
  }
  if (!UUID_RE.test(rfqId)) {
    return { ok: false, error: 'RFQ указан некорректно' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('decline_supplier_rfq', { p_rfq_id: rfqId });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/supplier');
  revalidatePath(`/supplier/rfq/${rfqId}`);
  return { ok: true };
}

/** Доставка подтверждается поставщиком, а не консьержем или платформой. */
export async function confirmSupplierDelivery(
  orderId: string,
): Promise<ActionResult & { delivered?: boolean }> {
  const user = await requireCurrentUser();
  if (orderActorFor(user) !== 'supplier') {
    return { ok: false, error: 'Только поставщик может подтвердить доставку' };
  }
  if (!UUID_RE.test(orderId)) {
    return { ok: false, error: 'Заказ указан некорректно' };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('confirm_supplier_delivery', {
    p_order_id: orderId,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/supplier');
  revalidatePath(`/supplier/orders/${orderId}`);
  revalidatePath(`/concierge/orders/${orderId}`);
  revalidatePath(`/buyer/orders/${orderId}`);
  return { ok: true, delivered: data === true };
}

/** Быстрый шаг публичной RFQ-ссылки — намерение взять заявку в работу. */
export async function quickRespondRfqByLink(token: string): Promise<ActionResult> {
  const payload = verifyRfqResponseToken(token);
  if (!payload) return { ok: false, error: 'Ссылка RFQ недействительна или истекла' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('quick_respond_rfq_public', {
    p_rfq_id: payload.rfqId,
    p_token: payload.nonce,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/rfq/respond/${token}`);
  return { ok: true };
}

/** Отказ по публичной ссылке также проверяется в БД по исходному nonce. */
export async function declineRfqByLink(token: string): Promise<ActionResult> {
  const payload = verifyRfqResponseToken(token);
  if (!payload) return { ok: false, error: 'Ссылка RFQ недействительна или истекла' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('decline_rfq_public', {
    p_rfq_id: payload.rfqId,
    p_token: payload.nonce,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/supplier');
  revalidatePath(`/rfq/respond/${token}`);
  return { ok: true };
}

/** Полный ответ из публичной ссылки: HMAC и nonce проверяются до RPC. */
export async function submitQuoteByLink(
  token: string,
  lines: QuoteLineInput[],
): Promise<ActionResult> {
  const payload = verifyRfqResponseToken(token);
  if (!payload) return { ok: false, error: 'Ссылка RFQ недействительна или истекла' };
  const validationError = validateQuoteLines(lines);
  if (validationError) return { ok: false, error: validationError };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('submit_rfq_public', {
    p_rfq_id: payload.rfqId,
    p_token: payload.nonce,
    p_lines: lines,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/supplier');
  revalidatePath(`/rfq/respond/${token}`);
  return { ok: true };
}
