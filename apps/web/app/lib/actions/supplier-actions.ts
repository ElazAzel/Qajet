'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { orderActorFor, requireCurrentUser } from '../current-user';

/**
 * Ответ поставщика на RFQ — agents.md §10 «Поставщик». Через
 * авторизованный dashboard поставщика (демо-логин), а не через защищённую
 * ссылку без входа (agents.md §10 предполагает и такой путь) — тот
 * добавляет отдельный публичный маршрут вне текущей аутентификации,
 * оставлено как честный, ещё не закрытый пробел.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface QuoteLineInput {
  requestItemId: string;
  unitPriceKzt: number;
  leadTimeDays: number;
  setupFeeKzt?: number | undefined;
  minQty?: number | undefined;
}

export async function submitQuote(rfqId: string, lines: QuoteLineInput[]): Promise<ActionResult> {
  const user = await requireCurrentUser();
  if (orderActorFor(user) !== 'supplier') {
    return { ok: false, error: 'Только поставщик может ответить на RFQ' };
  }
  if (lines.length === 0) {
    return { ok: false, error: 'Укажите цену хотя бы по одной позиции' };
  }
  if (new Set(lines.map((line) => line.requestItemId)).size !== lines.length) {
    return { ok: false, error: 'Каждая позиция должна встречаться в КП только один раз' };
  }
  for (const line of lines) {
    if (!Number.isSafeInteger(line.unitPriceKzt) || line.unitPriceKzt <= 0) {
      return { ok: false, error: 'Цена должна быть целым числом тенге больше нуля' };
    }
    if (
      !Number.isInteger(line.leadTimeDays) ||
      line.leadTimeDays <= 0 ||
      line.leadTimeDays > 2147483647
    ) {
      return { ok: false, error: 'Укажите корректный срок поставки' };
    }
    if (!Number.isSafeInteger(line.setupFeeKzt ?? 0) || (line.setupFeeKzt ?? 0) < 0) {
      return {
        ok: false,
        error: 'Стоимость подготовки должна быть целым неотрицательным числом тенге',
      };
    }
    if (
      line.minQty !== undefined &&
      (!Number.isInteger(line.minQty) || line.minQty <= 0 || line.minQty > 2147483647)
    ) {
      return { ok: false, error: 'Минимальное количество должно быть целым числом больше нуля' };
    }
  }

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

  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from('rfqs')
    .update({ status: 'declined' }, { count: 'exact' })
    .eq('id', rfqId)
    .eq('status', 'sent');
  if (error) return { ok: false, error: error.message };
  if (count !== 1) return { ok: false, error: 'Запрос недоступен или на него уже дан ответ' };

  revalidatePath('/supplier');
  revalidatePath(`/supplier/rfq/${rfqId}`);
  return { ok: true };
}
