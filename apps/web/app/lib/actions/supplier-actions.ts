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
  for (const line of lines) {
    if (!Number.isFinite(line.unitPriceKzt) || line.unitPriceKzt <= 0) {
      return { ok: false, error: 'Укажите корректную цену за единицу' };
    }
    if (!Number.isFinite(line.leadTimeDays) || line.leadTimeDays <= 0) {
      return { ok: false, error: 'Укажите корректный срок поставки' };
    }
  }

  const supabase = await createSupabaseServerClient();

  const { data: rfq } = await supabase
    .from('rfqs')
    .select('id, status')
    .eq('id', rfqId)
    .maybeSingle();
  if (!rfq) return { ok: false, error: 'RFQ не найден' };
  if (rfq.status !== 'sent') return { ok: false, error: 'На этот запрос уже дан ответ' };

  const { data: quote, error: quoteError } = await supabase
    .from('quotes')
    .insert({ rfq_id: rfqId, source: 'form' })
    .select('id')
    .single();
  if (quoteError || !quote)
    return { ok: false, error: quoteError?.message ?? 'Не удалось создать КП' };

  const { error: linesError } = await supabase.from('quote_lines').insert(
    lines.map((line) => ({
      quote_id: quote.id,
      request_item_id: line.requestItemId,
      unit_price_kzt: Math.round(line.unitPriceKzt),
      lead_time_days: Math.round(line.leadTimeDays),
      setup_fee_kzt: Math.round(line.setupFeeKzt ?? 0),
      min_qty: line.minQty ?? null,
      capability_confirmed: true,
    })),
  );
  if (linesError) return { ok: false, error: linesError.message };

  const { error: rfqError } = await supabase
    .from('rfqs')
    .update({ status: 'quoted' })
    .eq('id', rfqId);
  if (rfqError) return { ok: false, error: rfqError.message };

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
  const { error } = await supabase.from('rfqs').update({ status: 'declined' }).eq('id', rfqId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/supplier');
  return { ok: true };
}
